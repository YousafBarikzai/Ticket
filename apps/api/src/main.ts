import 'dotenv/config';
import { initTelemetry, logger } from '@itsm/platform';
import { startApp } from './app.js';

await initTelemetry('itsm-api');

try {
  await startApp();
} catch (error) {
  logger.error('api failed to start', { error: (error as Error).message, stack: (error as Error).stack });
  process.exit(1);
}
