import { createLogger } from '../utils/logger.js';
import { HumanErrorEngine } from './human-error-engine.js';

const logger = createLogger('HUMAN_CHAT');

/**
 * Adjacent keyboard keys used to simulate natural typing mistakes.
 */
const KEYBOARD_ADJACENT = {
  // QWERTY keyboard layout.
  'q': ['w', 'a', 's'],
  'w': ['q', 'e', 's', 'd'],
  'e': ['w', 'r', 'd', 'f'],
  'r': ['e', 't', 'f', 'g'],
  't': ['r', 'y', 'g', 'h'],
  'y': ['t', 'u', 'h', 'j'],
  'u': ['y', 'i', 'j', 'k'],
  'i': ['u', 'o', 'k', 'l'],
  'o': ['i', 'p', 'l'],
  'p': ['o', 'l'],
  'a': ['q', 'w', 's', 'z'],
  's': ['a', 'w', 'e', 'd', 'x', 'z'],
  'd': ['s', 'e', 'r', 'f', 'c', 'x'],
  'f': ['d', 'r', 't', 'g', 'v', 'c'],
  'g': ['f', 't', 'y', 'h', 'b', 'v'],
  'h': ['g', 'y', 'u', 'j', 'n', 'b'],
  'j': ['h', 'u', 'i', 'k', 'm', 'n'],
  'k': ['j', 'i', 'o', 'l', 'm'],
  'l': ['k', 'o', 'p'],
  'z': ['a', 's', 'x'],
  'x': ['z', 's', 'd', 'c'],
  'c': ['x', 'd', 'f', 'v'],
  'v': ['c', 'f', 'g', 'b'],
  'b': ['v', 'g', 'h', 'n'],
  'n': ['b', 'h', 'j', 'm'],
  'm': ['n', 'j', 'k'],
};

/**
 * HumanChatFlow — simulates the physical typing behavior of a real player:
 * 1. Stop the character or sneak while typing in chat (hands on the keyboard).
 * 2. Use a normally distributed typing delay of 200–350 characters per minute.
 * 3. Introduce natural, random typos using adjacent keys.
 * 4. IMPORTANT: in 65% of cases, the typo is NOT corrected if the meaning is clear,
 *    and a quick correction is sent only 35% of the time (for example, *coming).
 * 5. Split long messages into two shorter chat messages.
 */
export class HumanChatFlow {
  /**
   * Generate a typo in a word.
   */
  static injectTypo(word) {
    if (!word || word.length < 4) return { typoWord: word, hasTypo: false, originalWord: word };

    // Choose a character closer to the middle or end of the word.
    const charIndex = Math.max(1, Math.min(word.length - 2, Math.round(HumanErrorEngine.range(1, word.length - 2))));
    const char = word[charIndex].toLowerCase();
    const adjacent = KEYBOARD_ADJACENT[char];

    if (!adjacent || adjacent.length === 0) {
      return { typoWord: word, hasTypo: false, originalWord: word };
    }

    const replacement = HumanErrorEngine.choice(adjacent);
    const isUpper = word[charIndex] === word[charIndex].toUpperCase() && word[charIndex] !== word[charIndex].toLowerCase();
    const typoChar = isUpper ? replacement.toUpperCase() : replacement;

    const typoWord = word.slice(0, charIndex) + typoChar + word.slice(charIndex + 1);
    return {
      typoWord,
      hasTypo: true,
      originalWord: word,
    };
  }

  /**
   * Prepare text for sending with realistic typo handling.
   * @param {string} text
   * @param {object} bot
   * @returns {{ messages: string[], correction: string | null }}
   */
  static prepareMessages(text, bot = null) {
    if (!text || typeof text !== 'string') return { messages: [], correction: null };

    const clean = text.trim();
    if (clean.length === 0) return { messages: [], correction: null };

    // Check psychophysiological stress and fatigue when calculating the typo chance.
    const state = HumanErrorEngine.getPsychophysiologicalState(bot);
    // The base typo chance is 4%; stress and fatigue can raise it to 14%.
    const typoProbability = 0.04 + state.stress * 0.06 + state.fatigue * 0.04;

    const words = clean.split(' ');
    let madeTypo = null;

    for (let i = 0; i < words.length; i++) {
      // Allow at most one typo per message.
      if (!madeTypo && words[i].length >= 4 && HumanErrorEngine.chance(typoProbability, bot)) {
        const res = this.injectTypo(words[i]);
        if (res.hasTypo) {
          words[i] = res.typoWord;
          madeTypo = res;
        }
      }
    }

    const processedText = words.join(' ');

    // Decide whether to correct the typo.
    // A real player leaves a readable typo uncorrected 65% of the time.
    let correction = null;
    if (madeTypo) {
      const shouldCorrect = HumanErrorEngine.gaussian(0, 1) > 0.4; // About a 35% chance of correction.
      if (shouldCorrect) {
        correction = `*${madeTypo.originalWord}`;
      }
    }

    // Split into two short messages when there is a logical separator (period, comma, or conjunction)
    // and the message is longer than 40 characters.
    const messages = [];
    if (processedText.length > 40 && HumanErrorEngine.chance(0.45, bot)) {
      const splitIndex = processedText.search(/[.,!?]\s+/);
      if (splitIndex !== -1 && splitIndex > 10 && splitIndex < processedText.length - 10) {
        messages.push(processedText.slice(0, splitIndex + 1).trim());
        messages.push(processedText.slice(splitIndex + 2).trim());
      } else {
        messages.push(processedText);
      }
    } else {
      messages.push(processedText);
    }

    return { messages, correction };
  }

  /**
   * Physically simulate the character typing a message in chat.
   * @param {object} bot - Mineflayer bot
   * @param {string} text - Message text.
   * @param {Function} [chatFn] - Function used to send chat messages.
   */
  static async typeAndSend(bot, text, chatFn = null) {
    if (!text) return;
    const send = chatFn || ((msg) => {
      if (typeof bot?.chat === 'function') bot.chat(String(msg));
    });

    const { messages, correction } = this.prepareMessages(text, bot);

    for (let m = 0; m < messages.length; m++) {
      const msg = messages[m];

      // 1. Stop moving physically: the player presses 'T' and types.
      if (bot && typeof bot.setControlState === 'function') {
        try {
          bot.setControlState('forward', false);
          bot.setControlState('sprint', false);
          // In 30% of cases, sneak while typing by holding Shift.
          if (HumanErrorEngine.chance(0.3, bot)) bot.setControlState('sneak', true);
        } catch (_) {}
      }

      // 2. Calculate a realistic typing delay (240–340 characters per minute).
      const cpm = Math.max(180, Math.min(380, Math.round(HumanErrorEngine.gaussian(260, 35))));
      const msPerChar = 60000 / cpm;
      const typingTimeMs = Math.max(250, Math.min(2200, Math.round(msg.length * msPerChar)));

      await new Promise(r => setTimeout(r, typingTimeMs));

      // 3. Send the message.
      send(msg);

      // Release Shift.
      if (bot && typeof bot.setControlState === 'function') {
        try { bot.setControlState('sneak', false); } catch (_) {}
      }

      // Pause between separate messages if the original was split.
      if (m < messages.length - 1) {
        const splitPause = Math.round(HumanErrorEngine.range(400, 700, bot));
        await new Promise(r => setTimeout(r, splitPause));
      }
    }

    // 4. If the typo should be corrected, send the correction after 600–1100 ms.
    if (correction) {
      const correctionDelay = Math.round(HumanErrorEngine.range(650, 1100, bot));
      await new Promise(r => setTimeout(r, correctionDelay));
      send(correction);
    }
  }
}
