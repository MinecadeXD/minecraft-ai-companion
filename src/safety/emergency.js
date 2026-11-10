import { createLogger } from '../utils/logger.js';

const logger = createLogger('ERROR');

export class EmergencyController {
  constructor({ bot, planner, aiBrain }) {
    this.bot = bot;
    this.planner = planner;
    this.aiBrain = aiBrain;
    this.isPaused = false;
  }

  /**
   * Emergency stop for all bot actions.
   */
  emergencyStop(reason = 'Emergency stop', { announce = false } = {}) {
    logger.warn(`🚨 [EMERGENCY STOP] ${reason}`);

    try {
      // 1. Stop navigation and clear control states
      if (this.bot && this.bot.pathfinder) {
        this.bot.pathfinder.stop();
      }
      if (this.bot?.clearControlStates) {
        this.bot.clearControlStates();
      }

      // 2. Stop attacking / PvP
      if (this.bot && this.bot.pvp) {
        this.bot.pvp.stop();
      }

      // 3. Cancel the active plan
      if (this.planner) {
        this.planner.cancelPlan('Emergency stop');
      }

      // 4. Reset the current AI session
      if (this.aiBrain) {
        this.aiBrain.stop();
      }

      if (announce && this.bot?.chat) this.bot.chat('stop');
      return true;
    } catch (err) {
      logger.error(`Error during emergency stop: ${err.message}`);
      return false;
    }
  }

  /**
   * Pause action execution.
   */
  pause() {
    this.isPaused = true;
    if (this.bot && this.bot.pathfinder) {
      this.bot.pathfinder.stop();
    }
    logger.info('⏸️ Bot paused');
    return true;
  }

  /**
   * Resume operation.
   */
  resume() {
    this.isPaused = false;
    logger.info('▶️ Bot resumed');
    return true;
  }
}
