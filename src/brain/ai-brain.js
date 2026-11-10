import { createLogger } from '../utils/logger.js';
import { validateToolCall } from './tool-validator.js';
import { RateLimiter } from '../utils/rate-limiter.js';
import { LoopDetector } from '../safety/loop-detector.js';
import { getSystemPrompt } from '../../config/personality.js';
import { telemetry } from '../utils/telemetry.js';

const logger = createLogger('AI');

export const AgentAIState = {
  IDLE: 'IDLE',
  THINKING: 'THINKING',
  WAITING_API: 'WAITING_API',
  EXECUTING: 'EXECUTING',
  LOCAL_MODE: 'LOCAL_MODE',
  RECOVERING: 'RECOVERING',
};

/**
 * AI Brain — the main AI orchestrator with lifecycle management,
 * request cancellation (AbortController), and a strict activeRequests <= 1 invariant.
 */
export class AIBrain {
  constructor(config, toolRegistry, contextManager, provider, memoryManager = null, options = {}) {
    this.config = config;
    this.toolRegistry = toolRegistry;
    this.contextManager = contextManager;
    this.provider = provider;
    this.memoryManager = memoryManager;
    this.budgetManager = options.budgetManager || null;
    this.agentName = options.agentName || 'unknown';
    this.actionAdmission = options.actionAdmission || null;
    this.fidgetController = options.fidgetController || null;
    this.bot = options.bot || null;
    this.session = null;
    this.maxIterations = 10;
    this.processTimeout = 25000; // 25-second maximum timeout
    this.isProcessing = false;
    this.activeRequests = 0;
    this.state = AgentAIState.IDLE;
    this.currentAbortController = null;
    this.telemetryRequestController = null;
    this.localModeUntil = 0;
    this.localModeCooldownMs = config?.ai?.localModeCooldownMs ?? 30000;
    this.loopDetector = new LoopDetector(4);

    const maxRequests = config?.ai?.rateLimit?.maxRequests ?? 10;
    const windowMs = config?.ai?.rateLimit?.windowMs ?? 60000;
    this.rateLimiter = new RateLimiter(maxRequests, windowMs);

    logger.info('AI Brain initialized (State: IDLE, activeRequests: 0)');
  }

  setBot(bot) {
    this.bot = bot;
    if (this.fidgetController) this.fidgetController.setBot(bot);
  }

  setFidgetController(fidgetController) {
    this.fidgetController = fidgetController;
    if (this.bot && fidgetController) fidgetController.setBot(this.bot);
  }

  getState() {
    return this.state;
  }

  /**
   * Force-cancel the current AI request (for example, when an urgent player command arrives)
   */
  cancelActiveRequest(reason = 'Cancelled by system') {
    const hadActive = this.activeRequests > 0 || this.isProcessing;
    if (this.currentAbortController) {
      logger.warn(`[AI CANCEL] Cancelling active request: ${reason}`);
      this.currentAbortController.abort();
      if (hadActive) telemetry.increment('cancelledRequests');
    }
    if (hadActive || /unresponsive/i.test(reason)) {
      this.state = AgentAIState.LOCAL_MODE;
      this.localModeUntil = Date.now() + this.localModeCooldownMs;
      telemetry.enterLocalMode(this.agentName);
      if (hadActive) {
        this.activeRequests = 0;
        this.isProcessing = false;
        if (this.telemetryRequestController === this.currentAbortController) {
          telemetry.decrement('activeLLMRequests');
          telemetry.decrement('activeRequests');
          this.telemetryRequestController = null;
        }
        this.currentAbortController = null;
      }
    }
  }

  /**
   * Main entry point — process a user message.
   * @param {string} message — message from the player
   * @param {object} worldState — current world state
   * @param {string} [currentTask] — current task (optional)
   * @returns {Promise<string>} — AI response
   */
  async processMessage(message, worldState, currentTask = null) {
    // A direct player message always interrupts silence and exits local mode
    this.state = AgentAIState.IDLE;
    this.localModeUntil = 0;
    telemetry.leaveLocalMode(this.agentName);
    // STRICT INVARIANT: activeRequests <= 1
    if (this.activeRequests >= 1) {
      logger.warn(`[AI REJECT] Request rejected: another request is active (State: ${this.state}, activeRequests: ${this.activeRequests})`);
      return 'Wait, I'm still thinking about the previous request...';
    }

    this.activeRequests = 1;
    this.isProcessing = true;
    this.state = AgentAIState.THINKING;
    this.fidgetController?.startThinking(this.bot);
    this.currentAbortController = new AbortController();
    const requestController = this.currentAbortController;

    telemetry.increment('totalLLMCalls');

    let budgetGranted = false;
    if (this.budgetManager) {
      budgetGranted = await this.budgetManager.requestSlot(this.agentName, 'event_driven', 'message', {
        signal: requestController.signal,
      });
      if (!budgetGranted) {
        this.state = AgentAIState.LOCAL_MODE;
        this.localModeUntil = Date.now() + this.localModeCooldownMs;
        telemetry.enterLocalMode(this.agentName);
        this.activeRequests = 0;
        this.isProcessing = false;
        return null;
      }
    }

    telemetry.increment('activeLLMRequests');
    telemetry.increment('activeRequests');
    this.telemetryRequestController = requestController;

    const startTime = Date.now();
    logger.info(`[REQUEST] "${message}"`);

    try {
      const response = await this._processWithTimeout(
        this._processInternal(message, worldState, currentTask, requestController.signal),
        this.processTimeout,
        requestController.signal,
        requestController
      );

      this.state = AgentAIState.IDLE;
      this.localModeUntil = 0;
      telemetry.leaveLocalMode(this.agentName);
      telemetry.increment('successfulLLMCalls');
      telemetry.increment('completedRequests');
      telemetry.recordChatLatency(Date.now() - startTime);

      return response;
    } catch (error) {
      if (error.name === 'AbortError' || error.message.includes('Cancelled')) {
        logger.warn(`AI request was successfully cancelled: ${error.message}`);
        this.session = null;
        this.state = AgentAIState.LOCAL_MODE;
        this.localModeUntil = Date.now() + this.localModeCooldownMs;
        return null;
      }

      if (error.name === 'TimeoutError' || error.message.includes('timeout')) {
        telemetry.increment('timedOutRequests');
        telemetry.increment('timeouts');
        this.state = AgentAIState.LOCAL_MODE;
        this.session = null;
        this.localModeUntil = Date.now() + this.localModeCooldownMs;
        telemetry.enterLocalMode(this.agentName);
        logger.warn(`[AI TIMEOUT] Response timed out (${this.processTimeout} ms); switching to LOCAL_MODE`);
        return null;
      }

      logger.error(`Error processing message: ${error.message}`);
      this.session = null;
      this.state = AgentAIState.LOCAL_MODE;
      this.localModeUntil = Date.now() + this.localModeCooldownMs;
      telemetry.enterLocalMode(this.agentName);
      return null;
    } finally {
      this.fidgetController?.stopThinking();
      if (this.budgetManager && budgetGranted) this.budgetManager.releaseSlot(this.agentName);
      // Only the owning request may clear the in-flight state (prevents stale requests
      // completing after cancellation from corrupting a newer request's counters).
      if (this.currentAbortController === requestController) {
        this.activeRequests = 0;
        this.isProcessing = false;
        this.currentAbortController = null;
        if (this.telemetryRequestController === requestController) {
          telemetry.decrement('activeLLMRequests');
          telemetry.decrement('activeRequests');
          this.telemetryRequestController = null;
        }
      }
    }
  }

  /**
   * Timeout wrapper with AbortSignal support
   * @private
   */
  _processWithTimeout(promise, timeoutMs, abortSignal, requestController = null) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const settle = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (abortSignal) abortSignal.removeEventListener('abort', onAbort);
        fn(value);
      };

      const timer = setTimeout(() => {
        requestController?.abort();
        const error = new Error(`AI processing time expired (${timeoutMs / 1000} seconds)`);
        error.name = 'TimeoutError';
        settle(reject, error);
      }, timeoutMs);

      const onAbort = () => {
        const error = new Error('AI request was cancelled');
        error.name = 'AbortError';
        settle(reject, error);
      };

      if (abortSignal) {
        if (abortSignal.aborted) {
          onAbort();
          return;
        }
        abortSignal.addEventListener('abort', onAbort);
      }

      promise
        .then((res) => settle(resolve, res))
        .catch((err) => settle(reject, err));
    });
  }

  _maybeLeaveLocalMode() {
    if (
      this.state === AgentAIState.LOCAL_MODE &&
      !this.isProcessing &&
      this.localModeUntil > 0 &&
      Date.now() >= this.localModeUntil
    ) {
      this.state = AgentAIState.IDLE;
      this.localModeUntil = 0;
      telemetry.leaveLocalMode(this.agentName);
    }
  }

  /**
   * Internal processing with a function-calling loop.
   */
  async _processInternal(message, worldState, currentTask, abortSignal = null) {
    // Wait for a rate limiter slot
    await this.rateLimiter.waitForSlot(abortSignal);

    // Build context using world state and memory
    const context = this.contextManager.buildContext(
      worldState,
      currentTask,
      [],
      this.memoryManager
    );
    const fullMessage = context ? `${context}\n\n${message}` : message;

    // Create or reuse a session
    if (!this.session) {
      const tools = this.toolRegistry.getFunctionDeclarations();
      const systemPrompt = getSystemPrompt(this.config);

      this.session = await this.provider.createChat({
        systemPrompt,
        tools,
      });
      logger.info(`New AI session created (tools: ${tools.length})`);
    }

    this.state = AgentAIState.WAITING_API;
    // Send the message
    let response = await this.provider.sendMessage(this.session, fullMessage, { signal: abortSignal });
    let iteration = 0;

    // Function calling loop
    while (response.toolCalls && response.toolCalls.length > 0 && iteration < this.maxIterations) {
      iteration++;
      this.state = AgentAIState.EXECUTING;
      logger.info(`[TOOL LOOP] Iteration ${iteration}/${this.maxIterations}: calls [${response.toolCalls.map(tc => tc.name).join(', ')}]`);

      const toolResults = [];

      for (const tc of response.toolCalls) {
        if (this.actionAdmission && !this.actionAdmission()) {
          toolResults.push({
            id: tc.id,
            name: tc.name,
            result: {
              success: false,
              code: 'ACTION_UNAVAILABLE_PHASE1',
              error: 'Gameplay tools are temporarily unavailable during the actuator-safety rollout.',
            },
          });
          continue;
        }
        if (this.loopDetector.recordAndCheck(tc.name, tc.args || {})) {
          telemetry.increment('repeatedActionCount');
          toolResults.push({
            id: tc.id,
            name: tc.name,
            result: {
              success: false,
              error: `Call to ${tc.name} is repeating without changes. Change the parameters or choose a different approach.`,
            },
          });
          continue;
        }

        const toolDef = this.toolRegistry.get(tc.name);
        const validation = validateToolCall(toolDef, tc.args || {});
        if (!validation.valid) {
          logger.warn(`Validation failed for ${tc.name}: ${validation.errors.join(', ')}`);
          toolResults.push({
            id: tc.id,
            name: tc.name,
            result: { success: false, error: `Validation error: ${validation.errors.join(', ')}` },
          });
          continue;
        }

        try {
          logger.info(`[ACTION] Executing: ${tc.name}(${JSON.stringify(tc.args)})`);
          const result = await this.toolRegistry.execute(tc.name, tc.args || {});

          if (tc.name === 'run_code' && result && result.success === false) {
            logger.warn(`[SELF_HEALING] Script error: ${result.error}. Passing diagnostics for automatic repair.`);
            if (!result.instruction) {
              result.instruction = 'Your script encountered an error. Analyze the diagnostics and fix it by calling run_code with corrected code in this same turn.';
            }
          }

          toolResults.push({ id: tc.id, name: tc.name, result });
        } catch (error) {
          logger.error(`[ACTION] Error in ${tc.name}: ${error.message}`);
          toolResults.push({
            id: tc.id,
            name: tc.name,
            result: { success: false, error: error.message },
          });
        }
      }

      // Send the results back to the AI
      await this.rateLimiter.waitForSlot(abortSignal);
      this.state = AgentAIState.WAITING_API;
      response = await this.provider.sendToolResults(this.session, toolResults, { signal: abortSignal });
    }

    if (iteration >= this.maxIterations) {
      logger.warn('Function-calling iteration limit reached');
      return 'I have performed too many actions in a row, so I stopped. Tell me what to do next.';
    }

    let reply = (response.text || '').trim();

    // Do not force capitalization or fill silence with a canned "Got it!".
    // If the model has already completed actions and stays silent, silence is more natural
    // than a fake acknowledgement. Return an empty response as an empty string so
    // the calling code can decide what to do (usually, remain silent).
    logger.info(`[RESPONSE] "${reply.substring(0, 200)}"`);

    this.contextManager.addToHistory('user', message);
    if (reply.length > 0) this.contextManager.addToHistory('bot', reply);

    return reply;
  }

  /**
   * A quick standalone LLM request for a short natural response — without function
   * calling or a session, and with a short timeout. Used by speech generators
   * (ResponseGenerator, etc.) to AVOID falling back to canned phrases.
   *
   * @param {string} prompt — ready-to-use prompt
   * @param {object} options — { maxTokens, temperature, stopSequences, systemPrompt, timeoutMs }
   * @returns {Promise<{text: string}>}
   */
  async generateQuickResponse(prompt, options = {}) {
    if (!this.provider?.generateText) {
      return { text: '' };
    }

    const timeoutMs = options.timeoutMs ?? 1500;
    const call = this.provider.generateText({
      systemPrompt: options.systemPrompt || '',
      userPrompt: prompt,
      temperature: options.temperature ?? 0.9,
      maxTokens: options.maxTokens ?? 30,
      stopSequences: options.stopSequences,
    });

    try {
      const text = await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('quick response timeout')), timeoutMs);
        call.then(
          (v) => { clearTimeout(t); resolve(v); },
          (e) => { clearTimeout(t); reject(e); }
        );
      });
      return { text: String(text || '').trim() };
    } catch (err) {
      logger.debug(`generateQuickResponse failed: ${err.message}`);
      return { text: '' };
    }
  }

  /**
   * Reset the AI session (for example, when the context changes).
   */
  resetSession() {
    this.session = null;
    this.loopDetector.reset();
    logger.info('AI session reset');
  }

  /**
   * Stop the current processing.
   */
  stop() {
    this.cancelActiveRequest('AIBrain stop called');
    this.loopDetector.reset();
    logger.info('AI Brain stopped');
  }
}
