import { createLogger } from '../utils/logger.js';
import { BotActionWrapper } from './bot-action-wrapper.js';
import { CaveNavigation } from './cave-navigation.js';
import vec3 from 'vec3';

const logger = createLogger('CAMP_LIFE');

/**
 * CampLifeEngine — natural daily routines of a Minecraft player:
 * - Place torches in dark areas and caves
 * - Sleep in beds when night falls
 * - Harvest ripe crops and immediately replant them
 * - Automatically smelt ores and cook food in a furnace
 */
export class CampLifeEngine {
  /**
   * Place a torch when it is dark (light level < 7 or inside a cave)
   */
  static async placeTorchIfNeeded(bot, emotionalSystem = null) {
    if (!bot || !bot.entity) return false;
    const caveNav = new CaveNavigation({
      bot,
      emotionalSystem,
      agentName: bot.username || 'Bot',
    });
    return await caveNav.placeTorch(bot);
  }

  /**
   * Sleep in a bed when night falls (time > 12500)
   */
  static async sleepAtNight(bot) {
    if (!bot || !bot.time || bot.time.timeOfDay < 12500 || bot.time.timeOfDay > 23500) return false;
    if (bot.isSleeping) return true;

    try {
      const bed = bot.findBlock({
        matching: (block) => block.name.includes('_bed'),
        maxDistance: 8,
      });

      if (bed) {
        await bot.sleep(bed);
        logger.info(`[${bot.username || 'Bot'}] 🛏️ Went to bed for the night`);
        return true;
      }
    } catch (err) {
      logger.debug(`Sleep error: ${err.message}`);
    }
    return false;
  }

  /**
   * Harvest ripe crops (wheat, carrots, potatoes) and replant them
   */
  static async harvestAndReplant(bot, emotionalSystem = null) {
    if (!bot || !bot.findBlock) return false;

    try {
      const matureCrop = bot.findBlock({
        matching: (block) => {
          if (['wheat', 'carrots', 'potatoes'].includes(block.name)) {
            return block.metadata === 7 || block._properties?.age === 7;
          }
          if (block.name === 'beetroots') {
            return block.metadata === 3 || block._properties?.age === 3;
          }
          return false;
        },
        maxDistance: 6,
      });

      if (matureCrop) {
        // ✅ Use the error-aware wrapper; it may occasionally target the wrong block
        const wrapper = new BotActionWrapper(bot, emotionalSystem, bot.username || 'Bot');
        await wrapper.mineBlock(matureCrop);
        logger.info(`[${bot.username || 'Bot'}] 🌾 Harvested crop: ${matureCrop.name}`);

        // Replant immediately
        await new Promise((r) => setTimeout(r, 200));
        const cropToSeedMap = {
          wheat: 'wheat_seeds',
          beetroots: 'beetroot_seeds',
          carrots: 'carrot',
          potatoes: 'potato',
        };
        const seedName = cropToSeedMap[matureCrop.name] || matureCrop.name;
        const seedItem = bot.inventory?.items()?.find((i) => i.name === seedName || (seedName.includes('seed') && i.name.includes('seed')));

        if (seedItem) {
          const farmland = bot.blockAt(matureCrop.position.offset(0, -1, 0));
          if (farmland && farmland.name === 'farmland') {
            await bot.equip(seedItem, 'hand');

            // ✅ Use the wrapper to place the seeds
            await wrapper.placeBlock(farmland, vec3(0, 1, 0));
            logger.info(`[${bot.username || 'Bot'}] 🌱 Planted ${seedItem.name}`);
          }
        }
        return true;
      }
    } catch (e) {}
    return false;
  }
}
