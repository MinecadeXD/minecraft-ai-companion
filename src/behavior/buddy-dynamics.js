import vec3 from 'vec3';
import { createLogger } from '../utils/logger.js';
import { HumanMotor } from './human-motor.js';
import { HumanErrorEngine } from './human-error-engine.js';

const logger = createLogger('BUDDY_DYNAMICS');

/**
 * BuddyDynamics — cooperative etiquette, mutual support, and looking after teammates:
 * 1. shareLoot — share food, ingots, and tools with a teammate.
 * 2. checkEmergencyHeal — help a teammate with low health (<8 HP) or hunger by dropping food.
 * 3. synchronousSleep — coordinate sleep (places a nearby bed and suggests going to sleep).
 * 4. yieldHallway — yield in narrow 1x1 passages by stepping back or aside.
 * 5. celebrateVictory — celebrate a shared win or diamond discovery with a brief crouch-and-jump dance.
 */
export class BuddyDynamics {
  /**
   * Find a teammate entity
   */
  static findBuddy(bot, playerName = null) {
    if (!bot?.entities) return null;
    const want = playerName ? String(playerName).toLowerCase() : null;

    for (const id in bot.entities) {
      const e = bot.entities[id];
      if (!e || e === bot.entity || e.type !== 'player' || !e.position) continue;
      if (!want || (e.username && e.username.toLowerCase() === want)) {
        return e;
      }
    }
    return null;
  }

  /**
   * Share resources or a spare tool with a teammate
   */
  static async shareLoot(bot, playerName, itemName, count = 1) {
    const buddy = this.findBuddy(bot, playerName);
    if (!buddy) throw new Error(`Teammate ${playerName || 'player'} was not found nearby`);

    const item = (bot.inventory?.items() || []).find(i => i.name === itemName || i.name.includes(itemName));
    if (!item) throw new Error(`Item ${itemName} is not available in the inventory to share`);

    // Search the inventory with a natural human-like delay
    const searchDelay = Math.round(HumanErrorEngine.range(50, 120, bot));
    if (searchDelay > 100 && process.env.NODE_ENV !== 'test') {
      await new Promise(r => setTimeout(r, searchDelay));
    }

    // Move within 2.5 blocks
    if (typeof bot.lookAt === 'function') {
      await HumanMotor.smoothLook(bot, buddy.position.offset(0, buddy.height || 1.6, 0), 4);
    }

    if (typeof bot.equip === 'function') {
      await bot.equip(item, 'hand');
    }

    if (typeof bot.toss === 'function') {
      await bot.toss(item.type, null, Math.min(count, item.count));
      logger.info(`[BUDDY] 🤝 Dropped ${item.name} (${count}) for teammate ${buddy.username || 'friend'}`);
    }

    // A friendly crouch tap as a sign of respect
    if (typeof bot.setControlState === 'function') {
      bot.setControlState('sneak', true);
      const tapDuration = Math.round(HumanErrorEngine.range(100, 140, bot));
      await new Promise(r => setTimeout(r, tapDuration));
      bot.setControlState('sneak', false);
    }
    return true;
  }

  /**
   * Emergency food support when a teammate's health is critical (<8 HP) or they are hungry
   */
  static async checkEmergencyHeal(bot, playerName = null) {
    const buddy = this.findBuddy(bot, playerName);
    if (!buddy) return false;

    // Account for the chance of noticing a teammate in distress when attention is overloaded
    const noticed = HumanErrorEngine.chance(0.96, bot);
    if (!noticed) {
      logger.debug(`[BUDDY] Did not immediately notice the teammate's low health due to cognitive load`);
      return false;
    }

    // Look for food in the inventory
    const food = (bot.inventory?.items() || []).find(i =>
      ['cooked_beef', 'cooked_porkchop', 'bread', 'baked_potato', 'golden_apple', 'apple'].includes(i.name)
    );
    if (!food) return false;

    const dist = bot.entity.position.distanceTo(buddy.position);
    if (dist <= 6) {
      if (typeof bot.chat === 'function') {
        bot.chat('Here, eat this before you pass out');
      }
      return this.shareLoot(bot, buddy.username, food.name, Math.min(4, food.count));
    }
    return false;
  }

  /**
   * Coordinated bed sleep
   */
  static async synchronousSleep(bot, bedBlock = null) {
    if (!bot) return false;

    let bed = bedBlock;
    if (!bed && typeof bot.findBlock === 'function') {
      bed = bot.findBlock({
        matching: (b) => b && b.name.includes('_bed'),
        maxDistance: 16,
      });
    }

    // If there is no nearby bed but one is in the inventory, place it nearby
    if (!bed) {
      const bedItem = (bot.inventory?.items() || []).find(i => i.name.includes('_bed'));
      if (bedItem && bot.entity?.position && typeof bot.placeBlock === 'function') {
        try {
          const under = bot.blockAt(bot.entity.position.offset(1, -1, 0));
          if (under && under.name !== 'air' && typeof bot.equip === 'function') {
            await bot.equip(bedItem, 'hand');
            await bot.placeBlock(under, vec3(0, 1, 0));
            bed = bot.blockAt(bot.entity.position.offset(1, 0, 0));
          }
        } catch (_) {}
      }
    }

    if (bed && typeof bot.sleep === 'function') {
      if (typeof bot.chat === 'function') {
        bot.chat('Let's get some sleep; it's nighttime');
      }
      try {
        await bot.sleep(bed);
        logger.info(`[BUDDY] 🛏️ Went to sleep in a bed`);
        return true;
      } catch (err) {
        logger.debug(`Could not get into bed: ${err.message}`);
      }
    }
    return false;
  }

  /**
   * Yield the way in a narrow 1x1 tunnel when a teammate approaches
   */
  static async yieldHallway(bot, playerName = null) {
    const buddy = this.findBuddy(bot, playerName);
    if (!buddy || !bot?.entity?.position) return false;

    const dist = bot.entity.position.distanceTo(buddy.position);
    if (dist < 2.5) {
      // A natural hesitation before yielding (150–250 ms)
      const hesitation = Math.round(HumanErrorEngine.range(150, 250, bot));
      if (process.env.NODE_ENV !== 'test') {
        await new Promise(r => setTimeout(r, hesitation));
      }
      // Step back one block
      if (typeof bot.setControlState === 'function') {
        bot.setControlState('back', true);
        bot.setControlState('sneak', true);
        const backDuration = Math.round(HumanErrorEngine.range(420, 480, bot));
        await new Promise(r => setTimeout(r, backDuration));
        bot.setControlState('back', false);
        bot.setControlState('sneak', false);
        logger.info(`[BUDDY] 🚶 Yielded the narrow passage to a teammate`);
        return true;
      }
    }
    return false;
  }

  /**
   * Celebration dance (crouching and jumping) after a shared victory or diamond discovery
   */
  static async celebrateVictory(bot) {
    if (!bot || typeof bot.setControlState !== 'function') return;

    logger.info(`[BUDDY] 🎉 Celebrating a victory!`);
    const crouches = Math.max(2, Math.min(5, Math.round(HumanErrorEngine.range(2.6, 3.8, bot))));
    for (let i = 0; i < crouches; i++) {
      bot.setControlState('sneak', true);
      const crouchTime = Math.round(HumanErrorEngine.range(100, 140, bot));
      await new Promise(r => setTimeout(r, crouchTime));
      bot.setControlState('sneak', false);
      const pauseTime = Math.round(HumanErrorEngine.range(80, 120, bot));
      await new Promise(r => setTimeout(r, pauseTime));
    }
    if (bot.entity?.onGround) {
      bot.setControlState('jump', true);
      const jumpTime = Math.round(HumanErrorEngine.range(160, 200, bot));
      await new Promise(r => setTimeout(r, jumpTime));
      bot.setControlState('jump', false);
    }
  }
}
