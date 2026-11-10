import { createLogger } from '../utils/logger.js';

const logger = createLogger('ENVIRONMENT_INFLUENCE');

/**
 * Many factors — the environment has a MAJOR effect on mistakes!
 *
 * The system tracks ALL environmental conditions and adjusts the probability of mistakes.
 */
export class EnvironmentInfluence {
  constructor() {
    this.currentConditions = {};
  }

  /**
   * Analyze the environment and return mistake multipliers
   */
  analyzeEnvironment(bot, worldState) {
    const multipliers = {
      darkness: 1.0,
      weather: 1.0,
      hostiles: 1.0,
      height: 1.0,
      water: 1.0,
      lava: 1.0,
      cave: 1.0,
      crowded: 1.0,
      tired: 1.0,
      hungry: 1.0,
      damaged: 1.0,
      falling: 1.0,
      fire: 1.0,
      poison: 1.0,
      slowness: 1.0,
      blindness: 1.0,
      confusion: 1.0,
      nausea: 1.0,
      temperature: 1.0,
      noise: 1.0,
      company: 1.0,
      total: 1.0,
    };

    if (!bot) return multipliers;

    // 🌙 DARKNESS — very important!
    const light = this._getLightLevel(bot, worldState);
    if (light < 7) {
      multipliers.darkness = 1 + (0.3 * ((7 - light) / 7)); // Up to +30% in complete darkness
    }

    // 🌧️ WEATHER
    if (worldState?.isRaining) {
      multipliers.weather = 1.15; // +15% in rain
    }

    // 👹 NEARBY HOSTILES
    const nearbyHostiles = this._countNearbyHostiles(bot);
    if (nearbyHostiles > 0) {
      multipliers.hostiles = 1 + (nearbyHostiles * 0.25); // +25% for each hostile
    }

    // 📏 HEIGHT
    const height = bot.entity?.position?.y || 0;
    if (height > 100) {
      multipliers.height = 1.3; // +30% at high elevation
    } else if (height > 64) {
      multipliers.height = 1.15; // +15% at medium elevation
    }

    // 💧 WATER
    if (bot.entity?.isInWater) {
      multipliers.water = 1.4; // +40% in water
    }

    // 🔥 LAVA
    if (bot.entity?.isInLava) {
      multipliers.lava = 1.6; // +60% in lava!
    }

    // 🕳️ CAVES (darkness + hostiles)
    if (this._isInCave(bot)) {
      multipliers.cave = 1.25; // +25% in caves
    }

    // 🤝 MANY ENTITIES NEARBY (crowding)
    const nearbyEntities = this._countNearbyEntities(bot);
    if (nearbyEntities > 5) {
      multipliers.crowded = 1.2; // +20% when many entities are nearby
    }

    // 😴 FATIGUE
    if (bot.food && bot.food < 6) {
      multipliers.tired = 1.25; // +25% when hungry
    }

    // 💔 DAMAGED
    if (bot.health && bot.health < 8) {
      multipliers.damaged = 1.4; // +40% when heavily damaged
    }

    // 📉 FALLING
    if (!bot.entity?.onGround) {
      multipliers.falling = 1.3; // +30% while falling
    }

    // 🔥 ON FIRE
    if (bot.entity?.isOnFire) {
      multipliers.fire = 1.5; // +50% while on fire!
    }

    // ☠️ POISON
    if (this._hasEffect(bot, 'poison')) {
      multipliers.poison = 1.25; // +25% while poisoned
    }

    // 🐌 SLOWNESS
    if (this._hasEffect(bot, 'slowness')) {
      multipliers.slowness = 1.2; // +20% while slowed
    }

    // 👁️ BLINDNESS
    if (this._hasEffect(bot, 'blindness')) {
      multipliers.blindness = 1.8; // +80% while blinded!
    }

    // 🌀 CONFUSIO (confusion)
    if (this._hasEffect(bot, 'nausea')) {
      multipliers.nausea = 1.6; // +60% while affected by nausea
    }

    // 🌡️ TEMPERATURE (extreme conditions)
    if (this._isInExtremeTemperature(bot)) {
      multipliers.temperature = 1.3; // +30% in the Nether or icy plains
    }

    // 🔊 NOISE (many nearby mobs — a psychological factor)
    if (nearbyHostiles > 3) {
      multipliers.noise = 1.2; // +20% from combat noise
    }

    // 👥 LONELINESS (psychological factor)
    if (nearbyEntities === 0 && nearbyHostiles === 0) {
      multipliers.company = 1.1; // +10% when completely alone
    }

    // FINAL MULTIPLIER (all conditions accumulate)
    multipliers.total =
      multipliers.darkness *
      multipliers.weather *
      multipliers.hostiles *
      multipliers.height *
      multipliers.water *
      multipliers.lava *
      multipliers.cave *
      multipliers.crowded *
      multipliers.tired *
      multipliers.hungry *
      multipliers.damaged *
      multipliers.falling *
      multipliers.fire *
      multipliers.poison *
      multipliers.slowness *
      multipliers.blindness *
      multipliers.confusion *
      multipliers.nausea *
      multipliers.temperature *
      multipliers.noise *
      multipliers.company;

    // Limit the maximum multiplier
    multipliers.total = Math.min(multipliers.total, 5.0); // Maximum 5x mistake rate

    this.currentConditions = multipliers;
    return multipliers;
  }

  _getLightLevel(bot, worldState) {
    try {
      const pos = bot.entity?.position?.floored();
      if (!pos) return 15;
      const block = bot.blockAt(pos);
      return block?.light || 15;
    } catch (e) {
      return 15;
    }
  }

  _countNearbyHostiles(bot) {
    try {
      const pos = bot.entity?.position;
      if (!pos) return 0;
      const hostiles = bot.entities?.filter(e => {
        if (!e.position) return false;
        const dist = pos.distanceTo(e.position);
        return dist < 20 && this._isHostile(e.name);
      }) || [];
      return hostiles.length;
    } catch (e) {
      return 0;
    }
  }

  _countNearbyEntities(bot) {
    try {
      const pos = bot.entity?.position;
      if (!pos) return 0;
      const nearby = bot.entities?.filter(e => {
        if (!e.position) return false;
        const dist = pos.distanceTo(e.position);
        return dist < 16 && e.name !== bot.username;
      }) || [];
      return nearby.length;
    } catch (e) {
      return 0;
    }
  }

  _isInCave(bot) {
    try {
      const pos = bot.entity?.position?.floored();
      if (!pos) return false;
      const light = this._getLightLevel(bot);
      const blockAbove = bot.blockAt(pos.offset(0, 1, 0));
      // A cave means it is dark AND the block above is not the sky
      return light < 7 && blockAbove?.name !== 'air';
    } catch (e) {
      return false;
    }
  }

  _isInExtremeTemperature(bot) {
    try {
      const biome = bot.biome?.name || '';
      return biome.includes('nether') || biome.includes('ice') || biome.includes('frozen');
    } catch (e) {
      return false;
    }
  }

  _hasEffect(bot, effectName) {
    try {
      return bot.statusEffects?.some(e => e.name?.includes(effectName)) || false;
    } catch (e) {
      return false;
    }
  }

  _isHostile(name) {
    const hostiles = ['creeper', 'skeleton', 'zombie', 'spider', 'enderman', 'witch', 'piglin', 'ghast', 'wither'];
    return hostiles.some(h => name?.toLowerCase().includes(h));
  }

  /**
   * Get a description of the current conditions
   */
  getConditionsDescription() {
    let desc = '🌍 Environmental conditions:\n';

    for (const [key, value] of Object.entries(this.currentConditions)) {
      if (key === 'total') continue;
      if (value > 1) {
        const percent = Math.round((value - 1) * 100);
        desc += `  • ${key}: +${percent}%\n`;
      }
    }

    if (this.currentConditions.total) {
      desc += `\n📊 TOTAL MULTIPLIER: x${this.currentConditions.total.toFixed(2)}`;
    }

    return desc;
  }
}
