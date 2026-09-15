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
export { replayProjection } from './service/replay-service.js';
export * as metricService from './service/metric-service.js';
export * as dashboardService from './service/dashboard-service.js';
export * as reportService from './service/report-service.js';
export { seedAnalyticsDefaults } from './service/dashboard-service.js';
export { querySchema, forecastSchema, rollupPlan, type QueryInput, type QueryResult } from './service/metric-service.js';
export { dashboardSchema, widgetSchema, type DashboardInput, type WidgetInput } from './service/dashboard-service.js';
export { reportSchema, sectionSchema, scheduleInputSchema, MAX_REPORT_ROWS, type ReportInput, type ScheduleInput } from './service/report-service.js';
export { BUILTIN_METRICS, FACT_CATALOGUE, FACTS, AGGREGATES, builtinMetric, dimensionsOf, timeColumnFor, type MetricSpec, type Filter, type FactName } from './domain/metrics.js';
export { filterSchema, metricDefinitionSchema, assertFilters, assertMetric, assertDimension } from './domain/filters.js';
export { RANGES, resolveRange, bucketFor, bucketStarts, truncateTo, previousPeriod, type RangeKey, type Bucket, type Period } from './domain/ranges.js';
export { scheduleSchema, nextRunAfter, periodFor, type Schedule } from './domain/schedule.js';
export { linearTrend, type Trend, type Point } from './domain/forecast.js';
export { toCsv, csvCell } from './domain/csv.js';
export { whereFor, aggregateFor } from './repo/query-repo.js';
import './handlers/index.js';
import './notifications.js';
