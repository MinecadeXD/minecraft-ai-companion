import { createLogger } from '../../utils/logger.js';
import { HumanErrorEngine } from '../human-error-engine.js';

const logger = createLogger('CONTEXTUAL_MEMORY');

/**
 * Contextual memory system — the bot remembers the past but forgets details.
 *
 * Key mechanics:
 * 1. Short-term memory (the last 2 hours) — clear
 * 2. Medium-term memory (the last 2 days) — fuzzy
 * 3. Long-term memory (everything older) — only vivid moments
 * 4. Forgetfulness — details fade over time
 * 5. Emotional anchors — vivid events are remembered longer
 */

export class ContextualMemorySystem {
  constructor({ agentName, durableStorage }) {
    this.agentName = agentName;
    this.storage = durableStorage;

    // Three memory levels
    this.shortTerm = []; // Last 2 hours
    this.mediumTerm = []; // 2 hours–2 days
    this.longTerm = []; // > 2 days

    // Forgotten items (may be recalled)
    this.forgotten = [];

    // Memory distortions
    this.distortedMemories = new Map();

    this.loadFromStorage();
  }

  /**
   * Store a new memory
   */
  remember(event, context = {}) {
    const memory = {
      id: this._generateId(),
      timestamp: Date.now(),
      event: event,
      location: context.location,
      participants: context.participants || [],
      emotionalIntensity: context.emotionalIntensity || 0.5,
      importance: context.importance || 0.5,
      details: context.details || {},
      clarity: 1.0, // Clear initially
      accessCount: 0, // Number of times recalled
    };

    this.shortTerm.push(memory);

    logger.debug(`[${this.agentName}] Remembered: ${event}`);

    // If it is very important, reinforce it immediately
    if (memory.importance > 0.8 || memory.emotionalIntensity > 0.8) {
      memory.anchored = true;
    }

    this._trimShortTerm();
  }

  /**
   * Recall an event (possibly with inaccuracies)
   */
  recall(query, context = {}) {
    const now = Date.now();

    // Search all memory levels
    const allMemories = [
      ...this.shortTerm,
      ...this.mediumTerm,
      ...this.longTerm,
    ];

    const relevant = allMemories.filter(m =>
      this._isRelevant(m, query, context)
    );

    if (relevant.length === 0) {
      // Could it have been forgotten?
      return this._tryRecallForgotten(query, context);
    }

    // Sort by relevance and recency
    relevant.sort((a, b) => {
      const scoreA = this._calculateRecallScore(a, query, now);
      const scoreB = this._calculateRecallScore(b, query, now);
      return scoreB - scoreA;
    });

    const memory = relevant[0];
    memory.accessCount++;

    // Memory may be distorted
    return this._applyMemoryDistortion(memory);
  }

  /**
   * Get the latest N memories (for context)
   */
  getRecentContext(count = 5) {
    return this.shortTerm
      .slice(-count)
      .map(m => ({
        event: m.event,
        timestamp: m.timestamp,
        participants: m.participants,
      }));
  }

  /**
   * Forget less important details (a natural process)
   */
  naturalForget() {
    const now = Date.now();

    // Check each memory
    for (const memory of this.shortTerm) {
      const age = now - memory.timestamp;

      // The chance of forgetting increases over time
      let forgetChance = 0;

      if (age > 7200000) { // > 2 hours
        forgetChance = 0.3;
      }

      // Important events are forgotten less often
      forgetChance *= (1 - memory.importance);
      forgetChance *= (1 - memory.emotionalIntensity * 0.5);

      // Anchored memories are not forgotten
      if (memory.anchored) {
        forgetChance = 0;
      }

      if (HumanErrorEngine.chance(forgetChance)) {
        this._forgetMemory(memory);
      } else {
        // Reduce clarity
        memory.clarity *= 0.95;
      }
    }
  }

  /**
   * Sometimes spontaneously recall something (like people do)
   */
  spontaneousRecall() {
    if (!HumanErrorEngine.chance(0.02)) return null; // 2% chance

    // Choose a random memory from medium-term memory
    if (this.mediumTerm.length === 0) return null;

    const memory = HumanErrorEngine.choice(this.mediumTerm);

    // Emotionally vivid memories surface more often
    if (memory.emotionalIntensity > 0.6 || HumanErrorEngine.chance(0.3)) {
      memory.accessCount++;

      return {
        event: memory.event,
        timestamp: memory.timestamp,
        clarity: memory.clarity,
        spontaneous: true,
      };
    }

    return null;
  }

  /**
   * Update memory levels (move items from short-term toward long-term)
   */
  consolidate() {
    const now = Date.now();
    const shortTermCutoff = now - 7200000; // 2 hours
    const mediumTermCutoff = now - 172800000; // 2 days

    // Short-term → Medium-term
    const toMedium = this.shortTerm.filter(m => m.timestamp < shortTermCutoff);
    this.shortTerm = this.shortTerm.filter(m => m.timestamp >= shortTermCutoff);
    this.mediumTerm.push(...toMedium);

    // Medium-term → Long-term (important memories only)
    const toLong = this.mediumTerm.filter(m =>
      m.timestamp < mediumTermCutoff &&
      (m.importance > 0.6 || m.emotionalIntensity > 0.7 || m.anchored)
    );
    this.mediumTerm = this.mediumTerm.filter(m =>
      m.timestamp >= mediumTermCutoff || toLong.includes(m)
    );
    this.longTerm.push(...toLong);

    // Forget unimportant medium-term memories
    const toForget = this.mediumTerm.filter(m =>
      m.timestamp < mediumTermCutoff &&
      m.importance < 0.4 &&
      !m.anchored
    );
    toForget.forEach(m => this._forgetMemory(m));
    this.mediumTerm = this.mediumTerm.filter(m => !toForget.includes(m));

    // Limit the size of long-term memory
    if (this.longTerm.length > 100) {
      // Remove the least important items
      this.longTerm.sort((a, b) => {
        const scoreA = a.importance + a.emotionalIntensity + (a.anchored ? 2 : 0);
        const scoreB = b.importance + b.emotionalIntensity + (b.anchored ? 2 : 0);
        return scoreB - scoreA;
      });
      this.longTerm = this.longTerm.slice(0, 100);
    }

    this.saveToStorage();
  }

  /**
   * Forget a memory (but it may be recalled later)
   */
  _forgetMemory(memory) {
    // Do not delete it completely — move it to the "forgotten" collection
    this.forgotten.push({
      ...memory,
      forgotAt: Date.now(),
      recallDifficulty: 0.8, // Recall difficulty
    });

    // Remove from active memory
    this.shortTerm = this.shortTerm.filter(m => m.id !== memory.id);
    this.mediumTerm = this.mediumTerm.filter(m => m.id !== memory.id);

    logger.debug(`[${this.agentName}] Forgot: ${memory.event}`);
  }

  /**
   * Try to recall a forgotten memory (with difficulty)
   */
  _tryRecallForgotten(query, context) {
    const relevant = this.forgotten.filter(m =>
      this._isRelevant(m, query, context)
    );

    if (relevant.length === 0) return null;

    // Sort by recall difficulty
    relevant.sort((a, b) => a.recallDifficulty - b.recallDifficulty);

    const memory = relevant[0];

    // Recall probability depends on difficulty
    const recallChance = 1 - memory.recallDifficulty;

    if (HumanErrorEngine.chance(recallChance)) {
      // Recalled! But the memory is fuzzy
      memory.clarity = HumanErrorEngine.range(0.3, 0.6); // 30–60% clarity

      // Return it to short-term memory
      this.shortTerm.push(memory);
      this.forgotten = this.forgotten.filter(m => m.id !== memory.id);

      logger.info(`[${this.agentName}] Recalled a forgotten memory: ${memory.event}`);

      return {
        event: memory.event,
        timestamp: memory.timestamp,
        clarity: memory.clarity,
        reconstructed: true, // Reconstructed memory
      };
    }

    return null;
  }

  /**
   * Check whether a memory is relevant to a query
   */
  _isRelevant(memory, query, context) {
    // Simple word matching
    const memoryText = JSON.stringify(memory).toLowerCase();
    const queryWords = query.toLowerCase().split(' ');

    const matches = queryWords.filter(word => memoryText.includes(word));

    // Relevant if at least half of the words match
    return matches.length >= Math.ceil(queryWords.length / 2);
  }

  /**
   * Calculate a score for sorting memories
   */
  _calculateRecallScore(memory, query, now) {
    let score = 0;

    // Freshness (recent events are more important)
    const age = now - memory.timestamp;
    const freshnessScore = 1 / (1 + age / 3600000); // Divided by hours
    score += freshnessScore * 30;

    // Importance
    score += memory.importance * 20;

    // Emotional intensity
    score += memory.emotionalIntensity * 15;

    // Clarity
    score += memory.clarity * 10;

    // Anchored memories
    if (memory.anchored) {
      score += 25;
    }

    // Frequently recalled
    score += Math.min(memory.accessCount, 5) * 2;

    return score;
  }

  /**
   * Apply memory distortions (details become fuzzy)
   */
  _applyMemoryDistortion(memory) {
    const distorted = { ...memory };

    // The less clear a memory is, the more it becomes distorted
    const distortionLevel = 1 - memory.clarity;

    if (distortionLevel > 0.3 && HumanErrorEngine.chance(distortionLevel)) {
      // Distort details
      if (distorted.details) {
        distorted.details = this._distortDetails(distorted.details, distortionLevel);
        distorted.distorted = true;
      }
    }

    return distorted;
  }

  /**
   * Distort memory details
   */
  _distortDetails(details, level) {
    const distorted = { ...details };

    // Numbers become approximate
    for (const [key, value] of Object.entries(distorted)) {
      if (typeof value === 'number' && HumanErrorEngine.chance(level)) {
        const variation = value * level * 0.5;
        distorted[key] = Math.round(value + HumanErrorEngine.jitter(variation));
      }
    }

    return distorted;
  }

  /**
   * Generate a unique ID
   */
  _generateId() {
    return `mem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Limit the size of short-term memory
   */
  _trimShortTerm() {
    const maxSize = 50;
    if (this.shortTerm.length > maxSize) {
      // Remove the oldest and least important items
      this.shortTerm.sort((a, b) => {
        const scoreA = a.timestamp + a.importance * 3600000;
        const scoreB = b.timestamp + b.importance * 3600000;
        return scoreB - scoreA;
      });
      this.shortTerm = this.shortTerm.slice(0, maxSize);
    }
  }

  /**
   * Save to persistent storage
   */
  saveToStorage() {
    // Persistence is optional: only use the storage if it actually exposes a
    // key/value save() method. MemoryManager (the storage passed in index.js)
    // has no such method, so we no-op instead of throwing.
    if (!this.storage || typeof this.storage.save !== 'function') return;

    try {
      this.storage.save(`memory_${this.agentName}`, {
        shortTerm: this.shortTerm,
        mediumTerm: this.mediumTerm.slice(-100), // Only the latest 100
        longTerm: this.longTerm,
        forgotten: this.forgotten.slice(-50), // Only the latest 50 forgotten items
      });
    } catch (err) {
      logger.error(`Error saving memory: ${err.message}`);
    }
  }

  /**
   * Load from persistent storage
   */
  loadFromStorage() {
    // Persistence is optional: only load if the storage exposes a load()
    // method. MemoryManager (passed in index.js) has none, so we no-op
    // instead of throwing "this.storage.load is not a function".
    if (!this.storage || typeof this.storage.load !== 'function') return;

    try {
      const data = this.storage.load(`memory_${this.agentName}`);
      if (data) {
        this.shortTerm = data.shortTerm || [];
        this.mediumTerm = data.mediumTerm || [];
        this.longTerm = data.longTerm || [];
        this.forgotten = data.forgotten || [];

        logger.info(`[${this.agentName}] Loaded memories: ${this.shortTerm.length + this.mediumTerm.length + this.longTerm.length}`);
      }
    } catch (err) {
      logger.warn(`Could not load memory: ${err.message}`);
    }
  }

  /**
   * Get memory statistics
   */
  getStats() {
    return {
      shortTerm: this.shortTerm.length,
      mediumTerm: this.mediumTerm.length,
      longTerm: this.longTerm.length,
      forgotten: this.forgotten.length,
      averageClarity: this._calculateAverageClarity(),
    };
  }

  /**
   * Calculate average memory clarity
   */
  _calculateAverageClarity() {
    const all = [...this.shortTerm, ...this.mediumTerm, ...this.longTerm];
    if (all.length === 0) return 1.0;

    const totalClarity = all.reduce((sum, m) => sum + m.clarity, 0);
    return totalClarity / all.length;
  }
}
