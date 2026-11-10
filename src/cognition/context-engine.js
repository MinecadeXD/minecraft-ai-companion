import logger from '../utils/logger.js';

export class PersonalContextEngine {
  constructor() {
    this.playerActivity = 'idle';
    this.botActivity = 'idle';
    this.activeGoal = null;
    this.activeSubGoals = [];
    this.currentLocation = { name: 'Unknown', coords: null, biome: 'unknown' };
    this.moodState = {
      curiosity: 0.5,
      confidence: 0.7,
      caution: 0.4,
      stress: 0.1,
      satisfaction: 0.5,
      frustration: 0.0,
      excitement: 0.3,
      trust: 0.8,
    };
    this.immediateThreats = [];
    this.recentDialogue = [];
    this.recentEvents = [];
    this.recentMistakes = [];
    this.pendingActions = [];
    this.deferredIntentions = [];
  }

  /**
   * Update the personal context with latest state.
   */
  updateContext({
    playerActivity,
    botActivity,
    worldState,
    activeGoal,
    moodUpdate,
  } = {}) {
    if (playerActivity) this.playerActivity = playerActivity;
    if (botActivity) this.botActivity = botActivity;
    if (activeGoal !== undefined) this.activeGoal = activeGoal;
    if (moodUpdate) Object.assign(this.moodState, moodUpdate);

    if (worldState) {
      this.currentLocation = {
        coords: worldState.position,
        biome: worldState.biome || 'unknown',
        timeOfDay: worldState.timeOfDay,
        isRaining: worldState.isRaining,
      };

      // Filter immediate threats (hostiles within 12 blocks)
      const nearby = worldState.nearbyEntities || [];
      const hostileNames = ['zombie', 'skeleton', 'creeper', 'spider', 'witch', 'enderman', 'drowned', 'pillager'];
      this.immediateThreats = nearby.filter(e => hostileNames.includes(e.name) && e.distance <= 12);
    }
  }

  /**
   * Log a dialogue turn.
   */
  addDialogue(speaker, message) {
    this.recentDialogue.push({
      speaker,
      message,
      timestamp: Date.now(),
    });
    if (this.recentDialogue.length > 8) {
      this.recentDialogue.shift();
    }
  }

  /**
   * Record a recent event.
   */
  addEvent(eventDesc) {
    this.recentEvents.push({
      desc: eventDesc,
      timestamp: Date.now(),
    });
    if (this.recentEvents.length > 15) {
      this.recentEvents.shift();
    }
  }

  /**
   * Record a mistake / failure.
   */
  addMistake(action, error, lesson = null) {
    this.recentMistakes.push({
      action,
      error,
      lesson,
      timestamp: Date.now(),
    });
    if (this.recentMistakes.length > 5) {
      this.recentMistakes.shift();
    }
  }

  /**
   * Add a deferred intention ("task in head" to do later).
   */
  addDeferredIntention(intention, triggerCondition = 'idle') {
    this.deferredIntentions.push({
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      intention,
      triggerCondition,
      createdAt: Date.now(),
    });
  }

  /**
   * Remove a completed deferred intention.
   */
  completeDeferredIntention(id) {
    this.deferredIntentions = this.deferredIntentions.filter(i => i.id !== id);
  }

  /**
   * Generate a comprehensive, human-like situation summary for LLM context.
   */
  getSituationSummary() {
    const threats = this.immediateThreats.length > 0
      ? `Nearby threats: ${this.immediateThreats.map(t => `${t.name} (${Math.round(t.distance)} m)`).join(', ')}`
      : 'No nearby threats';

    const recentChat = this.recentDialogue.length > 0
      ? `Recent conversation:\n${this.recentDialogue.map(d => `[${d.speaker}]: ${d.message}`).join('\n')}`
      : 'Conversation has not started yet';

    const deferred = this.deferredIntentions.length > 0
      ? `Deferred intentions: ${this.deferredIntentions.map(i => i.intention).join('; ')}`
      : 'No deferred tasks';

    return {
      playerActivity: this.playerActivity,
      botActivity: this.botActivity,
      activeGoal: this.activeGoal || 'no active goal',
      threats,
      mood: this.moodState,
      recentChat,
      deferred,
      recentEvents: this.recentEvents.slice(-5).map(e => e.desc),
      recentMistakes: this.recentMistakes.slice(-3),
    };
  }
}

export const personalContext = new PersonalContextEngine();
