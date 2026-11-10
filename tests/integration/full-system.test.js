import { describe, it, expect, beforeEach } from 'vitest';
import { createMockBot } from '../mocks/mock-bot.js';
import { MockAIProvider } from '../mocks/mock-ai.js';
import { ToolRegistry } from '../../src/brain/tool-registry.js';
import { ContextManager } from '../../src/brain/context-manager.js';
import { AIBrain } from '../../src/brain/ai-brain.js';
import { WorldState } from '../../src/perception/world-state.js';
import { MemoryManager, POITypes } from '../../src/memory/memory-manager.js';
import { Planner } from '../../src/planning/planner.js';
import { registerAllTools } from '../../src/tools/index.js';

describe('Full Companion System Scenarios', () => {
  let mockBot;
  let provider;
  let registry;
  let worldState;
  let memoryManager;
  let planner;
  let aiBrain;

  beforeEach(() => {
    mockBot = createMockBot();
    provider = new MockAIProvider();
    registry = new ToolRegistry();
    worldState = new WorldState();
    memoryManager = new MemoryManager(':memory:');
    const contextManager = new ContextManager({
      bot: { owner: 'kustash01', language: 'ru' },
      minecraft: { username: 'GeminiBot' },
      ai: { rateLimit: { maxRequests: 1000, windowMs: 1000 } },
    });

    aiBrain = new AIBrain(
      {
        bot: { owner: 'kustash01', language: 'ru' },
        minecraft: { username: 'GeminiBot' },
        ai: { rateLimit: { maxRequests: 1000, windowMs: 1000 } },
      },
      registry,
      contextManager,
      provider,
      memoryManager
    );

    planner = new Planner(memoryManager, registry, aiBrain);

    registerAllTools(registry, {
      bot: mockBot,
      worldState,
      mcBot: { bot: mockBot, isConnected: () => true },
      memoryManager,
      planner,
    });

    worldState.forceUpdate(mockBot);
  });

  it('Scenario 1: "follow me" -> calls follow_player', async () => {
    provider.addResponse({
      text: '',
      toolCalls: [{ name: 'follow_player', args: { playerName: 'kustash01', distance: 3 } }],
      raw: {},
    });
    provider.addResponse({
      text: 'I am following you, keeping a 3-block distance!',
      toolCalls: [],
      raw: {},
    });

    const reply = await aiBrain.processMessage('Follow me', worldState);
    expect(reply).toContain('I am following you');
  });

  it('Scenario 2: "build a house" -> decomposes into plan with create_plan', async () => {
    provider.addResponse({
      text: '',
      toolCalls: [
        {
          name: 'create_plan',
          args: {
            goal: 'Build a house for us',
            steps: [
              'Clear a 6x6 area',
              'Gather 32 oak logs',
              'Build the walls from planks',
              'Add a roof and a door',
            ],
          },
        },
      ],
      raw: {},
    });
    provider.addResponse({
      text: 'I made a great building plan! Starting with the first step.',
      toolCalls: [],
      raw: {},
    });

    const reply = await aiBrain.processMessage('Let us build a proper house', worldState);
    expect(reply).toContain('plan');

    const activePlan = planner.getActivePlan();
    expect(activePlan).toBeDefined();
    expect(activePlan.goal).toBe('Build a house for us');
    expect(activePlan.steps).toHaveLength(4);
  });

  it('Scenario 3: "where is the base?" -> calls find_poi to recall base coordinates', async () => {
    // Preset base in memory
    memoryManager.pois.addPOI('Our base', POITypes.BASE, { x: 50, y: 70, z: -120 }, 'Main chest');

    provider.addResponse({
      text: '',
      toolCalls: [{ name: 'find_poi', args: { name: 'base' } }],
      raw: {},
    });
    provider.addResponse({
      text: 'Our base is located at coordinates X: 50, Y: 70, Z: -120.',
      toolCalls: [],
      raw: {},
    });

    const reply = await aiBrain.processMessage('Where is our base located?', worldState);
    expect(reply).toContain('50');
    expect(reply).toContain('-120');
  });

  it('Scenario 4: "what did we do yesterday?" -> reads diary / episodic memory', async () => {
    memoryManager.diary.logEntry(4, 'Mining trip', 'We found 8 diamonds and built a Nether portal.');

    provider.addResponse({
      text: '',
      toolCalls: [{ name: 'read_diary', args: { limit: 3 } }],
      raw: {},
    });
    provider.addResponse({
      text: 'Yesterday we went mining, found 8 diamonds, and built a Nether portal!',
      toolCalls: [],
      raw: {},
    });

    const reply = await aiBrain.processMessage('What did we do yesterday?', worldState);
    expect(reply).toContain('diamonds');
  });

  it('Scenario 5: "save this place as a mine" -> saves POI to SQLite', async () => {
    provider.addResponse({
      text: '',
      toolCalls: [{ name: 'save_poi', args: { name: 'Deep Mine', type: 'mine', notes: 'Lots of iron' } }],
      raw: {},
    });
    provider.addResponse({
      text: 'Saved this place as "Deep Mine" at the current coordinates!',
      toolCalls: [],
      raw: {},
    });

    const reply = await aiBrain.processMessage('Save this place as a mine', worldState);
    expect(reply).toContain('Saved');

    const pois = memoryManager.pois.getPOIs(POITypes.MINE);
    expect(pois).toHaveLength(1);
    expect(pois[0].name).toBe('Deep Mine');
    expect(pois[0].x).toBe(100);
  });
});
