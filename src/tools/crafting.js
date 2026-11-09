import minecraftData from 'minecraft-data';

export function registerCraftingTools(registry, { bot }) {
  registry.register({
    name: 'craft_item',
    description: 'Crafts an item if the recipe is known and materials are available.',
    parameters: {
      type: 'object',
      properties: {
        itemName: { type: 'string' },
        count: { type: 'number', default: 1 }
      },
      required: ['itemName']
    },
    handler: async (args) => {
      try {
        const mcData = minecraftData(bot.version || '1.20.1');
        const itemType = mcData.itemsByName[args.itemName];
        if (!itemType) return { success: false, error: `Unknown item: ${args.itemName}` };

        let craftingTable = null;
        if (mcData.blocksByName?.crafting_table) {
          craftingTable = bot.findBlock({
            matching: mcData.blocksByName.crafting_table.id,
            maxDistance: 4,
          });
        }

        let recipe = bot.recipesFor(itemType.id, null, args.count || 1, null)[0];
        let placedTable = false;
        let tablePos = null;

        // If the recipe is not available in the 2×2 grid, check for a crafting table.
        if (!recipe) {
          if (!craftingTable) {
            // Check whether a crafting table is available in the inventory for temporary placement.
            const tableItem = bot.inventory?.items()?.find(i => i.name === 'crafting_table');
            if (tableItem && typeof bot.placeBlock === 'function' && bot.entity?.position) {
              const placeBase = bot.blockAt(bot.entity.position.offset(1, -1, 0)) || bot.blockAt(bot.entity.position.offset(0, -1, 1));
              if (placeBase && placeBase.name !== 'air') {
                try {
                  const vec3 = (await import('vec3')).default;
                  await bot.equip(tableItem, 'hand');
                  await bot.placeBlock(placeBase, vec3(0, 1, 0));
                  tablePos = placeBase.position.offset(0, 1, 0);
                  craftingTable = bot.blockAt(tablePos);
                  placedTable = true;
                } catch (_) {}
              }
            }
          }

          if (craftingTable) {
            recipe = bot.recipesFor(itemType.id, null, args.count || 1, craftingTable)[0];
          }
        }

        if (!recipe) {
          if (placedTable && tablePos) {
            try { await bot.dig(bot.blockAt(tablePos)); } catch (_) {}
          }
          return {
            success: false,
            error: `No known recipe for ${args.itemName} or missing materials${!craftingTable ? ' (and no crafting table available)' : ''}.`
          };
        }

        await bot.craft(recipe, args.count || 1, recipe.requiresTable ? craftingTable : null);

        // If we placed the crafting table, pick it back up.
        if (placedTable && tablePos) {
          try {
            const placedBlock = bot.blockAt(tablePos);
            if (placedBlock && placedBlock.name === 'crafting_table' && typeof bot.dig === 'function') {
              await bot.dig(placedBlock);
            }
          } catch (_) {}
        }

        return { success: true, data: `Crafted ${args.count || 1} ${args.itemName}` };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }
  });

  registry.register({
    name: 'list_craftable',
    description: 'Lists what can be crafted with the current inventory.',
    parameters: { type: 'object', properties: {} },
    handler: async () => {
      try {
        const mcData = minecraftData(bot.version || '1.20.1');
        let craftingTable = null;
        if (mcData?.blocksByName?.crafting_table) {
          craftingTable = bot.findBlock({
            matching: mcData.blocksByName.crafting_table.id,
            maxDistance: 4
          });
        }

        const invItems = bot.inventory?.items() || [];
        if (invItems.length === 0) {
          return { success: true, data: 'The inventory is empty; there is nothing to craft with.' };
        }

        const craftable = [];
        const seen = new Set();
        if (typeof bot.recipesFor === 'function' && mcData.items) {
          for (const item of Object.values(mcData.items)) {
            try {
              const recipes = bot.recipesFor(item.id, null, 1, craftingTable);
              if (recipes && recipes.length > 0 && !seen.has(item.name)) {
                seen.add(item.name);
                craftable.push(item.name);
                if (craftable.length >= 35) break;
              }
            } catch (_) {}
          }
        }

        if (craftable.length === 0) {
          return {
            success: true,
            data: 'Nothing can be crafted with the current materials' + (craftingTable ? ' (crafting table nearby).' : ' (no crafting table nearby).')
          };
        }

        return {
          success: true,
          data: `Available to craft (${craftable.length}): ${craftable.join(', ')}`
        };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }
  });
}
