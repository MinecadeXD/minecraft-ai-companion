import { CompanyOrchestrator } from './src/agents/company-orchestrator.js';
import { createLogger } from './src/utils/logger.js';
import dotenv from 'dotenv';

dotenv.config();

const logger = createLogger('FRIENDS_MODE');

/**
 * FRIENDS MODE — Maximum human-likeness
 *
 * Differences from CompanyOrchestrator (work mode):
 * - Bots do not autonomously work on tasks
 * - They live alongside you and react to the world
 * - They speak rarely and naturally
 * - They remember you and your adventures
 * - Each has its own personality
 */

async function startFriendsMode() {
  logger.info('🎮 Starting FRIENDS mode...');
  logger.info('');
  logger.info('Your friends:');
  logger.info('  Sam  — calm and observant');
  logger.info('  Max  — methodical and organized');
  logger.info('  Jack — easily gets carried away');
  logger.info('  Ryan — hardworking and patient');
  logger.info('  Alex — creative and attentive');
  logger.info('  Leo  — reliable and confident');
  logger.info('');

  const config = {
    minecraft: {
      host: process.env.MC_HOST || 'localhost',
      port: parseInt(process.env.MC_PORT, 10) || 25565,
      version: process.env.MC_VERSION || '1.20.1',
      auth: process.env.MC_AUTH || 'offline',
    },
    ai: {
      provider: process.env.AI_PROVIDER || 'anthropic',
      model: process.env.AI_MODEL || 'claude-3-5-sonnet-20241022',
      apiKey: process.env.ANTHROPIC_API_KEY,
    },
    bot: {
      owner: process.env.BOT_OWNER || 'kustash01',
    },
    friends: {
      // HUMAN-LIKE SETTINGS

      // Talkativeness (0.05 = very quiet, 0.25 = talkative)
      chattiness: 0.12, // 12% of events trigger a message

      // Add typos (true/false)
      enableTypos: true,

      // Pauses before replying (realistic typing delays)
      naturalTyping: true,

      // Use memories of previous encounters
      rememberPlayer: true,

      // Autonomous life (wander, build, and gather — but not like workers)
      autonomousLife: true,
    },
  };

  logger.info('📋 Configuration:');
  logger.info(`   Server: ${config.minecraft.host}:${config.minecraft.port}`);
  logger.info(`   Version: ${config.minecraft.version}`);
  logger.info(`   AI: ${config.ai.provider} (${config.ai.model})`);
  logger.info(`   Talkativeness: ${config.friends.chattiness * 100}%`);
  logger.info(`   Typos: ${config.friends.enableTypos ? 'yes' : 'no'}`);
  logger.info(`   Natural pauses: ${config.friends.naturalTyping ? 'yes' : 'no'}`);
  logger.info('');

  // Create the group (use the existing system in "friends" mode)
  const company = new CompanyOrchestrator({
    agents: ['Sam', 'Max', 'Jack', 'Ryan', 'Alex', 'Leo'],
    baseConfig: config,
    mode: 'friends', // Special mode
  });

  // Configure event handlers
  company.on('agent:ready', ({ name }) => {
    logger.info(`✅ ${name} joined the world`);
  });

  company.on('agent:chat', ({ name, message }) => {
    logger.info(`💬 ${name}: ${message}`);
  });

  company.on('agent:action', ({ name, action }) => {
    logger.debug(`🎬 ${name} is doing: ${action}`);
  });

  company.on('error', (err) => {
    logger.error(`❌ Error: ${err.message}`);
  });

  try {
    await company.start();
    logger.info('');
    logger.info('🎉 Your friends are in the game! Join the server and say hello.');
    logger.info('');
    logger.info('💡 Tips:');
    logger.info('   - They will not respond to every message (just like real people)');
    logger.info('   - Give them time to think before replying');
    logger.info('   - Silence is normal; not every event needs a comment');
    logger.info('   - Mention them by name to get their attention');
    logger.info('   - They remember previous encounters with you');
    logger.info('');
    logger.info('Press Ctrl+C to stop.');

  } catch (err) {
    logger.error(`❌ Failed to start friends mode: ${err.message}`);
    logger.error(err.stack);
    process.exit(1);
  }
}

// Handle shutdown
process.on('SIGINT', async () => {
  logger.info('');
  logger.info('👋 Your friends are leaving the world...');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('');
  logger.info('👋 Your friends are leaving the world...');
  process.exit(0);
});

// Startup
startFriendsMode().catch((err) => {
  logger.error('Critical error:', err);
  process.exit(1);
});
