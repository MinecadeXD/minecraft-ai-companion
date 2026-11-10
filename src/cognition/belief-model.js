import logger from '../utils/logger.js';

export const ConfidenceTier = {
  CERTAIN: 'certain',     // >= 0.85 ("I know for certain")
  PROBABLE: 'probable',   // 0.50 - 0.84 ("I assume / most likely")
  UNCERTAIN: 'uncertain', // < 0.50 ("I am not sure; I need to check")
};

export class BeliefModel {
  constructor() {
    this.beliefs = new Map(); // key -> { value, confidence, source, timestamp, evidence }
  }

  /**
   * Register or update a belief.
   * @param {string} key - Unique key/topic (e.g. 'home_coords', 'has_iron_in_chest', 'player_wants_farm')
   * @param {any} value
   * @param {number} confidence - 0.0 to 1.0
   * @param {string} source - 'observed' | 'player_said' | 'inferred' | 'memory'
   * @param {string} evidence - Details supporting this belief
   */
  setBelief(key, value, confidence = 0.8, source = 'observed', evidence = '') {
    this.beliefs.set(key, {
      value,
      confidence: Math.max(0.0, Math.min(1.0, confidence)),
      source,
      evidence,
      timestamp: Date.now(),
    });
  }

  /**
   * Retrieve a belief and its confidence rating.
   * @param {string} key
   * @returns {object|null} { value, confidence, tier, source, isFresh }
   */
  getBelief(key, maxAgeMs = 1000 * 60 * 30) {
    const belief = this.beliefs.get(key);
    if (!belief) return null;

    const age = Date.now() - belief.timestamp;
    let confidence = belief.confidence;

    // Gradual confidence decay if unverified over time
    if (age > maxAgeMs) {
      confidence = Math.max(0.2, confidence * 0.7);
    }

    let tier = ConfidenceTier.UNCERTAIN;
    if (confidence >= 0.85) tier = ConfidenceTier.CERTAIN;
    else if (confidence >= 0.5) tier = ConfidenceTier.PROBABLE;

    return {
      value: belief.value,
      confidence,
      tier,
      source: belief.source,
      evidence: belief.evidence,
      isFresh: age <= maxAgeMs,
    };
  }

  /**
   * Get verbal phrasing appropriate for the confidence level.
   */
  formatConfidencePrefix(key) {
    const b = this.getBelief(key);
    if (!b) return 'I do not know for certain, ';
    if (b.tier === ConfidenceTier.CERTAIN) return 'I know that ';
    if (b.tier === ConfidenceTier.PROBABLE) return 'Most likely, ';
    return 'I am not 100% sure, but it seems that ';
  }

  /**
   * Clear all beliefs.
   */
  clear() {
    this.beliefs.clear();
  }
}

export const beliefModel = new BeliefModel();
