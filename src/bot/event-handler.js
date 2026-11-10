import { createLogger } from '../utils/logger.js';
import { MessageBus, MessageOrigin } from '../events/message-bus.js';
import { telemetry } from '../utils/telemetry.js';
import { ConversationRouter } from '../social/conversation-router.js';
import { FastPlayerIntentRouter, PlayerIntents } from '../control/fast-player-intent.js';
import { adaptiveCamera } from '../behavior/adaptive-camera.js';
import { LootProtectionManager } from '../behavior/loot-protection.js';
import { HumanChatFlow } from '../behavior/human-chat-flow.js';
import { AdrenalineController } from '../behavior/adrenaline-controller.js';
import { AuditoryEngine } from '../behavior/auditory-engine.js';
import { HotbarErgonomics } from '../behavior/hotbar-ergonomics.js';
import { CombatMicroEngine } from '../behavior/combat-micro-engine.js';
import { HumanErrorEngine } from '../behavior/human-error-engine.js';

const logger = createLogger('EVENT');

/**
 * EventHandler — handles Minecraft events, routes fast player commands (Fast Path)
 * and filters messages with deduplication.
 */
export class EventHandler {
  constructor(mcBot, aiBrain, worldState, config, options = {}) {
    this.mcBot = mcBot;
    this.aiBrain = aiBrain;
    this.worldState = worldState;
    this.config = config;
    this.owner = config?.bot?.owner || 'kustash01';
    this.botUsername = config?.minecraft?.username || 'GeminiBot';
    this.toolRegistry = options.toolRegistry || this.aiBrain?.toolRegistry || null;
    this.agentInstance = options.agentInstance || null;
    this.deathHandler = options.deathHandler || null;
    this.emergency = options.emergency || null;
    this.friendship = options.friendship || null;
    this.planner = options.planner || null;
    this.conversationManager = options.conversationManager || null;
    this.conversationEngine = options.conversationEngine || null;
    this.chatBus = options.chatBus || new MessageBus();
    this.humanController = options.humanController || null; // Attach humanController
    this.movementController = options.movementController || null;
    this.bodyLanguage = options.bodyLanguage || null;
    this.allAgentNames = options.allAgentNames || ['Sam', 'Max', 'Jack', 'Ryan', 'Alex', 'Leo'];
    this.conversationRouter = options.conversationRouter || new ConversationRouter({
      agentNames: this.allAgentNames,
      maxPublicResponders: config?.ai?.social?.maxPublicResponders || config?.social?.maxPublicResponders || 2,
    });
    this.lootProtection = options.lootProtection || (this.mcBot?.bot ? new LootProtectionManager(this.mcBot.bot) : null);
    this.commitmentMemory = options.commitmentMemory || null;
    this._lootCheckInterval = null;
    this.boundBot = null;
    this.boundGeneration = null;
    this._entityDeadListener = null;
  }

  _getPhysicalState() {
    if (this.worldState && typeof this.worldState.getSnapshot === 'function') {
      return this.worldState.getSnapshot();
    }
    return {
      health: this.mcBot?.bot?.health || 20,
      food: this.mcBot?.bot?.food || 20,
      position: this.mcBot?.bot?.entity?.position || { x: 0, y: 0, z: 0 },
    };
  }

  /**
   * Register all event handlers.
   */
  setup() {
    if (this._isSetup) return;
    this._isSetup = true;
    // 1. Chat — the primary communication channel
    this.mcBot.on('chat', async (username, rawMessage, generation) => {
      if (this.agentInstance && (generation !== this.agentInstance?.activeGeneration || this.agentInstance?.bindingReady !== true)) return;
      // Ignore the bot's own messages
      if (username === this.botUsername) return;

      const message = rawMessage.trim();
      const lower = message.toLowerCase();

      // Generate/retrieve message ID and deduplicate
      const timestamp = Date.now();
      const msgId = this.agentInstance?.chatIngress?.getEnvelopeId(username, message, timestamp)
        || this.chatBus.generateMessageId(username, message, timestamp);
      const isOwner = username === this.owner;
      const isBot = this.allAgentNames.includes(username);
      const origin = isBot ? MessageOrigin.BOT_REAL_CHAT : (isOwner ? MessageOrigin.PLAYER : MessageOrigin.SYSTEM);

      const envelope = { sender: username, content: message, origin, timestamp, messageId: msgId };

      // Transport noise never counts as social observation or silence reset.
      if (
        lower.startsWith('[ui]') ||
        lower.startsWith('[web-ui]') ||
        lower.includes('wait, i'm still thinking') ||
        lower.includes('an error occurred:')
      ) {
        return;
      }

      // Observe every valid social line before addressing/filter decisions; observation is not an action.
      const observed = this.agentInstance?.observeChat(envelope, { generation });
      if (observed === false) return;
      if (!this.chatBus.markProcessed(this.botUsername, msgId)) {
        telemetry.increment('duplicateMessageCount');
        return;
      }

      const routing = this.conversationRouter.route(envelope, { agentName: this.botUsername });
      const isDirectMessage = routing.kind === 'direct' || !this.agentInstance;
      const isSelectedPublic = routing.recipientIds.includes(this.botUsername) || !this.agentInstance;

      // Smoothly turn toward the speaking player
      if (this.mcBot?.bot?.players?.[username]?.entity) {
        try {
          const pEntity = this.mcBot.bot.players[username].entity;
          adaptiveCamera.calmLookAt(this.mcBot.bot, pEntity.position.offset(0, 1.6, 0)).catch(() => {});
        } catch (_) {}
      }

      // If the command is explicitly addressed to another specific bot, do not process it
      if (this.agentInstance && (routing.kind === 'named' || (!isDirectMessage && !isSelectedPublic))) {
        logger.debug(`[${this.botUsername}] Message routed to other participants.`);
        return;
      }

      // Main path: when AI Brain is connected, use full agent processing without templates or regex shortcuts
      if (this.aiBrain && !isBot && isDirectMessage) {
        const lower = message.toLowerCase().trim();

        // 1. Stop is immediate (responsiveness comes first),
        // but do NOT hardcode the reply; the LLM will generate a natural response below.
        if (isOwner && /(^|\s)(stop|halt|freeze|enough|cancel)(?=$|[\s,!?.])/i.test(lower)) {
          if (this.agentInstance) this.agentInstance.emergencyStop('Owner stop command');
          else this.emergency?.emergencyStop('Owner stop command');
          if (this.mcBot?.bot?.pathfinder) this.mcBot.bot.pathfinder.stop();
          this.mcBot?.bot?.clearControlStates?.();
          // Generate a short natural acknowledgement through humanController if available; otherwise stop silently.
          if (this.humanController) {
            try {
              const ack = await this.humanController.generateResponse('player_command', {
                speaker: username,
                message,
                isOwner: true,
                intent: 'STOP',
                physicalState: this._getPhysicalState(),
              });
              if (ack && this.mcBot?.bot?.chat) this.mcBot.bot.chat(ack);
            } catch (_) {}
          }
          return;
        }

        // 2. "Where are you / coordinates" — do NOT reply with a canned line.
        // Pass the question to AIBrain; it can see the real coordinates in context
        // [WHAT I SEE] and can answer in its own words, like a real player.

        // 2.5. Detect "do this later" requests and save them as commitments.
        // The LLM generates the wording; this code only records the commitment.
        if (isOwner && this.commitmentMemory && /(later|afterwards|don't forget|remind me|when you're free|when you can|for the future)/i.test(lower)) {
          try {
            this.commitmentMemory.remember(message, { requestedBy: username, importance: 0.6 });
          } catch (_) {}
        }

        try {
          const reply = await this.aiBrain.processMessage(`[${username}]: ${message}`, this.worldState);
          if (reply && this.mcBot?.bot?.chat) {
            await HumanChatFlow.typeAndSend(this.mcBot.bot, reply);
            if (this.humanController) {
              this.humanController.processEvent('executed_player_command', {
                speaker: username,
                message: message,
                memorable: true,
                importance: 0.6,
              });
            }
            return;
          }
        } catch (err) {
          logger.warn(`AI Brain processing error: ${err.message}`);
        }
      }

      // Fallback path for isolated tests without AI (Fast Path)
      if (!isBot) {
        const intent = FastPlayerIntentRouter.classifyIntent(message);
        if (FastPlayerIntentRouter.isGameplayMutation(intent)) {
          if (!isOwner) {
            logger.debug(`[${this.botUsername}] Command ${intent} rejected: sender is not the owner.`);
          } else {

            const result = await FastPlayerIntentRouter.executeLocally({
              agentInstance: this.agentInstance,
              movementController: this.movementController,
              bot: this.mcBot?.bot,
              intent,
              playerUsername: username,
              generation,
            });
            this.agentInstance?.recordFastIntentResult?.(result, {
              sender: username,
              routing,
              intent,
            });
            if (result.status !== 'unrecognized') {
              // Immediate physical response: a head nod confirms the command was received
              try {
                if (this.bodyLanguage && this.mcBot?.bot) {
                  this.bodyLanguage.nodHead?.(this.mcBot.bot);
                }
              } catch (_) {}

              // If the human-like controller is available, generate a natural LLM response without templates
              if (this.humanController) {
                const physicalState = this._getPhysicalState();

                const response = await this.humanController.generateResponse('player_command', {
                  speaker: username,
                  message: message,
                  intent: intent,
                  commandAction: result.outcome?.action,
                  physicalState: physicalState,
                  routing: routing,
                  isOwner: isOwner,
                });

                if (response) {
                  // Human-like typing delay (at the speed of an ordinary player)
                  const typingDelayMs = Math.min(1800, Math.max(300, response.length * 28 + Math.floor(HumanErrorEngine.range(0, 120))));
                  await new Promise((r) => setTimeout(r, typingDelayMs));

                  if (this.agentInstance) {
                    await this.agentInstance.sendChat(response, {
                      generation,
                      recipientScope: routing,
                      social: true,
                    });
                  } else if (this.mcBot?.bot?.chat) {
                    this.mcBot.bot.chat(response);
                  }

                  this.humanController.processEvent('executed_player_command', {
                    speaker: username,
                    message: message,
                    intent: intent,
                    memorable: true,
                    importance: 0.6,
                  });
                }
              } else if (result.responseDisposition === 'immediate' && typeof result.ack === 'string' && result.ack.trim()) {
                await this.agentInstance?.sendChat(result.ack, {
                  generation,
                  recipientScope: routing,
                  social: false,
                });
              } else if (!this.agentInstance && this.mcBot?.bot?.chat) {
                // Minimal fallback for isolated tests without AI
                const quickAcks = {
                  [PlayerIntents.STOP]: 'I am stopping',
                  [PlayerIntents.WAIT]: 'waiting',
                  [PlayerIntents.COME_HERE]: 'coming',
                  [PlayerIntents.FOLLOW]: "let's go",
                  [PlayerIntents.HELP]: "I'll help",
                };
                const reply = quickAcks[intent] || 'okay';
                this.mcBot.bot.chat(reply);
              }
              return;
            }
          }
        }
      }

      // STOP is the only gameplay-adjacent route. It is owner-only and direct.
      if (isOwner && isDirectMessage && /(^|\s)(stop|halt|freeze)(?=$|[\s,!?.])/i.test(message)) {
        if (this.agentInstance) {
          this.agentInstance.emergencyStop('Owner stop command');
        } else {
          this.emergency?.emergencyStop('Owner stop command');
        }

        if (this.humanController) {
          const physicalState = this._getPhysicalState();
          const response = await this.humanController.generateResponse('player_command', {
            speaker: username,
            message: message,
            intent: 'STOP',
            commandAction: 'stop',
            physicalState: physicalState,
            routing: routing,
            isOwner: isOwner,
          });
          if (response) {
            const typingDelayMs = Math.min(1800, Math.max(300, response.length * 28 + Math.floor(HumanErrorEngine.range(0, 120))));
            await new Promise((r) => setTimeout(r, typingDelayMs));
            if (this.agentInstance) {
              await this.agentInstance.sendChat(response, { generation, recipientScope: routing, social: true });
            } else if (this.mcBot?.bot?.chat) {
              this.mcBot.bot.chat(response);
            }
          }
        } else {
          if (this.agentInstance) {
            await this.agentInstance.sendChat('I am stopping', { generation, recipientScope: routing, social: true });
          } else if (this.mcBot?.bot?.chat) {
            this.mcBot.bot.chat('I am stopping');
          }
        }
        return;
      }

      // Conversation is opt-in: only direct or explicit group messages enter it.
      const routedEnvelope = this.chatBus.emitChatReceived(envelope);

      // INTEGRATION: Use the maximum human-likeness system or AI Brain
      if (this.humanController) {
        // Determine the situation type
        const situationType = isDirectMessage ? 'direct_question' :
                             isSelectedPublic ? 'group_question' : 'social_chat';

        // Collect the bot's physical state
        const physicalState = this._getPhysicalState();

        // Generate a natural response through the human-like behavior system
        const response = await this.humanController.generateResponse(situationType, {
          speaker: username,
          message: message,
          physicalState: physicalState,
          routing: routing,
          isOwner: isOwner,
        });

        if (response) {
          // Realistic human reading and typing delay
          if (!this.agentInstance) {
            const typingDelayMs = Math.min(2200, Math.max(500, response.length * 35 + Math.floor(HumanErrorEngine.range(0, 250))));
            await new Promise((r) => setTimeout(r, typingDelayMs));
          }

          if (this.agentInstance) {
            await this.agentInstance.sendChat(response, {
              generation,
              recipientScope: routing,
              social: true,
            });
          } else if (this.mcBot.bot?.chat) {
            this.mcBot.bot.chat(response);
          }

          // Record the event in memory and emotional state
          this.humanController.processEvent('received_message', {
            speaker: username,
            message: message,
            memorable: isDirectMessage,
            importance: isDirectMessage ? 0.7 : 0.4,
          });
        }
      } else if (this.agentInstance) {
        await this.agentInstance.handleConversationMessage(routedEnvelope, {
          kind: isDirectMessage ? 'direct' : 'group',
          generation,
          routing
        });
      } else if (this.aiBrain) {
        const reply = await this.aiBrain.processMessage(`[${username}]: ${message}`, this.worldState);
        if (reply && this.mcBot.bot?.chat) {
          this.mcBot.bot.chat(reply);
        }
      }
    });

    // 2. Bot death
    this.mcBot.on('death', () => {
      logger.warn(`[${this.botUsername}] Bot died — starting the death handler`);

      // Record the event in the human-like behavior system
      if (this.humanController) {
        this.humanController.processEvent('died', {
          location: this.mcBot.bot?.entity?.position,
          memorable: true,
          importance: 1.0,
        });
      }

      if (this.deathHandler) {
        this.deathHandler.handleBotDeath();
      }
      if (this.worldState && this.mcBot.bot) {
        this.worldState.forceUpdate(this.mcBot.bot);
      }
    });

    // 3. Bot spawn
    this.mcBot.on('spawn', ({ generation, bot } = {}) => {
      if (bot) this.bindBot(bot, generation);
      logger.info(`[${this.botUsername}] Spawned in the world`);

      // Record the event in the human-like behavior system
      if (this.humanController) {
        this.humanController.processEvent('spawned', {
          location: bot?.entity?.position,
          memorable: true,
          importance: 0.6,
        });
      }

      setTimeout(() => {
        if (this.worldState && this.mcBot.bot) {
          this.worldState.forceUpdate(this.mcBot.bot);
        }
      }, 1000);
    });

    // 4. Bot respawn after death
    this.mcBot.on('respawn', ({ generation, bot } = {}) => {
      const activeBot = bot || this.mcBot.bot;
      if (activeBot) {
        this.bindBot(activeBot, generation);
        try {
          activeBot.clearControlStates?.();
        } catch (_) {}
      }

      this.movementController?.stop?.();

      logger.info(`[${this.botUsername}] Respawned after death`);

      if (this.humanController) {
        this.humanController.processEvent('respawned', {
          location: activeBot?.entity?.position,
          memorable: true,
          importance: 0.8,
        });
      }

      setTimeout(() => {
        if (this.worldState && activeBot) {
          this.worldState.forceUpdate(activeBot);
        }
      }, 1000);
    });

    logger.info(`Event handlers registered for [${this.botUsername}]`);
  }

  bindBot(bot, generation) {
    this.cleanup();
    this.boundBot = bot || null;
    this.boundGeneration = generation;
    if (bot) {
      if (!this.lootProtection) {
        this.lootProtection = new LootProtectionManager(bot);
      } else {
        this.lootProtection.bot = bot;
      }

      if (this.movementController?.attachBot) {
        this.movementController.attachBot(bot);
      }
      if (this.deathHandler) {
        this.deathHandler.bot = bot;
      }
      if (this.emergency) {
        this.emergency.bot = bot;
      }
      this._entityDeadListener = (entity) => {
        if (this.boundBot !== bot || this.boundGeneration !== generation) return;
        if (entity.type === 'player' && entity.username && entity.username !== this.botUsername) {
          logger.info(`[${this.botUsername}] Recorded player death: ${entity.username}`);
          if (this.deathHandler) {
            this.deathHandler.handlePlayerDeath(entity.username, entity.position);
          }
          if (this.lootProtection) {
            this.lootProtection.recordTeammateDeath(entity.username, entity.position);
          }
        }
      };
      bot.on('entityDead', this._entityDeadListener);

      // Initialize human psychophysiological engines
      if (!bot._adrenalineController) bot._adrenalineController = new AdrenalineController();
      if (!bot._auditoryEngine) bot._auditoryEngine = new AuditoryEngine(bot, bot._adrenalineController);
      if (!bot._hotbarErgonomics) bot._hotbarErgonomics = new HotbarErgonomics(bot, bot._adrenalineController);
      if (!bot._combatMicroEngine) bot._combatMicroEngine = new CombatMicroEngine(bot, bot._adrenalineController);

      this._soundEffectListener = (packet) => {
        if (this.boundBot !== bot || this.boundGeneration !== generation) return;
        try {
          const soundName = packet?.soundName || packet?.sound || '';
          const pos = {
            x: (packet?.x ?? 0) / 8,
            y: (packet?.y ?? 0) / 8,
            z: (packet?.z ?? 0) / 8,
          };
          const volume = packet?.volume ?? 1.0;
          const pitch = packet?.pitch ?? 1.0;
          bot._auditoryEngine?.processSound(soundName, pos, volume, pitch);
        } catch (_) {}
      };
      if (bot._client?.on) {
        bot._client.on('sound_effect', this._soundEffectListener);
      }

      this._entityHurtListener = (entity) => {
        if (this.boundBot !== bot || this.boundGeneration !== generation) return;
        if (entity === bot.entity) {
          bot._adrenalineController?.triggerDamage(2);
        }
      };
      if (typeof bot.on === 'function') {
        bot.on('entityHurt', this._entityHurtListener);
      }

      // Background monitoring for loot protection and returning items to teammates
      this._lootCheckInterval = setInterval(async () => {
        if (!this.boundBot || this.boundGeneration !== generation) return;
        if (!this.lootProtection || !this.lootProtection.deathRecord) return;

        try {
          await this.lootProtection.gatherTeammateLoot();
          const returned = await this.lootProtection.checkTeammateReturn();
          if (returned && returned.tossedCount > 0) {
            if (this.aiBrain && typeof this.aiBrain.processMessage === 'function') {
              try {
                const prompt = `[SYSTEM_EVENT] You just saved and returned the dropped items belonging to your teammate ${returned.recipient} (${returned.tossedCount} items/stacks). Write a short, friendly chat message (no templates; use a natural player-like style).`;
                const reply = await this.aiBrain.processMessage(prompt, this.worldState);
                if (reply && this.boundBot?.chat) {
                  this.boundBot.chat(reply);
                }
              } catch (_) {}
            } else if (this.humanController && typeof this.humanController.generateResponse === 'function') {
              try {
                const reply = await this.humanController.generateResponse('returned_loot', {
                  recipient: returned.recipient,
                  count: returned.tossedCount,
                });
                if (reply && this.boundBot?.chat) {
                  this.boundBot.chat(reply);
                }
              } catch (_) {}
            }
          }
        } catch (_) {}
      }, 1500);
    }
  }

  cleanup() {
    if (this._lootCheckInterval) {
      clearInterval(this._lootCheckInterval);
      this._lootCheckInterval = null;
    }
    if (this.boundBot?.removeListener && this._entityDeadListener) {
      this.boundBot.removeListener('entityDead', this._entityDeadListener);
      this._entityDeadListener = null;
    }
    if (this.boundBot?._client?.removeListener && this._soundEffectListener) {
      this.boundBot._client.removeListener('sound_effect', this._soundEffectListener);
      this._soundEffectListener = null;
    }
    if (this.boundBot?.removeListener && this._entityHurtListener) {
      this.boundBot.removeListener('entityHurt', this._entityHurtListener);
      this._entityHurtListener = null;
    }
  }
}
