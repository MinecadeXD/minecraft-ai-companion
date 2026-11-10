import { createLogger } from '../utils/logger.js';

const logger = createLogger('THOUGHT_STREAM');

/**
 * ThoughtStream — stream of the bot's subconscious and inner monologue:
 * Allows Gemini and background processes to surface spontaneous thoughts,
 * doubts, and reflections in real time.
 */
export class ThoughtStream {
  constructor() {
    this.recentThoughts = [];
    this.listeners = new Set();
  }

  /**
   * Generate and record a thought in the stream of consciousness
   */
  emit(thoughtText) {
    if (!thoughtText || typeof thoughtText !== 'string') return null;
    const clean = thoughtText.trim();
    if (!clean) return null;

    const entry = {
      text: clean,
      timestamp: Date.now(),
    };

    this.recentThoughts.push(entry);
    if (this.recentThoughts.length > 20) {
      this.recentThoughts.shift();
    }

    logger.info(`[💭 THOUGHT] ${clean}`);

    for (const listener of this.listeners) {
      try { listener(entry); } catch (_) {}
    }

    return entry;
  }

  /**
   * Subscribe to the thought stream
   */
  subscribe(callback) {
    if (typeof callback === 'function') {
      this.listeners.add(callback);
      return () => this.listeners.delete(callback);
    }
    return () => {};
  }

  /**
   * Get recent thoughts
   */
  getRecent(limit = 5) {
    return this.recentThoughts.slice(-limit);
  }
}

export const thoughtStream = new ThoughtStream();
