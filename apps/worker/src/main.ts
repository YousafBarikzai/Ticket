import 'dotenv/config';
import {
  disconnectDb,
  disconnectRedis,
  initTelemetry,
  loadConfig,
  logger,
  queuesForFamilies,
  registeredJobs,
  startWorker,
  closeQueues,
} from '@itsm/platform';
import { bootstrapModules } from '@itsm/runtime';
import { outboxPublisher } from '@itsm/module-integrations';
import { registerSchedules, startPublisherTicker } from './jobs.js';
import { registerTransports } from './transports.js';

/**
 * The worker process (docs/architecture/03 §1 and §4).
 *
 * One image, deployed as several services, each pinned to a queue family
 * through WORKER_QUEUES. That is what stops a burst of indexing or AI work
 * starving outbox publishing or SLA timers.
 */
await initTelemetry('itsm-worker');

const config = loadConfig();
bootstrapModules();
registerTransports();

const queues = queuesForFamilies(config.WORKER_QUEUES);
if (queues.length === 0) {
  logger.error('no queues selected; check WORKER_QUEUES', { configured: config.WORKER_QUEUES });
  process.exit(1);
}

await outboxPublisher.syncConsumerRegistry();
await registerSchedules(queues);

const workers = queues.map((queue) => startWorker(queue, queue === 'events' ? 16 : 8));
const ticker = startPublisherTicker(queues);

logger.info('worker started', {
  queues,
  jobs: registeredJobs().length,
  family: config.WORKER_QUEUES,
});

const shutdown = async (signal: string): Promise<void> => {
  logger.info('worker shutting down', { signal });
  if (ticker) clearInterval(ticker);
  // Let in-flight jobs finish: a killed job is retried, but a clean stop is
  // cheaper than a retry storm on every deploy.
  await Promise.all(workers.map((worker) => worker.close()));
  await closeQueues();
  await disconnectDb();
  await disconnectRedis();
  process.exit(0);
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
