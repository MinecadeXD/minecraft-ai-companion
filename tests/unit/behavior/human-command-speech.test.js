import { describe, it, expect, vi } from 'vitest';
import { AdvancedNaturalSpeech } from '../../../src/behavior/human-like/advanced-natural-speech.js';
import { EventHandler } from '../../../src/bot/event-handler.js';
import { PlayerIntents } from '../../../src/control/fast-player-intent.js';

describe('Mature Zero-Template Speech & Command Handling', () => {
  it('AdvancedNaturalSpeech formats player_command situation correctly', () => {
    const speech = new AdvancedNaturalSpeech({
      provider: { generateText: vi.fn() },
      agentName: 'GeminiBot',
    });

    const situationDesc = speech._describeSituation('player_command', {
      speaker: 'kustash01',
      message: 'stop here creeper',
      intent: 'STOP',
      commandAction: 'stop',
    });

    expect(situationDesc).toContain('kustash01 gave a command');
    expect(situationDesc).toContain('stop here creeper');
    expect(situationDesc).toContain('you are standing still');
  });

  it('AdvancedNaturalSpeech post-processes responses: strips brackets and trailing dots for short replies', () => {
    const speech = new AdvancedNaturalSpeech({
      provider: { generateText: vi.fn() },
      agentName: 'GeminiBot',
    });

    const processedWithBrackets = speech._processResponse('I am stopping))', { mentalFatigue: 0 });
    expect(processedWithBrackets).toBe('I am stopping');

    const processedWithDot = speech._processResponse('coming right over.', { mentalFatigue: 0 });
    expect(processedWithDot).toBe('coming right over');
  });

  it('AdvancedNaturalSpeech _getNaturalFallback never contains bracket smiles and responds contextually', () => {
    const speech = new AdvancedNaturalSpeech({
      provider: { generateText: vi.fn() },
      agentName: 'GeminiBot',
    });

    // Test multiple iterations to cover random choices
    for (let i = 0; i < 20; i++) {
      const stopFallback = speech._getNaturalFallback({ message: 'stop!', intent: 'STOP' });
      expect(stopFallback).not.toContain(')');
      expect(stopFallback).not.toContain('(');

      const waitFallback = speech._getNaturalFallback({ message: 'wait a second', intent: 'WAIT' });
      expect(waitFallback).not.toContain(')');

      const followFallback = speech._getNaturalFallback({ message: 'follow me', intent: 'FOLLOW' });
      expect(followFallback).not.toContain(')');

      const greetingFallback = speech._getNaturalFallback({ message: 'hello' });
      expect(greetingFallback).not.toContain(')');
      expect(greetingFallback).not.toContain('hello there');
    }
  });

  it('EventHandler routes player commands through humanController.generateResponse without ackVariations', async () => {
    const mockBot = {
      username: 'GeminiBot',
      players: {
        kustash01: {
          entity: { position: { x: 10, y: 64, z: 20, offset: () => ({ x: 10, y: 65.6, z: 20 }) } },
        },
      },
      entity: { position: { x: 10, y: 64, z: 20 } },
      chat: vi.fn(),
      lookAt: vi.fn().mockResolvedValue(undefined),
    };

    const mockHumanController = {
      generateResponse: vi.fn().mockResolvedValue('I am stopping'),
      processEvent: vi.fn(),
    };

    const mockBodyLanguage = {
      nodHead: vi.fn(),
    };

    const mockMovementController = {
      stop: vi.fn(),
    };

    const config = {
      bot: { owner: 'kustash01' },
      minecraft: { username: 'GeminiBot' },
      ai: { provider: 'ollama' },
    };

    let chatCallback = null;
    const mockMcBot = {
      bot: mockBot,
      on: vi.fn((event, cb) => {
        if (event === 'chat') chatCallback = cb;
      }),
    };

    const eventHandler = new EventHandler(
      mockMcBot,
      null,
      null,
      config,
      {
        humanController: mockHumanController,
        movementController: mockMovementController,
        bodyLanguage: mockBodyLanguage,
      }
    );

    eventHandler.botUsername = 'GeminiBot';
    eventHandler.setup();

    // Call chat handler via registered event
    expect(chatCallback).toBeTypeOf('function');
    await chatCallback('kustash01', 'stop');

    // Verify local stop was executed
    expect(mockMovementController.stop).toHaveBeenCalled();

    // Verify body language was triggered
    expect(mockBodyLanguage.nodHead).toHaveBeenCalled();

    // Verify humanController generated response
    expect(mockHumanController.generateResponse).toHaveBeenCalledWith(
      'player_command',
      expect.objectContaining({
        speaker: 'kustash01',
        message: 'stop',
        intent: PlayerIntents.STOP,
        isOwner: true,
      })
    );

    // Verify bot spoke the generated response
    expect(mockBot.chat).toHaveBeenCalledWith('I am stopping');
  });
});
