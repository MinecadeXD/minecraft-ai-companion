import { createLogger } from '../utils/logger.js';
import { sceneObserver } from '../perception/scene-observer.js';

const logger = createLogger('CONSCIOUSNESS');

/**
 * StreamOfConsciousness — the bot's continuous stream of consciousness and free will.
 *
 * Instead of canned triggers and limited if/else scenarios, this system
 * periodically or when notable world events occur (a teammate's death, sunset, or inactivity)
 * builds a combined snapshot of sensory input and memories, then asks Gemini
 * an open-ended question:
 * "What's happening? What are you thinking about? What do you want right now?"
 *
 * The bot is free to say something in chat, write code through run_code,
 * record a thought in memory, or simply continue with its current activities.
 */
export class StreamOfConsciousness {
  constructor({
    bot = null,
    aiBrain = null,
    memoryManager = null,
    worldState = null,
    config = {},
  } = {}) {
    this.bot = bot;
    this.aiBrain = aiBrain;
    this.memoryManager = memoryManager;
    this.worldState = worldState;
    this.config = config;

    this.checkIntervalMs = config.consciousnessCheckIntervalMs ?? 5000;
    this.minThoughtIntervalMs = config.minThoughtIntervalMs ?? 30000; // no more than once every 30 seconds
    this.lastThoughtTime = 0;
    this.lastActivityTime = Date.now();
    this.lastSeenSunsetTime = 0;

    this.timer = null;
    this.isRunning = false;
    this._listeners = [];
  }

  setBot(bot) {
    this.bot = bot;
    if (this.isRunning) {
      this._attachBotEvents();
    }
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this._attachBotEvents();

    this.timer = setInterval(() => {
      this._pulse();
    }, this.checkIntervalMs);

    logger.info('[CONSCIOUSNESS] Stream of consciousness started');
  }

  stop() {
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this._detachBotEvents();
    logger.info('[CONSCIOUSNESS] Stream of consciousness stopped');
  }

  markActivity() {
    this.lastActivityTime = Date.now();
  }

  _attachBotEvents() {
    this._detachBotEvents();
    if (!this.bot?.on) return;

    // A nearby player dies
    const onEntityDead = (entity) => {
      if (entity?.type === 'player' && entity.username && entity.username !== this.bot?.username) {
        const pos = entity.position ? `[${Math.round(entity.position.x)}, ${Math.round(entity.position.y)}, ${Math.round(entity.position.z)}]` : 'unknown';
        this.triggerImpulse({
          type: 'teammate_death',
          eventDesc: `Your teammate ${entity.username} died at ${pos}! Their items will disappear in 5 minutes.`,
          priority: 'high',
        });
      }
    };

    this.bot.on('entityDead', onEntityDead);
    this._listeners.push({ event: 'entityDead', fn: onEntityDead });
  }

  _detachBotEvents() {
    if (this.bot?.removeListener) {
      for (const { event, fn } of this._listeners) {
        try {
          this.bot.removeListener(event, fn);
        } catch (_) {}
      }
    }
    this._listeners = [];
  }

  async _pulse() {
    if (!this.isRunning || !this.bot?.entity || !this.aiBrain) return;
    if (this.aiBrain.isProcessing) return;

    const now = Date.now();

    // 1. Check for sunset / nightfall
    const timeOfDay = this.bot.time?.timeOfDay;
    if (typeof timeOfDay === 'number' && timeOfDay >= 12000 && timeOfDay <= 13500) {
      if (now - this.lastSeenSunsetTime > 600000) { // once per in-game day
        this.lastSeenSunsetTime = now;
        await this.triggerImpulse({
          type: 'sunset',
          eventDesc: 'The sun is setting and night is approaching. Mobs will soon begin spawning in the dark.',
        });
        return;
      }
    }

    // 2. Check for inactivity / free time (idle)
    const idleDuration = now - this.lastActivityTime;
    const isMoving = this.bot.pathfinder?.isMoving?.();
    if (!isMoving && idleDuration >= 45000 && (now - this.lastThoughtTime >= this.minThoughtIntervalMs)) {
      await this.triggerImpulse({
        type: 'idle_curiosity',
        eventDesc: `You've been idle for ${Math.round(idleDuration / 1000)} seconds.`,
      });
    }
  }

  async triggerImpulse({ type, eventDesc, priority = 'normal' } = {}) {
    if (!this.aiBrain || typeof this.aiBrain.processMessage !== 'function') return null;

    const now = Date.now();
    if (priority !== 'high' && now - this.lastThoughtTime < this.minThoughtIntervalMs) {
      return null;
    }

    this.lastThoughtTime = now;
    this.lastActivityTime = now;

    // Gather a complete sensory snapshot
    let sensory = '';
    try {
      const scene = sceneObserver.observe(this.bot);
      if (scene) sensory = sceneObserver.describe(scene);
    } catch (_) {}

    // Gather current memories and notes
    let memories = '';
    try {
      if (this.memoryManager?.getMemoryContext) {
        memories = this.memoryManager.getMemoryContext(this.bot?.entity?.position);
      }
    } catch (_) {}

    const prompt = [
      `[INTERNAL STREAM OF CONSCIOUSNESS]`,
      eventDesc ? `What happened: ${eventDesc}` : null,
      sensory ? `Surroundings: ${sensory}` : null,
      memories ? `Your memories and thoughts:\n${memories}` : null,
      `What do you want to do right now? You have full autonomy: you can write code through run_code (explore, build, gather resources, or defend yourself), reply to a teammate in chat, save a thought with memory.remember(...), or simply take a break. The choice is yours.`
    ].filter(Boolean).join('\n\n');

    try {
      logger.info(`[CONSCIOUSNESS] Thought impulse (${type}): "${eventDesc || type}"`);
      const reply = await this.aiBrain.processMessage(prompt, this.worldState);
      if (reply && this.bot?.chat && typeof this.bot.chat === 'function') {
        this.bot.chat(reply);
      }
      return reply;
    } catch (err) {
      logger.debug(`[CONSCIOUSNESS] Error processing stream of consciousness: ${err.message}`);
      return null;
    }
  }
}
