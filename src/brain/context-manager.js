import { createLogger } from '../utils/logger.js';
import { sceneObserver } from '../perception/scene-observer.js';

const logger = createLogger('AI');

/**
 * ContextManager — context management for the LLM.
 * Builds relevant information for each request.
 */
export class ContextManager {
  constructor(config) {
    this.config = config;
    this.maxHistoryLength = 20;
    this.recentHistory = [];
    this.bot = null;
    // Optional CommitmentMemory — lets the bot recall its own open promises.
    this.commitmentMemory = null;
  }

  /**
   * Attach the commitment memory so open promises surface in the LLM context.
   */
  setCommitmentMemory(cm) {
    this.commitmentMemory = cm || null;
  }

  /**
   * Attach the live mineflayer bot so the context can include a first-person
   * scene description (terrain, compass, what is around). Optional: without it
   * the context falls back to the flat WorldState summary.
   */
  setBot(bot) {
    this.bot = bot || null;
  }

  /**
   * Build a context string for the AI from the current WorldState.
   * @param {WorldState} worldState — world state object
   * @param {string|null} currentTask — current task
   * @param {Array} recentHistory — recent history
   * @returns {string}
   */
  buildContext(worldState, currentTask, recentHistory = [], memoryManager = null) {
    const parts = [];

    parts.push('[WORLD STATE]');

    if (worldState && worldState.getSummary) {
      parts.push(worldState.getSummary());
    } else if (worldState && worldState.position) {
      // Fallback when a snapshot is provided
      const pos = worldState.position;
      parts.push(`Position: [${pos.x}, ${pos.y}, ${pos.z}]`);
      parts.push(`Health: ${worldState.health || 20}/20, Food: ${worldState.food || 20}/20`);
    }

    // Live vision: what the bot actually sees nearby (terrain, cardinal directions, and objects).
    if (this.bot?.entity) {
      try {
        const scene = sceneObserver.observe(this.bot);
        if (scene) {
          parts.push(`\n[WHAT I SEE]\n${sceneObserver.describe(scene)}`);
        }
      } catch (err) {
        logger.debug(`Could not build a scene for context: ${err.message}`);
      }
    }

    if (currentTask) {
      parts.push(`\n[CURRENT TASK]\n${currentTask}`);
    }

    if (memoryManager && memoryManager.getMemoryContext) {
      const memContext = memoryManager.getMemoryContext(worldState?.position);
      if (memContext) {
        parts.push(`\n${memContext}`);
      }
    }

    // Open promises and commitments (living memory): the bot recalls on its own
    // what it promised but has not done. The LLM generates the exact wording.
    if (this.commitmentMemory?.getContextForPrompt) {
      try {
        const promises = this.commitmentMemory.getContextForPrompt();
        if (promises) parts.push(`\n[MY PROMISES]\n${promises}`);
      } catch (_) {}
    }

    // Recent history (summarized)
    const history = recentHistory.length > 0 ? recentHistory : this.recentHistory;
    if (history.length > 0) {
      const historyText = this._summarizeHistory(history);
      parts.push(`\n[RECENT HISTORY]\n${historyText}`);
    }

    return parts.join('\n');
  }

  /**
   * Add a message to history.
   */
  addToHistory(role, content) {
    this.recentHistory.push({ role, content, timestamp: Date.now() });
    // Limit the size
    if (this.recentHistory.length > this.maxHistoryLength) {
      this.recentHistory = this.recentHistory.slice(-this.maxHistoryLength);
    }
  }

  /**
   * Compress the history into a readable format.
   */
  _summarizeHistory(messages) {
    if (!messages || messages.length === 0) return '';
    return messages
      .slice(-10) // Last 10 messages
      .map(m => `${m.role}: ${typeof m.content === 'string' ? m.content.substring(0, 150) : m.content}`)
      .join('\n');
  }

  /**
   * Clear history.
   */
  clearHistory() {
    this.recentHistory = [];
  }
}
