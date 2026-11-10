import { createLogger } from '../utils/logger.js';

const logger = createLogger('ERROR');

export class LoopDetector {
  constructor(maxRepeats = 4) {
    this.maxRepeats = maxRepeats;
    this.history = [];
    this.maxHistory = 15;
  }

  /**
   * Record a tool call and check for loops.
   * @param {string} toolName
   * @param {Object} args
   * @returns {boolean} true if an infinite loop is detected
   */
  recordAndCheck(toolName, args = {}) {
    const signature = `${toolName}:${JSON.stringify(args)}`;
    this.history.push({ signature, timestamp: Date.now() });

    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }

    // Check the last N calls
    if (this.history.length >= this.maxRepeats) {
      const recent = this.history.slice(-this.maxRepeats);
      const allSame = recent.every(item => item.signature === signature);

      if (allSame) {
        logger.warn(`⚠️ [LOOP DETECTED] Tool ${toolName} was called identically ${this.maxRepeats} times in a row!`);
        return true;
      }
    }

    return false;
  }

  reset() {
    this.history = [];
  }
}
