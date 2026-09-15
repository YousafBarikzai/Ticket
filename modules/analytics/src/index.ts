/** MOD-12 Reporting and analytics — public interface. */
export { analyticsManifest } from './manifest.js';
export { durationsBetween, marginMinutes, dateKey, isoWeek, type Durations } from './domain/durations.js';
export {
  addDelta,
  contributions,
  emptyDelta,
  groupingKey,
  groupingsFor,
  isEmptyDelta,
  mean,
  negate,
  rollupDiff,
  type Grouping,
  type RollupDelta,
  type RollupEntry,
  type TicketFactShape,
} from './domain/rollup.js';
export { rebuildDay, rebuildRange, rebuildRecent } from './service/rebuild-service.js';
export { checkTicketDrift, DRIFT_TOLERANCE, type DriftResult } from './service/drift-service.js';
export { refreshTicketFact, markBreached } from './service/ticket-projector.js';
export { refreshTimerFact } from './service/sla-projector.js';
export { refreshApprovalFact } from './service/approval-projector.js';
export { refreshTaskFact } from './service/task-projector.js';
export { refreshNotificationFact } from './service/notification-projector.js';
import './handlers/index.js';
