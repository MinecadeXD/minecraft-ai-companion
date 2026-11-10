import { createLogger } from '../utils/logger.js';
import { POITypes } from '../memory/poi-manager.js';

const logger = createLogger('ERROR');

export class DeathHandler {
  constructor(bot, memoryManager, config) {
    this.bot = bot;
    this.memoryManager = memoryManager;
    this.owner = config?.bot?.owner || 'kustash01';
    this.botDeathCount = 0;
    this.lastBotDeathTime = 0;
    this.maxDeathsInWindow = 3;
    this.deathWindowMs = 180000; // 3 minutes
  }

  /**
   * Handle a player death.
   */
  handlePlayerDeath(playerName, position) {
    if (!position) return;

    const coords = {
      x: Math.round(position.x),
      y: Math.round(position.y),
      z: Math.round(position.z),
    };

    logger.warn(`💀 [PLAYER DEATH] ${playerName} died at [${coords.x}, ${coords.y}, ${coords.z}]`);

    // Save to memory as a point of interest
    if (this.memoryManager) {
      this.memoryManager.pois.addPOI(
        `${playerName}'s death location`,
        POITypes.DEATH,
        coords,
        `Died at ${new Date().toLocaleTimeString()}`
      );

      this.memoryManager.episodic.rememberEpisode({
        mcDay: this.bot?.time ? Math.floor(this.bot.time.time / 24000) + 1 : 1,
        eventType: 'death',
        summary: `${playerName} died at coordinates [${coords.x}, ${coords.y}, ${coords.z}]`,
        position: coords,
        participants: playerName,
        outcome: 'item loss',
        importance: 8,
      });
    }

    // The event is saved to memory; ConversationEngine chooses the social response.
  }

  /**
   * Handle the bot's own death.
   */
  handleBotDeath() {
    const now = Date.now();
    if (now - this.lastBotDeathTime < this.deathWindowMs) {
      this.botDeathCount++;
    } else {
      this.botDeathCount = 1;
    }
    this.lastBotDeathTime = now;

    let coords = { x: 0, y: 0, z: 0 };
    if (this.bot && this.bot.entity) {
      coords = {
        x: Math.round(this.bot.entity.position.x),
        y: Math.round(this.bot.entity.position.y),
        z: Math.round(this.bot.entity.position.z),
      };
    }

    logger.warn(`💀 [BOT DEATH] Bot died at [${coords.x}, ${coords.y}, ${coords.z}] (death #${this.botDeathCount})`);

    // Prevent an infinite death loop
    if (this.botDeathCount >= this.maxDeathsInWindow) {
      logger.error('⚠️ [DEATH LOOP DETECTED] Too many consecutive deaths! The bot is switching to passive mode.');
      // Do not send an automatic message; the agent may choose to remain silent.
      return false;
    }

    if (this.memoryManager) {
      this.memoryManager.episodic.rememberEpisode({
        mcDay: this.bot?.time ? Math.floor(this.bot.time.time / 24000) + 1 : 1,
        eventType: 'bot_death',
        summary: `Bot died at [${coords.x}, ${coords.y}, ${coords.z}]`,
        position: coords,
        importance: 7,
      });
    }

    return true;
  }
}
