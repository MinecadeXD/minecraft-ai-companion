import { createLogger } from '../../utils/logger.js';

const logger = createLogger('RESPONSE_GENERATOR');

/**
 * Generates natural human responses instead of templates.
 * Uses an LLM to create unique reactions.
 */
export class ResponseGenerator {
  constructor(aiBrain, profile) {
    this.aiBrain = aiBrain;
    this.profile = profile;
    this.recentResponses = []; // Last 20 responses, used to avoid repetition
  }

  /**
   * Generate a natural response to a player's command
   * @param {string} intent - command type (STOP, FOLLOW, etc)
   * @param {string} playerMessage - original player message
   * @param {Object} context - context (position, health, mood, etc.)
   * @returns {Promise<string>}
   */
  async generateResponse(intent, playerMessage, context = {}) {
    const { mood, health, food, position, busy, currentTask } = context;
    
    // Build the LLM prompt
    const prompt = this._buildPrompt(intent, playerMessage, {
      mood,
      health,
      food,
      position,
      busy,
      currentTask,
      personality: this.profile,
      recentResponses: this.recentResponses.slice(-5) // last 5 for context
    });

    try {
      // Quick, short LLM request
      const response = await this.aiBrain.generateQuickResponse(prompt, {
        maxTokens: 30,
        temperature: 0.9, // high variation
        stopSequences: ['\n', '.', '!', '?']
      });

      const text = response.text?.trim() || await this._getFallback(intent, playerMessage, context);

      // Save to history
      this.recentResponses.push({ intent, text, timestamp: Date.now() });
      if (this.recentResponses.length > 20) this.recentResponses.shift();

      return text;
    } catch (err) {
      logger.error(`Response generation error: ${err.message}`);
      return await this._getFallback(intent, playerMessage, context);
    }
  }

  /**
   * Build the LLM prompt
   */
  _buildPrompt(intent, playerMessage, context) {
    const { personality, mood, health, busy, currentTask, recentResponses } = context;
    
    const moodStr = mood ? `Mood: ${mood}. ` : '';
    const healthStr = health < 10 ? 'Health is low.  ' : '';
    const busyStr = busy ? `Busy: ${currentTask}. ` : '';
    
    let intentDesc = '';
    switch (intent) {
      case 'STOP':
        intentDesc = 'The player ordered you to stop';
        break;
      case 'FOLLOW':
        intentDesc = 'The player asked you to follow';
        break;
      case 'COME_HERE':
        intentDesc = 'The player called you over';
        break;
      case 'WAIT':
        intentDesc = 'The player asked you to wait';
        break;
      case 'HELP':
        intentDesc = 'The player asked for help';
        break;
      case 'WHERE_ARE_YOU':
        intentDesc = 'The player asked where you are';
        break;
      case 'CALL_NAME':
        intentDesc = 'The player called your name';
        break;
    }

    const charDesc = this._getCharacterDescription(personality);
    
    // Avoid repeating recent phrases
    const avoidPhrases = recentResponses.map(r => r.text).join(', ');

    return `You are ${personality.name}, playing Minecraft. ${charDesc}
${moodStr}${healthStr}${busyStr}
The player wrote: "${playerMessage}"
${intentDesc}.

Reply with ONE short, natural sentence (5–7 words maximum), without using a template. 
Do NOT use these phrases: ${avoidPhrases}
Write like a real person in game chat:`;
  }

  /**
   * Character description for the prompt
   */
  _getCharacterDescription(personality) {
    const traits = personality.traits || {};
    
    if (personality.name === 'Sam') {
      return 'You are calm and cautious; you think before acting.';
    } else if (personality.name === 'Max') {
      return 'You are formal, practical, and a little fussy.';
    } else if (personality.name === 'Jack') {
      return 'You are energetic, cheerful, and occasionally reckless.';
    } else if (personality.name === 'Ryan') {
      return 'You are calm, reliable, and not very talkative.';
    } else if (personality.name === 'Alex') {
      return 'You are friendly and helpful to others.';
    } else if (personality.name === 'Leo') {
      return 'You are brave, adventurous, and enjoy action.';
    }
    
    return 'You are an ordinary player.';
  }

  /**
   * Fallback when the main LLM request returns empty or fails.
   * No canned phrases: try one more very short
   * LLM request, knowing only the gist of the message. If that also fails —
   * return one neutral word (a sign of a connection lag, not a response template).
   */
  async _getFallback(intent, playerMessage = '', context = {}) {
    if (this.aiBrain?.generateQuickResponse) {
      try {
        const name = this.profile?.name || 'ты';
        const prompt = `You are ${name}, playing Minecraft with friends. Someone wrote: "${playerMessage}". Reply in ONE natural, short phrase (1–4 words), in your own words, using lowercase and no period:`;
        const res = await this.aiBrain.generateQuickResponse(prompt, {
          maxTokens: 16,
          temperature: 0.95,
          timeoutMs: 1000,
        });
        const text = res.text?.trim().replace(/^["'«»]+|["'«»]+$/g, '').trim();
        if (text && text.length >= 1) return text;
      } catch (_) {}
    }
    return 'hmm?';
  }
}
