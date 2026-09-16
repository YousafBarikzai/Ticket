/**
 * `@itsm/pwa` — offline, for the applications (doc 14 §5).
 *
 * The parts worth knowing about:
 *
 *   outbox.ts   the rules — what may be queued, what an HTTP answer means,
 *               when to retry and when to stop. Pure, and heavily tested.
 *   routing.ts  which caching strategy a request gets. Pure.
 *   store.ts    IndexedDB, with an in-memory fallback that is not only for
 *               tests: private browsing makes IndexedDB throw.
 *   sync.ts     draining the queue, one item at a time, oldest first.
 *   client.ts   registration, `submitOrQueue`, and `useOutbox` for the screen.
 *   sw.ts       the service worker, bundled into each app's public/sw.js.
 */
export {
  afterAttempt,
  afterNoAnswer,
  backoffMs,
  dueNow,
  isQueueable,
  needsAttention,
  newItem,
  outcomeOf,
  pendingCount,
  MAX_ATTEMPTS,
  QUEUEABLE,
  type Attempt,
  type ItemStatus,
  type OutboxItem,
  type OutboxStore,
  type QueueInput,
  type QueueableAction,
} from './outbox.js';
export { isCacheable, isQueueablePath, routeFor, type Routed, type Strategy } from './routing.js';
export {
  enqueue,
  forgetSent,
  indexedDbOutboxStore,
  memoryOutboxStore,
  outboxStore,
  SENT_RETENTION_MS,
} from './store.js';
export { drainOutbox, retryable, type SyncDeps, type SyncReport } from './sync.js';
export {
  registerServiceWorker,
  requestDrain,
  submitOrQueue,
  useOutbox,
  type OutboxView,
  type SubmitResult,
} from './client.js';
