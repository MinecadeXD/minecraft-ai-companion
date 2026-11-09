import { createLogger } from '../utils/logger.js';
import { telemetry } from '../utils/telemetry.js';

const logger = createLogger('API_BUDGET');

export class APIBudgetManager {
  /**
   * @param {Object} options
   * @param {number} [options.maxGlobalRPM=60] - Increased from 14 to 60.
   * @param {number} [options.maxPerAgentRPM=15] - Increased from 4 to 15.
   * @param {string[]} options.agents
   */
  constructor({ maxGlobalRPM = 60, maxPerAgentRPM = 15, agents = [] }) {
    this.maxGlobalRPM = maxGlobalRPM;
    this.maxPerAgentRPM = maxPerAgentRPM;
    
    this.globalRequestsThisMinute = 0;
    this.windowStart = Date.now();
    this.requestQueue = [];
    this.activeRequests = 0;
    this.maxConcurrent = 1;
    
    this.agentsStats = {};
    for (const agent of agents) {
      this.agentsStats[agent] = {
        requestsThisMinute: 0,
        activeRequests: 0,
        totalRequests: 0,
        totalTokensEstimated: 0,
        lastRequestTime: 0,
        cooldownUntil: null,
        priority: 'normal'
      };
    }

    // Reset the rate-limit window every minute.
    this._resetInterval = setInterval(() => this.resetMinuteWindow(), 60000);
    logger.info(`APIBudgetManager initialized (global RPM: ${this.maxGlobalRPM}, per-agent RPM: ${this.maxPerAgentRPM})`);
  }

  /**
   * Reset the per-minute counters.
   */
  resetMinuteWindow() {
    this.windowStart = Date.now();
    this.globalRequestsThisMinute = 0;
    
    for (const agent in this.agentsStats) {
      this.agentsStats[agent].requestsThisMinute = 0;
    }
    this._processQueue();
    logger.debug('API rate-limit window reset.');
  }

  /**
   * @param {string} agentName
   * @returns {boolean}
   */
  canAgentThink(agentName) {
    const stats = this.agentsStats[agentName];
    if (!stats) return false;
    
    if (stats.cooldownUntil && Date.now() < stats.cooldownUntil) {
      return false;
    }

    if (this.globalRequestsThisMinute >= this.maxGlobalRPM) {
      return false;
    }

    if (stats.requestsThisMinute >= this.maxPerAgentRPM) {
      return false;
    }

    return true;
  }

  /**
   * Request a slot for an LLM call.
   * @param {string} agentName 
   * @param {'normal_tick'|'event_driven'|'deep_thinking'|'emergency'} priority 
   * @param {string} eventType 
   * @returns {Promise<boolean>}
   */
  async requestSlot(agentName, priority, eventType, options = {}) {
    if (!this.agentsStats[agentName]) {
      logger.warn(`Agent ${agentName} is not registered with APIBudgetManager`);
      return false;
    }

    const priorityWeights = {
      'emergency': 4,
      'event_driven': 3,
      'deep_thinking': 2,
      'normal_tick': 1
    };

    return new Promise((resolve) => {
      let settled = false;
      let timeoutTimer = null;
      const signal = options.signal;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        if (timeoutTimer) clearTimeout(timeoutTimer);
        signal?.removeEventListener('abort', onAbort);
        resolve(value);
      };
      const onAbort = () => {
        const index = this.requestQueue.indexOf(requestObj);
        if (index !== -1) {
          this.requestQueue.splice(index, 1);
          requestObj.wasQueued = false;
          telemetry.decrement('queuedRequests');
        }
        finish(false);
      };
      const requestObj = {
        agentName,
        priorityWeight: priorityWeights[priority] || 1,
        priorityLabel: priority,
        eventType,
        resolve: finish,
        timestamp: Date.now()
        ,wasQueued: false
      };

      if (signal?.aborted) {
        finish(false);
        return;
      }
      signal?.addEventListener('abort', onAbort, { once: true });

      // Emergency requests bypass the queue when any budget remains,
      // and may exceed the limit when survival is at stake.
      if (priority === 'emergency') {
        this._grantSlot(requestObj);
        return;
      }

      this.requestQueue.push(requestObj);
      requestObj.wasQueued = true;
      telemetry.increment('queuedRequests');
      this.requestQueue.sort((a, b) => b.priorityWeight - a.priorityWeight); // Highest priority first.
      
      this._processQueue();

      // Slot request timeout: 10 seconds.
      timeoutTimer = setTimeout(() => {
        const index = this.requestQueue.indexOf(requestObj);
        if (index !== -1) {
          this.requestQueue.splice(index, 1);
          requestObj.wasQueued = false;
          logger.debug(`[${agentName}] Slot request timed out (${priority})`);
          finish(false);
          telemetry.decrement('queuedRequests');
        }
      }, 10000);
    });
  }

  /**
   * Process the request queue.
   * @private
   */
  _processQueue() {
    if (this.requestQueue.length === 0 || this.activeRequests >= this.maxConcurrent) return;

    const index = this.requestQueue.findIndex((req) => this.canAgentThink(req.agentName));
    if (index === -1) return;
    const nextReq = this.requestQueue[index];
    
    if (this.activeRequests < this.maxConcurrent && this.canAgentThink(nextReq.agentName)) {
      this.requestQueue.splice(index, 1);
      this._grantSlot(nextReq);
      
      // Recursively check the next queued request.
      this._processQueue();
    }
  }

  /**
   * Grant a request slot.
   * @private
   */
  _grantSlot(req) {
    this.globalRequestsThisMinute++;
    this.activeRequests++;
    const stats = this.agentsStats[req.agentName];
    stats.requestsThisMinute++;
    stats.activeRequests++;
    stats.totalRequests++;
    stats.lastRequestTime = Date.now();
    if (req.wasQueued) {
      req.wasQueued = false;
      telemetry.decrement('queuedRequests');
    }
    
    logger.debug(`[${req.agentName}] Slot granted (priority: ${req.priorityLabel}, event: ${req.eventType}). Global requests: ${this.globalRequestsThisMinute}/${this.maxGlobalRPM}`);
    req.resolve(true);
  }

  /**
   * Notify the manager that a request has finished.
   * @param {string} agentName 
   */
  releaseSlot(agentName) {
    // In the future, this can release slots for parallel limits;
    // for RPM-based limits, we only record the completion.
    this.activeRequests = Math.max(0, this.activeRequests - 1);
    if (this.agentsStats[agentName]) {
      this.agentsStats[agentName].activeRequests = Math.max(0, this.agentsStats[agentName].activeRequests - 1);
    }
    this._processQueue();
  }

  /**
   * Block an agent from accessing the API for a specified duration.
   * @param {string} agentName 
   * @param {number} durationMs 
   */
  setCooldown(agentName, durationMs) {
    if (this.agentsStats[agentName]) {
      this.agentsStats[agentName].cooldownUntil = Date.now() + durationMs;
      logger.info(`[${agentName}] API cooldown set for ${durationMs} ms`);
    }
  }

  /**
   * Return statistics for the dashboard.
   * @returns {Object}
   */
  getStats() {
    return {
      global: {
        requestsThisMinute: this.globalRequestsThisMinute,
        maxGlobalRPM: this.maxGlobalRPM,
        queueLength: this.requestQueue.length,
        activeRequests: this.activeRequests,
        windowStart: this.windowStart
      },
      perAgent: this.agentsStats
    };
  }

  dispose() {
    if (this._resetInterval) {
      clearInterval(this._resetInterval);
      this._resetInterval = null;
    }
    for (const request of this.requestQueue.splice(0)) request.resolve(false);
  }
}
