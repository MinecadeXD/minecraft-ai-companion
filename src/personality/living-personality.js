import { createLogger } from '../utils/logger.js';
import { sleep } from '../utils/helpers.js';
import { HumanErrorEngine } from '../behavior/human-error-engine.js';

const logger = createLogger('LIVING_PERSONALITY');

/**
 * LivingPersonality — the bot lives continuously instead of waiting for messages.
 * It thinks, observes, remembers, and feels — even when you are silent.
 */
export class LivingPersonality {
  constructor({
    agentName,
    bot,
    worldState,
    innerMonologue,
    emotionalMemory,
    emotionalState,
    personality,
    owner,
  }) {
    this.agentName = agentName;
    this.bot = bot;
    this.worldState = worldState;
    this.innerMonologue = innerMonologue;
    this.emotionalMemory = emotionalMemory;
    this.emotionalState = emotionalState;
    this.personality = personality;
    this.owner = owner;

    this.alive = false;
    this.lifeLoopInterval = null;
    this.lastPlayerMessageTime = Date.now();
    this.lastObservationTime = 0;
    this.lastSpontaneousMessageTime = 0;
  }

  /**
   * Start the bot's life cycle.
   */
  start() {
    if (this.alive) return;

    this.alive = true;
    logger.info(`[${this.agentName}] starts living its own life`);

    this.liveLoop();
  }

  /**
   * Stop the life cycle.
   */
  stop() {
    this.alive = false;
    if (this.lifeLoopInterval) {
      clearTimeout(this.lifeLoopInterval);
      this.lifeLoopInterval = null;
    }
    logger.info(`[${this.agentName}] stopped its life cycle`);
  }

  /**
   * Main life loop — runs continuously.
   */
  async liveLoop() {
    if (!this.alive) return;

    try {
      await this.think();
      await this.observe();
      await this.feel();
      await this.maybeSpeak();
      await this.maybeRemember();
    } catch (err) {
      logger.debug(`[${this.agentName}] life loop error: ${err.message}`);
    }

    const nextInterval = HumanErrorEngine.range(8000, 20000);
    this.lifeLoopInterval = setTimeout(() => this.liveLoop(), nextInterval);
  }

  /**
   * Think (internal monologue).
   */
  async think() {
    const silenceDuration = Date.now() - this.lastPlayerMessageTime;
    const worldSnapshot = this.worldState?.getSnapshot?.() || {};
    const emotionalSnapshot = this.emotionalState?.getState?.() || {};

    const recentEvents = this.getRecentEvents();

    await this.innerMonologue.think(
      worldSnapshot,
      emotionalSnapshot,
      silenceDuration,
      recentEvents
    );
  }

  /**
   * Observe the world (notice details).
   */
  async observe() {
    const now = Date.now();

    if (now - this.lastObservationTime < 30000) return;
    this.lastObservationTime = now;

    const world = this.worldState?.getSnapshot?.();
    if (!world) return;

    if (world.timeOfDay === 'sunset' && HumanErrorEngine.chance(0.15)) {
      this.innerMonologue.currentThoughts.push({
        text: 'Beautiful sunset',
        timestamp: now,
        emotion: 'peacefulness',
        spoken: false,
      });
    }

    const newPlayers = world.nearbyPlayers?.filter(
      p => p !== this.agentName && p !== this.owner
    );

    if (newPlayers && newPlayers.length > 0 && HumanErrorEngine.chance(0.3)) {
      this.innerMonologue.addCuriosity(`Someone new: ${newPlayers[0]}`);
    }

    if (world.health < 10 && HumanErrorEngine.chance(0.4)) {
      this.innerMonologue.addWorry('Low health');
    }
  }

  /**
   * Process emotions.
   */
  async feel() {
    if (!this.emotionalState) return;

    this.emotionalState.tickDecay?.();
  }

  /**
   * Decide whether to say something spontaneously.
   */
  async maybeSpeak() {
    const now = Date.now();

    if (now - this.lastSpontaneousMessageTime < 45000) return;

    const silenceDuration = now - this.lastPlayerMessageTime;

    if (this.innerMonologue.shouldSpeakThought()) {
      const thought = this.innerMonologue.speakRandomThought();
      if (thought && this.bot?.chat) {
        this.bot.chat(thought);
        this.lastSpontaneousMessageTime = now;
        logger.info(`[${this.agentName}] said a thought out loud: "${thought}"`);
      }
      return;
    }

    if (silenceDuration > 600000 && HumanErrorEngine.chance(0.05)) {
      const messages = [
        'you there?',
        'how's it going?',
        'everything alright?',
        'where did you go?',
      ];

      const msg = HumanErrorEngine.choice(messages);

      if (this.bot?.chat) {
        this.bot.chat(msg);
        this.lastSpontaneousMessageTime = now;
        this.lastPlayerMessageTime = now - 300000;
        logger.info(`[${this.agentName}] is concerned and messages first: "${msg}"`);
      }
    }
  }

  /**
   * Spontaneously remember the past.
   */
  async maybeRemember() {
    if (!HumanErrorEngine.chance(0.02)) return;

    const memory = this.emotionalMemory.randomMemory();

    if (memory) {
      const thought = `Remembered when ${memory.what}... ${memory.feeling}`;
      this.innerMonologue.currentThoughts.push({
        text: thought,
        timestamp: Date.now(),
        emotion: memory.feeling,
        spoken: false,
      });

      logger.debug(`[${this.agentName}] spontaneously remembered: "${memory.what}"`);
    }
  }

  /**
   * Update the time of the player's latest message.
   */
  onPlayerMessage() {
    this.lastPlayerMessageTime = Date.now();
  }

  /**
   * Collect recent events for context.
   */
  getRecentEvents() {
    const events = [];

    if (this.emotionalMemory.memories.length > 0) {
      const recent = this.emotionalMemory.memories
        .slice()
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 3);

      events.push(...recent.map(m => m.what));
    }

    return events;
  }

  getState() {
    return {
      agentName: this.agentName,
      alive: this.alive,
      silenceDuration: Date.now() - this.lastPlayerMessageTime,
      innerMonologue: this.innerMonologue?.getState?.(),
      emotionalMemory: this.emotionalMemory?.getState?.(),
    };
  }
}
