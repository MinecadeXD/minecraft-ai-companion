import { createLogger } from '../utils/logger.js';
import { HumanErrorEngine } from './human-error-engine.js';

const logger = createLogger('ADRENALINE_CONTROLLER');

/**
 * AdrenalineController models a player's adrenaline level and heart rate.
 * It follows the Yerkes-Dodson law:
 * - Low arousal (< 0.2): sluggishness, poor attention, and slower reactions.
 * - Optimal arousal (0.35–0.55): a flow state with the best focus and reactions.
 * - High arousal (> 0.75): panic, hand tremors, tunnel vision, and poorer decisions.
 */
export class AdrenalineController {
  constructor(options = {}) {
    this.baseline = options.baseline ?? 0.08;
    this.adrenaline = this.baseline;
    this.heartRateBpm = 72;
    this.lastStimulusTime = Date.now();
    this.calmWindowMs = options.calmWindowMs ?? 3000;
    this.decayRatePerSec = options.decayRatePerSec ?? 0.04;
  }

  /**
   * Gradually reduce adrenaline when no new stimulus occurs.
   * @param {number} dtMs - Elapsed time in milliseconds.
   */
  update(dtMs = 50) {
    const now = Date.now();
    if (now - this.lastStimulusTime > this.calmWindowMs) {
      const decay = (this.decayRatePerSec * (dtMs / 1000));
      this.adrenaline = Math.max(this.baseline, this.adrenaline - decay);
    }

    // Heart-rate target (from 65 BPM at rest to 175 BPM at maximum).
    const targetBpm = 65 + this.adrenaline * 110;
    this.heartRateBpm += (targetBpm - this.heartRateBpm) * Math.min(1.0, dtMs / 500);
  }

  /**
   * Increase adrenaline in response to an external stimulus.
   * @param {number} amount - Stimulus intensity (0.0–1.0).
   * @param {string} reason - Reason for the stimulus.
   */
  spike(amount, reason = 'unknown') {
    const prev = this.adrenaline;
    this.adrenaline = Math.min(1.0, this.adrenaline + amount);
    this.lastStimulusTime = Date.now();
    logger.debug(`[ADRENALINE] Spike: +${amount.toFixed(2)} (was ${prev.toFixed(2)} -> now ${this.adrenaline.toFixed(2)}) [${reason}] Heart rate: ${Math.round(this.heartRateBpm)} BPM`);
  }

  triggerDamage(damageAmount = 2) {
    const surge = Math.min(0.6, 0.15 + (damageAmount / 10) * 0.35);
    this.spike(surge, `damage taken: ${damageAmount}`);
  }

  triggerCreeperHiss(distance = 3) {
    const proximityMultiplier = Math.max(0.5, (6 - distance) / 4);
    this.spike(0.45 * proximityMultiplier, `creeper hiss at ${distance.toFixed(1)} blocks`);
  }

  triggerExplosion() {
    this.spike(0.65, 'nearby explosion');
  }

  triggerFallHazard() {
    this.spike(0.35, 'dangerous fall / cliff');
  }

  triggerLavaHazard() {
    this.spike(0.55, 'contact with lava / fire');
  }

  /**
   * Apply the Yerkes-Dodson law: performance is highest at a moderate arousal level.
   * The optimal adrenaline value is optimalAdrenaline = 0.45.
   */
  getYerkesDodsonEfficiency() {
    const optimal = 0.45;
    const deviation = this.adrenaline - optimal;
    const raw = 1.0 - 2.8 * (deviation * deviation);
    return Math.max(0.15, Math.min(1.0, raw));
  }

  /**
   * Check whether the agent is panicking.
   */
  isPanicking() {
    return this.adrenaline >= 0.75;
  }

  isFlowState() {
    return this.adrenaline >= 0.35 && this.adrenaline <= 0.60;
  }

  isSluggish() {
    return this.adrenaline < 0.20;
  }

   * Return the hand-tremor multiplier for actions.
   * ??????????? ???????????????? ??????? ??? ??? ????
   */
  getTremorMultiplier() {
    if (this.isFlowState()) {
      return 0.75;
    }
    if (this.isPanicking()) {
      return 1.8 + (this.adrenaline - 0.75) * 3.0;
    }
    if (this.isSluggish()) {
      return 1.15;
    }
    return 1.0;
  }

   * Return the attention-tunneling factor (narrowed focus).
   * ??????????? ??????? ???? ???????? (?????????? ??????)
   */
  getAttentionTunnelingFactor() {
    if (this.adrenaline < 0.6) return 0.0;
    return Math.min(0.85, (this.adrenaline - 0.6) * 2.1);
  }
}
