import { createLogger } from '../utils/logger.js';
import { HumanErrorEngine } from '../behavior/human-error-engine.js';

const logger = createLogger('HUMAN_CHAT');

/**
 * Natural chat behavior model
 *
 * Principles:
 * - Real people stay silent most of the time
 * - Typos and unfinished words happen
 * - People pause to think before replying
 * - Responses are based on context, not just triggers
 * - No exaggerated roleplay — just natural human traits
 */

export class HumanChatBehavior {
  constructor() {
    // Everyone makes typos sometimes
    this.typoPatterns = {
      // Dropping the last letter
      endings: 0.03, // 3%

      // Occasional keyboard typos (nearby keys on an English keyboard)
      keyboard: {
        a: 's', o: 'i', e: 'w', i: 'o', t: 'r',
        n: 'b', s: 'a', v: 'c', k: 'j', m: 'n'
      },

      // Missing spaces
      spaceMissing: 0.02,

      // Duplicating a letter
      doubleChar: 0.015,
    };

    // Natural speech patterns
    this.speechPatterns = {
      // Filler words (used sparingly)
      fillers: ['hmm', 'uh', 'well', 'so', 'like', 'anyway', 'damn'],
      fillerChance: 0.1, // 10% of phrases

      // Trailing off
      trailingOff: ['...', '..', '.', ''],
      trailingChance: 0.08,

      // Hesitation and uncertainty
      uncertainty: ['probably', 'maybe', 'not sure', 'idk', 'I think'],
      uncertaintyChance: 0.12,

      // Natural contractions (not forced slang)
      contractions: {
        'right now': 'rn',
        'something': 'smth',
        'probably': 'prob',
        'okay': 'ok',
        'because': 'bc',
        'though': 'tho',
      },
      contractionChance: 0.15,
    };

    // Timings (in milliseconds)
    this.timings = {
      // Delay before answering a question (time to think)
      thinkBeforeAnswer: { min: 1500, max: 4000 },

      // Typing delay (depends on message length)
      typingSpeed: { min: 50, max: 120 }, // ms per character

      // Occasional pauses in long messages
      pauseInTyping: 0.1, // 10% chance
      pauseDuration: { min: 300, max: 1200 },
    };
  }

  /**
   * Process text to make it sound more natural
   */
  makeNatural(text, agentPersonality = {}) {
    if (!text || text.length < 3) return text;

    let result = text;

    // 1. Tone down excessive expressiveness
    result = this._toneDown(result);

    // 2. Add natural speech patterns
    result = this._addSpeechPatterns(result, agentPersonality);

    // 3. Occasional typos
    result = this._addTypos(result);

    // 4. Contractions
    result = this._addContractions(result);

    return result;
  }

  /**
   * Remove exaggerated style ("haha", repeated punctuation)
   */
  _toneDown(text) {
    // Remove repeated punctuation
    text = text.replace(/!+/g, '');
    text = text.replace(/\?+/g, '?');
    text = text.replace(/\.{4,}/g, '...');

    // Remove slang that sounds forced or unnatural
    const cringeWords = {
      'hahaha': '', 'haha': '', 'lol': '', 'lmao': '',
      'kek': '', 'bruh': '', 'goated': '',
      'rofl': '', 'lmfao': ''
    };

    for (const [cringe, replacement] of Object.entries(cringeWords)) {
      const regex = new RegExp('\\b' + cringe + '\\b', 'gi');
      text = text.replace(regex, replacement);
    }

    // Remove extra spaces
    text = text.replace(/\s{2,}/g, ' ').trim();

    return text;
  }

  /**
   * Add natural speech patterns
   */
  _addSpeechPatterns(text, personality) {
    const words = text.split(' ');

    // Occasional filler words at the beginning
    if (HumanErrorEngine.chance(this.speechPatterns.fillerChance) && words.length > 3) {
      const filler = HumanErrorEngine.choice(this.speechPatterns.fillers);
      text = filler + ', ' + text;
    }

    // Uncertainty
    if (HumanErrorEngine.chance(this.speechPatterns.uncertaintyChance)) {
      const uncertain = HumanErrorEngine.choice(this.speechPatterns.uncertainty);

      // Add it to the beginning or end
      if (HumanErrorEngine.coinFlip() > 0) {
        text = uncertain + ' ' + text;
      } else {
        text = text + ' ' + uncertain;
      }
    }

    // Trailing off (occasionally)
    if (HumanErrorEngine.chance(this.speechPatterns.trailingChance)) {
      // Remove the last word or add an ellipsis
      if (words.length > 4 && HumanErrorEngine.chance(0.3)) {
        words.pop();
        text = words.join(' ') + '...';
      } else {
        const trailing = HumanErrorEngine.choice(this.speechPatterns.trailingOff);
        text = text + trailing;
      }
    }

    return text;
  }

  /**
   * Add natural contractions
   */
  _addContractions(text) {
    if (!HumanErrorEngine.chance(this.speechPatterns.contractionChance)) return text;

    for (const [full, short] of Object.entries(this.speechPatterns.contractions)) {
      if (text.includes(full) && HumanErrorEngine.chance(0.6)) {
        text = text.replace(full, short);
        break; // Only one contraction
      }
    }

    return text;
  }

  /**
   * Add occasional typos
   */
  _addTypos(text) {
    const words = text.split(' ');

    // Dropping the last letter
    if (HumanErrorEngine.chance(this.typoPatterns.endings) && words.length > 2) {
      const idx = Math.floor(HumanErrorEngine.range(0, words.length - 0.01));
      if (words[idx].length > 3) {
        words[idx] = words[idx].slice(0, -1);
      }
    }

    // Keyboard typo (very rare)
    if (HumanErrorEngine.chance(0.02)) {
      const idx = Math.floor(HumanErrorEngine.range(0, words.length - 0.01));
      const word = words[idx];

      for (const [correct, typo] of Object.entries(this.typoPatterns.keyboard)) {
        if (word.includes(correct) && HumanErrorEngine.chance(0.5)) {
          words[idx] = word.replace(correct, typo);
          break;
        }
      }
    }

    // Missing space between short words
    if (HumanErrorEngine.chance(this.typoPatterns.spaceMissing) && words.length > 3) {
      const idx = Math.floor(HumanErrorEngine.range(0, words.length - 1.01));
      if (words[idx].length <= 3 && words[idx + 1].length <= 4) {
        words[idx] = words[idx] + words[idx + 1];
        words.splice(idx + 1, 1);
      }
    }

    // Duplicate a letter
    if (HumanErrorEngine.chance(this.typoPatterns.doubleChar)) {
      const idx = Math.floor(HumanErrorEngine.range(0, words.length - 0.01));
      const word = words[idx];
      if (word.length > 3) {
        const pos = Math.floor(HumanErrorEngine.range(0, word.length - 1.01));
        words[idx] = word.slice(0, pos) + word[pos] + word.slice(pos);
      }
    }

    return words.join(' ');
  }

  /**
   * Calculate the response delay (people need time to think)
   */
  calculateResponseDelay(message, isQuestion, personality = {}) {
    let delay = 0;

    // If it is a question, allow time to think before replying
    if (isQuestion) {
      const { min, max } = this.timings.thinkBeforeAnswer;
      delay += HumanErrorEngine.range(min, max);
    }

    // Typing delay
    const typingSpeed = HumanErrorEngine.range(this.timings.typingSpeed.min, this.timings.typingSpeed.max);
    delay += message.length * typingSpeed;

    // Random pause (getting distracted)
    if (HumanErrorEngine.chance(this.timings.pauseInTyping)) {
      const { min, max } = this.timings.pauseDuration;
      delay += HumanErrorEngine.range(min, max);
    }

    // Personality affects typing speed
    if (personality.impulsiveness > 0.7) {
      delay *= 0.6; // Faster
    } else if (personality.patience > 0.7) {
      delay *= 1.3; // Slower, taking time to think
    }

    // Keep the delay within reasonable limits
    return Math.max(800, Math.min(12000, delay));
  }

  /**
   * Should the agent respond to the message?
   * (Most messages do NOT need a reply from everyone)
   */
  shouldRespond(agentName, message, context = {}) {
    const { speaker, isQuestion, mentioned, recentlySpokeCount } = context;

    // Do not reply to yourself
    if (speaker === agentName) return false;

    // Almost always respond to a direct mention
    if (mentioned) return HumanErrorEngine.chance(0.92);

    // Sometimes respond to a question addressed to the group
    if (isQuestion) {
      // If someone has already replied, usually stay quiet
      if (recentlySpokeCount > 1) return HumanErrorEngine.chance(0.1);

      return HumanErrorEngine.chance(0.25); // 25% chance of answering a group question
    }

    // Rarely comment on an ordinary message
    if (recentlySpokeCount > 0) return HumanErrorEngine.chance(0.03);

    return HumanErrorEngine.chance(0.08); // 8% chance of joining the conversation
  }

  /**
   * Probability of starting a conversation
   */
  shouldInitiate(silenceDuration, personality = {}) {
    // Do not initiate during the first 3 minutes of silence
    if (silenceDuration < 180000) return false;

    // 3–10 minutes — very low chance
    if (silenceDuration < 600000) {
      const baseChance = 0.003; // 0.3%
      const personalityBonus = (personality.talkativeness || 0.5) * 0.002;
      return HumanErrorEngine.chance(baseChance + personalityBonus);
    }

    // More than 10 minutes — low chance
    const baseChance = 0.01; // 1%
    const personalityBonus = (personality.talkativeness || 0.5) * 0.01;
    return HumanErrorEngine.chance(baseChance + personalityBonus);
  }
}

export const humanChatBehavior = new HumanChatBehavior();
