import { createLogger } from '../utils/logger.js';
import { HumanErrorEngine } from '../behavior/human-error-engine.js';

const logger = createLogger('NATURAL_DIALOGUE');

/**
 * Natural dialogue system — no templates, only context-aware reactions.
 *
 * Principles of human-like conversation:
 * 1. Silence is natural — do not comment on every action.
 * 2. Context matters more than templates — remember what was said recently.
 * 3. Uncertainty is normal — it is okay to say "I don't know", "maybe", or "not sure".
 * 4. Typos happen sometimes.
 * 5. Convey emotion through pauses and tone, not forced reactions like "haha, lol".
 */

export class NaturalDialogue {
  constructor({ aiProvider, memoryManager, socialGraph, emotionalState }) {
    this.aiProvider = aiProvider;
    this.memory = memoryManager;
    this.socialGraph = socialGraph;
    this.emotions = emotionalState;

    // Recent message history for context.
    this.recentMessages = [];
    this.lastSpokeTime = new Map(); // agentName -> timestamp

    // Base chance of speaking at all (most events should result in silence).
    this.baseSpeakChance = 0.15; // 15% of events trigger a response.
  }

  /**
   * Generate a natural reaction to an in-game event.
   * Most events do NOT trigger a message, just as with real people.
   */
  async generateResponse(agentName, event, context = {}) {
    const now = Date.now();
    const lastSpoke = this.lastSpokeTime.get(agentName) || 0;

    // Has the bot been silent for a while? Increase the chance of speaking.
    const timeSinceSpoke = now - lastSpoke;
    let speakChance = this.baseSpeakChance;

    if (timeSinceSpoke > 300000) { // 5 minutes of silence.
      speakChance = 0.4;
    } else if (timeSinceSpoke < 20000) { // The bot spoke within the last 20 seconds.
      speakChance = 0.05;
    }

    // Emotional state affects talkativeness.
    const mood = this.emotions?.getMood() || {};
    if (mood.excitement > 0.7) speakChance += 0.2;
    if (mood.stress > 0.7) speakChance -= 0.1;

    // Randomness is essential for natural behavior.
    if (!HumanErrorEngine.chance(speakChance, mood)) {
      return null; // Stay silent.
    }

    // Generate a context-aware message through AI.
    const response = await this._generateContextualResponse(agentName, event, context);

    if (response) {
      this.lastSpokeTime.set(agentName, now);
      this.recentMessages.push({
        agent: agentName,
        message: response,
        event,
        timestamp: now
      });

      // Keep only the 20 most recent messages.
      if (this.recentMessages.length > 20) {
        this.recentMessages.shift();
      }
    }

    return response;
  }

  /**
   * Generate a message using context, personality, and conversation history.
   */
  async _generateContextualResponse(agentName, event, context) {
    // Get the context of recent messages.
    const recentContext = this.recentMessages
      .slice(-5)
      .map(m => `${m.agent}: ${m.message}`)
      .join('\n');

    // Get the agent's personality.
    const personality = this._getPersonalityDescription(agentName);

    // Get the emotional state.
    const mood = this.emotions?.getMood() || {};
    const moodDesc = this._describeMood(mood);

    const prompt = `You are ${agentName} in Minecraft. ${personality}

Current mood: ${moodDesc}

What just happened: ${this._describeEvent(event, context)}

Recent chat messages:
${recentContext || '(silence)'}

Write ONE short, natural reaction (or stay silent if you have nothing to say).

IMPORTANT:
- Speak like an ordinary person, not a fictional character.
- Avoid forced filler such as "haha", "lol", or "brb"; it sounds unnatural.
- You can use "hmm", "I don't know", pauses, or unfinished thoughts.
- Do not comment on the obvious (for example, saying "found a tree" while chopping one).
- Speak only when you have something to say or want to chat.
- Typos are rare, but they can happen (1–2%).
- Sometimes you can leave a thought unfinished or get distracted.

Reply ONLY with the message text, without explanation. Or write "..." if it is better to stay silent.`;

    try {
      const response = await this.aiProvider.generateText(prompt, {
        maxTokens: 60,
        temperature: 0.85, // High creativity for natural responses.
        stopSequences: ['\n', 'You:', agentName + ':']
      });

      const text = response.trim();

      // If the AI chose to stay silent.
      if (!text || text === '...' || text.length < 3) {
        return null;
      }

      // Add rare, natural typos (2% chance).
      return this._addNaturalImperfections(text);

    } catch (error) {
      logger.error(`Failed to generate a message for ${agentName}: ${error.message}`);
      return null;
    }
  }

  /**
   * Describe the event for the prompt.
   */
  _describeEvent(event, context) {
    const descriptions = {
      'find_ore': `Found ${context.oreName || 'ore'}`,
      'craft_item': `Crafted ${context.itemName || 'item'}`,
      'night_approaching': 'It is getting dark; night is coming',
      'sunrise': 'Sunrise',
      'kill_mob': `Killed ${context.mobType || 'mob'}`,
      'take_damage': `Took damage (${context.damage || '?'} HP)`,
      'low_health': 'Low on health',
      'low_food': 'Hungry',
      'player_nearby': `${context.playerName || 'A player'} is nearby`,
      'discovery': `Discovered ${context.what || 'something interesting'}`,
      'build_progress': 'Working on a build',
      'idle_moment': 'Just a quiet moment',
      'someone_spoke': `${context.speaker} said: "${context.message}"`,
    };

    return descriptions[event] || event;
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
    if (mood.trust > 0.8) parts.push('trusts the people around them');

    if (parts.length === 0) return 'calm';
    return parts.join(', ');
  }

  /**
   * Agent personality (real traits, NOT stereotypes).
   */
  _getPersonalityDescription(name) {
    const personalities = {
      Sam: 'You are calm and observant. You notice details but do not rush to share every thought. You are sometimes thoughtful.',
      Max: 'You are methodical and organized. You value facts over emotions. You stay on point without sounding cold.',
      Jack: 'You get excited easily and are spontaneous. That does not mean you are always shouting; you simply live in the moment.',
      Ryan: 'You are hardworking and patient. You find satisfaction in the process. You are not very talkative, but you are warm toward your friends.',
      Alex: 'You are creative and attentive to detail. You notice beauty in small things. You speak when inspired or when you want to share an idea.',
      Leo: 'You are reliable and ready to protect your friends. You are not aggressive, just confident. You value directness.',
    };

    return personalities[name] || 'You are an ordinary person playing Minecraft.';
  }

  /**
   * Add natural imperfections.
   */
  _addNaturalImperfections(text) {
    // 2% chance of a typo.
    if (HumanErrorEngine.chance(0.02)) {
      const typos = {
        'the': 'teh',
        'you': 'yuo',
        'because': 'becuase',
        'friend': 'freind',
        'really': 'realy',
        'going': 'goign',
      };

      for (const [correct, typo] of Object.entries(typos)) {
        if (text.includes(correct) && HumanErrorEngine.chance(0.5)) {
          text = text.replace(correct, typo);
          break; // Only one typo.
        }
      }
    }

    // 5% chance of leaving a thought unfinished.
    if (HumanErrorEngine.chance(0.05) && text.length > 15) {
      const words = text.split(' ');
      if (words.length > 3) {
        text = words.slice(0, -1).join(' ') + '...';
      }
    }

    return text;
  }

  /**
   * React to a message from another player or agent.
   */
  async respondToMessage(agentName, speaker, message, context = {}) {
    const now = Date.now();
    const lastSpoke = this.lastSpokeTime.get(agentName) || 0;

    // Was the agent's name mentioned directly?
    const mentioned = message.toLowerCase().includes(agentName.toLowerCase());

    // Is this a question?
    const isQuestion = message.includes('?') ||
                      message.match(/\b(?:how|what|where|when|why|which|who|whose|whom)\b/i);

    // Is the question addressed to the group?
    const toGroup = isQuestion && !mentioned;

    let respondChance = 0;

    if (mentioned) {
      respondChance = 0.95; // Almost always respond to a direct mention.
    } else if (isQuestion) {
      respondChance = 0.25; // Sometimes respond to questions addressed to the group.
    } else if (now - lastSpoke > 120000) { // 2 minutes of silence.
      respondChance = 0.15; // We may join the conversation.
    } else {
      respondChance = 0.05; // Rarely interrupt someone else's conversation.
    }

    // Relationship with the person speaking.
    const relationship = this.socialGraph?.getRelationship(agentName, speaker);
    if (relationship) {
      if (relationship.friendship > 0.7) respondChance += 0.15;
      if (relationship.irritation > 0.5) respondChance -= 0.2;
    }

    if (!HumanErrorEngine.chance(respondChance)) {
      return null;
    }

    // Generate the response.
    const response = await this._generateContextualResponse(
      agentName,
      'someone_spoke',
      { speaker, message, mentioned, isQuestion }
    );

    return response;
  }

  /**
   * Initiative — start a conversation yourself.
   */
  shouldInitiateConversation(agentName) {
    const now = Date.now();
    const lastSpoke = this.lastSpokeTime.get(agentName) || 0;
    const silenceDuration = now - lastSpoke;

    // Do not initiate if there has been less than 2 minutes of silence.
    if (silenceDuration < 120000) return false;

    // After 2–10 minutes, use a very low chance (0.5%).
    if (silenceDuration < 600000) return HumanErrorEngine.chance(0.005);

    // After more than 10 minutes, use a low chance (2%).
    return HumanErrorEngine.chance(0.02);
  }

  /**
   * Generate an opening for a conversation.
   */
  async initiateConversation(agentName, context = {}) {
    const recentContext = this.recentMessages
      .slice(-3)
      .map(m => `${m.agent}: ${m.message}`)
      .join('\n');

    const personality = this._getPersonalityDescription(agentName);
    const mood = this.emotions?.getMood() || {};
    const moodDesc = this._describeMood(mood);

    const prompt = `You are ${agentName} in Minecraft. ${personality}

Mood: ${moodDesc}

You have been quiet for a while. What are you doing right now: ${context.currentActivity || 'relaxing'}

Latest chat:
${recentContext || '(no one has spoken in a while)'}

You can start a conversation — ask a question, share a thought, or suggest something.
Or simply stay silent if you have nothing to say.

Write ONE natural sentence. Or write "..." if silence is better.`;

    try {
      const response = await this.aiProvider.generateText(prompt, {
        maxTokens: 60,
        temperature: 0.9,
      });

      const text = response.trim();
      if (!text || text === '...' || text.length < 3) return null;

      this.lastSpokeTime.set(agentName, Date.now());
      return this._addNaturalImperfections(text);

    } catch (error) {
      logger.error(`Conversation initiation failed for ${agentName}: ${error.message}`);
      return null;
    }
  }

  /**
   * Clean up old history.
   */
  cleanup() {
    const cutoff = Date.now() - 600000; // 10 minutes.
    this.recentMessages = this.recentMessages.filter(m => m.timestamp > cutoff);
  }
}
