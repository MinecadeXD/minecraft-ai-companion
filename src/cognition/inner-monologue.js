import { createLogger } from '../utils/logger.js';
import { HumanErrorEngine } from '../behavior/human-error-engine.js';

const logger = createLogger('INNER_MONOLOGUE');

/**
 * InnerMonologue — internal stream of consciousness.
 * The bot keeps thinking even when nobody is chatting.
 * Some thoughts occasionally make it into chat, making the bot feel more human.
 */
export class InnerMonologue {
  constructor({ provider, agentName, personality }) {
    this.provider = provider;
    this.agentName = agentName;
    this.personality = personality;

    this.currentThoughts = [];
    this.worries = [];
    this.curiosities = [];
    this.pendingMemories = [];

    this.lastThoughtTime = Date.now();
    this.lastSpokeThoughtTime = 0;

    this.thinkingSession = null;
  }

  /**
   * Generate an internal thought through the LLM.
   * No tool calls — this is ordinary internal thinking.
   */
  async generateThought(context) {
    const { situation, emotion, recentEvents, silenceDuration, physState } = context;

    const prompt = `You are ${this.agentName}. Think of one short thought (2–7 words), like a person would.

Situation: ${situation || 'an ordinary day in Minecraft'}
Mood: ${emotion || 'neutral'}
${recentEvents && recentEvents.length > 0 ? `Recently: ${recentEvents.slice(-3).join('; ')}` : ''}
${silenceDuration > 300000 ? `Your friend has not chatted in a while (${Math.floor(silenceDuration / 60000)} minutes)` : ''}
${physState?.fatigue > 0.6 ? 'Tired' : ''}
${physState?.stress > 0.5 ? 'Stressed' : ''}

Examples of the STYLE of thoughts (do NOT copy them; only understand the tone):
- "Hmm, I have not checked the mine in a while..."
- "I wonder where everyone is"
- "I should clear out my inventory"
- "Beautiful sunset"
- "A little tired"

Your thought (2–7 words):`;

    try {
      // Reset session periodically to prevent context bloat
      this._thoughtCount = (this._thoughtCount || 0) + 1;
      if (this._thoughtCount > 15) {
        this.thinkingSession = null;
        this._thoughtCount = 0;
      }

      if (!this.thinkingSession) {
        this.thinkingSession = await this.provider.createChat({
          systemPrompt: `You generate the character's internal thoughts.
Reply ONLY with the character's thought, without explanation.
Every thought should be unique, natural, and human.
NO repetition and NO templates.`,
          tools: [],
        });
      }

      const response = await this.provider.sendMessage(this.thinkingSession, prompt, {
        temperature: 0.9,
        maxTokens: 50,
      });

      const thought = (response.text || '').trim();

      if (thought && thought.length > 5 && thought.length < 150) {
        this.lastThoughtTime = Date.now();
        return thought;
      }

      return null;
    } catch (err) {
      logger.debug(`Thought generation failed: ${err.message}`);
      return null;
    }
  }

  /**
   * Main thinking loop — called periodically.
   */
  async think(worldState, emotionalState, silenceDuration, recentEvents = []) {
    const now = Date.now();

    if (now - this.lastThoughtTime < 15000) return null;

    const physState = {
      fatigue: emotionalState?.fatigue || 0.2,
      stress: emotionalState?.stress || 0.1,
    };

    let situation = 'ordinary gameplay';
    let emotion = 'calm';

    if (worldState?.nearbyMobs?.some(m => ['zombie', 'skeleton', 'creeper'].includes(m.name))) {
      situation = 'hostile mobs nearby';
      emotion = 'tension';
    } else if (silenceDuration > 300000) {
      situation = 'have not heard from a friend in a while';
      emotion = 'mild unease';
    } else if (worldState?.health < 10) {
      situation = 'low health';
      emotion = 'concern';
    } else if (worldState?.timeOfDay === 'sunset') {
      situation = 'sunset';
      emotion = 'calm';
    }

    const thought = await this.generateThought({
      situation,
      emotion,
      recentEvents,
      silenceDuration,
      physState,
    });

    if (thought) {
      this.currentThoughts.push({
        text: thought,
        timestamp: now,
        emotion,
        spoken: false,
      });

      if (this.currentThoughts.length > 20) {
        this.currentThoughts.shift();
      }

      logger.debug(`[${this.agentName}] thinking: "${thought}"`);
      return thought;
    }

    return null;
  }

  /**
   * Decide whether to say a thought out loud.
   * 10% chance when thoughts are available, with a 30-second cooldown.
   */
  shouldSpeakThought() {
    const now = Date.now();

    if (now - this.lastSpokeThoughtTime < 30000) return false;
    if (this.currentThoughts.length === 0) return false;

    const unspokenThoughts = this.currentThoughts.filter(t => !t.spoken);
    if (unspokenThoughts.length === 0) return false;

    return HumanErrorEngine.chance(0.1);
  }

  /**
   * Say a random unspoken thought out loud.
   */
  speakRandomThought() {
    const unspoken = this.currentThoughts.filter(t => !t.spoken);
    if (unspoken.length === 0) return null;

    const thought = HumanErrorEngine.choice(unspoken);
    thought.spoken = true;
    this.lastSpokeThoughtTime = Date.now();

    logger.info(`[${this.agentName}] thinking out loud: "${thought.text}"`);
    return thought.text;
  }

  /**
   * Add a worry (something the character is concerned about).
   */
  addWorry(text) {
    this.worries.push({ text, timestamp: Date.now() });
    if (this.worries.length > 5) this.worries.shift();
  }

  /**
   * Add a curiosity (something the character is interested in).
   */
  addCuriosity(text) {
    this.curiosities.push({ text, timestamp: Date.now() });
    if (this.curiosities.length > 5) this.curiosities.shift();
  }

  getState() {
    return {
      currentThoughts: this.currentThoughts.slice(-5).map(t => t.text),
      worries: this.worries.map(w => w.text),
      curiosities: this.curiosities.map(c => c.text),
    };
  }

  reset() {
    this.currentThoughts = [];
    this.worries = [];
    this.curiosities = [];
    this.thinkingSession = null;
  }
}
