import { createLogger } from '../utils/logger.js';

const logger = createLogger('SOCIAL_GRAPH');

export class SocialGraph {
  /**
   * @param {Object} options
   * @param {string[]} options.agents
   * @param {string} options.humanPlayer
   */
  constructor({ agents, humanPlayer }) {
    this.entities = [...agents, humanPlayer];
    this.humanPlayer = humanPlayer;
    this.graph = new Map(); // Map<from, Map<to, Relationship>>

    // Initialize the directed graph
    for (const from of this.entities) {
      this.graph.set(from, new Map());
      for (const to of this.entities) {
        if (from !== to) {
          this.graph.get(from).set(to, this._createDefaultRelationship());
        }
      }
    }
    
    logger.info(`Social graph initialized for ${this.entities.length} entities.`);
  }

  _createDefaultRelationship() {
    return {
      trust: 0.5,           // 0.0-1.0
      familiarity: 0.1,     // 0.0-1.0
      friendship: 0.3,      // 0.0-1.0
      respect: 0.5,         // 0.0-1.0
      irritation: 0.0,      // 0.0-1.0
      gratitude: 0.0,       // 0.0-1.0
      cooperationTendency: 0.5, // 0.0-1.0
      humorCompatibility: 0.5,  // 0.0-1.0
      lastInteraction: null,     // timestamp
      interactionCount: 0,       // total interactions
      sharedHistory: [],         // last 30 significant events
    };
  }

  /**
   * Get the relationship from one entity to another
   * @param {string} from 
   * @param {string} to 
   * @returns {Object|null}
   */
  getRelationship(from, to) {
    if (!this.graph.has(from)) return null;
    const relationship = this.graph.get(from).get(to);
    return relationship ? JSON.parse(JSON.stringify(relationship)) : null;
  }

  /**
   * Update relationship parameters (clamped between 0 and 1)
   * @param {string} from 
   * @param {string} to 
   * @param {Object} changes 
   * @param {boolean} [isDelta=false]
   */
  updateRelationship(from, to, changes, isDelta = false) {
    const rel = this.graph.get(from)?.get(to);
    if (!rel) return;

    for (const [key, value] of Object.entries(changes)) {
      if (typeof rel[key] === 'number' && key !== 'interactionCount' && key !== 'lastInteraction') {
        if (isDelta) {
          rel[key] = Math.max(0, Math.min(1, rel[key] + value));
        } else {
          rel[key] = Math.max(0, Math.min(1, value));
        }
      } else {
        rel[key] = value;
      }
    }
  }

  /** Apply only a validated, already-computed delta from the company updater. */
  applyProvenancedDelta({ from, to, changes, event, provenance } = {}) {
    if (!provenance || !['chat_observed', 'chat_send_accepted'].includes(provenance.source) || typeof provenance.eventId !== 'string' || !provenance.eventId || !Number.isSafeInteger(provenance.generation) || !Number.isFinite(event?.timestamp)) return false;
    const rel = this.graph.get(from)?.get(to);
    if (!rel || !changes || typeof changes !== 'object') return false;
    const allowed = new Set(['trust', 'familiarity', 'friendship', 'respect', 'irritation', 'gratitude', 'cooperationTendency', 'humorCompatibility']);
    for (const [key, value] of Object.entries(changes)) {
      if (!allowed.has(key) || !Number.isFinite(value) || Math.abs(value) > 0.05) return false;
    }
    this.updateRelationship(from, to, changes, true);
    rel.lastInteraction = Number.isFinite(event?.timestamp) ? event.timestamp : Date.now();
    rel.interactionCount += 1;
    rel.sharedHistory.push({ timestamp: rel.lastInteraction, type: event?.type || 'social_observation', description: event?.description || '', impact: event?.impact || 0, provenance: { ...provenance } });
    if (rel.sharedHistory.length > 30) rel.sharedHistory.shift();
    return true;
  }

  applyProvenancedBatch({ deltas = [], provenance } = {}) {
    if (!Array.isArray(deltas) || !deltas.length) return false;
    const snapshots = deltas.map(({ from, to }) => ({ rel: this.graph.get(from)?.get(to), copy: this.graph.get(from)?.get(to) && JSON.parse(JSON.stringify(this.graph.get(from).get(to))) }));
    if (deltas.some((delta) => !this.applyProvenancedDelta({ ...delta, provenance }))) {
      snapshots.forEach(({ rel, copy }) => { if (rel && copy) Object.assign(rel, copy); });
      return false;
    }
    return true;
  }

  /**
   * Record an event and automatically update metrics
   * @param {string} from 
   * @param {string} to 
   * @param {string|Object} event 
   */
  recordEvent(from, to, event) {
    const rel = this.graph.get(from)?.get(to);
    if (!rel) return;

    const eventType = typeof event === 'string' ? event : event?.type;
    const eventDesc = typeof event === 'object' ? event?.description : null;
    const eventImpact = typeof event === 'object' ? event?.impact : null;

    rel.lastInteraction = Date.now();
    rel.interactionCount += 1;

    let changes = {};
    let impact = 0;
    let description = '';

    switch (eventType) {
      case 'helped_in_combat':
        changes = { trust: 0.1, friendship: 0.05, gratitude: 0.15 };
        impact = 0.3;
        description = eventDesc || 'Helped in combat';
        break;
      case 'shared_resources':
        changes = { trust: 0.05, friendship: 0.05, gratitude: 0.1 };
        impact = 0.2;
        description = eventDesc || 'Shared resources';
        break;
      case 'took_items_without_asking':
        changes = { trust: -0.15, irritation: 0.2 };
        impact = -0.3;
        description = eventDesc || 'Took items without asking';
        break;
      case 'saved_from_death':
        changes = { trust: 0.2, friendship: 0.1, gratitude: 0.3 };
        impact = 0.6;
        description = eventDesc || 'Saved someone from death';
        break;
      case 'ignored_help_request':
        changes = { trust: -0.1, irritation: 0.1 };
        impact = -0.2;
        description = eventDesc || 'Ignored a request for help';
        break;
      case 'completed_task_together':
        changes = { trust: 0.05, familiarity: 0.1, cooperationTendency: 0.05 };
        impact = 0.2;
        description = eventDesc || 'Completed a task together';
        break;
      case 'made_joke':
        changes = { humorCompatibility: 0.05, friendship: 0.02 };
        impact = 0.1;
        description = eventDesc || 'Made a joke';
        break;
      case 'had_conflict':
        changes = { trust: -0.1, irritation: 0.15 };
        impact = -0.25;
        description = eventDesc || 'Had a conflict';
        break;
      case 'apologized':
        changes = { irritation: -0.2, trust: 0.05 };
        impact = 0.25;
        description = eventDesc || 'Apologized';
        break;
      case 'long_time_together':
        changes = { familiarity: 0.05 };
        impact = 0.05;
        description = eventDesc || 'Spent a long time together';
        break;
      default:
        description = eventDesc || eventType || 'Interaction';
        break;
    }

    this.updateRelationship(from, to, changes, true);

    rel.sharedHistory.push({
      timestamp: Date.now(),
      type: eventType,
      description,
      impact: eventImpact || impact
    });

    if (rel.sharedHistory.length > 30) {
      rel.sharedHistory.shift();
    }
  }

  /**
   * Find the best friend for a given agent
   * @param {string} agentName 
   * @returns {string|null}
   */
  getClosestAlly(agentName) {
    return this._getHighestMetric(agentName, 'friendship');
  }

  /**
   * Find the person the agent trusts most
   * @param {string} agentName 
   * @returns {string|null}
   */
  getMostTrusted(agentName) {
    return this._getHighestMetric(agentName, 'trust');
  }

  /**
   * Find the person who irritates the agent most
   * @param {string} agentName 
   * @returns {string|null}
   */
  getMostIrritating(agentName) {
    return this._getHighestMetric(agentName, 'irritation');
  }

  _getHighestMetric(agentName, metric) {
    const relationships = this.graph.get(agentName);
    if (!relationships) return null;

    let highestVal = -1;
    let target = null;

    for (const [to, rel] of relationships.entries()) {
      if (rel[metric] > highestVal) {
        highestVal = rel[metric];
        target = to;
      }
    }
    return target;
  }

  /**
   * Evaluate group compatibility from 0.0 to 1.0
   * @param {string[]} agents 
   * @returns {number}
   */
  getGroupCompatibility(agents) {
    if (agents.length < 2) return 1.0;
    
    let totalScore = 0;
    let pairs = 0;

    for (let i = 0; i < agents.length; i++) {
      for (let j = 0; j < agents.length; j++) {
        if (i === j) continue;
        const rel = this.getRelationship(agents[i], agents[j]);
        if (rel) {
          // Calculate the baseline compatibility of a pair
          const pairScore = (rel.trust + rel.cooperationTendency + rel.friendship + (1 - rel.irritation)) / 4;
          totalScore += pairScore;
          pairs++;
        }
      }
    }

    return pairs > 0 ? totalScore / pairs : 0;
  }

  /**
   * Gradually reduce irritation
   * @param {number} rate 
   */
  decayIrritation(rate) {
    for (const fromMap of this.graph.values()) {
      for (const rel of fromMap.values()) {
        if (rel.irritation > 0) {
          rel.irritation = Math.max(0, rel.irritation - rate);
        }
      }
    }
  }

  /**
   * Gradually reduce gratitude
   * @param {number} rate 
   */
  decayGratitude(rate) {
    for (const fromMap of this.graph.values()) {
      for (const rel of fromMap.values()) {
        if (rel.gratitude > 0) {
          rel.gratitude = Math.max(0, rel.gratitude - rate);
        }
      }
    }
  }

  /**
   * Get a readable description of a relationship
   * @param {string} from 
   * @param {string} to 
   * @returns {string}
   */
  getRelationshipSummary(from, to) {
    const rel = this.getRelationship(from, to);
    if (!rel) return 'Not acquainted';

    let summary = [];
    
    if (rel.friendship > 0.8) summary.push('best friend');
    else if (rel.friendship > 0.6) summary.push('good friend');
    else if (rel.friendship > 0.4) summary.push('acquaintance');
    
    if (rel.trust > 0.8) summary.push('fully trusts');
    else if (rel.trust < 0.3) summary.push('does not trust');

    if (rel.irritation > 0.7) summary.push('highly irritated');
    else if (rel.irritation > 0.4) summary.push('dislikes');

    if (rel.gratitude > 0.6) summary.push('very grateful');

    if (summary.length === 0) return 'neutral relationship';

    return summary.join(', ');
  }

  /**
   * Get the state for persistence / dashboard display
   * @returns {Object}
   */
  getState() {
    const state = {};
    for (const [from, toMap] of this.graph.entries()) {
      state[from] = {};
      for (const [to, rel] of toMap.entries()) {
        state[from][to] = { ...rel };
      }
    }
    return JSON.parse(JSON.stringify(state));
  }
}
