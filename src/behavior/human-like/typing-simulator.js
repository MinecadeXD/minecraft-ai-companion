import { createLogger } from '../../utils/logger.js';
import { HumanErrorEngine } from '../human-error-engine.js';

const logger = createLogger('TYPING_SIMULATOR');

/**
 * Human typing simulator with typos, corrections, and distractions.
 */
export class TypingSimulator {
  constructor(profile) {
    this.profile = profile;
    
    // Typing speed for each bot (characters per minute)
    this.typingSpeed = this._getTypingSpeed(profile.name);
    
    // Typo probability
    this.typoChance = this._getTypoChance(profile);
    
    // Distraction probability
    this.distractionChance = 0.05; // 5% chance of getting distracted
  }

  /**
   * Determine the typing speed for a character
   */
  _getTypingSpeed(name) {
    const speeds = {
      Sam: 250,      // Average speed
      Max: 300,      // Fast
      Jack: 180,     // Slow but energetic
      Ryan: 220,     // Moderately slow
      Alex: 240,     // Average
      Leo: 200       // Moderately slow
    };
    
    return speeds[name] || 240;
  }

  /**
   * Determine the typo probability for a character
   */
  _getTypoChance(profile) {
    const baseChance = 0.03; // 3% base chance
    
    // Jack types quickly and carelessly, so he makes more typos
    if (profile.name === 'Jack') return 0.08;
    
    // Max is careful and makes fewer typos
    if (profile.name === 'Max') return 0.01;
    
    return baseChance;
  }

  /**
   * Process a message before sending it
   * @param {string} message - original message
   * @returns {Object} { finalMessage: string, delay: number, interrupted: boolean }
   */
  async processMessage(message) {
    // Check for distraction
    if (HumanErrorEngine.chance(this.distractionChance, this.profile)) {
      // Got distracted — do not send the message
      logger.debug(`[${this.profile.name}] Got distracted; message was not sent`);
      return { finalMessage: null, delay: 0, interrupted: true };
    }

    // Add typos
    let finalMessage = this._addTypos(message);
    
    // Sometimes correct typos
    if (finalMessage !== message && HumanErrorEngine.chance(0.6, this.profile)) {
      finalMessage = this._addCorrection(message, finalMessage);
    }

    // Calculate typing delay
    const delay = this._calculateTypingDelay(finalMessage);

    return { finalMessage, delay, interrupted: false };
  }

  /**
   * Add typos to text
   */
  _addTypos(text) {
    if (text.length < 5) return text; // Short messages are not given typos
    
    let result = text;
    const words = text.split(' ');
    
    // Check each word
    for (let i = 0; i < words.length; i++) {
      if (HumanErrorEngine.chance(this.typoChance, this.profile) && words[i].length > 3) {
        words[i] = this._makeTypo(words[i]);
      }
    }
    
    return words.join(' ');
  }

  /**
   * Create a typo in a word
   */
  _makeTypo(word) {
    if (word.length < 3) return word;
    
    const typoTypes = [
      'swap',      // Swap adjacent letters
      'duplicate', // Duplicate a letter
      'skip',      // Skip a letter
      'wrong'      // Wrong letter (an adjacent key on the keyboard)
    ];
    
    const type = HumanErrorEngine.choice(typoTypes);
    const chars = word.split('');
    const pos = Math.floor(HumanErrorEngine.range(1, chars.length - 1.01)); // Not the first or last character
    
    switch (type) {
      case 'swap':
        if (pos < chars.length - 1) {
          [chars[pos], chars[pos + 1]] = [chars[pos + 1], chars[pos]];
        }
        break;
      
      case 'duplicate':
        chars.splice(pos, 0, chars[pos]);
        break;
      
      case 'skip':
        chars.splice(pos, 1);
        break;
      
      case 'wrong':
        chars[pos] = this._getNeighborKey(chars[pos]);
        break;
    }
    
    return chars.join('');
  }

  /**
   * Return an adjacent keyboard key
   */
  _getNeighborKey(char) {
    const enKeyboard = {
      q: ['w', 'a'],
      w: ['q', 'e', 'a', 's'],
      e: ['w', 'r', 's', 'd'],
      r: ['e', 't', 'd', 'f'],
      t: ['r', 'y', 'f', 'g'],
      y: ['t', 'u', 'g', 'h'],
      u: ['y', 'i', 'h', 'j'],
      i: ['u', 'o', 'j', 'k'],
      o: ['i', 'p', 'k', 'l'],
      p: ['o', 'l'],
      a: ['q', 'w', 's', 'z'],
      s: ['w', 'e', 'a', 'd', 'z', 'x'],
      d: ['e', 'r', 's', 'f', 'x', 'c'],
      f: ['r', 't', 'd', 'g', 'c', 'v'],
      g: ['t', 'y', 'f', 'h', 'v', 'b'],
      h: ['y', 'u', 'g', 'j', 'b', 'n'],
      j: ['u', 'i', 'h', 'k', 'n', 'm'],
      k: ['i', 'o', 'j', 'l', 'm'],
      l: ['o', 'p', 'k'],
      z: ['a', 's', 'x'],
      x: ['z', 's', 'd', 'c'],
      c: ['x', 'd', 'f', 'v'],
      v: ['c', 'f', 'g', 'b'],
      b: ['v', 'g', 'h', 'n'],
      n: ['b', 'h', 'j', 'm'],
      m: ['n', 'j', 'k']
    };
    
    const neighbors = enKeyboard[char.toLowerCase()];
    if (neighbors && neighbors.length > 0) {
      return HumanErrorEngine.choice(neighbors);
    }
    
    return char;
  }

  /**
   * Add a typo correction
   */
  _addCorrection(original, typo) {
    // Correction options:
    // 1. "*correct word" (most common, 60%)
    // 2. "typo* correct" (20%)
    // 3. Leave the typo as-is (20%)
    
    if (HumanErrorEngine.chance(0.6, this.profile)) {
      // Correction using *
      return `${typo}\n*${original}`;
    } else if (HumanErrorEngine.chance(0.5, this.profile)) {
      // Just the corrected version
      return original;
    } else {
      // Leave it with the typo
      return typo;
    }
  }

  /**
   * Calculate typing delay
   */
  _calculateTypingDelay(message) {
    const charsPerMinute = this.typingSpeed;
    const charsPerMs = charsPerMinute / 60000;
    
    // Base delay
    let delay = message.length / charsPerMs;
    
    // Add random variation of ±30%
    const variation = 0.3;
    delay = delay * (1 + HumanErrorEngine.jitter(variation, this.profile));
    
    // Minimum 500 ms, maximum 10 seconds
    delay = Math.max(500, Math.min(10000, delay));
    
    // Add "thinking time" before sending
    const thinkTime = HumanErrorEngine.range(200, 1000, this.profile); // 200–1000 ms
    
    return Math.round(delay + thinkTime);
  }

  /**
   * Simulate starting to type and possibly stopping
   * @returns {boolean} true if typing started, false if the agent changed its mind
   */
  startTyping() {
    // 10% chance of starting to type and then changing their mind
    return !HumanErrorEngine.chance(0.1, this.profile);
  }

  /**
   * Return the typing indicator (for displaying "typing...")
   */
  getTypingIndicatorDuration(messageLength) {
    // Show "typing..." for the duration of the actual typing
    return this._calculateTypingDelay('x'.repeat(messageLength));
  }
}
