import { createLogger } from '../utils/logger.js';

const logger = createLogger('FAST_PLAYER_INTENT');

export const PlayerIntents = {
  STOP: 'STOP',
  FOLLOW: 'FOLLOW',
  WAIT: 'WAIT',
  COME_HERE: 'COME_HERE',
  HELP: 'HELP',
  WHERE_ARE_YOU: 'WHERE_ARE_YOU',
  CALL_NAME: 'CALL_NAME',
  NONE: 'NONE',
};

// Gameplay and speech are separate decisions.  The fast path reports what
// happened to the action; callers may decide later whether a human response
// is appropriate.
export const FastIntentStatus = Object.freeze({
  UNRECOGNIZED: 'unrecognized',
  REJECTED: 'rejected',
  ACCEPTED: 'accepted',
  COMPLETED: 'completed',
  NOOP: 'noop',
  FAILED: 'failed',
});

export const ResponseDisposition = Object.freeze({
  NONE: 'none',
  IMMEDIATE: 'immediate',
  DEFERRED: 'deferred',
});

// ACKNOWLEDGEMENTS removed - responses are now generated dynamically via HumanBehaviorController
// This eliminates robotic template phrases and creates unique, context-aware responses

/**
 * FastPlayerIntentRouter — instant recognition of basic player commands
 * and their direct local execution without waiting for the LLM.
 */
export class FastPlayerIntentRouter {
  static isGameplayMutation(intent) {
    return [
      PlayerIntents.STOP,
      PlayerIntents.WAIT,
      PlayerIntents.FOLLOW,
      PlayerIntents.COME_HERE,
      PlayerIntents.HELP,
    ].includes(intent);
  }

  /**
   * Classify intent from text
   * @param {string} content
   * @returns {string} PlayerIntents enum
   */
  static classifyIntent(content) {
    const raw = content.toLowerCase().trim();
    // Remove punctuation
    const clean = raw.replace(/[.,!?;:()]/g, ' ').replace(/\s+/g, ' ').trim();
    const words = clean.split(' ');
    const hasStem = (...stems) => words.some((word) => stems.some((stem) => word.startsWith(stem)));
    const isQuestion = /\?|^(where|why|when|who|what|how|which)\b/.test(raw);

    // 0. WHERE ARE YOU
    if (
      clean.includes('where are you') ||
      clean.includes('where you at') ||
      clean.includes('where are you now') ||
      clean.includes('where are you located') ||
      clean.includes('where have you been')
    ) {
      return PlayerIntents.WHERE_ARE_YOU;
    }

    // 1. STOP
    if (
      hasStem('stop', 'halt', 'freeze', 'cancel') ||
      clean.includes("don't move") || clean.includes('do not move') || clean.includes('stay still') ||
      clean.includes("that's enough") || clean.includes('stand still')
    ) {
      return PlayerIntents.STOP;
    }

    // 2. WAIT
    if (hasStem('wait', 'hold', 'pause') || words.includes('sec') || words.includes('second') || words.includes('minute')) {
      return PlayerIntents.WAIT;
    }

    // 3. COME HERE
    if (
      clean.includes('come here') ||
      clean.includes('come to me') ||
      clean.includes('get over here') ||
      clean.includes('come over') ||
      clean.includes('approach me') ||
      clean.includes('gather here') ||
      clean.includes('return to me') ||
      clean.includes('stay close') ||
      hasStem('approach', 'gather')
    ) {
      return PlayerIntents.COME_HERE;
    }

    // 4. FOLLOW
    if (
      clean.includes('follow me') ||
      clean.includes('come with me') ||
      clean.includes("let's go") ||
      clean.includes('keep up') ||
      clean.includes('stay with me') ||
      clean.includes('move forward') ||
      clean.includes('move out') ||
      clean.includes('go ahead') ||
      clean.includes('continue') ||
      (!isQuestion && (
        hasStem('follow', 'proceed', 'continue', 'move') || words.includes('forward')
      ))
    ) {
      return PlayerIntents.FOLLOW;
    }

    // 5. HELP
    if (
      clean.includes('help me') || clean.includes('need help') || clean.includes('come help') ||
      hasStem('help', 'assist', 'rescue') || words.includes('help')
    ) {
      return PlayerIntents.HELP;
    }

    // 6. CALL NAME (Just calling the bot)
    const nameAliases = [
      'sam', 'sammy', 'hey sam',
      'max', 'maxim', 'hey max',
      'jack', 'jackie', 'hey jack',
      'ryan', 'hey ryan',
      'alex', 'hey alex',
      'leo', 'leon', 'hey leo',
      'guys', 'everyone', 'team',
    ];
    if (nameAliases.includes(clean) || (clean.startsWith('hey ') && words.length <= 2)) {
      return PlayerIntents.CALL_NAME;
    }

    return PlayerIntents.NONE;
  }

  /**
   * Get an acknowledgement phrase in the character's style
   * DEPRECATED: Now handled by HumanBehaviorController for dynamic, natural responses
   * This method is kept for backward compatibility but should return null
   * to signal that response generation should be delegated to HumanBehaviorController
   * @param {string} agentName
   * @param {string} intent
   * @returns {null}
   */
  static getAcknowledgement(agentName, intent) {
    // Response generation is now handled by HumanBehaviorController
    // Return null to signal that dynamic generation is needed
    return null;
  }

  /**
   * Execute a command locally on the bot immediately
   * @param {Object} options
   * @param {Object} [options.agentInstance]
   * @param {Object} [options.movementController]
   * @param {Object} [options.bot]
   * @param {string} options.intent
   * @param {string} options.playerUsername
   * @returns {Promise<{ executed: boolean, ack: string }>}
   */
  static async executeLocally({ agentInstance = null, movementController = null, bot = null, intent, playerUsername }) {
    const activeBot = bot || agentInstance?.mcBot?.bot;
    const activeMovement = movementController || agentInstance?.movementController;
    const agentName = agentInstance?.name || activeBot?.username || 'CompanionBot';
    const actionId = `${agentName}:fast:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    const generation = agentInstance?.activeGeneration ?? null;

    if ((!agentInstance && !activeMovement && !activeBot) || intent === PlayerIntents.NONE) {
      return {
        actionId,
        generation,
        executed: false,
        status: intent === PlayerIntents.NONE ? FastIntentStatus.UNRECOGNIZED : FastIntentStatus.REJECTED,
        responseDisposition: ResponseDisposition.NONE,
        ack: null,
        outcome: null,
        error: (agentInstance || activeMovement || activeBot) ? null : 'MISSING_AGENT',
      };
    }

    // A live AgentInstance owns the runtime lifecycle. Keep the direct
    // branch below only for isolated compatibility tests and lightweight
    // adapters that do not expose the runtime facade.
    if (typeof agentInstance?.submitFastIntent === 'function') {
      return agentInstance.submitFastIntent({ intent, playerUsername, generation });
    }

    const result = ({ status, outcome = null, error = null, responseDisposition = ResponseDisposition.DEFERRED, expectedObservation = null, ack = null } = {}) => ({
      actionId,
      generation,
      executed: [FastIntentStatus.ACCEPTED, FastIntentStatus.COMPLETED, FastIntentStatus.NOOP].includes(status),
      status,
      responseDisposition,
      ack,
      outcome,
      error,
      expectedObservation,
    });

    logger.info(`[${agentName}] Executing local intent [${intent}] from player ${playerUsername}`);


    try {
      switch (intent) {
        case PlayerIntents.STOP:
          agentInstance?.preemptRuntimeForLegacy?.();
          if (activeMovement) activeMovement.stop();
          else if (activeBot?.pathfinder) { activeBot.pathfinder.stop(); activeBot.clearControlStates?.(); }
          if (agentInstance) agentInstance.currentTask = 'waiting';
          return result({ status: FastIntentStatus.COMPLETED, outcome: { action: 'stop' }, expectedObservation: { movementMode: 'idle' } });

        case PlayerIntents.WAIT:
          agentInstance?.preemptRuntimeForLegacy?.();
          if (activeMovement) activeMovement.wait();
          else if (activeBot?.pathfinder) { activeBot.pathfinder.stop(); activeBot.clearControlStates?.(); }
          if (agentInstance) agentInstance.currentTask = 'waiting';
          return result({ status: FastIntentStatus.COMPLETED, outcome: { action: 'wait' }, expectedObservation: { movementMode: 'waiting' } });

        case PlayerIntents.FOLLOW:
        case PlayerIntents.COME_HERE: {
          agentInstance?.preemptRuntimeForLegacy?.();
          if (activeMovement) {
            await activeMovement.followPlayer(playerUsername, intent === PlayerIntents.COME_HERE ? 2 : 3);
          } else if (activeBot?.pathfinder) {
            const targetPlayer = activeBot.players?.[playerUsername]?.entity
              || Object.entries(activeBot.players || {}).find(([name]) => name.toLowerCase() === String(playerUsername).toLowerCase())?.[1]?.entity;
            if (!targetPlayer) return result({ status: FastIntentStatus.FAILED, responseDisposition: ResponseDisposition.NONE, error: 'PLAYER_NOT_VISIBLE' });
            const pathfinderPkg = await import('mineflayer-pathfinder');
            const { goals } = pathfinderPkg.default || pathfinderPkg;
            activeBot.pathfinder.setGoal(new goals.GoalFollow(targetPlayer, 3), true);
          } else {
            return result({ status: FastIntentStatus.FAILED, responseDisposition: ResponseDisposition.NONE, error: 'MOVEMENT_UNAVAILABLE' });
          }
          if (agentInstance) agentInstance.currentTask = `following_${playerUsername}`;
          return result({ status: FastIntentStatus.ACCEPTED, outcome: { action: intent === PlayerIntents.FOLLOW ? 'follow' : 'come_here', target: playerUsername }, expectedObservation: { movementMode: 'following', targetPlayer: playerUsername } });
        }

        case PlayerIntents.HELP:
          agentInstance?.preemptRuntimeForLegacy?.();
          if (activeMovement) {
            await activeMovement.followPlayer(playerUsername, 2);
          } else {
            return result({ status: FastIntentStatus.FAILED, responseDisposition: ResponseDisposition.NONE, error: 'MOVEMENT_UNAVAILABLE' });
          }
          if (agentInstance) agentInstance.currentTask = `helping_${playerUsername}`;
          return result({ status: FastIntentStatus.ACCEPTED, outcome: { action: 'help', target: playerUsername }, expectedObservation: { movementMode: 'following', targetPlayer: playerUsername } });

        case PlayerIntents.WHERE_ARE_YOU:
          if (!activeBot?.entity?.position) return result({ status: FastIntentStatus.FAILED, responseDisposition: ResponseDisposition.NONE, error: 'POSITION_UNAVAILABLE' });
          const pos = { x: Math.round(activeBot.entity.position.x), y: Math.round(activeBot.entity.position.y), z: Math.round(activeBot.entity.position.z) };
          return result({ status: FastIntentStatus.COMPLETED, ack: `I'm here: x: ${pos.x}, y: ${pos.y}, z: ${pos.z}`, outcome: { action: 'report_position', position: pos }, expectedObservation: { positionAvailable: true } });

        case PlayerIntents.CALL_NAME:
          return result({ status: FastIntentStatus.NOOP, ack: 'Yes, I'm here!', outcome: { action: 'acknowledge_call' } });

        default:
          return result({ status: FastIntentStatus.UNRECOGNIZED, responseDisposition: ResponseDisposition.NONE });
      }
    } catch (error) {
      logger.warn(`[${agentName}] Failed to execute [${intent}]: ${error.message}`);
      return result({ status: FastIntentStatus.FAILED, responseDisposition: ResponseDisposition.NONE, error: error.message });
    }
  }
}
