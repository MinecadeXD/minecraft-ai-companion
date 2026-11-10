import { AIProvider } from './ai-provider.js';
import { createLogger } from '../utils/logger.js';
import { telemetry } from '../utils/telemetry.js';

const logger = createLogger('AI_OPENAI_COMPATIBLE');

/**
 * OpenAI-Compatible AI Provider (Tooken Club / OpenAI / Local LLMs).
 * Full support for Chat Completions, tool calling, multi-turn reasoning,
 * exponential-backoff retries, and error isolation.
 */
export class OpenAICompatibleProvider extends AIProvider {
  /**
   * @param {Object} config
   */
  constructor(config) {
    super(config);
    this.apiKey =
      config?.ai?.openaiCompatibleApiKey ||
      config?.ai?.openaiApiKey ||
      process.env.OPENAI_COMPATIBLE_API_KEY ||
      process.env.OPENAI_API_KEY ||
      'ollama';

    const configuredProvider = String(config?.ai?.provider || process.env.AI_PROVIDER || '').toLowerCase();
    this.isOllama = configuredProvider === 'ollama';
    const rawBaseUrl =
      config?.ai?.openaiCompatibleBaseUrl ||
      process.env.OPENAI_COMPATIBLE_BASE_URL ||
      (configuredProvider === 'ollama'
        ? 'http://127.0.0.1:11434/v1'
        : (config?.ai?.openaiBaseUrl || process.env.OPENAI_BASE_URL || 'https://tooken.club/v1'));

    this.baseUrl = rawBaseUrl.replace(/\/+$/, '').replace('//localhost:11434', '//127.0.0.1:11434');
    this.model = config?.ai?.model || process.env.AI_MODEL || 'gpt-5.6-luna';
    this.maxRetries = config?.ai?.maxRetries ?? 3;
    this.timeoutMs = config?.ai?.timeoutMs ?? 35000;
    this.maxCompletionTokens = config?.ai?.maxCompletionTokens ?? config?.ai?.maxTokens ?? 512;
    this.maxContextMessages = config?.ai?.maxContextMessages ?? 24;
    this.temperature = config?.ai?.temperature ?? 0.75;
    this.fallbackOnTimeout = config?.ai?.fallbackOnTimeout === true;
    this.cooldownUntil = 0;

    const maskedKey = this.apiKey.length > 8
      ? `${this.apiKey.substring(0, 4)}...${this.apiKey.substring(this.apiKey.length - 4)}`
      : '***';

    logger.info(`OpenAI-compatible provider initialized: model="${this.model}", baseUrl="${this.baseUrl}", key=${maskedKey}`);
  }

  get name() {
    return `OpenAI-Compatible (${this.model} @ ${this.baseUrl})`;
  }

  /**
   * Check model availability through GET /models
   * @returns {Promise<{available: boolean, models: string[], error?: string}>}
   */
  async listModels() {
    const url = `${this.baseUrl}/models`;
    logger.debug(`Requesting model list: GET ${url}`);

    try {
      const response = await this._fetchWithTimeout(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
        },
      });

      if (!response.ok) {
        const text = await response.text();
        return { available: false, models: [], error: `HTTP ${response.status}: ${text}` };
      }

      const data = await response.json();
      const models = Array.isArray(data.data)
        ? data.data.map(m => m.id || m.name).filter(Boolean)
        : Array.isArray(data)
        ? data.map(m => m.id || m.name || String(m))
        : [];

      return {
        available: true,
        models,
        hasCurrentModel: models.includes(this.model),
      };
    } catch (err) {
      logger.warn(`Failed to fetch model list from ${url}: ${err.message}`);
      return { available: false, models: [], error: err.message };
    }
  }

  /**
   * Create a chat session with tools.
   * @param {Object} options
   * @param {string} [options.systemPrompt]
   * @param {Array<Object>} [options.tools]
   * @returns {Promise<Object>}
   */
  async createChat({ systemPrompt, tools, personality, emotionalState, socialContext } = {}) {
    const formattedTools = tools && tools.length > 0
      ? tools.map(t => ({
          type: 'function',
          function: {
            name: t.name,
            description: t.description || '',
            parameters: t.parameters || { type: 'object', properties: {} },
          },
        }))
      : [];

    const shouldEnrich = this.isOllama || personality || emotionalState || socialContext;
    const enrichedPrompt = shouldEnrich
      ? this._enrichRussianPrompt(systemPrompt, { personality, emotionalState, socialContext })
      : (systemPrompt || '');
    const session = {
      model: this.model,
      systemPrompt: enrichedPrompt,
      tools: formattedTools.length > 0 ? formattedTools : undefined,
      messages: [],
      lastPendingToolCalls: [], // Array<{ id: string, name: string }>
    };

    if (enrichedPrompt) {
      session.messages.push({ role: 'system', content: enrichedPrompt });
    }

    logger.debug(`Chat session created (tools: ${formattedTools.length})`);
    return session;
  }

  /**
   * Send a user message and return the response (including possible tool calls).
   * @param {Object} session
   * @param {string} message
   * @returns {Promise<{text: string, toolCalls: Array<{name: string, args: Object, id?: string}>, raw: any}>}
   */
  async sendMessage(session, message, options = {}) {
    this._throwIfAborted(options.signal);
    session.messages.push({ role: 'user', content: message });
    try {
      return await this._callCompletionsWithRetry(session, options.signal);
    } catch (error) {
      if ((options.allowFallback || this.fallbackOnTimeout) && (error.name === 'TimeoutError' || /timeout|fetch failed|network|econnrefused|enotfound/i.test(error.message || ''))) {
        logger.warn('Local model unavailable; remain silent instead of spamming errors');
        return { text: '', toolCalls: [], raw: null, fallback: true };
      }
      throw error;
    }
  }

  /**
   * Send tool results back to the model.
   * @param {Object} session
   * @param {Array<{name: string, result: any}>} results
   * @returns {Promise<{text: string, toolCalls: Array<{name: string, args: Object, id?: string}>, raw: any}>}
   */
  async sendToolResults(session, results, options = {}) {
    this._throwIfAborted(options.signal);
    const pending = session.lastPendingToolCalls || [];

    for (let i = 0; i < results.length; i++) {
      const res = results[i];
      // Match the result to the corresponding tool-call ID
      const matched = (res.id && pending.find(p => p.id === res.id)) || pending.find(p => p.name === res.name) || pending[i];
      const toolCallId = matched ? matched.id : `call_${Date.now()}_${i}`;

      const contentStr = typeof res.result === 'object'
        ? JSON.stringify(res.result)
        : String(res.result ?? '');

      session.messages.push({
        role: 'tool',
        tool_call_id: toolCallId,
        name: res.name,
        content: contentStr,
      });
    }

    session.lastPendingToolCalls = [];
    return await this._callCompletionsWithRetry(session, options.signal);
  }

  /** A stateless local vision request. Used by the continuous perception loop. */
  async analyzeVision(observation, prompt, options = {}) {
    const content = [{ type: 'text', text: `${prompt}\n\nFIRST-PERSON OBSERVATION:\n${observation}` }];
    if (options.imageDataUrl) {
      content.push({ type: 'image_url', image_url: { url: options.imageDataUrl } });
    }
    const response = await this._fetchWithTimeout(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: options.model || this.model,
        temperature: 0.35,
        max_completion_tokens: options.maxTokens || 180,
        messages: [{ role: 'system', content: 'Return only valid JSON. Never invent unavailable actions.' }, { role: 'user', content }],
      }),
      signal: options.signal,
    });
    if (!response.ok) throw new Error(`Local vision HTTP ${response.status}: ${await response.text()}`);
    const data = await response.json();
    return data?.choices?.[0]?.message?.content || '';
  }

  /**
   * Generate a one-off text response (chat line, thought, or dialogue).
   * @param {string|Object} promptOrOptions
   * @param {Object} [options]
   * @returns {Promise<string>}
   */
  async generateText(promptOrOptions, options = {}) {
    let userPrompt = '';
    let systemPrompt = '';
    let opts = {};

    if (typeof promptOrOptions === 'string') {
      userPrompt = promptOrOptions;
      opts = options || {};
      systemPrompt = opts.systemPrompt || opts.systemInstruction || '';
    } else if (promptOrOptions && typeof promptOrOptions === 'object') {
      opts = promptOrOptions;
      userPrompt = opts.userPrompt || opts.prompt || '';
      systemPrompt = opts.systemPrompt || opts.systemInstruction || '';
    }

    const messages = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    if (userPrompt) {
      messages.push({ role: 'user', content: userPrompt });
    }

    if (messages.length === 0) {
      return '';
    }

    const payload = {
      model: opts.model || this.model,
      messages,
      temperature: opts.temperature ?? this.temperature ?? 0.8,
      max_completion_tokens: opts.maxTokens || opts.maxCompletionTokens || this.maxCompletionTokens || 120,
    };

    if (opts.stopSequences || opts.stop) {
      payload.stop = opts.stopSequences || opts.stop;
    }

    if (this.isOllama) {
      payload.options = { num_ctx: 4096 };
    }

    try {
      const response = await this._fetchWithTimeout(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: opts.signal,
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`generateText HTTP ${response.status}: ${errText}`);
      }

      const data = await response.json();
      const content = data?.choices?.[0]?.message?.content || '';
      return content.trim();
    } catch (err) {
      logger.error(`generateText error: ${err.message}`);
      throw err;
    }
  }


  /**
   * Call the Chat Completions API with retries (exponential backoff)
   * @private
   */
  async _callCompletionsWithRetry(session, signal = null) {
    let lastError = null;

    if (Date.now() < this.cooldownUntil) {
      const error = new Error('API cooldown active');
      error.retryable = false;
      throw error;
    }

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const payload = {
          model: session.model,
          messages: this._trimMessages(session.messages),
          max_completion_tokens: this.maxCompletionTokens,
          temperature: this.temperature,
        };
        if (this.isOllama) payload.options = { num_ctx: 16384 };

        if (session.tools && session.tools.length > 0) {
          payload.tools = session.tools;
          payload.tool_choice = 'auto';
        }

        logger.debug(`[API CALL #${attempt + 1}] Sending to ${this.baseUrl}/chat/completions (messages: ${session.messages.length})`);
        const startTime = Date.now();

        const response = await this._fetchWithTimeout(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(payload),
          signal,
        });

        const elapsed = Date.now() - startTime;

        if (!response.ok) {
          const status = response.status;
          const errBody = await response.text();
          if (status === 400) telemetry.increment('HTTP400');
          if (status === 429) { telemetry.increment('HTTP429'); telemetry.increment('rateLimit429Count'); }

          if (status === 400) {
            const error = new Error(`API HTTP 400: ${errBody}`);
            error.httpStatus = 400;
            try { error.retryable = JSON.parse(errBody)?.error?.retryable === true; } catch {}
            throw error;
          }

          // Retrying authorization errors is pointless
          if (status === 401 || status === 403) {
            throw new Error(`API authorization error (${status}): ${errBody}`);
          }

          // 429 indicates overload: use a short pause instead of a long block
          if (status === 429) {
            this.cooldownUntil = Date.now() + 5000; // 5 seconds instead of 30
            const error = new Error(`API HTTP 429: ${errBody}`);
            error.httpStatus = 429;
            error.retryable = false;
            throw error;
          }

          // Retry 5xx errors a limited number of times with a delay.
          if (status >= 500 && status < 600) {
            const isLast = attempt === this.maxRetries;
            const waitMs = Math.min(10000, 1000 * Math.pow(2, attempt) + Math.random() * 500);
            logger.warn(`API returned status ${status} (${elapsed} ms). ${isLast ? 'No retries remain.' : `Retrying in ${Math.round(waitMs)} ms...`}`);

            if (!isLast) {
              await new Promise((resolve, reject) => {
                const timer = setTimeout(resolve, waitMs);
                signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
              });
              continue;
            }
          }

          throw new Error(`API HTTP ${status}: ${errBody}`);
        }

        const data = await response.json();
        logger.debug(`[API RESPONSE] Received response (${elapsed} ms)`);

        return this._parseChatResponse(session, data);
      } catch (err) {
        lastError = err;
        if (err.httpStatus === 400 || err.retryable === false || signal?.aborted) throw err;
        if (err instanceof TypeError || /fetch failed|network|econnreset|enotfound/i.test(err.message || '')) {
          this.cooldownUntil = Date.now() + 5000; // 5 seconds instead of 30
          err.retryable = false;
          throw err;
        }
        if (err.name === 'AbortError' || err.name === 'TimeoutError' || err.message.includes('timeout')) {
          logger.warn(`API request timed out (${this.timeoutMs} ms) on attempt ${attempt + 1}`);
          // A provider timeout already consumed the full request budget. Retrying
          // immediately would multiply 35s stalls and keep every agent waiting.
          err.retryable = false;
          throw err;
        }
        if (err.message.includes('authorization')) {
          throw err;
        }
      }
    }

    logger.error(`All ${this.maxRetries + 1} API request attempts failed: ${lastError?.message}`);
    throw lastError;
  }

  /**
   * Parse the Chat Completion response and update message history
   * @private
   */
  _parseChatResponse(session, data) {
    const choice = data?.choices?.[0];
    if (!choice || !choice.message) {
      throw new Error(`Invalid API response structure: ${JSON.stringify(data).substring(0, 300)}`);
    }

    const assistantMsg = choice.message;
    session.messages.push(assistantMsg);

    const text = assistantMsg.content || '';
    const toolCalls = [];
    session.lastPendingToolCalls = [];

    if (assistantMsg.tool_calls && Array.isArray(assistantMsg.tool_calls)) {
      for (const tc of assistantMsg.tool_calls) {
        let parsedArgs = {};
        if (typeof tc.function?.arguments === 'string') {
          try {
            parsedArgs = JSON.parse(tc.function.arguments || '{}');
          } catch (e) {
            logger.warn(`Could not parse JSON arguments for tool ${tc.function.name}: ${tc.function.arguments}`);
          }
        } else if (typeof tc.function?.arguments === 'object' && tc.function.arguments !== null) {
          parsedArgs = tc.function.arguments;
        }

        const toolName = tc.function?.name || 'unknown_tool';
        const toolId = tc.id || `call_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

        toolCalls.push({
          id: toolId,
          name: toolName,
          args: parsedArgs,
        });

        session.lastPendingToolCalls.push({
          id: toolId,
          name: toolName,
        });
      }
    }

    if (text) {
      logger.debug(`Text response (${text.length} chars): "${text.substring(0, 100).replace(/\n/g, ' ')}"`);
    }
    if (toolCalls.length > 0) {
      logger.info(`Tool calls (${toolCalls.length}): ${toolCalls.map(t => t.name).join(', ')}`);
    }

    return {
      text,
      toolCalls,
      raw: data,
    };
  }

  /**
   * Fetch with timeout through AbortController
   * @private
   */
  _trimMessages(messages) {
    if (!Array.isArray(messages) || messages.length <= this.maxContextMessages) return messages;
    const system = messages.find((m) => m.role === 'system');
    const nonSystem = messages.filter((m) => m !== system);
    const budget = Math.max(1, this.maxContextMessages - (system ? 1 : 0));
    let start = Math.max(0, nonSystem.length - budget);
    // Keep tool results paired with the preceding assistant tool-call message.
    while (start > 0 && nonSystem[start]?.role === 'tool') start--;
    const tail = nonSystem.slice(start);
    return system ? [system, ...tail] : tail;
  }

  _enrichRussianPrompt(systemPrompt, context = {}) {
    const base = String(systemPrompt || '').trim();
    const lines = [
      'Speak naturally in English, like a real teammate playing with friends.',
      'Do not respond automatically to every message: sometimes silence or a short reply is more appropriate.',
      'Do not use system labels, command lists, or bureaucratic language. Never claim an action was completed unless a tool result confirms it.',
      'Write in modern, natural English: use short conversational phrases and casual chat. Avoid phrases such as "executing task", "acknowledged", "successfully completed", "ready for work", and avoid NPC-style reports.',
    ];
    if (context.personality) lines.push(`Your personality traits: ${context.personality}`);
    if (context.emotionalState) lines.push(`Your current mood (it may change): ${context.emotionalState}`);
    if (context.socialContext) lines.push(`What is happening between friends right now: ${context.socialContext}`);
    return [base, lines.join('\n')].filter(Boolean).join('\n\n');
  }

  async _fetchWithTimeout(url, options = {}) {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, this.timeoutMs);
    const externalSignal = options.signal;
    const abortExternal = () => controller.abort();
    if (externalSignal?.aborted) controller.abort();
    externalSignal?.addEventListener('abort', abortExternal, { once: true });

    try {
      return await fetch(url, {
        ...options,
        signal: controller.signal,
      });
    } catch (error) {
      if (timedOut && !externalSignal?.aborted && error?.name === 'AbortError') {
        error.name = 'TimeoutError';
        error.message = `API request timeout (${this.timeoutMs}ms)`;
      }
      throw error;
    } finally {
      clearTimeout(timer);
      externalSignal?.removeEventListener('abort', abortExternal);
    }
  }

  _throwIfAborted(signal) {
    if (signal?.aborted) {
      const error = new Error('Request aborted');
      error.name = 'AbortError';
      throw error;
    }
  }
}
