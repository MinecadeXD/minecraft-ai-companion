import { createLogger } from '../utils/logger.js';

const logger = createLogger('ADAPTIVE_THINKING');

/**
 * @typedef {'FAST_PATH'|'EVENT_DRIVEN'|'NORMAL_TICK'|'DEEP_THINKING'} LayerType
 */

export class AdaptiveThinkingController {
  /**
   * @param {Object} options
   * @param {string} options.agentName
   * @param {Object} options.cognitiveEngine
   * @param {Object} options.fastPath
   * @param {Object} options.eventBus
   */
  constructor({ agentName, cognitiveEngine, fastPath, eventBus }) {
    this.agentName = agentName;
    this.cognitiveEngine = cognitiveEngine;
    this.fastPath = fastPath;
    this.eventBus = eventBus;
    
    this.activityLevel = 'idle'; // 'idle' | 'working' | 'group' | 'danger'
    this.lastTickTime = Date.now();
    this.lastLLMCallTime = 0;
    
    logger.info(`AdaptiveThinkingController initialized for agent ${agentName}`);
  }

  /**
   * @param {string} level - 'idle' | 'working' | 'group' | 'danger'
   */
  setActivityLevel(level) {
    const validLevels = ['idle', 'working', 'group', 'danger'];
    if (validLevels.includes(level) && this.activityLevel !== level) {
      this.activityLevel = level;
      logger.debug(`[${this.agentName}] Activity level changed to: ${level}`);
    }
  }

  /**
   * @returns {number} Current interval in milliseconds.
   */
  getTickInterval() {
    switch (this.activityLevel) {
      case 'danger':
        return 7500; // 5-10 seconds
      case 'group':
        return 15000; // 10-20 seconds
      case 'working':
        return 22500; // 15-30 seconds
      case 'idle':
      default:
        return 45000; // 30-60 seconds
    }
  }

  /**
   * Check whether it is time for a NORMAL_TICK.
   * @returns {boolean}
   */
  shouldTick() {
    const now = Date.now();
    const interval = this.getTickInterval();
    if (now - this.lastTickTime >= interval) {
      this.lastTickTime = now;
      return true;
    }
    return false;
  }

  /**
   * Record the time of the latest LLM call.
   */
  recordLLMCall() {
    this.lastLLMCallTime = Date.now();
  }

  /**
   * Evaluate an event and decide which layer should handle it.
   * @param {Object} event
   * @param {string} event.type
   * @param {any} [event.payload]
   * @returns {{ layer: LayerType, priority: number, shouldCallLLM: boolean }}
   */
  evaluateEvent(event) {
    // 1. FAST_PATH checks.
    const fastPathEvents = ['entity_hurt', 'creeper_nearby', 'low_health', 'falling'];
    if (fastPathEvents.includes(event.type)) {
      return { layer: 'FAST_PATH', priority: 10, shouldCallLLM: false };
    }

    // 4. DEEP_THINKING checks.
    const deepThinkingEvents = ['complex_goal_planning', 'conflict_resolution', 'craft_strategy'];
    if (deepThinkingEvents.includes(event.type)) {
      return { layer: 'DEEP_THINKING', priority: 5, shouldCallLLM: true };
    }

    // 2. EVENT_DRIVEN checks.
    const eventDrivenEvents = ['chat', 'player_joined', 'inventory_full', 'death', 'respawn', 'block_broken'];
    if (eventDrivenEvents.includes(event.type)) {
      return { layer: 'EVENT_DRIVEN', priority: 8, shouldCallLLM: true };
    }

    // 3. NORMAL_TICK fallback.
    return { layer: 'NORMAL_TICK', priority: 3, shouldCallLLM: true };
  }

  /**
   * Return the current state for the dashboard.
   * @returns {Object}
   */
  getState() {
    return {
      agentName: this.agentName,
      activityLevel: this.activityLevel,
      currentIntervalMs: this.getTickInterval(),
      timeSinceLastTick: Date.now() - this.lastTickTime,
      timeSinceLastLLM: Date.now() - this.lastLLMCallTime,
    };
  }
}
