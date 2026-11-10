import logger from '../utils/logger.js';

export class SessionManager {
  constructor(db = null) {
    this.db = db;
    this.sessionId = `session-${Date.now()}`;
    this.startTime = Date.now();
    this.activeGoalOnStart = null;
  }

  /**
   * Reconstruct session start summary from memory.
   */
  getReconstructedContext(memoryManager) {
    let summary = 'We just entered the world.';
    if (!memoryManager) return summary;

    const base = memoryManager.getPOI('base') || memoryManager.getPOI('home');
    const recentEpisode = memoryManager.episodic ? memoryManager.episodic.getRecentEpisodes(1)[0] : null;

    if (base && recentEpisode) {
      summary = `We are at the base (${base.x}, ${base.y}, ${base.z}). Last time, we: ${recentEpisode.description || 'explored the world'}.`;
    } else if (base) {
      summary = `We are at the base at coordinates (${base.x}, ${base.y}, ${base.z}).`;
    }

    logger.info(`[SESSION] Reconstructed start context: "${summary}"`);
    return summary;
  }

  /**
   * Save session statistics and summary upon exit.
   */
  saveSessionSummary(summaryText = 'Session completed successfully') {
    const durationMinutes = Math.round((Date.now() - this.startTime) / 60000);
    logger.info(`[SESSION] Saving session ${this.sessionId} (Duration: ${durationMinutes} min): ${summaryText}`);
    return {
      sessionId: this.sessionId,
      durationMinutes,
      summary: summaryText,
    };
  }
}

export const sessionManager = new SessionManager();
