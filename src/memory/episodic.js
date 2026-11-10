import { createLogger } from '../utils/logger.js';

const logger = createLogger('MEMORY');

export class EpisodicMemory {
  constructor(longTermMemory) {
    this.storage = longTermMemory;
  }

  /**
   * Remember an important event.
   */
  rememberEpisode({
    mcDay,
    eventType,
    summary,
    position = null,
    participants = '',
    outcome = '',
    importance = 5,
  }) {
    // Only save events with sufficient importance
    if (importance < 3) return null;

    const x = position ? position.x : null;
    const y = position ? position.y : null;
    const z = position ? position.z : null;

    const result = this.storage.addEpisode({
      mcDay,
      eventType,
      summary,
      x,
      y,
      z,
      participants,
      outcome,
      importance,
    });

    logger.info(`[EPISODE] (${eventType}, importance ${importance}): ${summary}`);
    return result;
  }

  /**
   * Get relevant memories for a query, or the latest ones.
   */
  recall(query = null, limit = 5) {
    if (query) {
      return this.storage.searchEpisodes(query);
    }
    return this.storage.getRecentEpisodes(limit, 4);
  }

  /**
   * Format memories for AI context.
   */
  getFormattedMemories(limit = 5) {
    const episodes = this.recall(null, limit);
    if (episodes.length === 0) return 'No saved memories.';

    return episodes
      .map(e => `• [Day ${e.mc_day || '?'}] ${e.summary} (${e.outcome || 'successfully'})`)
      .join('\n');
  }
}
