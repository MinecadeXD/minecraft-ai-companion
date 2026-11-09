import { createLogger } from '../utils/logger.js';
import { humanChatBehavior } from './human-chat-behavior.js';
import { HumanErrorEngine } from '../behavior/human-error-engine.js';

const logger = createLogger('SPONTANEOUS_EXPRESSION');

/**
 * SpontaneousExpression — replacement for BanterEngine.
 * Instead of memorized phrases, generate live responses through an LLM with human-like imperfections.
 * Every message is unique because its context is always changing.
 *
 * UPDATED: integrated with the natural behavior system.
 */
export class SpontaneousExpression {
  constructor({ provider, agentName, personality, emotionalState, recentMessages = [] }) {
    this.provider = provider;
    this.agentName = agentName;
    this.personality = personality;
    this.emotionalState = emotionalState;
    this.recentMessages = recentMessages; // Shared message history.

    this.lastExpressionTime = 0;
    this.globalCooldown = 6000; // Increased to 6 seconds (people stay silent more often).
    this.perAgentCooldown = 18000; // Increased to 18 seconds.
    this.lastAgentExpressionTime = new Map();

    this.expressionSession = null;

    // Chance of saying anything at all (most events should result in silence).
    this.baseSpeakChance = 0.12; // 12% of events trigger a response.
  }

  /**
   * Generate a spontaneous message in response to an in-game event.
   * No templates — generate a new message every time.
   * NEW: most events do NOT trigger a message, just as with real people.
   */
  async generateExpression(trigger, context = {}) {
    const now = Date.now();

    // Rate limiting
    if (now - this.lastExpressionTime < this.globalCooldown) return null;

    const lastAgentTime = this.lastAgentExpressionTime.get(this.agentName) || 0;
    if (now - lastAgentTime < this.perAgentCooldown) return null;

    // NEW: real people stay silent 85–90% of the time.
    const timeSinceSpoke = now - lastAgentTime;
    let speakChance = this.baseSpeakChance;

    // Increase the chance after a long period of silence.
    if (timeSinceSpoke > 300000) { // 5 minutes.
      speakChance = 0.35;
    } else if (timeSinceSpoke < 20000) { // The bot spoke within the last 20 seconds.
      speakChance = 0.03;
    }

    // Emotions affect talkativeness.
    const emotion = this.emotionalState?.getState() || {};
    if (emotion.excitement > 0.7) speakChance += 0.25;
    if (emotion.stress > 0.7) speakChance -= 0.15;
    if (emotion.satisfaction > 0.8) speakChance += 0.1;

    // Personality affects talkativeness.
    const traits = this.personality?.traits || {};
    if (traits.talkativeness) {
      speakChance *= (0.5 + traits.talkativeness);
    }

    // Randomness is essential for natural behavior.
    if (!HumanErrorEngine.chance(speakChance, emotion)) {
      return null; // Stay silent.
    }

    const {
      eventDescription,
      emotionalReaction,
      recentContext,
      physState,
      targetPlayer
    } = context;

    // NEW: get recent messages for context.
    const recentChat = this.recentMessages
      .slice(-5)
      .map(m => `${m.sender}: ${m.text}`)
      .join('\n');

    const personalityDesc = this._getPersonalityDescription();
    const moodDesc = this._describeMood(emotion);

    const prompt = `You are ${this.agentName} in Minecraft. ${personalityDesc}

Current mood: ${moodDesc}

What happened: ${this.describeTrigger(trigger, eventDescription)}
${emotionalReaction ? `Your emotional reaction: ${emotionalReaction}` : ''}

Recent chat messages:
${recentChat || '(silence)'}

${targetPlayer ? `You are addressing ${targetPlayer}` : ''}

Write ONE short, natural message (or stay silent).

IMPORTANT:
- Speak like an ordinary person, not a "character".
- Avoid forced filler such as "haha", "lol", or "brb, I'll loot it"; it sounds unnatural.
- You can use "hmm", "I don't know", pauses, or unfinished thoughts.
- Do not comment on the obvious.
- Speak only when you have something to say.
- Typos are rare, but they can happen.
- Sometimes you can leave a thought unfinished.

Reply ONLY with the message text, without explanation. Or write "..." if it is better to stay silent.`;

    try {
      if (!this.expressionSession) {
        this.expressionSession = await this.provider.createChat({
          systemPrompt: `Generate short, natural messages from a Minecraft player.
Reply ONLY with the message itself, without explanations.
Every message should be unique and human-like.
People speak simply and naturally, without forced slang.`,
          tools: [],
        });
      }

      const response = await this.provider.sendMessage(this.expressionSession, prompt, {
        temperature: 0.9, // High creativity.
        maxTokens: 50,
      });

      let expression = (response.text || '').trim();

      // If the AI chose to stay silent.
      if (!expression || expression === '...' || expression.length < 2) {
        return null;
      }

      // Validate the message length.
      if (expression.length > 200) {
        return null;
      }

      // Reject meta-commentary.
      const lowerExpression = expression.toLowerCase();
      if (
        lowerExpression.includes('character') ||
        lowerExpression.includes('response') ||
        lowerExpression.includes('generat') ||
        /\\b(?:llm|ai)\\b/.test(lowerExpression) ||
        lowerExpression.includes('silence')
      ) {
        return null;
      }

      // NEW: process the message through the natural behavior system.
      expression = humanChatBehavior.makeNatural(expression, traits);

      this.lastExpressionTime = now;
      this.lastAgentExpressionTime.set(this.agentName, now);

      logger.info(`[${this.agentName}] spontaneous: "${expression}" (trigger: ${trigger})`);
      return expression;

    } catch (err) {
      logger.debug(`Failed to generate a spontaneous message: ${err.message}`);
      return null;
    }
  }

  /**
   * Describe the agent's personality.
   */
  _getPersonalityDescription() {
    const personalities = {
      Sam: 'You are calm and observant. You notice details but do not rush to share every thought.',
      Max: 'You are methodical and organized. You value facts over emotions and stay on point.',
      Jack: 'You get excited easily and are spontaneous. You live in the moment, but you do not shout constantly.',
      Ryan: 'You are hardworking and patient. You are not very talkative, but you are warm toward your friends.',
      Alex: 'You are creative and attentive to detail. You notice beauty in small things.',
      Leo: 'You are reliable and ready to protect your friends. You are not aggressive, just confident.',
    };
    return personalities[this.agentName] || 'You are an ordinary person.';
  }

  /**
   * Describe the mood.
   */
  _describeMood(mood) {
    const parts = [];
    if (mood.stress > 0.6) parts.push('tense');
    if (mood.excitement > 0.6) parts.push('excited');
    if (mood.satisfaction > 0.7) parts.push('satisfied');
    if (mood.frustration > 0.6) parts.push('frustrated');
    if (mood.curiosity > 0.7) parts.push('curious');
    if (parts.length === 0) return 'calm';
    return parts.join(', ');
  }

  /**
   * Describe the trigger in natural language.
   */
  describeTrigger(trigger, customDescription) {
    if (customDescription) return customDescription;

    const descriptions = {
      FIND_ORE: 'found ore',
      CRAFT_MILESTONE: 'crafted an important item',
      NIGHT_APPROACH: 'it is getting dark; night is coming',
      SUNRISE: 'sunrise',
      COMBAT_KILL: 'defeated a mob',
      HUNGER: 'hungry',
      SHARE_ITEM: 'sharing an item',
      SCOUT_DISCOVERY: 'discovered something interesting',
      BUILD_PROGRESS: 'making progress on a build',
      JOKE: 'wants to tell a joke',
      DAMAGE_TAKEN: 'took damage',
      LOW_HEALTH: 'low on health',
      FOUND_DIAMONDS: 'found diamonds',
      CREEPER_NEAR: 'a creeper is nearby',
    };

    return descriptions[trigger] || 'an event occurred';
  }

  /**
   * Reset the session.
   */
  reset() {
    this.expressionSession = null;
    this.lastExpressionTime = 0;
    this.lastAgentExpressionTime.clear();
  }
}
