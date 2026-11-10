import { createLogger } from '../utils/logger.js';

const logger = createLogger('ERROR_MEMORY');

/**
 * Mistake memory system — the bot LEARNS from its mistakes!
 *
 * - Remembers the last 100 mistakes
 * - If a mistake happens twice in a row, the chance is lower the third time
 * - After success, the chance of another mistake decreases
 * - Analyzes mistake patterns
 */
export class ErrorMemory {
  constructor(agentName = 'Bot') {
    this.agentName = agentName;
    this.errorHistory = [];
    this.successHistory = [];
    this.maxHistoryLength = 100;
    this.learningMultiplier = 1.0;
  }

  /**
   * Record a mistake and update learning
   */
  recordError(errorType, errorData = {}) {
    const error = {
      type: errorType,
      timestamp: Date.now(),
      data: errorData,
    };

    this.errorHistory.push(error);
    if (this.errorHistory.length > this.maxHistoryLength) {
      this.errorHistory.shift();
    }

    this._updateLearning();
  }

  /**
   * Record a success (an action completed without mistakes)
   */
  recordSuccess(actionType, actionData = {}) {
    const success = {
      type: actionType,
      timestamp: Date.now(),
      data: actionData,
    };

    this.successHistory.push(success);
    if (this.successHistory.length > this.maxHistoryLength) {
      this.successHistory.shift();
    }

    this._updateLearning();
  }

  /**
   * Update the learning multiplier based on history
   */
  _updateLearning() {
    let learning = 1.0;

    // Check the last 5 actions for mistakes
    const recentErrors = this._getRecentErrors(5);
    const recentSuccesses = this._getRecentSuccesses(5);

    // If there have been many consecutive mistakes, LEARN and make fewer mistakes
    if (recentErrors.length >= 2) {
      learning -= 0.1 * recentErrors.length; // -10% for each mistake
    }

    // If there have been many successes, confidence increases but so does the mistake rate (overconfidence)
    if (recentSuccesses.length >= 3) {
      learning += 0.05 * (recentSuccesses.length - 2); // +5% for each success after the second
    }

    // Check for repeated mistakes
    const repeatErrors = this._getRepeatingErrors();
    learning -= 0.15 * repeatErrors.length; // -15% for each repeated mistake

    // Clamp the multiplier
    this.learningMultiplier = Math.max(0.3, Math.min(1.5, learning));
  }

  /**
   * Get the mistake multiplier for a specific action type
   */
  getErrorModifier(actionType) {
    // Check the history for this action type
    const recentForThisAction = this.errorHistory
      .filter(e => e.type === actionType)
      .slice(-5);

    let modifier = this.learningMultiplier;

    // If a mistake was made recently on this action, become more cautious
    if (recentForThisAction.length > 0) {
      modifier *= (1 - 0.2 * recentForThisAction.length); // -20% for each mistake
    }

    return Math.max(0.2, modifier); // Minimum 0.2x (the bot can still make mistakes)
  }

  /**
   * Get the latest N mistakes
   */
  _getRecentErrors(count = 10) {
    return this.errorHistory.slice(-count);
  }

  /**
   * Get the latest N successes
   */
  _getRecentSuccesses(count = 10) {
    return this.successHistory.slice(-count);
  }

  /**
   * Get recurring mistakes
   */
  _getRepeatingErrors() {
    const errorCounts = {};

    for (const error of this.errorHistory.slice(-20)) {
      errorCounts[error.type] = (errorCounts[error.type] || 0) + 1;
    }

    return Object.entries(errorCounts)
      .filter(([_, count]) => count >= 2)
      .map(([type, _]) => type);
  }

  /**
   * Get mistake statistics
   */
  getStats() {
    const stats = {
      totalErrors: this.errorHistory.length,
      totalSuccesses: this.successHistory.length,
      learningMultiplier: this.learningMultiplier.toFixed(2),
      recentErrors: this._getRecentErrors(5).map(e => e.type),
      repeatingErrors: this._getRepeatingErrors(),
      successRate: this._calculateSuccessRate(),
    };

    return stats;
  }

  /**
   * Calculate the success rate
   */
  _calculateSuccessRate() {
    const total = this.errorHistory.length + this.successHistory.length;
    if (total === 0) return 100;
    return Math.round((this.successHistory.length / total) * 100);
  }

  /**
   * Get a learning summary
   */
  getDescription() {
    const stats = this.getStats();
    let desc = `📚 Mistake memory for ${this.agentName}\n`;
    desc += `✅ Successes: ${stats.totalSuccesses}\n`;
    desc += `❌ Mistakes: ${stats.totalErrors}\n`;
    desc += `📊 Success rate: ${stats.successRate}%\n`;
    desc += `🧠 Learning multiplier: ${stats.learningMultiplier}x\n`;

    if (stats.repeatingErrors.length > 0) {
      desc += `⚠️ Recurring mistakes: ${stats.repeatingErrors.join(', ')}\n`;
    }

    return desc;
  }
}
