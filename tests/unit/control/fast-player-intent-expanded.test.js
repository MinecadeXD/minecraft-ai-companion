import { describe, it, expect } from 'vitest';
import { FastPlayerIntentRouter, PlayerIntents } from '../../../src/control/fast-player-intent.js';
import { messageBus } from '../../../src/events/message-bus.js';

describe('FastPlayerIntentRouter Expanded Vocabulary Tests', () => {
  it('routes English agent names to the matching companion', () => {
    expect(messageBus.checkAddressing('Sam, follow me', 'Sam', ['Sam', 'Max']).isAddressedToMe).toBe(true);
    expect(messageBus.checkAddressing('Sam, follow me', 'Max', ['Sam', 'Max']).targetName).toBe('Sam');
    expect(messageBus.checkAddressing('Max, stop', 'Max', ['Sam', 'Max']).isAddressedToMe).toBe(true);
  });

  it('understands ordinary English group phrasing without a bot name', () => {
    expect(FastPlayerIntentRouter.classifyIntent('keep up')).toBe(PlayerIntents.FOLLOW);
    expect(FastPlayerIntentRouter.classifyIntent('gather here')).toBe(PlayerIntents.COME_HERE);
    expect(FastPlayerIntentRouter.classifyIntent('help me')).toBe(PlayerIntents.HELP);
    expect(FastPlayerIntentRouter.classifyIntent('stand still')).toBe(PlayerIntents.STOP);
    expect(FastPlayerIntentRouter.classifyIntent('where are we going?')).toBe(PlayerIntents.NONE);
  });

  it('correctly classifies English STOP synonyms', () => {
    expect(FastPlayerIntentRouter.classifyIntent('Sam, stop')).toBe(PlayerIntents.STOP);
    expect(FastPlayerIntentRouter.classifyIntent('halt!')).toBe(PlayerIntents.STOP);
    expect(FastPlayerIntentRouter.classifyIntent('guys, stop')).toBe(PlayerIntents.STOP);
    expect(FastPlayerIntentRouter.classifyIntent('freeze here')).toBe(PlayerIntents.STOP);
    expect(FastPlayerIntentRouter.classifyIntent('guys, stay still')).toBe(PlayerIntents.STOP);
    expect(FastPlayerIntentRouter.classifyIntent("that's enough, stop following me")).toBe(PlayerIntents.STOP);
    expect(FastPlayerIntentRouter.classifyIntent("don't move")).toBe(PlayerIntents.STOP);
    expect(FastPlayerIntentRouter.classifyIntent('cancel')).toBe(PlayerIntents.STOP);
  });

  it('correctly classifies English WAIT synonyms', () => {
    expect(FastPlayerIntentRouter.classifyIntent('Sam, wait')).toBe(PlayerIntents.WAIT);
    expect(FastPlayerIntentRouter.classifyIntent('hold on a second')).toBe(PlayerIntents.WAIT);
    expect(FastPlayerIntentRouter.classifyIntent('pause here')).toBe(PlayerIntents.WAIT);
    expect(FastPlayerIntentRouter.classifyIntent('wait for me')).toBe(PlayerIntents.WAIT);
    expect(FastPlayerIntentRouter.classifyIntent('wait a minute')).toBe(PlayerIntents.WAIT);
  });

  it('correctly classifies English COME_HERE synonyms', () => {
    expect(FastPlayerIntentRouter.classifyIntent('Sam, come here')).toBe(PlayerIntents.COME_HERE);
    expect(FastPlayerIntentRouter.classifyIntent('get over here!')).toBe(PlayerIntents.COME_HERE);
    expect(FastPlayerIntentRouter.classifyIntent('come to me')).toBe(PlayerIntents.COME_HERE);
    expect(FastPlayerIntentRouter.classifyIntent('guys, stay close')).toBe(PlayerIntents.COME_HERE);
    expect(FastPlayerIntentRouter.classifyIntent('approach me')).toBe(PlayerIntents.COME_HERE);
  });

  it('correctly classifies English FOLLOW synonyms', () => {
    expect(FastPlayerIntentRouter.classifyIntent("Sam, let's go")).toBe(PlayerIntents.FOLLOW);
    expect(FastPlayerIntentRouter.classifyIntent('guys, come with me')).toBe(PlayerIntents.FOLLOW);
    expect(FastPlayerIntentRouter.classifyIntent('move forward')).toBe(PlayerIntents.FOLLOW);
    expect(FastPlayerIntentRouter.classifyIntent('continue following')).toBe(PlayerIntents.FOLLOW);
    expect(FastPlayerIntentRouter.classifyIntent('come with me')).toBe(PlayerIntents.FOLLOW);
    expect(FastPlayerIntentRouter.classifyIntent('follow me')).toBe(PlayerIntents.FOLLOW);
  });

  it('correctly classifies English HELP synonyms', () => {
    expect(FastPlayerIntentRouter.classifyIntent('guys, help!')).toBe(PlayerIntents.HELP);
    expect(FastPlayerIntentRouter.classifyIntent('help, there is a creeper!')).toBe(PlayerIntents.HELP);
    expect(FastPlayerIntentRouter.classifyIntent('need help urgently')).toBe(PlayerIntents.HELP);
    expect(FastPlayerIntentRouter.classifyIntent('help me, low health')).toBe(PlayerIntents.HELP);
  });

  it('returns NONE for normal conversation', () => {
    expect(FastPlayerIntentRouter.classifyIntent('what should we craft next?')).toBe(PlayerIntents.NONE);
    expect(FastPlayerIntentRouter.classifyIntent('where do you think the diamonds are?')).toBe(PlayerIntents.NONE);
    expect(FastPlayerIntentRouter.classifyIntent('beautiful sunset')).toBe(PlayerIntents.NONE);
  });
});
