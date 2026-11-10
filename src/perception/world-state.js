import { createLogger } from '../utils/logger.js';

const logger = createLogger('WORLD');

/**
 * WorldState — collects and stores the current state of the game world.
 * Updated periodically (not every tick).
 */
export class WorldState {
  constructor() {
    this.position = null;
    this.health = 20;
    this.food = 20;
    this.saturation = 0;
    this.inventory = [];
    this.nearbyEntities = [];
    this.timeOfDay = 0;
    this.isRaining = false;
    this.gameMode = 'survival';
    this.experience = 0;
    this.armor = [];
    this.heldItem = null;
    this.offHand = null;
    this.freeSlots = 36;
    this.hotbar = [];
    this.lightLevel = 15;
    this.blockLight = 15;
    this.skyLight = 15;
    this.inCave = false;
    this.isDark = false;
    this.torchCount = 0;
    this.foodCount = 0;
    this.hasShield = false;
    this.lastUpdate = 0;
    this.updateInterval = 2000; // Updated every 2 seconds
    this._autoUpdateTimer = null;
  }

  /**
   * Update world state from the Mineflayer bot.
   */
  update(bot) {
    if (!bot || !bot.entity) return;
    const now = Date.now();
    if (now - this.lastUpdate < this.updateInterval) return;
    this._doUpdate(bot, now);
  }

  /**
   * Force an update (ignore the interval).
   */
  forceUpdate(bot) {
    if (!bot || !bot.entity) return;
    this._doUpdate(bot, Date.now());
  }

  _doUpdate(bot, now) {
    try {
      this.position = bot.entity.position ? {
        x: Math.round(bot.entity.position.x * 10) / 10,
        y: Math.round(bot.entity.position.y * 10) / 10,
        z: Math.round(bot.entity.position.z * 10) / 10,
      } : null;
      this.health = bot.health;
      this.food = bot.food;
      this.saturation = bot.foodSaturation;
      this.timeOfDay = bot.time ? bot.time.timeOfDay : 0;
      this.isRaining = bot.isRaining;
      this.gameMode = bot.game ? bot.game.gameMode : 'survival';
      this.experience = bot.experience ? bot.experience.points : 0;

      // Inventory
      const rawItems = bot.inventory ? bot.inventory.items() : [];
      this.inventory = rawItems.map(item => ({
        name: item.name,
        count: item.count,
        slot: item.slot,
      }));

      // Main-hand item
      this.heldItem = bot.heldItem ? {
        name: bot.heldItem.name,
        count: bot.heldItem.count,
        slot: bot.heldItem.slot,
        durabilityUsed: bot.heldItem.durabilityUsed ?? null,
      } : null;

      // Off-hand item (slot 45)
      const offHandItem = bot.inventory?.slots ? bot.inventory.slots[45] : null;
      this.offHand = offHandItem ? {
        name: offHandItem.name,
        count: offHandItem.count,
        slot: 45,
        durabilityUsed: offHandItem.durabilityUsed ?? null,
      } : null;

      // Available inventory slots (slots 9–44)
      if (bot.inventory?.slots) {
        let free = 0;
        for (let s = 9; s <= 44; s++) {
          if (!bot.inventory.slots[s]) free++;
        }
        this.freeSlots = free;
      } else {
        this.freeSlots = 36;
      }

      // Hotbar (slots 36–44)
      this.hotbar = bot.inventory?.slots
        ? bot.inventory.slots.slice(36, 45).filter(Boolean).map(item => ({
            name: item.name,
            count: item.count,
            slot: item.slot,
          }))
        : [];

      // Armor (slots 5–8: helmet, chestplate, leggings, boots)
      const armorSlots = [
        { slot: 5, type: 'head' },
        { slot: 6, type: 'torso' },
        { slot: 7, type: 'legs' },
        { slot: 8, type: 'feet' },
      ];
      this.armor = bot.inventory?.slots
        ? armorSlots.map(({ slot, type }) => {
            const item = bot.inventory.slots[slot];
            return item ? { name: item.name, slot, type, durabilityUsed: item.durabilityUsed ?? null } : null;
          }).filter(Boolean)
        : [];

      // Torches
      this.torchCount = rawItems.reduce((acc, item) => {
        if (item.name === 'torch' || item.name === 'soul_torch') {
          return acc + (item.count || 1);
        }
        return acc;
      }, 0);

      // Food
      const EDIBLE_ITEMS = new Set([
        'apple', 'baked_potato', 'beef', 'beetroot', 'beetroot_soup', 'bread', 'carrot',
        'chorus_fruit', 'cooked_beef', 'cooked_chicken', 'cooked_cod', 'cooked_mutton',
        'cooked_porkchop', 'cooked_rabbit', 'cooked_salmon', 'cookie', 'dried_kelp',
        'enchanted_golden_apple', 'glow_berries', 'golden_apple', 'golden_carrot',
        'honey_bottle', 'melon_slice', 'mushroom_stew', 'mutton', 'porkchop', 'potato',
        'pumpkin_pie', 'rabbit', 'rabbit_stew', 'sweet_berries'
      ]);
      this.foodCount = rawItems.reduce((acc, item) => {
        if (EDIBLE_ITEMS.has(item.name) || item.name?.includes('cooked') || item.name?.includes('bread')) {
          return acc + (item.count || 1);
        }
        return acc;
      }, 0);

      // Shield availability
      this.hasShield = Boolean(
        this.offHand?.name === 'shield' ||
        this.heldItem?.name === 'shield' ||
        rawItems.some(i => i.name === 'shield')
      );

      // Lighting and whether the bot is in a cave
      let blockLight = 15;
      let skyLight = 0;
      let lightLevel = 15;
      if (bot.world || typeof bot.blockAt === 'function') {
        const pos = typeof bot.entity?.position?.floored === 'function'
          ? bot.entity.position.floored()
          : (bot.entity?.position ? {
              x: Math.floor(bot.entity.position.x),
              y: Math.floor(bot.entity.position.y),
              z: Math.floor(bot.entity.position.z),
            } : null);
        if (pos) {
          const block = typeof bot.blockAt === 'function'
            ? bot.blockAt(pos)
            : (typeof bot.world?.getBlock === 'function' ? bot.world.getBlock(pos) : null);
          if (block) {
            blockLight = block.light ?? 15;
            if (block.skyLight !== undefined) {
              skyLight = block.skyLight;
              lightLevel = Math.max(blockLight, skyLight);
            } else {
              skyLight = 0;
              lightLevel = blockLight;
            }
          }
        }
      }
      this.blockLight = blockLight;
      this.skyLight = skyLight;
      this.lightLevel = lightLevel;
      this.isDark = this.lightLevel <= 7;

      const yPos = this.position ? this.position.y : 64;
      this.inCave = Boolean(yPos < 55 || (this.skyLight <= 4 && yPos < 65));

      // Nearby entities
      this.nearbyEntities = this._getNearbyEntities(bot, 16);

      this.lastUpdate = now;
    } catch (error) {
      logger.error(`WorldState update error: ${error.message}`);
    }
  }

  /**
   * Start automatic updates.
   */
  startAutoUpdate(bot) {
    this.stopAutoUpdate();
    this.forceUpdate(bot);
    this._autoUpdateTimer = setInterval(() => {
      this.forceUpdate(bot);
    }, this.updateInterval);
    logger.info('WorldState auto-update started');
  }

  /**
   * Stop automatic updates.
   */
  stopAutoUpdate() {
    if (this._autoUpdateTimer) {
      clearInterval(this._autoUpdateTimer);
      this._autoUpdateTimer = null;
    }
  }

  /**
   * Return a serializable state snapshot for the AI.
   */
  getSnapshot() {
    return {
      position: this.position,
      observedAt: this.lastUpdate,
      health: this.health,
      food: this.food,
      saturation: this.saturation,
      timeOfDay: this.timeOfDay,
      isRaining: this.isRaining,
      gameMode: this.gameMode,
      experience: this.experience,
      inventorySummary: this.getInventorySummary(),
      inventory: this.inventory.map((item) => ({ name: item.name, count: item.count })),
      nearbyEntities: this.nearbyEntities.map(e => ({
        name: e.name || e.type,
        type: e.type,
        distance: e.distance,
      })),
      armorSummary: this.armor.map(a => a.name).join(', ') || 'none',
      armor: this.armor,
      heldItem: this.heldItem,
      offHand: this.offHand,
      freeSlots: this.freeSlots,
      hotbar: this.hotbar,
      lightLevel: this.lightLevel,
      blockLight: this.blockLight,
      skyLight: this.skyLight,
      inCave: this.inCave,
      isDark: this.isDark,
      torchCount: this.torchCount,
      foodCount: this.foodCount,
      hasShield: this.hasShield,
    };
  }

  /**
   * Short text description for AI context.
   */
  getSummary() {
    const pos = this.position
      ? `${this.position.x}, ${this.position.y}, ${this.position.z}`
      : 'Unknown';

    const timeStr = this._getTimeDescription();
    const entities = this.nearbyEntities.length > 0
      ? `Nearby: ${this.nearbyEntities.slice(0, 5).map(e => e.name || e.type).join(', ')}`
      : 'Nobody nearby';

    const lightStr = `Light: ${this.lightLevel}/15${this.inCave ? ' (in a cave)' : ''}`;
    const handsStr = `Held: [${this.heldItem?.name || 'hand'}], off-hand: [${this.offHand?.name || 'empty'}]`;
    const gearStr = `Free slots: ${this.freeSlots}, Torches: ${this.torchCount}, Food: ${this.foodCount}`;

    return [
      `Position: [${pos}]`,
      `Health: ${this.health}/20, Food: ${this.food}/20`,
      `Time: ${timeStr}, Weather: ${this.isRaining ? 'Rain' : 'Clear'}, ${lightStr}`,
      handsStr,
      gearStr,
      `Inventory: ${this.getInventorySummary()}`,
      entities,
    ].join('. ');
  }

  /**
   * Compact inventory description.
   */
  getInventorySummary() {
    if (!this.inventory || this.inventory.length === 0) return 'empty';
    const counts = {};
    for (const item of this.inventory) {
      counts[item.name] = (counts[item.name] || 0) + item.count;
    }
    return Object.entries(counts)
      .map(([name, count]) => `${count}x ${name}`)
      .join(', ');
  }

  /**
   * Collect nearby entities.
   */
  _getNearbyEntities(bot, range = 16) {
    if (!bot || !bot.entities || !bot.entity) return [];
    const entities = [];
    for (const id in bot.entities) {
      const entity = bot.entities[id];
      if (entity === bot.entity) continue;
      if (!entity.position) continue;
      const dist = bot.entity.position.distanceTo(entity.position);
      if (dist <= range) {
        entities.push({
          name: entity.username || entity.name || entity.type,
          type: entity.type,
          distance: Math.round(dist * 10) / 10,
          position: {
            x: Math.round(entity.position.x),
            y: Math.round(entity.position.y),
            z: Math.round(entity.position.z),
          },
        });
      }
    }
    return entities.sort((a, b) => a.distance - b.distance);
  }

  /**
   * Description of the time of day in Minecraft.
   */
  _getTimeDescription() {
    const t = this.timeOfDay;
    if (t >= 0 && t < 6000) return 'Morning';
    if (t >= 6000 && t < 12000) return 'Day';
    if (t >= 12000 && t < 13000) return 'Sunset';
    if (t >= 13000 && t < 23000) return 'Night';
    return 'Dawn';
  }
}
