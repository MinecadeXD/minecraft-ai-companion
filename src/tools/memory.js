import { POITypes } from '../memory/poi-manager.js';

/**
 * Register memory tools for the AI.
 */
export function registerMemoryTools(registry, { memoryManager, bot, worldState }) {
  if (!memoryManager) return;

  // 1. Save a point of interest.
  registry.register({
    name: 'save_poi',
    description: 'Save a Point of Interest (base, village, cave, mine, farm, etc.) to long-term memory with coordinates.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name of the location (e.g., "Main Base", "Villager Village")' },
        type: {
          type: 'string',
          enum: Object.values(POITypes),
          description: 'Type of POI: base, village, cave, stronghold, nether_fortress, portal, mine, farm, death_location, other',
        },
        x: { type: 'number', description: 'X coordinate (optional, defaults to current position)' },
        y: { type: 'number', description: 'Y coordinate (optional, defaults to current position)' },
        z: { type: 'number', description: 'Z coordinate (optional, defaults to current position)' },
        notes: { type: 'string', description: 'Additional description or notes' },
      },
      required: ['name', 'type'],
    },
    handler: async (args) => {
      try {
        let { x, y, z } = args;
        if (x === undefined || y === undefined || z === undefined) {
          if (!bot || !bot.entity) return { success: false, error: 'The bot has not spawned, so its coordinates cannot be determined.' };
          x = bot.entity.position.x;
          y = bot.entity.position.y;
          z = bot.entity.position.z;
        }

        const poi = memoryManager.pois.addPOI(args.name, args.type, { x, y, z }, args.notes || '');
        return {
          success: true,
          data: `Saved place "${args.name}" (${args.type}) at coordinates [${Math.round(x)}, ${Math.round(y)}, ${Math.round(z)}]`,
        };
      } catch (err) {
        return { success: false, error: err.message };
      }
    },
  });

  // 2. Find a point of interest.
  registry.register({
    name: 'find_poi',
    description: 'Find a saved Point of Interest by name or type.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name of the place to search for' },
        type: { type: 'string', description: 'Type of place (base, village, cave, mine, etc.)' },
      },
    },
    handler: async (args) => {
      try {
        if (args.name) {
          const poi = memoryManager.pois.findByName(args.name);
          if (poi) {
            return {
              success: true,
              data: `Found: ${poi.name} (${poi.type}) at [${Math.round(poi.x)}, ${Math.round(poi.y)}, ${Math.round(poi.z)}] - ${poi.notes || ''}`,
            };
          }
        }

        const pois = memoryManager.pois.getPOIs(args.type || null);
        if (pois.length === 0) return { success: true, data: 'No places found.' };

        return {
          success: true,
          data: pois.map(p => `${p.name} (${p.type}): [${Math.round(p.x)}, ${Math.round(p.y)}, ${Math.round(p.z)}] ${p.notes ? '(' + p.notes + ')' : ''}`).join('\n'),
        };
      } catch (err) {
        return { success: false, error: err.message };
      }
    },
  });

  // 3. Save a fact.
  registry.register({
    name: 'save_fact',
    description: 'Save a key fact, agreement, or player preference to long-term memory.',
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Short identifier/topic for the fact' },
        value: { type: 'string', description: 'Fact description or preference' },
        category: { type: 'string', description: 'Category: preference, agreement, resource, base, general' },
      },
      required: ['key', 'value'],
    },
    handler: async (args) => {
      try {
        memoryManager.longTerm.setFact(args.key, args.value, args.category || 'general');
        return { success: true, data: `Remembered: ${args.key} = ${args.value}` };
      } catch (err) {
        return { success: false, error: err.message };
      }
    },
  });

  // 4. Write a diary entry.
  registry.register({
    name: 'write_diary',
    description: 'Write an entry in the adventure diary for a significant event or accomplishment.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Title of the diary entry' },
        content: { type: 'string', description: 'Detailed story/summary of what happened' },
        mcDay: { type: 'number', description: 'Minecraft day number (optional)' },
      },
      required: ['title', 'content'],
    },
    handler: async (args) => {
      try {
        const day = args.mcDay || (bot && bot.time ? Math.floor(bot.time.time / 24000) + 1 : 1);
        memoryManager.diary.logEntry(day, args.title, args.content);
        return { success: true, data: `Added diary entry [Day ${day}] "${args.title}".` };
      } catch (err) {
        return { success: false, error: err.message };
      }
    },
  });

  // 5. Read the diary.
  registry.register({
    name: 'read_diary',
    description: 'Read recent entries from the adventure diary to recall past adventures.',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Number of recent entries to read (default 5)' },
        day: { type: 'number', description: 'Specific Minecraft day to read' },
      },
    },
    handler: async (args) => {
      try {
        if (args.day) {
          const entries = memoryManager.diary.getEntriesByDay(args.day);
          if (entries.length === 0) return { success: true, data: `There are no entries for day ${args.day}.` };
          return { success: true, data: entries.map(e => `[Day ${e.mc_day}] ${e.title}: ${e.content}`).join('\n') };
        }

        const summary = memoryManager.diary.getFormattedSummary(args.limit || 5);
        return { success: true, data: summary };
      } catch (err) {
        return { success: false, error: err.message };
      }
    },
  });
}
