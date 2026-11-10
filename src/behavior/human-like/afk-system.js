import { createLogger } from '../../utils/logger.js';
import { HumanErrorEngine } from '../human-error-engine.js';

const logger = createLogger('AFK_SYSTEM');

/**
 * Random AFK and break system.
 * Bots occasionally step away, just like real people.
 */
export class AFKSystem {
  constructor(profile, aiBrain = null) {
    this.profile = profile;
    this.aiBrain = aiBrain;

    // AFK status
    this.isAFK = false;
    this.afkStartTime = null;
    this.afkReason = null;
    this.plannedReturnTime = null;

    // AFK history for realism
    this.afkHistory = [];

    // Last AFK time
    this.lastAFKTime = Date.now();
  }

  /**
   * Check whether the bot should go AFK
   */
  async shouldGoAFK(context = {}) {
    const { tiredness, sessionDuration, boredom, lastAFKMinutesAgo } = context;

    // Do not go AFK if the bot has only just returned
    if (lastAFKMinutesAgo < 20) {
      return { shouldAFK: false, reason: 'recently_returned' };
    }

    // Base AFK probability
    let afkChance = 0.02; // 2% base chance (roughly once every 50 checks)

    // Fatigue increases the chance of going AFK
    if (tiredness > 0.8) {
      afkChance += 0.15;
    } else if (tiredness > 0.6) {
      afkChance += 0.08;
    }

    // Longer sessions increase the chance of stepping away
    const sessionHours = sessionDuration / 60;
    if (sessionHours > 2) {
      afkChance += 0.05 * (sessionHours - 2);
    }

    // Boredom increases the chance of stepping away
    if (boredom > 0.7) {
      afkChance += 0.08;
    }

    const shouldAFK = HumanErrorEngine.chance(afkChance, { stress: tiredness, fatigue: tiredness });

    if (shouldAFK) {
      const afkDetails = await this._planAFK(tiredness, sessionDuration);
      this._startAFK(afkDetails);
      return {
        shouldAFK: true,
        ...afkDetails
      };
    }

    return { shouldAFK: false };
  }

  /**
   * Plan AFK details
   */
  async _planAFK(tiredness, sessionDuration) {
    // AFK reason
    const reasons = this._getAFKReasons(tiredness, sessionDuration);
    const reason = HumanErrorEngine.choice(reasons);

    // AFK duration (minutes)
    let duration = this._getAFKDuration(reason, tiredness);

    // Whether to announce the reason
    const announceChance = this._getAnnounceChance(reason);
    const shouldAnnounce = HumanErrorEngine.chance(announceChance);

    // Message
    const message = shouldAnnounce ? await this._getAFKMessage(reason) : 'afk';

    return {
      reason,
      duration,
      shouldAnnounce,
      message
    };
  }

  /**
   * Return possible AFK reasons
   */
  _getAFKReasons(tiredness, sessionDuration) {
    const reasons = [
      'bathroom',
      'drink',
      'food',
      'phone',
      'door',
      'distraction',
      'stretch',
      'rest'
    ];
    
    // If very tired, increase the chance of taking a break
    if (tiredness > 0.8) {
      reasons.push('rest', 'rest', 'rest');
    }
    
    // Longer play sessions increase the chance of physical needs
    if (sessionDuration > 120) {
      reasons.push('bathroom', 'drink', 'food', 'stretch');
    }
    
    return reasons;
  }

  /**
   * Determine AFK duration
   */
  _getAFKDuration(reason, tiredness) {
    const durations = {
      'bathroom': [2, 5],      // 2–5 minutes
      'drink': [1, 3],         // 1–3 minutes
      'food': [5, 15],         // 5–15 minutes
      'phone': [3, 10],        // 3–10 minutes
      'door': [2, 5],          // 2–5 minutes
      'distraction': [5, 20],  // 5–20 minutes (got distracted by something)
      'stretch': [2, 5],       // 2–5 minutes
      'rest': [10, 30]         // 10–30 minutes
    };
    
    const [min, max] = durations[reason] || [2, 5];
    let duration = HumanErrorEngine.range(min, max);
    
    // Fatigue increases the duration
    if (tiredness > 0.8) {
      duration *= 1.5;
    }
    
    return Math.round(duration);
  }

  /**
   * Probability of announcing the AFK reason
   */
  _getAnnounceChance(reason) {
    // Some reasons are announced less often
    const announceChances = {
      'bathroom': 0.3,      // Rarely say "going to the restroom"
      'drink': 0.6,
      'food': 0.7,
      'phone': 0.5,
      'door': 0.8,          // Usually mention the door
      'distraction': 0.2,   // Rarely admit they got distracted
      'stretch': 0.4,
      'rest': 0.6
    };
    
    return announceChances[reason] || 0.5;
  }

  /**
   * Generate an AFK message in natural language through the LLM, without templates.
   */
  async _getAFKMessage(reason) {
    const situations = {
      bathroom: 'you need to step away to use the restroom',
      drink: 'you want to step away and get a drink',
      food: 'you're going to get something to eat',
      phone: 'you have a phone call / something came up on your phone',
      door: 'someone is here and the doorbell is ringing',
      distraction: 'something came up and distracted you',
      stretch: 'you want to stretch',
      rest: 'you're tired and want to take a break',
    };
    const situation = situations[reason] || 'you need to step away for a moment';

    if (this.aiBrain?.generateQuickResponse) {
      try {
        const name = this.profile?.name || 'you';
        const prompt = `You are ${name}, playing Minecraft with friends. You need to step away from your computer: ${situation}. Quickly send a short chat message in your own words (1–4 words), lowercase, without a period:`;
        const res = await this.aiBrain.generateQuickResponse(prompt, {
          maxTokens: 14,
          temperature: 0.95,
          timeoutMs: 900,
        });
        const text = res.text?.trim().replace(/^["'«»]+|["'«»]+$/g, '').trim();
        if (text && text.length >= 1) return text;
      } catch (_) {}
    }

    // "AFK" is a real term that people actually type; it is not a canned line.
    return 'afk';
  }

  /**
   * Start AFK
   */
  _startAFK(details) {
    this.isAFK = true;
    this.afkStartTime = Date.now();
    this.afkReason = details.reason;
    this.plannedReturnTime = Date.now() + details.duration * 60 * 1000;
    
    logger.info(`[${this.profile.name}] AFK: ${details.reason} for ${details.duration} minutes`);
    
    this.afkHistory.push({
      reason: details.reason,
      startTime: this.afkStartTime,
      plannedDuration: details.duration
    });
  }

  /**
   * Check whether the bot should return from AFK
   */
  checkReturn() {
    if (!this.isAFK) {
      return { shouldReturn: false };
    }
    
    const now = Date.now();
    
    // Check whether the bot has returned as scheduled
    if (now >= this.plannedReturnTime) {
      // Sometimes return later (20% chance)
      if (HumanErrorEngine.chance(0.2)) {
        // Stay away for an extra 2–10 minutes
        const extraDelay = HumanErrorEngine.range(2, 10) * 60 * 1000;
        this.plannedReturnTime = now + extraDelay;
        logger.debug(`[${this.profile.name}] Stayed AFK for another ${(extraDelay / 60000).toFixed(1)} minutes`);
        return { shouldReturn: false };
      }
      
      // Return
      return this._returnFromAFK();
    }
    
    // Sometimes return earlier (10% chance)
    const timeInAFK = (now - this.afkStartTime) / (60 * 1000);
    if (timeInAFK > 1 && HumanErrorEngine.chance(0.1)) {
      return this._returnFromAFK();
    }
    
    return { shouldReturn: false };
  }

  /**
   * Return from AFK
   */
  _returnFromAFK() {
    const afkDuration = (Date.now() - this.afkStartTime) / (60 * 1000);
    
    this.isAFK = false;
    this.lastAFKTime = Date.now();
    
    // Sometimes announce the return (50% chance)
    const shouldAnnounce = HumanErrorEngine.chance(0.5);
    const message = shouldAnnounce ? this._getReturnMessage(afkDuration) : null;
    
    logger.info(`[${this.profile.name}] Returned from AFK (was away for ${afkDuration.toFixed(1)} minutes)`);
    
    // Update history
    const lastAFK = this.afkHistory[this.afkHistory.length - 1];
    if (lastAFK) {
      lastAFK.actualDuration = afkDuration;
      lastAFK.endTime = Date.now();
    }
    
    // Clear old history (older than 24 hours)
    this.afkHistory = this.afkHistory.filter(a => 
      Date.now() - a.startTime < 24 * 60 * 60 * 1000
    );
    
    return {
      shouldReturn: true,
      shouldAnnounce,
      message,
      duration: afkDuration
    };
  }

  /**
   * Generate a return message
   */
  _getReturnMessage(duration) {
    if (duration > 20) {
      return HumanErrorEngine.choice(['I'm back', 'back', 'hey everyone, I'm back']);
    } else if (duration > 10) {
      return HumanErrorEngine.choice(['I'm back', 'back', 'I'm here']);
    } else {
      // Short AFK periods are less likely to include a return announcement
      return HumanErrorEngine.chance(0.3) ? 'back' : null;
    }
  }

  /**
   * Check whether the bot can perform actions (not AFK)
   */
  canAct() {
    return !this.isAFK;
  }

  /**
   * Get status
   */
  getStatus() {
    if (!this.isAFK) {
      return {
        isAFK: false,
        minutesSinceLastAFK: (Date.now() - this.lastAFKTime) / (60 * 1000)
      };
    }
    
    return {
      isAFK: true,
      reason: this.afkReason,
      minutesAFK: (Date.now() - this.afkStartTime) / (60 * 1000),
      plannedMinutesRemaining: Math.max(0, (this.plannedReturnTime - Date.now()) / (60 * 1000))
    };
  }

  /**
   * Force a return (for example, when called by a player)
   */
  forceReturn() {
    if (this.isAFK) {
      logger.info(`[${this.profile.name}] Forced return from AFK`);
      return this._returnFromAFK();
    }
    return { shouldReturn: false };
  }
}
