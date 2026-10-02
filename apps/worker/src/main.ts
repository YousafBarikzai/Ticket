import 'dotenv/config';
import {
  disconnectDb,
  disconnectRedis,
  initTelemetry,
  loadConfig,
  logger,
  queuesForFamilies,
  registeredJobs,
  reportConfigWarnings,
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

// D24: every worker signs links too (survey invitations, status-page mail), so
// each says so when it holds the public development secret — under its own
// service name, which is how the operator's banner can say which ones still
// do. The name is the environment's, not the parsed configuration's: that
// defaults to the API's name, and a worker reporting itself clean under it
// would clear the API's warning.
const configReport = await reportConfigWarnings(process.env.OTEL_SERVICE_NAME || 'itsm-worker');

const shutdown = async (signal: string): Promise<void> => {
  logger.info('worker shutting down', { signal });
  configReport.stop();
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
