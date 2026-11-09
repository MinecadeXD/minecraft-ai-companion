import { createLogger } from '../utils/logger.js';

const logger = createLogger('ACTION_COMMITMENT');

export class ActionCommitmentManager {
  /**
   * @param {Object} options
   * @param {string} options.agentName
   */
  constructor({ agentName }) {
    this.agentName = agentName;
    
    /** 
     * @type {{ type: string, description: string, startedAt: number, estimatedDuration: number, progress: number, priority: number } | null}
     */
    this.currentAction = null;
    
    /** @type {Array<Object>} */
    this.actionHistory = [];
    
    this.interruptCount = 0;
    this.pendingInterrupts = [];
    
    logger.info(`ActionCommitmentManager initialized for ${agentName}`);
  }

  /**
   * Commit to performing an action.
   * @param {Object} action
   * @param {string} action.type
   * @param {string} action.description
   * @param {number} action.estimatedDuration
   * @param {number} [action.priority=5]
   */
  commitTo(action) {
    if (this.currentAction) {
      this.interrupt('NEW_COMMITMENT');
    }
    
    this.currentAction = {
      ...action,
      priority: action.priority || 5,
      startedAt: Date.now(),
      progress: 0.0
    };
    
    logger.debug(`[${this.agentName}] Action started: ${this.currentAction.description} (priority: ${this.currentAction.priority})`);
  }

  /**
   * Check whether the current action can be interrupted.
   * @param {Object} newEvent
   * @param {number} newEvent.priority
   * @param {boolean} [newEvent.isEmergency=false]
   * @returns {boolean}
   */
  canInterrupt(newEvent) {
    if (!this.currentAction) return true;

    const isEmergency = Boolean(newEvent?.isEmergency || newEvent?.type === 'emergency' || (newEvent?.priority && newEvent.priority >= 9));

    // Emergency (health < 3, creeper, lava, fire) → ALWAYS interrupt
    if (isEmergency) return true;

    // Current action completed → interrupt (transition)
    if (this.currentAction.progress >= 1.0) return true;

    // Higher priority action (new priority > current priority + 2) → interrupt
    if (newEvent?.priority && newEvent.priority > this.currentAction.priority + 2) return true;

    const timeSinceStart = Date.now() - this.currentAction.startedAt;
    
    // If action started < 3 seconds ago → resist interrupt (anti-twitching)
    if (timeSinceStart < 3000) {
      return false;
    }

    return false;
  }

  /**
   * Forcefully interrupt the current action.
   * @param {string} reason
   */
  interrupt(reason) {
    if (!this.currentAction) return;

    this.interruptCount++;
    this._recordToHistory('INTERRUPTED', reason);
    
    logger.debug(`[${this.agentName}] Action interrupted: ${this.currentAction.description}. Reason: ${reason}`);
    this.currentAction = null;
  }

  /**
   * Complete the current action.
   * @param {string} outcome
   */
  complete(outcome) {
    if (!this.currentAction) return;

    this.currentAction.progress = 1.0;
    this._recordToHistory('COMPLETED', outcome);
    
    logger.debug(`[${this.agentName}] Action completed: ${this.currentAction.description}. Outcome: ${outcome}`);
    this.currentAction = null;
  }

  /**
   * Internal method for recording action history.
   * @private
   */
  _recordToHistory(status, reasonOrOutcome) {
    this.actionHistory.unshift({
      ...this.currentAction,
      status,
      detail: reasonOrOutcome,
      endedAt: Date.now()
    });

    // Keep only the 20 most recent entries.
    if (this.actionHistory.length > 20) {
      this.actionHistory.pop();
    }
  }

  /**
   * 0.0-1.0, how strongly committed
   * @returns {number}
   */
  getCommitmentStrength() {
    if (!this.currentAction) return 0.0;
    
    const timeSpent = Date.now() - this.currentAction.startedAt;
    const estDuration = this.currentAction.estimatedDuration || 10000;
    
    // Commitment grows the longer the action continues.
    let strength = Math.min(timeSpent / estDuration, 1.0);
    
    // Commitment is artificially high during the first 3 seconds to prevent twitchy interruptions.
    if (timeSpent < 3000) {
      strength = Math.max(strength, 0.8);
    }
    
    return strength;
  }

  /**
   * Return pending interruptions.
   * @returns {Array<Object>}
   */
  getPendingInterrupts() {
    return this.pendingInterrupts;
  }

  /**
   * Return the state used by the dashboard.
   * @returns {Object}
   */
  getState() {
    return {
      agentName: this.agentName,
      currentAction: this.currentAction,
      commitmentStrength: this.getCommitmentStrength(),
      interruptCount: this.interruptCount,
      historyLength: this.actionHistory.length
    };
  }
}
