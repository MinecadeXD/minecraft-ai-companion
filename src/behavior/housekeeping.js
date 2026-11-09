import logger from '../utils/logger.js';
import { HumanErrorEngine } from './human-error-engine.js';

export class HousekeepingEngine {
  constructor() {
    this.lastCleanupTime = 0;
    this.cleanupCooldownMs = 1000 * 60 * 10; // 10 minutes cooldown after cleanup
  }

  /**
   * Calculate probability of deciding to sort chests or tidy inventory based on actual context.
   * @param {object} params
   * @param {number} params.disorderRatio - 0.0 (clean) to 1.0 (messy/scattered items in chests)
   * @param {boolean} params.isHome - true if currently at base
   * @param {boolean} params.hasUrgentGoal - true if actively building, fighting, or on an expedition
   * @param {number} params.habitScore - 0.0 to 1.0 (bot preference for cleanliness)
   * @returns {object} { shouldClean: boolean, probability: number, reason: string }
   */
  evaluateHousekeeping({
    disorderRatio = 0.5,
    isHome = true,
    hasUrgentGoal = false,
    habitScore = 0.6,
  } = {}) {
    if (!isHome) {
      return { shouldClean: false, probability: 0, reason: 'Not at the base' };
    }

    if (hasUrgentGoal) {
      return { shouldClean: false, probability: 0.02, reason: 'There is an urgent active task' };
    }

    const now = Date.now();
    const timeSinceLast = now - this.lastCleanupTime;

    // Strong penalty if cleaned recently
    let recentPenalty = 0.0;
    if (timeSinceLast < this.cleanupCooldownMs) {
      recentPenalty = 0.85 * (1.0 - (timeSinceLast / this.cleanupCooldownMs));
    }

    // Dynamic formula
    const rawProb = (disorderRatio * 0.5) + (habitScore * 0.3) - recentPenalty;
    const finalProb = Math.max(0.01, Math.min(0.90, rawProb));

    const shouldClean = HumanErrorEngine.chance(finalProb);

    if (shouldClean) {
      this.lastCleanupTime = now;
      logger.info(`[HOUSEKEEPING] Decided to do natural chest cleanup (Prob: ${(finalProb * 100).toFixed(1)}%)`);
    }

    return {
      shouldClean,
      probability: finalProb,
      reason: shouldClean ? 'It is time to tidy the chests' : 'The chests are in good shape or were cleaned recently',
    };
  }

  recordManualRequest() {
    this.lastCleanupTime = 0; // Reset cooldown when player directly requests cleanup
  }
}

export const housekeeping = new HousekeepingEngine();
