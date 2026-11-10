import { config } from '../config/default.js';
import { createLogger } from './utils/logger.js';
import { CompanyOrchestrator } from './agents/company-orchestrator.js';
import { MinecraftAICompanion } from './index.js';

const logger = createLogger('MAIN');

const isCompanyMode = process.argv.includes('--company') || process.env.COMPANY_MODE === 'true';
const runner = isCompanyMode ? new CompanyOrchestrator(config) : new MinecraftAICompanion();

async function shutdown(signal) {
  logger.info(`Received signal ${signal}; shutting down gracefully...`);
  try {
    await runner.stop();
  } catch (err) {
    logger.warn(`Shutdown error: ${err.message}`);
  }
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

let isLoggingError = false;
process.on('uncaughtException', (error) => {
  if (error?.code === 'EPIPE' || error?.syscall === 'write') return;
  if (isLoggingError) return;
  isLoggingError = true;
  try {
    logger.error(`Unhandled exception: ${error.stack || error.message}`);
  } catch (_) {}
  isLoggingError = false;
});

process.on('unhandledRejection', (reason) => {
  if (isLoggingError) return;
  isLoggingError = true;
  try {
    logger.error(`Unhandled rejection: ${reason?.stack || reason}`);
  } catch (_) {}
  isLoggingError = false;
});

logger.info(`Launch mode: ${isCompanyMode ? 'Six-player company (--company)' : `Single companion bot (${config.minecraft.username})`}`);

runner.start().catch((error) => {
  logger.error(`Startup error: ${error.stack || error.message}`);
  process.exitCode = 1;
});
