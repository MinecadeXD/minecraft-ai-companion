import 'dotenv/config';
import { config } from '../config/default.js';
import { createLogger } from './utils/logger.js';
import { MinecraftBot } from './bot/minecraft-bot.js';
import { EventHandler } from './bot/event-handler.js';
import { WorldState } from './perception/world-state.js';
import { ToolRegistry } from './brain/tool-registry.js';
import { ContextManager } from './brain/context-manager.js';
import { AIBrain } from './brain/ai-brain.js';
import { createAIProvider } from './brain/provider-factory.js';
import { registerAllTools } from './tools/index.js';
import { MemoryManager } from './memory/memory-manager.js';
import { Planner } from './planning/planner.js';
import { DeathHandler } from './safety/death-handler.js';
import { EmergencyController } from './safety/emergency.js';
import { InitiativeController } from './personality/initiative.js';
import { FriendshipSystem } from './personality/friendship.js';
import { AutonomousGoals } from './personality/autonomous-goals.js';
import { CognitiveEngine } from './cognition/cognitive-engine.js';
import { eventBus } from './events/event-bus.js';
import { missionSystem } from './missions/mission-system.js';
import { sessionManager } from './session/session-manager.js';
import { bodyLanguage } from './behavior/body-language.js';
import { skillSystem } from './behavior/player-simulation/skill-system.js';
import { WorldInteractionErrors } from './perception/world-interaction-errors.js';
import { WorldInteractionErrorsExtended } from './perception/world-interaction-errors-extended.js';
import { BotActionWrapper } from './behavior/bot-action-wrapper.js';
import { BotActionWrapperExtended } from './behavior/bot-action-wrapper-extended.js';
import { ErrorMemory } from './perception/error-memory.js';
import { PersonalityHabits } from './perception/personality-habits.js';
import { EnvironmentInfluence } from './perception/environment-influence.js';
import { MovementController } from './control/movement-controller.js';
import { ReflexEngine } from './behavior/reflex-engine.js';
import { LootProtectionManager } from './behavior/loot-protection.js';
import { ActionSandbox } from './actions/action-sandbox.js';
import { SkillLibrary } from './skills/skill-library.js';
import { fidgetController } from './behavior/fidget-controller.js';

const logger = createLogger('MAIN');


/**
 * Main application class — connects all Minecraft AI Companion modules.
 */
class MinecraftAICompanion {
  constructor() {
    this.isRunning = false;
    this.mcBot = null;
    this.worldState = null;
    this.toolRegistry = null;
    this.contextManager = null;
    this.memoryManager = null;
    this.aiBrain = null;
    this.eventHandler = null;
    this.planner = null;
    this.deathHandler = null;
    this.lootProtection = null;
    this.emergency = null;
    this.initiative = null;
    this.friendship = null;
    this.autonomousGoals = null;
    this.cognitiveEngine = null;
    this.eventBus = eventBus;
    this.missionSystem = missionSystem;
    this.sessionManager = sessionManager;
    this.bodyLanguage = bodyLanguage;
    this.skillSystem = skillSystem;
    this.worldInteractionErrors = null;
    this.botActionWrapper = null;
    this.errorMemory = null;
    this.personalityHabits = null;
    this.environmentInfluence = null;
    this.movementController = null;
    this.skillLibrary = null;
    this.actionSandbox = null;
  }

  /**
   * Initialize and start all systems.
   */
  async start() {
    logger.info('=============================================');
    logger.info('🤖 Minecraft AI Companion — Starting');
    logger.info(`AI provider: ${config.ai.provider} (Model: ${config.ai.model})`);
    logger.info(`Server: ${config.minecraft.host}:${config.minecraft.port} (${config.minecraft.version || 'auto'})`);
    logger.info(`Bot name: ${config.minecraft.username}`);
    logger.info(`Owner: ${config.bot.owner}`);
    logger.info(`Initiative: ${config.bot.initiative}`);
    logger.info('=============================================');

    try {
      // 1. Memory (SQLite)
      logger.info('1/7. Initializing memory (SQLite)...');
      this.memoryManager = new MemoryManager();

      // 2. AI provider
      logger.info('2/7. Initializing AI provider...');
      const aiProvider = createAIProvider(config);
      logger.info(`AI provider ready: ${aiProvider.name}`);

      // 2.5. Maximum human-likeness system
      logger.info('2.5/7. Initializing maximum human-likeness system...');
      const { createMaximalHumanController } = await import('./behavior/human-like/maximal-human-controller.js');
      this.humanController = createMaximalHumanController({
        agentName: config.minecraft.username,
        profile: config.agentProfile || {},
        provider: aiProvider,
        durableStorage: this.memoryManager,
        socialGraph: null, // Will be connected after friendship initialization
        conversationMemory: null,
      });
      logger.info(`✅ Maximum human-likeness system is active for ${config.minecraft.username}`);

      // 3. Tool registry and context
      logger.info('3/7. Initializing tool registry and planner...');
      this.toolRegistry = new ToolRegistry();
      this.contextManager = new ContextManager(config);
      // Commitment memory (living memory, no new database).
      const { CommitmentMemory } = await import('./memory/commitment-memory.js');
      this.commitmentMemory = new CommitmentMemory(this.memoryManager);
      this.contextManager.setCommitmentMemory(this.commitmentMemory);
      this.aiBrain = new AIBrain(config, this.toolRegistry, this.contextManager, aiProvider, this.memoryManager);
      this.planner = new Planner(this.memoryManager, this.toolRegistry, this.aiBrain);
      this.cognitiveEngine = new CognitiveEngine({
        config,
        toolRegistry: this.toolRegistry,
        contextManager: this.contextManager,
        provider: aiProvider,
        memoryManager: this.memoryManager,
        aiBrain: this.aiBrain,
      });

      // 4. Friendship and personality
      this.friendship = new FriendshipSystem(this.memoryManager, config.bot.owner);
      this.friendship.load();

      // Connect friendship to humanController
      if (this.humanController) {
        this.humanController.socialGraph = this.friendship;
      }

      // 5. Minecraft bot
      logger.info('4/7. Creating the bot and connecting to Minecraft...');
      this.mcBot = new MinecraftBot(config);
      this.worldState = new WorldState();

      // Safety controller
      this.emergency = new EmergencyController({
        bot: null,
        planner: this.planner,
        aiBrain: this.aiBrain,
      });

      this.deathHandler = new DeathHandler(null, this.memoryManager, config);

      // Connect to the server
      await this.mcBot.connect();
      this.emergency.bot = this.mcBot.bot;
      this.deathHandler.bot = this.mcBot.bot;

      // Give the brain "eyes": the context manager now sees the world from a first-person perspective.
      this.contextManager.setBot(this.mcBot.bot);
      this.aiBrain.setBot(this.mcBot.bot);
      this.aiBrain.setFidgetController(fidgetController);

      // 6. Register all tools (including the Code-as-Action sandbox and skills)
      logger.info('5/7. Registering tools and sandbox...');
      this.skillLibrary = new SkillLibrary();
      this.actionSandbox = new ActionSandbox({
        bot: this.mcBot.bot,
        worldState: this.worldState,
        skillLibrary: this.skillLibrary,
        memoryManager: this.memoryManager,
        config,
      });

      registerAllTools(this.toolRegistry, {
        bot: this.mcBot.bot,
        worldState: this.worldState,
        mcBot: this.mcBot,
        memoryManager: this.memoryManager,
        planner: this.planner,
        aiProvider,
        actionSandbox: this.actionSandbox,
        skillLibrary: this.skillLibrary,
      });
      logger.info(`Registered ${this.toolRegistry.getAll().length} tools.`);

      // 6.6. Initializing realistic mistakes for world interactions
      logger.info('6.6/7. Initializing realistic mistake system...');
      this.worldInteractionErrors = new WorldInteractionErrorsExtended({
        agentName: config.minecraft.username,
        emotionalSystem: this.humanController?.emotionalSystem || null,
      });

      // Create an extended wrapper for bot actions
      this.botActionWrapper = new BotActionWrapperExtended(
        this.mcBot.bot,
        this.humanController?.emotionalSystem || null,
        config.minecraft.username
      );

      // 6.7. Initialize mistake memory (the bot LEARNS!)
      this.errorMemory = new ErrorMemory(config.minecraft.username);
      logger.info('✅ Mistake memory system activated');

      // 6.8. Initialize personal habits (every bot is UNIQUE!)
      this.personalityHabits = new PersonalityHabits(config.minecraft.username);
      logger.info('✅ Personal habits activated:');
      logger.info(this.personalityHabits.getDescription());

      // 6.9. Initialize environmental influence (MANY factors!)
      this.environmentInfluence = new EnvironmentInfluence();
      logger.info('✅ Environmental influence system activated (20+ factors)');

      logger.info('✅ ALL realistic mistake systems activated!');

      // 7. Start perception subsystems and cognitive core
      logger.info('6/7. Starting perception systems and cognitive core...');
      this.worldState.startAutoUpdate(this.mcBot.bot);

      // Spinal cord (Reflex Engine 20 Hz)
      this.reflexEngine = new ReflexEngine(this.mcBot.bot);
      this.reflexEngine.setEmergencyHandler((reason) => {
        this.actionSandbox?.abortRunning(reason);
      });
      this.reflexEngine.start();
      logger.info('✅ Spinal cord (Reflex Engine 20 Hz) activated');

      this.cognitiveEngine.start(() => this.worldState.getSnapshot(), this.mcBot.bot);

      // Movement controller. Mood affects pace, jumping, and alertness
      // (numbers only — speech remains the LLM's responsibility).
      this.movementController = new MovementController({
        agentName: config.minecraft.username,
        bot: this.mcBot.bot,
        moodProvider: () => this.humanController?.emotionalSystem?.getMood?.() || null,
      });

      // Autonomous goal system (the bot develops on its own, not only in response to commands)
      this.autonomousGoals = new AutonomousGoals({
        bot: this.mcBot.bot,
        memoryManager: this.memoryManager,
        aiBrain: this.aiBrain,
        config,
      });
      logger.info('✅ Autonomous goal system activated (the bot develops independently)');

      this.initiative = new InitiativeController({
        bot: this.mcBot.bot,
        worldState: this.worldState,
        memoryManager: this.memoryManager,
        aiBrain: this.aiBrain,
        config,
        movementController: this.movementController,
        autonomousGoals: this.autonomousGoals,
      });
      this.initiative.start();

      // Stream of consciousness and the bot's free will
      const { StreamOfConsciousness } = await import('./cognition/stream-of-consciousness.js');
      this.streamOfConsciousness = new StreamOfConsciousness({
        bot: this.mcBot.bot,
        aiBrain: this.aiBrain,
        memoryManager: this.memoryManager,
        worldState: this.worldState,
        config,
      });
      this.streamOfConsciousness.start();
      logger.info('✅ Stream of consciousness (StreamOfConsciousness) activated');

      this.lootProtection = new LootProtectionManager(this.mcBot.bot);

      // Event handler
      this.eventHandler = new EventHandler(this.mcBot, this.aiBrain, this.worldState, config, {
        deathHandler: this.deathHandler,
        emergency: this.emergency,
        friendship: this.friendship,
        planner: this.planner,
        humanController: this.humanController, // Pass humanController
        movementController: this.movementController,
        bodyLanguage: this.bodyLanguage,
        lootProtection: this.lootProtection,
        toolRegistry: this.toolRegistry,
        commitmentMemory: this.commitmentMemory,
      });
      this.eventHandler.setup();

      // Initial friendly greeting for the owner (shift-shift + nod) if nearby
      setTimeout(async () => {
        try {
          const ownerUsername = config.bot.owner;
          const ownerPlayer = this.mcBot?.bot?.players?.[ownerUsername]
            || Object.entries(this.mcBot?.bot?.players || {}).find(([n]) => n.toLowerCase() === ownerUsername.toLowerCase())?.[1];
          const ownerEntity = ownerPlayer?.entity;
          if (ownerEntity && this.mcBot?.bot) {
            await this.mcBot.bot.lookAt(ownerEntity.position.offset(0, 1.6, 0), true);
            await this.bodyLanguage?.shiftGreeting(this.mcBot.bot);
            await this.bodyLanguage?.nodHead(this.mcBot.bot);
          }
        } catch (_) {}
      }, 2500);

      this.isRunning = true;
      logger.info('=============================================');
      logger.info('✅ Minecraft AI Companion started successfully!');
      logger.info(`🎮 Bot "${config.minecraft.username}" is ready to play in the Minecraft world.`);
      logger.info(`💬 Chat with the group naturally using ordinary phrases in Minecraft chat.`);
      logger.info('=============================================');

    } catch (error) {
      logger.error(`❌ Startup error: ${error.message}`);
      logger.error(error.stack);
      await this.stop();
      process.exit(1);
    }
  }

  /**
   * Stop all systems.
   */
  async stop() {
    logger.info('Stopping all bot systems...');
    this.isRunning = false;

    // Save mistake statistics
    if (this.errorMemory) {
      logger.info('📊 Final mistake statistics:');
      const stats = this.errorMemory.getStats();
      logger.info(`Total mistakes: ${stats.totalErrors}`);
      logger.info(`Total successes: ${stats.totalSuccesses}`);
      logger.info(`Success rate: ${stats.successRate}%`);
      logger.info(`Learning multiplier: ${stats.learningMultiplier}x`);
    }

    if (this.humanController) {
      this.humanController.stop();
    }

    if (this.eventHandler) {
      this.eventHandler.cleanup?.();
    }

    if (this.cognitiveEngine) {
      this.cognitiveEngine.stop();
    }

    if (this.initiative) {
      this.initiative.stop();
    }

    if (this.streamOfConsciousness) {
      this.streamOfConsciousness.stop();
    }

    if (this.autonomousGoals) {
      this.autonomousGoals.clearCurrentGoal();
    }

    if (this.movementController) {
      this.movementController.stop();
    }

    if (this.worldState) {
      this.worldState.stopAutoUpdate();
    }

    if (this.mcBot) {
      this.mcBot.disconnect();
    }

    if (this.memoryManager) {
      this.memoryManager.close();
    }


    logger.info('Minecraft AI Companion stopped.');
  }
}

import { CompanyOrchestrator } from './agents/company-orchestrator.js';
import { AgentInstance } from './agents/agent-instance.js';

export { MinecraftAICompanion, CompanyOrchestrator, AgentInstance };
