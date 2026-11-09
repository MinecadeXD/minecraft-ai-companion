import minecraftData from 'minecraft-data';
import { sceneObserver } from '../perception/scene-observer.js';
import { spatialIntelligence } from '../world/spatial-intelligence.js';
import { frameCapture } from '../perception/frame-capture.js';

export function registerWorldTools(registry, { bot, worldState, aiProvider }) {
  registry.register({
    name: 'get_position',
    description: 'Returns the current coordinates of the bot.',
    parameters: { type: 'object', properties: {} },
    handler: async () => {
      if (!bot.entity) return { success: false, error: 'Bot not spawned' };
      const pos = bot.entity.position;
      return { success: true, data: { x: pos.x, y: pos.y, z: pos.z } };
    }
  });

  registry.register({
    name: 'get_world_state',
    description: 'Returns a summary of the current world state including health, hunger, time, and position.',
    parameters: { type: 'object', properties: {} },
    handler: async () => {
      return { success: true, data: worldState.getSummary() };
    }
  });

  registry.register({
    name: 'find_block',
    description: 'Finds the coordinates of a specific block type nearby.',
    parameters: {
      type: 'object',
      properties: {
        blockName: { type: 'string' },
        maxDistance: { type: 'number', default: 64 },
        count: { type: 'number', default: 1 }
      },
      required: ['blockName']
    },
    handler: async (args) => {
      try {
        const mcData = minecraftData(bot.version);
        const blockType = mcData.blocksByName[args.blockName];
        if (!blockType) return { success: false, error: `Unknown block: ${args.blockName}` };

        const blocks = bot.findBlocks({
          matching: blockType.id,
          maxDistance: args.maxDistance || 64,
          count: args.count || 1
        });

        if (blocks.length === 0) return { success: true, data: 'No blocks found.' };
        return { success: true, data: blocks };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }
  });

  registry.register({
    name: 'find_entity',
    description: 'Finds nearby entities matching a name.',
    parameters: {
      type: 'object',
      properties: {
        entityName: { type: 'string' },
        maxDistance: { type: 'number', default: 32 }
      },
      required: ['entityName']
    },
    handler: async (args) => {
      try {
        const maxDist = args.maxDistance || 32;
        const search = String(args.entityName || '').toLowerCase().trim();
        const entities = [];
        for (const id in bot.entities) {
          const e = bot.entities[id];
          if (!e || !e.position || e === bot.entity) continue;
          const match = (e.name && e.name.toLowerCase() === search) ||
                        (e.username && e.username.toLowerCase() === search) ||
                        (e.displayName && e.displayName.toLowerCase() === search);
          if (match && bot.entity?.position && bot.entity.position.distanceTo(e.position) <= maxDist) {
            entities.push({ id: e.id, name: e.username || e.name, type: e.type, position: e.position });
          }
        }
        return { success: true, data: entities };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }
  });

  registry.register({
    name: 'get_time',
    description: 'Returns the current Minecraft time of day.',
    parameters: { type: 'object', properties: {} },
    handler: async () => {
      try {
        return {
          success: true,
          data: {
            timeOfDay: bot.time?.timeOfDay ?? 0,
            isDay: bot.time?.isDay ?? true,
          }
        };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }
  });

  // Look around: describe visible details, terrain, compass directions, and nearby objects.
  registry.register({
    name: 'look_around',
    description: 'Look around and describe everything the bot perceives right now: what is happening to it (taking damage, on fire, drowning, falling, low HP), facing direction, biome, terrain in each compass direction, the block it is aiming at, nearby ores, hazards (lava/fire), useful stations (crafting table, furnace, chest, bed, anvil...), and nearby entities with side and distance. Use to understand the full situation before acting.',
    parameters: { type: 'object', properties: {} },
    handler: async () => {
      try {
        if (!bot.entity) return { success: false, error: 'The bot has not spawned yet.' };
        const scene = sceneObserver.observe(bot);
        if (!scene) return { success: false, error: 'Could not observe the surroundings.' };
        return { success: true, data: sceneObserver.describe(scene), scene };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }
  });

  // Describe what is in a specific compass direction.
  registry.register({
    name: 'describe_direction',
    description: 'Describe what is in a specific compass direction (north/south/east/west/etc). Answers questions like "what is to the north" or "is there a mountain that way".',
    parameters: {
      type: 'object',
      properties: {
        direction: { type: 'string', description: 'Compass direction: N, S, E, W, NE, NW, SE, SW, or the full English direction names.' }
      },
      required: ['direction']
    },
    handler: async (args) => {
      try {
        if (!bot.entity) return { success: false, error: 'The bot has not spawned yet.' };
        const scene = sceneObserver.observe(bot);
        if (!scene) return { success: false, error: 'Could not observe the surroundings.' };

        const raw = String(args.direction || '').toLowerCase().trim();
        const alias = {
          n: 'N', north: 'N', s: 'S', south: 'S', e: 'E', east: 'E', w: 'W', west: 'W',
          ne: 'NE', northeast: 'NE', nw: 'NW', northwest: 'NW',
          se: 'SE', southeast: 'SE', sw: 'SW', southwest: 'SW',
        };
        const code = alias[raw] || raw.toUpperCase();
        const dir = scene.horizon.find(h => h.code === code);
        if (!dir) return { success: false, error: `Unknown direction: ${args.direction}. Use N/S/E/W/NE/NW/SE/SW or full English direction names.` };

        return {
          success: true,
          data: `To the ${dir.en}: ${dir.features.join(', ')}${dir.rise >= 5 ? ` (about ${dir.rise} blocks uphill)` : ''}${dir.drop <= -8 ? ` (about ${Math.abs(dir.drop)} blocks downhill)` : ''}.`,
          direction: dir,
        };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }
  });

  // Direction and distance to a target point or coordinates.
  registry.register({
    name: 'bearing_to',
    description: 'Given target coordinates, tells the compass direction, distance, and whether it is ahead/left/right/behind the bot right now. Use to orient toward a known location (e.g. a village a player mentioned).',
    parameters: {
      type: 'object',
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        z: { type: 'number' }
      },
      required: ['x', 'z']
    },
    handler: async (args) => {
      try {
        if (!bot.entity?.position) return { success: false, error: 'The bot has not spawned yet.' };
        const p = bot.entity.position;
        const botPos = { x: p.x, y: p.y, z: p.z };
        const target = { x: args.x, y: args.y ?? p.y, z: args.z };
        const phrase = spatialIntelligence.describeTarget(botPos, bot.entity.yaw || 0, target, 'target');
        return { success: true, data: phrase };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }
  });

  // Inspect carefully: capture a real screenshot and analyse it with a multimodal model.
  // This is an expensive tool; use it only when symbolic vision is insufficient (for example, "look closely" or "what is that in the distance?").
  registry.register({
    name: 'capture_screenshot',
    description: 'Take a real screenshot of what the bot sees and analyse it with vision AI for a detailed answer (distant structures, subtle details). Heavier than look_around — use only when the symbolic scene is not enough. Falls back to a symbolic description if screenshot rendering is unavailable on this machine.',
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'What to look for (e.g. "is there a village in the distance?", "what is that structure?")' }
      }
    },
    handler: async (args) => {
      try {
        if (!bot.entity) return { success: false, error: 'The bot has not spawned yet.' };
        const question = args.question || 'What is visible in the image: terrain, structures, villages, mobs, and anything notable in the distance?';

        const available = await frameCapture.isAvailable();
        if (!available) {
          // Graceful fallback: use symbolic scene instead of crashing.
          const scene = sceneObserver.observe(bot);
          const symbolic = scene ? sceneObserver.describe(scene) : 'view unavailable';
          return {
            success: true,
            degraded: true,
            data: `A real screenshot is unavailable on this server (the canvas/node-canvas-webgl module is required). Here is a description based on symbolic vision: ${symbolic}`,
          };
        }

        const png = await frameCapture.capture(bot);
        if (!png) {
          const scene = sceneObserver.observe(bot);
          const symbolic = scene ? sceneObserver.describe(scene) : 'view unavailable';
          return { success: true, degraded: true, data: `Could not render the frame. Symbolic vision reports: ${symbolic}` };
        }

        if (!aiProvider || typeof aiProvider.describeImage !== 'function') {
          return { success: true, degraded: true, data: 'The screenshot was captured, but no vision model is connected to analyse it.' };
        }

        const description = await aiProvider.describeImage(png, question, { maxTokens: 300 });
        return { success: true, data: description || 'Could not analyse the frame.' };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }
  });
}
