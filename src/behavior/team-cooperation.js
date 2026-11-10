import { createLogger } from '../utils/logger.js';
import { KinematicsEngine } from './kinematics.js';

const logger = createLogger('TEAM_COOPERATION');

/**
 * TeamCooperationEngine — team cooperation, item sharing with Q,
 * looking out for teammates who are busy and friendly gestures (GG, crouching).
 */
export class TeamCooperationEngine {
  /**
   * Give an item to a player or teammate (Q Toss)
   */
  static async tossItemToTarget(bot, targetName, itemName, count = 1) {
    if (!bot || !bot.inventory) return false;

    const targetPlayer = bot.players?.[targetName]?.entity;
    if (!targetPlayer || !targetPlayer.position) return false;

    const item = bot.inventory.items().find((i) => i.name === itemName || i.name.includes(itemName));
    if (!item) return false;

    try {
      // Turn toward the player
      await bot.lookAt(targetPlayer.position.offset(0, 1.5, 0), true);

      // Drop the item with the Q key
      if (typeof bot.toss === 'function') {
        await bot.toss(item.type, null, Math.min(count, item.count));
      } else if (typeof bot.tossStack === 'function') {
        await bot.tossStack(item);
      }

      logger.info(`[${bot.username || 'Bot'}] 🎁 Dropped ${count}x ${item.name} for ${targetName}`);

      // Friendly nod
      await KinematicsEngine.crouchNod(bot, 2);
      return true;
    } catch (err) {
      logger.debug(`Toss item error: ${err.message}`);
      return false;
    }
  }

  /**
   * Celebrate a victory or completed task (GG crouch-and-jump gesture)
   */
  static async celebrate(bot) {
    if (!bot || typeof bot.setControlState !== 'function') return;

    try {
      for (let i = 0; i < 3; i++) {
        bot.setControlState('sneak', true);
        if (i === 1 && bot.entity?.onGround) {
          bot.setControlState('jump', true);
          setTimeout(() => bot?.setControlState?.('jump', false), 200);
        }
        KinematicsEngine.swingArm(bot);
        await new Promise((r) => setTimeout(r, 120));
        bot.setControlState('sneak', false);
        await new Promise((r) => setTimeout(r, 120));
      }
    } catch (e) {}
  }
}
