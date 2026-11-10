import logger from '../../utils/logger.js';
import { HumanErrorEngine as CoreHumanErrorEngine } from '../human-error-engine.js';

export class HumanErrorEngine {
  constructor() {
    this.lapseCount = 0;
  }

  /**
   * Determine if a human lapse occurs based on stress, rush, and fatigue.
   * @param {object} context - { stress: 0.0-1.0, isRushing: boolean, fatigue: 0.0-1.0 }
   * @returns {object} { hasLapse: boolean, lapseType: string|null, recoveryAction: string|null }
   */
  evaluateLapse(context = {}) {
    const stress = context.stress || 0.1;
    const isRushing = context.isRushing || false;

    // Base slip probability ~ 5%, increases under stress
    let slipProb = 0.04 + (stress * 0.1) + (isRushing ? 0.05 : 0.0);
    slipProb = Math.min(0.25, slipProb);

    if (CoreHumanErrorEngine.chance(slipProb, context)) {
      this.lapseCount++;
      const lapses = [
        { type: 'wrong_hotbar_slot', message: 'Oops, selected the wrong slot!', recovery: 'swap_to_correct_slot' },
        { type: 'straight_down_dig_hesitation', message: 'Wait, I almost dug the block beneath me!', recovery: 'step_back_to_2_wide' },
        { type: 'forgot_to_eat_first', message: 'Wait, I should eat something first.', recovery: 'eat_food' },
        { type: 'fleeting_enderman_gaze', message: 'Oops, I accidentally looked at an Enderman!', recovery: 'panic_find_water' },
      ];

      const selected = CoreHumanErrorEngine.choice(lapses);
      logger.info(`[HUMAN ERROR] Natural lapse triggered: ${selected.type}`);
      return {
        hasLapse: true,
        lapseType: selected.type,
        quip: selected.message,
        recoveryAction: selected.recovery,
      };
    }

    return { hasLapse: false, lapseType: null, recoveryAction: null };
  }
}

export const humanError = new HumanErrorEngine();
