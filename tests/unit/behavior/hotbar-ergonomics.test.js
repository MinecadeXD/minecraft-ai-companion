import { describe, it, expect, beforeEach } from 'vitest';
import { HotbarErgonomics } from '../../../src/behavior/hotbar-ergonomics.js';
import { AdrenalineController } from '../../../src/behavior/adrenaline-controller.js';

describe('HotbarErgonomics — hotbar ergonomics, number-key slips, and durability', () => {
  let bot;
  let adrenaline;
  let hotbar;

  beforeEach(() => {
    bot = {
      health: 20,
      food: 20,
      inventory: {
        items: () => []
      }
    };
    adrenaline = new AdrenalineController();
    hotbar = new HotbarErgonomics(bot, adrenaline);
  });

  it('contains an experienced player's semantic hotbar layout', () => {
    expect(hotbar.semanticSlots.sword).toBe(0);
    expect(hotbar.semanticSlots.pickaxe).toBe(1);
    expect(hotbar.semanticSlots.food).toBe(7);
    expect(hotbar.semanticSlots.water_bucket).toBe(8);
  });

  it('evaluates slot switching and returns a valid slot in the 0–8 range', () => {
    const res = hotbar.evaluateSlotSwitch(1); // pickaxe (key 2)
    expect(res.slotToEquip).toBeGreaterThanOrEqual(0);
    expect(res.slotToEquip).toBeLessThanOrEqual(8);
    expect(res.intendedSlot).toBe(1);
    if (res.hadKeySlip) {
      expect(res.realizationDelayMs).toBeGreaterThan(50);
    }
  });

  it('protects a tool with critically low durability (durability awareness)', () => {
    const freshPickaxe = { name: 'diamond_pickaxe', maxDurability: 1561, durabilityUsed: 100 };
    const safeRes = hotbar.evaluateDurabilitySafety(freshPickaxe);
    expect(safeRes.safe).toBe(true);
    expect(safeRes.shouldPreserve).toBe(false);

    const dyingPickaxe = { name: 'diamond_pickaxe', maxDurability: 1561, durabilityUsed: 1520 }; // ~2.6%
    const criticalRes = hotbar.evaluateDurabilitySafety(dyingPickaxe);
    expect(criticalRes.safe).toBe(false);
    expect(criticalRes.ratio).toBeLessThan(0.15);
    expect(typeof criticalRes.shouldPreserve).toBe('boolean');
  });

  it('calculates human-like click intervals when moving items in a chest', () => {
    const delay1 = hotbar.evaluateItemTransferDelay(1);
    const delay7 = hotbar.evaluateItemTransferDelay(7); // short micro-pause

    expect(delay1).toBeGreaterThanOrEqual(30);
    expect(delay7).toBeGreaterThan(delay1);
  });
});
