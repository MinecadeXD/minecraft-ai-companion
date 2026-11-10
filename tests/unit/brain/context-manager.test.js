import { describe, it, expect, beforeEach } from 'vitest';
import { ContextManager } from '../../../src/brain/context-manager.js';

// Minimal config for test
const testConfig = {
  bot: { owner: 'kustash01', language: 'ru' },
  minecraft: { username: 'GeminiBot' },
};

// Mock WorldState
const mockWorldState = {
  position: { x: 100, y: 64, z: 200 },
  health: 18,
  food: 15,
  timeOfDay: 6000,
  isRaining: false,
  nearbyEntities: [
    { name: 'kustash01', type: 'player', distance: 5 },
    { name: 'zombie', type: 'mob', distance: 12 },
  ],
  inventory: [
    { name: 'diamond_pickaxe', count: 1 },
    { name: 'cobblestone', count: 64 },
  ],
  getSummary() {
    return 'Position: [100, 64, 200]. Health: 18/20, Food: 15/20. Time: Morning, Weather: Clear. Inventory: 1x diamond_pickaxe, 64x cobblestone. Nearby: kustash01, zombie';
  },
  getInventorySummary() {
    return '1x diamond_pickaxe, 64x cobblestone';
  },
};

describe('ContextManager', () => {
  let manager;

  beforeEach(() => {
    manager = new ContextManager(testConfig);
  });

  it('should build context with world state', () => {
    const context = manager.buildContext(mockWorldState, null, []);
    expect(context).toContain('WORLD STATE');
    expect(context).toContain('100');
    expect(context).toContain('18/20');
  });

  it('should include current task when provided', () => {
    const context = manager.buildContext(mockWorldState, 'Gather iron', []);
    expect(context).toContain('CURRENT TASK');
    expect(context).toContain('Gather iron');
  });

  it('should handle null world state', () => {
    const context = manager.buildContext(null, null, []);
    expect(context).toContain('WORLD STATE');
  });

  it('should add and retrieve history', () => {
    manager.addToHistory('user', 'Hello!');
    manager.addToHistory('bot', 'Hello, kustash01!');
    expect(manager.recentHistory).toHaveLength(2);
  });

  it('should limit history size', () => {
    for (let i = 0; i < 30; i++) {
      manager.addToHistory('user', `Message ${i}`);
    }
    expect(manager.recentHistory.length).toBeLessThanOrEqual(20);
  });

  it('should include history in context', () => {
    manager.addToHistory('user', 'Find iron');
    manager.addToHistory('bot', 'Looking for iron ore nearby');
    const context = manager.buildContext(mockWorldState, null, []);
    expect(context).toContain('RECENT HISTORY');
    expect(context).toContain('iron');
  });

  it('should clear history', () => {
    manager.addToHistory('user', 'test');
    manager.clearHistory();
    expect(manager.recentHistory).toHaveLength(0);
  });
});
