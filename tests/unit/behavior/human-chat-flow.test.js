import { describe, it, expect, vi } from 'vitest';
import { HumanChatFlow } from '../../../src/behavior/human-chat-flow.js';

describe('HumanChatFlow — human typing and typo simulation', () => {
  it('generates typos using adjacent keyboard keys', () => {
    const word = 'mine';
    const res = HumanChatFlow.injectTypo(word);
    if (res.hasTypo) {
      expect(res.typoWord).not.toBe(word);
      expect(res.typoWord.length).toBe(word.length);
      expect(res.originalWord).toBe(word);
    }
  });

  it('leaves most typos uncorrected (~65%) and only occasionally sends a correction', () => {
    let correctionsCount = 0;
    const trials = 300;

    for (let i = 0; i < trials; i++) {
      const { correction } = HumanChatFlow.prepareMessages('let us hurry and mine diamonds in the cave', {
        health: 5,
        food: 5,
      });
      if (correction) correctionsCount++;
    }

    // The proportion of corrected messages should remain moderate (not every word)
    expect(correctionsCount).toBeLessThan(trials * 0.5);
  });

  it('simulates physical typing: stops running and sends the message', async () => {
    const mockBot = {
      setControlState: vi.fn(),
      chat: vi.fn(),
    };
    const sent = [];

    await HumanChatFlow.typeAndSend(mockBot, 'hello', (msg) => sent.push(msg));

    expect(mockBot.setControlState).toHaveBeenCalledWith('forward', false);
    expect(mockBot.setControlState).toHaveBeenCalledWith('sprint', false);
    expect(sent.length).toBeGreaterThanOrEqual(1);
    expect(sent[0]).toContain('hell');
  });
});
