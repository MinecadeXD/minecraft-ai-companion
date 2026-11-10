import { createLogger } from '../utils/logger.js';

const logger = createLogger('MEMORY');

export class Diary {
  constructor(longTermMemory) {
    this.storage = longTermMemory;
  }

  /**
   * Record a new event in the diary.
   */
  logEntry(mcDay, title, content) {
    const info = this.storage.addDiaryEntry(mcDay, title, content);
    logger.info(`[DIARY] Day ${mcDay}: ${title}`);
    return info;
  }

  /**
   * Get the latest diary entries.
   */
  getRecentEntries(limit = 5) {
    return this.storage.getDiaryEntries(limit);
  }

  /**
   * Get entries for a specific day.
   */
  getEntriesByDay(mcDay) {
    return this.storage.getDiaryByDay(mcDay);
  }

  /**
   * Return formatted diary text for the AI.
   */
  getFormattedSummary(limit = 5) {
    const entries = this.getRecentEntries(limit);
    if (entries.length === 0) return 'The diary is empty.';

    return entries
      .map(e => `[Day ${e.mc_day}] ${e.title}: ${e.content}`)
      .join('\n');
  }
}
