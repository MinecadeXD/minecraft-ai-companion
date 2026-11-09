import { structureDetector } from '../perception/structure-detector.js';
import { POITypes } from '../memory/poi-manager.js';
import { spatialIntelligence } from '../world/spatial-intelligence.js';
import pathfinderPkg from 'mineflayer-pathfinder';
import { createLogger } from '../utils/logger.js';

const { goals } = pathfinderPkg;
const logger = createLogger('EXPLORATION_TOOLS');

// Unit vectors for compass directions in Minecraft axes (+X east, +Z south).
const DIRECTION_VECTORS = {
  N: { dx: 0, dz: -1 }, S: { dx: 0, dz: 1 }, E: { dx: 1, dz: 0 }, W: { dx: -1, dz: 0 },
  NE: { dx: 0.707, dz: -0.707 }, NW: { dx: -0.707, dz: -0.707 },
  SE: { dx: 0.707, dz: 0.707 }, SW: { dx: -0.707, dz: 0.707 },
};

const DIRECTION_ALIASES = {
  n: 'N', north: 'N',
  s: 'S', south: 'S',
  e: 'E', east: 'E',
  w: 'W', west: 'W',
  ne: 'NE', northeast: 'NE',
  nw: 'NW', northwest: 'NW',
  se: 'SE', southeast: 'SE',
  sw: 'SW', southwest: 'SW',
};

function normalizeDirection(raw) {
  const key = String(raw || '').toLowerCase().trim();
  return DIRECTION_ALIASES[key] || key.toUpperCase();
}

/**
 * Exploration / structure-awareness tools: let the bot notice villages the way
 * a player would, remember them, and orient toward ones a player mentions.
 */
export function registerExplorationTools(registry, { bot, memoryManager }) {
  // Was this village center already saved? Avoid duplicate POIs for the same spot.
  const alreadyKnown = (center) => {
    if (!memoryManager?.pois?.getPOIs) return false;
    const villages = memoryManager.pois.getPOIs(POITypes.VILLAGE) || [];
    return villages.some(v => Math.hypot(v.x - center.x, v.y - center.y, v.z - center.z) < 24);
  };

  registry.register({
    name: 'scan_for_village',
    description: 'Look around for a village nearby (by its bells, workstations, beds and villagers). Reports direction, distance and approximate coordinates, and remembers it. Use when a player says a village is nearby or when asked to find one.',
    parameters: {
      type: 'object',
      properties: {
        maxDistance: { type: 'number', description: 'Search radius in blocks (default 64, max 128)' }
      }
    },
    handler: async (args) => {
      try {
        if (!bot.entity) return { success: false, error: 'The bot has not spawned yet.' };
        const maxDistance = Math.min(128, Math.max(16, args.maxDistance || 64));
        const detection = structureDetector.detectVillage(bot, maxDistance);

        if (!detection) {
          return { success: true, data: 'I do not see a village within this radius. Try moving closer or looking from higher ground.' };
        }

        // Remember it as a POI (flows into AI memory context automatically).
        let saved = false;
        if (memoryManager?.pois?.addPOI && !alreadyKnown(detection.center)) {
          try {
            memoryManager.pois.addPOI(
              `Village (${detection.direction.en})`,
              POITypes.VILLAGE,
              detection.center,
              `Observed: about ${detection.villagerCount} villagers, about ${detection.bedCount} beds, confidence ${detection.confidence}`,
            );
            saved = true;
          } catch (err) {
            logger.debug(`Could not save village POI: ${err.message}`);
          }
        }

        return {
          success: true,
          data: structureDetector.describeVillage(detection) + (saved ? ' (remembered)' : ''),
          detection,
        };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }
  });

  registry.register({
    name: 'list_known_places',
    description: 'List places the bot already knows and remembers (villages, bases, mines, etc.) with their coordinates. Use to recall where a previously-found village is.',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Optional filter: village, base, mine, cave, farm, portal' }
      }
    },
    handler: async (args) => {
      try {
        if (!memoryManager?.pois?.getPOIs) return { success: true, data: 'No places have been saved yet.' };
        const type = args.type ? String(args.type).toLowerCase() : null;
        const pois = memoryManager.pois.getPOIs(type) || [];
        if (pois.length === 0) {
          return { success: true, data: type ? `I do not know any places of type "${type}" yet.` : 'I do not know any notable places yet.' };
        }
        const list = pois.slice(0, 12).map(p =>
          `${p.name} (${p.type}): [${Math.round(p.x)}, ${Math.round(p.y)}, ${Math.round(p.z)}]`
        ).join('; ');
        return { success: true, data: list, places: pois };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }
  });

  registry.register({
    name: 'remember_place',
    description: 'Save the current spot (or given coordinates) as a named place to remember (e.g. "home", "village", "mine"). Use when a player points out a location.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name for the place' },
        type: { type: 'string', description: 'village, base, mine, cave, farm, portal, other (default other)' },
        x: { type: 'number' },
        y: { type: 'number' },
        z: { type: 'number' },
        notes: { type: 'string' }
      },
      required: ['name']
    },
    handler: async (args) => {
      try {
        if (!memoryManager?.pois?.addPOI) return { success: false, error: 'Memory is unavailable.' };
        let coords;
        if (args.x !== undefined && args.z !== undefined) {
          coords = { x: args.x, y: args.y ?? (bot.entity?.position?.y ?? 64), z: args.z };
        } else if (bot.entity?.position) {
          const p = bot.entity.position;
          coords = { x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z) };
        } else {
          return { success: false, error: 'No coordinates are available and the bot has not spawned.' };
        }

        const validTypes = Object.values(POITypes);
        const type = validTypes.includes(args.type) ? args.type : POITypes.OTHER;
        memoryManager.pois.addPOI(args.name, type, coords, args.notes || '');
        return { success: true, data: `Remembered: ${args.name} at [${coords.x}, ${coords.y}, ${coords.z}].` };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }
  });

  registry.register({
    name: 'scout_direction',
    description: 'Walk a short distance in a compass direction to look around (e.g. "go see what is beyond the mountain to the north"). Scan for a village along the way and report what you find. This is a short, bounded trip, not a long expedition.',
    parameters: {
      type: 'object',
      properties: {
        direction: { type: 'string', description: 'Compass direction: N/S/E/W/NE/NW/SE/SW or north/south/east/west and their diagonal forms.' },
        distance: { type: 'number', description: 'How far to scout in blocks (default 40, max 80)' }
      },
      required: ['direction']
    },
    handler: async (args) => {
      try {
        if (!bot.entity?.position) return { success: false, error: 'The bot has not spawned yet.' };
        if (!bot.pathfinder) return { success: false, error: 'Pathfinder is not initialized.' };

        const code = normalizeDirection(args.direction);
        const vec = DIRECTION_VECTORS[code];
        if (!vec) return { success: false, error: `Unknown direction: ${args.direction}. Use N/S/E/W/NE/NW/SE/SW or full English direction names.` };

        const distance = Math.min(80, Math.max(10, args.distance || 40));
        const start = bot.entity.position;
        const targetX = Math.floor(start.x + vec.dx * distance);
        const targetZ = Math.floor(start.z + vec.dz * distance);
        const dirEn = spatialIntelligence.compassFromVector(vec.dx, vec.dz).en;

        // Check before we even move — village might already be in range.
        const preScan = structureDetector.detectVillage(bot, 64);
        if (preScan && preScan.distance <= 48) {
          saveVillageIfNew(preScan);
          return { success: true, data: `No need to go far — ${structureDetector.describeVillage(preScan)}`, detection: preScan };
        }

        // GoalNearXZ walks toward the XZ target without demanding an exact Y.
        const Goal = goals.GoalNearXZ || goals.GoalXZ;
        const goal = goals.GoalNearXZ ? new goals.GoalNearXZ(targetX, targetZ, 4) : new goals.GoalXZ(targetX, targetZ);
        bot.pathfinder.setGoal(goal);

        // Poll while walking: stop early if we spot a village.
        const deadlineMs = Math.min(25000, distance * 500);
        const startTime = Date.now();
        let found = null;
        while (Date.now() - startTime < deadlineMs) {
          await new Promise(r => setTimeout(r, 1500));
          found = structureDetector.detectVillage(bot, 64);
          if (found) break;
          // Arrived at target?
          const p = bot.entity?.position;
          if (p && Math.hypot(p.x - targetX, p.z - targetZ) <= 5) break;
          if (!bot.pathfinder.isMoving?.() && !bot.pathfinder.goal) break;
        }
        try { bot.pathfinder.setGoal(null); } catch (_) {}

        if (found) {
          saveVillageIfNew(found);
          return { success: true, data: `Went ${dirEn}: ${structureDetector.describeVillage(found)}`, detection: found };
        }

        const now = bot.entity?.position;
        const posStr = now ? `[${Math.round(now.x)}, ${Math.round(now.y)}, ${Math.round(now.z)}]` : 'unknown';
        return { success: true, data: `Went ${dirEn} (current position: ${posStr}) but did not spot a village. It may be farther away or in another direction.` };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }
  });

  function saveVillageIfNew(detection) {
    if (!detection || !memoryManager?.pois?.addPOI || alreadyKnown(detection.center)) return false;
    try {
      memoryManager.pois.addPOI(
        `Village (${detection.direction.en})`,
        POITypes.VILLAGE,
        detection.center,
        `Found while scouting: about ${detection.villagerCount} villagers, confidence ${detection.confidence}`,
      );
      return true;
    } catch (err) {
      logger.debug(`Could not save village found while scouting: ${err.message}`);
      return false;
    }
  }
}
