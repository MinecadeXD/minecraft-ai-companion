import { createLogger } from '../../utils/logger.js';
import { HumanErrorEngine } from '../human-error-engine.js';

const logger = createLogger('PROBABILISTIC_REACTIONS');

/**
 * Probabilistic reaction system for in-game events.
 * Bots do not always react to events, just like real people.
 */
export class ProbabilisticReactions {
  constructor(profile) {
    this.profile = profile;
    this.pendingMentions = []; // Delayed mentions
  }

  /**
   * Determine whether the bot should react to an event
   * @param {string} eventType - event type
   * @param {Object} eventData - event data
   * @param {Object} context - context (mood, fatigue, etc.)
   * @returns {Object} { shouldReact: boolean, reactionType: 'immediate'|'delayed'|'silent', delayMinutes?: number }
   */
  shouldReactToEvent(eventType, eventData, context = {}) {
    const { mood, talkativeness, busy, recentlySpokeAbout } = context;
    
    // Base probabilities for different events
    const baseProbabilities = {
      // Discoveries
      'found_diamonds': { immediate: 0.3, delayed: 0.4, silent: 0.3 },
      'found_iron': { immediate: 0.1, delayed: 0.2, silent: 0.7 },
      'found_gold': { immediate: 0.15, delayed: 0.3, silent: 0.55 },
      'found_ancient_debris': { immediate: 0.6, delayed: 0.3, silent: 0.1 },
      'found_village': { immediate: 0.5, delayed: 0.3, silent: 0.2 },
      'found_stronghold': { immediate: 0.7, delayed: 0.2, silent: 0.1 },
      'found_dungeon': { immediate: 0.4, delayed: 0.3, silent: 0.3 },
      
      // Dangers
      'under_attack': { immediate: 0.7, delayed: 0.2, silent: 0.1 },
      'low_health': { immediate: 0.5, delayed: 0.3, silent: 0.2 },
      'nearly_died': { immediate: 0.8, delayed: 0.15, silent: 0.05 },
      'killed_mob': { immediate: 0.1, delayed: 0.1, silent: 0.8 },
      
      // Achievements
      'crafted_important': { immediate: 0.2, delayed: 0.3, silent: 0.5 },
      'built_something': { immediate: 0.3, delayed: 0.4, silent: 0.3 },
      'leveled_up': { immediate: 0.15, delayed: 0.25, silent: 0.6 },
      
      // Environment
      'nightfall': { immediate: 0.1, delayed: 0.1, silent: 0.8 },
      'weather_change': { immediate: 0.05, delayed: 0.1, silent: 0.85 },
      
      // Miscellaneous
      'inventory_full': { immediate: 0.4, delayed: 0.2, silent: 0.4 },
      'tool_broke': { immediate: 0.6, delayed: 0.2, silent: 0.2 },
      'got_lost': { immediate: 0.5, delayed: 0.3, silent: 0.2 },
    };

    const probs = baseProbabilities[eventType] || { immediate: 0.3, delayed: 0.3, silent: 0.4 };
    
    // Probability modifiers
    let immediateProb = probs.immediate;
    let delayedProb = probs.delayed;
    let silentProb = probs.silent;
    
    // Talkativeness increases the chance of reacting
    const talkMod = (talkativeness || 0.5) - 0.5; // -0.5 to +0.5
    immediateProb += talkMod * 0.2;
    delayedProb += talkMod * 0.1;
    silentProb -= talkMod * 0.3;
    
    // Mood has an effect
    if (mood === 'excited' || mood === 'happy') {
      immediateProb += 0.15;
      silentProb -= 0.15;
    } else if (mood === 'tired' || mood === 'bored') {
      immediateProb -= 0.2;
      silentProb += 0.2;
    } else if (mood === 'scared' || mood === 'stressed') {
      immediateProb += 0.1; // More emotional
    }
    
    // If busy, react less often
    if (busy) {
      immediateProb -= 0.2;
      silentProb += 0.2;
    }
    
    // If this was discussed recently, stay quiet
    if (recentlySpokeAbout?.includes(eventType)) {
      silentProb += 0.3;
      immediateProb -= 0.2;
      delayedProb -= 0.1;
    }
    
    // Normalize probabilities
    const total = immediateProb + delayedProb + silentProb;
    immediateProb /= total;
    delayedProb /= total;
    silentProb /= total;
    
    // Choose a reaction through HumanErrorEngine
    const outcome = HumanErrorEngine.weightedChoice([
      { type: 'immediate', weight: immediateProb },
      { type: 'delayed', weight: delayedProb },
      { type: 'silent', weight: silentProb }
    ], item => item.weight);

    if (outcome?.type === 'immediate') {
      return { shouldReact: true, reactionType: 'immediate' };
    } else if (outcome?.type === 'delayed') {
      // Delayed reaction — wait for a random interval
      const delayMinutes = this._getDelayTime(eventType);
      this._scheduleDelayedMention(eventType, eventData, delayMinutes);
      return { shouldReact: false, reactionType: 'delayed', delayMinutes };
    } else {
      return { shouldReact: false, reactionType: 'silent' };
    }
  }

  /**
   * Determine the delay before a deferred mention
   */
  _getDelayTime(eventType) {
    // Mention important events sooner
    const urgentEvents = ['found_diamonds', 'found_ancient_debris', 'nearly_died', 'found_stronghold'];
    
    if (urgentEvents.includes(eventType)) {
      return HumanErrorEngine.range(5, 20); // 5–20 minutes
    } else {
      return HumanErrorEngine.range(15, 60); // 15–60 minutes
    }
  }

  /**
   * Schedule a delayed mention
   */
  _scheduleDelayedMention(eventType, eventData, delayMinutes) {
    const mention = {
      eventType,
      eventData,
      scheduledFor: Date.now() + delayMinutes * 60 * 1000,
      mentioned: false
    };
    
    this.pendingMentions.push(mention);
    
    logger.debug(`[${this.profile.name}] Scheduled a delayed mention of ${eventType} in ${delayMinutes.toFixed(1)} minutes`);
  }

  /**
   * Check whether any events are ready to be mentioned
   * @returns {Object|null} event ready to be mentioned
   */
  checkPendingMentions() {
    const now = Date.now();
    
    // Find an event ready to be mentioned
    for (let i = 0; i < this.pendingMentions.length; i++) {
      const mention = this.pendingMentions[i];
      
      if (!mention.mentioned && mention.scheduledFor <= now) {
        // Chance of mentioning it now or delaying it again
        if (HumanErrorEngine.chance(0.7)) { // 70% chance of mentioning it
          mention.mentioned = true;
          return mention;
        } else {
          // Delay it by another 5–15 minutes
          mention.scheduledFor = now + HumanErrorEngine.range(5, 15) * 60 * 1000;
        }
      }
    }
    
    // Clear old mentions (older than 2 hours)
    this.pendingMentions = this.pendingMentions.filter(m => 
      !m.mentioned && (now - m.scheduledFor < 2 * 60 * 60 * 1000)
    );
    
    return null;
  }

  /**
   * Generate text for a delayed mention
   * @param {Object} mention - mention object
   * @returns {string} prompt for generating a message
   */
  generateDelayedMentionPrompt(mention) {
    const { eventType, eventData } = mention;
    const timePassed = ((Date.now() - mention.scheduledFor) / (60 * 1000)).toFixed(0);
    
    let eventDescription = '';
    
    switch (eventType) {
      case 'found_diamonds':
        eventDescription = `found ${eventData.count || 3} diamonds`;
        break;
      case 'found_iron':
        eventDescription = `found some iron`;
        break;
      case 'found_village':
        eventDescription = `found a village`;
        break;
      case 'nearly_died':
        eventDescription = `almost died because of ${eventData.cause || 'a mob'}`;
        break;
      case 'built_something':
        eventDescription = `built ${eventData.what || 'something'}`;
        break;
      default:
        eventDescription = `something happened`;
    }
    
    return `You just remembered that you ${eventDescription} a while ago. Mention it casually, as if it had just come back to you. Use 1–2 natural sentences:`;
  }
}
