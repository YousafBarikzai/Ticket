import type { Client } from '../client.js';
import type { AvailabilityInput, Page, SlaTimers, Ticket } from './types.js';
import { ticketQuery, type TicketFilter } from './workbench.js';

/**
 * What the desk is doing, as opposed to how it is set up.
 *
 * `configure.*` writes the rules; this reads the consequences — the queues, the
 * tickets in them, the estate they run on, the numbers, the integrations, the
 * audit trail. It started read-only, deliberately: each screen existed so an
 * administrator could *see* something the API had always served and no screen
 * had shown. The writes here now are the ones those screens need to act on
 * what they show — covering an on-call night, replaying a failed delivery,
 * rotating a credential, retiring an asset — and nothing a screen does not.
 *
 * Written against `apps/api/src/routes`, field by field, including which
 * timestamps cross the wire as strings. Several of these routes return Prisma
 * rows straight out of a service, so their `Date` columns arrive as ISO
 * strings and are typed that way here; a `Date` in one of these interfaces
 * would be a lie that only shows up in a `toLocaleString` call.
 */

// ---------------------------------------------------------------------------
// Queues: availability, shifts, rotations, skills (MOD-20)
// ---------------------------------------------------------------------------

export interface AvailabilityRow {
  userId: string;
  status: string;
  /** What the router will actually use: `status`, unless `until` has passed. */
  effectiveStatus: string;
  reason: string | null;
  until: string | null;
  capacity: number;
  source: string;
  updatedAt: string;
}

export interface ShiftAssignmentRow {
  id: string;
  userId: string;
  /** `YYYY-MM-DD`: a shift assignment is a run of days, not an instant. */
  startsOn: string;
  endsOn: string | null;
}

export interface ShiftRow {
  key: string;
  name: string;
  teamId: string;
  timeZone: string;
  /** Weekday keys to local start and end times. */
  pattern: unknown;
  assignments: ShiftAssignmentRow[];
}

export interface RotationRow {
  key: string;
  name: string;
  teamId: string;
  timeZone: string;
  /** `daily` or `weekly`. */
  cadence: string;
  /** User ids, in the order they take it. */
  members: string[];
  /** A local time of day, e.g. `09:00` — not a timestamp. */
  handoverAt: string;
}

export interface SkillRow {
  key: string;
  name: string;
  description: string | null;
}

export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

/** Local times per weekday, up to four spans a day: `{ mon: [{ from: '09:00', to: '17:30' }] }`. */
export type ShiftPattern = Partial<Record<Weekday, { from: string; to: string }[]>>;

/**
 * Who is on call at an instant, and the next few handovers.
 *
 * Each handover is resolved through the overrides, and `covered` says so: a
 * rota that showed whose turn it *would* be, on a night somebody has agreed to
 * cover, is the page that goes to the wrong person.
 */
export interface OnCallRow {
  rotation: { key: string; name: string; teamId: string; timeZone: string };
  at: string;
  userId: string | null;
  via: 'override' | 'rotation' | 'nobody';
  upcoming: { at: string; userId: string; covered: boolean }[];
  overrides: { id: string; userId: string; startsAt: string; endsAt: string; reason: string | null }[];
}

export type RoutingStrategy = 'round_robin' | 'least_loaded' | 'skill';

/** A team's routing policy, or the tenant's settings where the team has none (`source`). */
export interface RoutingPolicy {
  strategy: RoutingStrategy;
  defaultCapacity: number;
  requireSkill: boolean;
  allowOffShift: boolean;
  source: 'team' | 'tenant';
}

/**
 * A rehearsal: who would take the next ticket and who would not, and why.
 * Nothing is assigned. `rejected` is the useful half — "four of six are away
 * and two are at capacity" is something an administrator can act on.
 */
export interface RoutingExplanation {
  teamId: string;
  userId: string | null;
  strategy: RoutingStrategy;
  reason: string;
  eligible: string[];
  rejected: { userId: string; because: string }[];
  policy: RoutingPolicy;
}

export interface Queues {
  availability(): Promise<AvailabilityRow[]>;
  /** Your own by default; somebody else's (`userId`) needs the `any` scope. */
  setAvailability(input: AvailabilityInput): Promise<{ userId: string; status: string; until: string | null }>;
  shifts(teamId?: string): Promise<ShiftRow[]>;
  createShift(input: { key: string; name: string; teamId: string; timeZone: string; pattern: ShiftPattern }): Promise<{
    key: string;
    name: string;
    teamId: string;
  }>;
  deleteShift(key: string): Promise<void>;
  /** `startsOn`/`endsOn` are dates, `YYYY-MM-DD`: an assignment is a run of days. */
  assignShift(shiftKey: string, input: { userId: string; startsOn: string; endsOn?: string }): Promise<{ id: string; userId: string }>;
  unassignShift(assignmentId: string): Promise<void>;
  rotations(teamId?: string): Promise<RotationRow[]>;
  createRotation(input: {
    key: string;
    name: string;
    teamId: string;
    timeZone: string;
    cadence?: 'daily' | 'weekly';
    startsAt: string;
    members: string[];
    handoverAt?: string;
  }): Promise<{ key: string; name: string; members: string[] }>;
  /** Reordering `members` reorders every future turn; a one-off swap belongs in an override. */
  updateRotation(
    key: string,
    patch: { name?: string; teamId?: string; timeZone?: string; cadence?: 'daily' | 'weekly'; startsAt?: string; members?: string[]; handoverAt?: string },
  ): Promise<{ key: string; members: string[]; handoverAt: string }>;
  /** Who is on call for one rotation, now or at `at`. */
  onCall(rotationKey: string, at?: string): Promise<OnCallRow>;
  /** A swap: somebody covering for a while. */
  addOverride(
    rotationKey: string,
    input: { userId: string; startsAt: string; endsAt: string; reason?: string },
  ): Promise<{ id: string; userId: string; startsAt: string; endsAt: string }>;
  removeOverride(id: string): Promise<void>;
  skills(): Promise<SkillRow[]>;
  createSkill(input: { key: string; name: string; description?: string }): Promise<{ key: string; name: string }>;
  /** `level` 1 learning, 2 competent (the default), 3 expert. Granting again changes the level. */
  grantSkill(skillKey: string, userId: string, level?: 1 | 2 | 3): Promise<{ userId: string; level: number }>;
  revokeSkill(skillKey: string, userId: string): Promise<void>;
  routing(teamId: string): Promise<RoutingPolicy>;
  setRouting(
    teamId: string,
    policy: { strategy: RoutingStrategy; defaultCapacity: number; requireSkill?: boolean; allowOffShift?: boolean },
  ): Promise<{ teamId: string; strategy: RoutingStrategy; defaultCapacity: number }>;
  explainRouting(teamId: string, options?: { strategy?: RoutingStrategy; ticketId?: string }): Promise<RoutingExplanation>;
}

// ---------------------------------------------------------------------------
// The estate: configuration items and the asset register (MOD-10-E1)
// ---------------------------------------------------------------------------

export interface CiClassRow {
  id: string;
  key: string;
  name: string;
  parentId: string | null;
}

export interface CiRow {
  id: string;
  name: string;
  /** The item's class (`CiClassRow.id`). Optional: an API from before it was sent leaves it out. */
  classId?: string;
  status: string;
  criticality: string;
  externalKey: string | null;
  serviceId: string | null;
  ownerId: string | null;
  environment: string | null;
  description: string | null;
  attributes: unknown;
  source: string;
  retiredAt: string | null;
  updatedAt: string;
}

export interface AssetRow {
  id: string;
  tag: string;
  serial: string | null;
  status: string;
  ciId: string | null;
  location: string | null;
  costCentre: string | null;
  supplier: string | null;
  /** Dates, not instants: the API truncates these to `YYYY-MM-DD`. */
  purchasedOn: string | null;
  warrantyEndsOn: string | null;
  retiredAt: string | null;
  /**
   * The person holding it now, on the lists (`assets`, `warranties`); null when
   * nobody does (in stock, or placed at a location). Absent from a single
   * asset, whose `assignments` say it, and from an API that predates it.
   */
  holderId?: string | null;
}

export interface CiFilter {
  classKey?: string;
  status?: string;
  criticality?: string;
  serviceId?: string;
  search?: string;
  includeRetired?: boolean;
  limit?: number;
}

export interface AssetFilter {
  status?: string;
  userId?: string;
  costCentre?: string;
  search?: string;
  limit?: number;
}

export type CiStatus = 'operational' | 'degraded' | 'down' | 'retired';
export type Criticality = 'low' | 'medium' | 'high' | 'critical';
export type RelationshipType = 'depends_on' | 'runs_on' | 'installed_on' | 'member_of' | 'connected_to';

/** One attribute a class declares, inheritance included. */
export interface CiAttribute {
  key: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'date' | 'enum';
  required: boolean;
  options?: string[];
}

export interface CiInput {
  classKey: string;
  name: string;
  externalKey?: string;
  description?: string;
  criticality?: Criticality;
  serviceId?: string;
  ownerId?: string;
  environment?: string;
  attributes?: Record<string, unknown>;
  source?: 'manual' | 'import' | 'discovery';
}

/** A relationship reads "`fromCi` `type` `toCi`": the web server *runs on* the host. */
export interface Relationship {
  fromCi: string;
  toCi: string;
  type: RelationshipType;
}

export interface CiRelationships {
  /** What this item needs. */
  needs: { type: string; ci: { id: string; name: string; status: string } }[];
  /** What needs this item. */
  neededBy: { type: string; ci: { id: string; name: string; status: string } }[];
}

/** What a traversal reached, and the few numbers somebody reads out on a bridge call. */
export interface ImpactResult {
  ci: { id: string; name: string; status: string; criticality: string; serviceId: string | null };
  depth: number;
  summary: {
    total: number;
    byCriticality: Record<Criticality, number>;
    services: string[];
    worst: Criticality | null;
    /** The traversal stopped at the depth bound rather than running out. */
    truncated: boolean;
  };
  data: {
    id: string;
    name: string;
    status: string;
    criticality: string;
    serviceId: string | null;
    className: string;
    depth: number;
    via: string;
  }[];
}

export interface CiHistory {
  ci: { id: string; name: string };
  data: { entityType: 'ticket' | 'major_incident' | 'problem' | 'change'; entityId: string; role: string; linkedAt: string }[];
}

export interface AssetInput {
  tag?: string;
  serial?: string;
  manufacturer?: string;
  model?: string;
  ciId?: string;
  purchasedOn?: string;
  purchaseCost?: number;
  currency?: string;
  warrantyEndsOn?: string;
  supplier?: string;
  costCentre?: string;
  location?: string;
}

export interface AssetDetail extends AssetRow {
  assignments: { userId: string | null; location: string | null; note: string | null; assignedAt: string; returnedAt: string | null }[];
}

export interface Estate {
  classes(): Promise<CiClassRow[]>;
  classAttributes(classKey: string): Promise<CiAttribute[]>;
  createClass(input: { key: string; name: string; description?: string; parentKey?: string; attributes?: CiAttribute[] }): Promise<{
    id: string;
    key: string;
    name: string;
  }>;
  /** `parentKey: ''` moves a class to the top level. */
  updateClass(
    classKey: string,
    patch: { name?: string; description?: string; parentKey?: string; attributes?: CiAttribute[] },
  ): Promise<CiClassRow>;
  cis(filter?: CiFilter): Promise<CiRow[]>;
  ci(id: string): Promise<CiRow>;
  createCi(input: CiInput): Promise<CiRow>;
  updateCi(id: string, patch: Partial<Omit<CiInput, 'classKey' | 'source'>>): Promise<CiRow>;
  /** Operational, degraded or down. Retiring is `retireCi`, deliberately separate. */
  setCiStatus(id: string, status: Exclude<CiStatus, 'retired'>, note?: string): Promise<CiRow>;
  retireCi(id: string, reason: string): Promise<CiRow>;
  relationships(id: string): Promise<CiRelationships>;
  /** Idempotent: the same edge twice is one edge. Answers with the sentence it recorded. */
  relate(relationship: Relationship): Promise<{ id: string; reads: string }>;
  unrelate(relationship: Relationship): Promise<void>;
  /** What falls over if this does. */
  impact(id: string, options?: { depth?: number; types?: readonly RelationshipType[] }): Promise<ImpactResult>;
  /** What this needs in order to work. */
  dependencies(id: string, options?: { depth?: number; types?: readonly RelationshipType[] }): Promise<ImpactResult>;
  /** Tickets, incidents, problems and changes that have touched it, newest first. */
  history(id: string): Promise<CiHistory>;
  assets(filter?: AssetFilter): Promise<AssetRow[]>;
  asset(tag: string): Promise<AssetDetail>;
  createAsset(input: AssetInput): Promise<AssetRow>;
  updateAsset(tag: string, patch: Omit<AssetInput, 'tag'>): Promise<AssetRow>;
  assignAsset(tag: string, input: { userId?: string; location?: string; note?: string }): Promise<AssetRow>;
  returnAsset(tag: string, location?: string): Promise<AssetRow>;
  retireAsset(tag: string, reason: string, disposed?: boolean): Promise<AssetRow>;
  /** Warranties ending within `withinDays` (default 30), and those already over. */
  warranties(withinDays?: number): Promise<(AssetRow & { expired: boolean })[]>;
}

// ---------------------------------------------------------------------------
// Insights: metrics, dashboards, reports (MOD-12)
// ---------------------------------------------------------------------------

export interface MetricRow {
  key: string;
  name: string;
  description: string;
  fact: string;
  aggregate: string;
  field?: string;
  unit: string;
  /** Shipped with the platform, so it cannot be edited or deleted. */
  builtin: boolean;
}

export interface DashboardRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  /** True where it belongs to one person rather than the desk. */
  personal: boolean;
  seeded: boolean;
  version: number;
  updatedAt: string;
  widgetCount: number;
}

export interface ReportRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  sections: unknown;
  schedules: number;
  runs: number;
  version: number;
}

export type MetricRange = '7d' | '30d' | '90d' | '12m' | 'ytd' | 'custom';

export interface MetricFilter {
  field: string;
  op: 'eq' | 'neq' | 'in' | 'not_in' | 'gt' | 'gte' | 'lt' | 'lte' | 'is_null' | 'not_null';
  value?: string | number | boolean | (string | number)[] | null;
}

/** One question: a number, or with `series` a line over time, or with `groupBy` a breakdown. */
export interface MetricQuery {
  metricKey: string;
  filters?: MetricFilter[];
  range?: MetricRange;
  /** For `range: 'custom'`: ISO instants. */
  from?: string;
  to?: string;
  groupBy?: string;
  series?: boolean;
  /** Chosen from the range when left out. */
  bucket?: 'day' | 'week' | 'month';
}

export interface MetricResult {
  metric: { key: string; name: string; unit: 'count' | 'minutes' | 'percent' | 'money'; aggregate: string; fact: string };
  period: { from: string; to: string };
  bucket?: 'day' | 'week' | 'month';
  value?: number | null;
  series?: { at: string; value: number | null }[];
  groups?: { key: string | null; value: number | null; label: string | null }[];
  /** Which path answered: the fact tables or the rollup. */
  source: 'facts' | 'rollup';
}

/** A straight line through the series, extended. A trend, not a prediction. */
export interface MetricTrend {
  slopePerDay: number;
  intercept: number;
  /** 0: the line explains nothing; 1: every point sits on it. */
  rSquared: number;
  fitted: { at: string; value: number }[];
  projected: { at: string; value: number }[];
}

export type WidgetType = 'number' | 'timeseries' | 'bar' | 'table' | 'trend';

export interface WidgetInput {
  title: string;
  type: WidgetType;
  metricKey: string;
  filters?: MetricFilter[];
  groupBy?: string;
  range?: Exclude<MetricRange, 'custom'>;
  /** Columns out of twelve. */
  width?: number;
  options?: Record<string, unknown>;
}

export interface DashboardInput {
  key?: string;
  name: string;
  description?: string;
  /** Personal dashboards belong to the caller; anything else is shared. */
  personal?: boolean;
  widgets?: WidgetInput[];
}

export interface WidgetRow {
  id: string;
  position: number;
  title: string;
  type: WidgetType;
  metricKey: string;
  filters: MetricFilter[];
  groupBy: string | null;
  range: string;
  width: number;
  options: Record<string, unknown>;
}

/** A widget evaluated. One widget failing reports `error` on that widget, not on the dashboard. */
export interface RenderedWidget {
  id: string;
  title: string;
  type: WidgetType;
  width: number;
  metricKey: string;
  result?: MetricResult;
  error?: string;
}

export type DashboardSummary = Omit<DashboardRow, 'widgetCount'>;

export interface DashboardDetail extends DashboardSummary {
  widgets: WidgetRow[];
}

export interface RenderedDashboard extends DashboardSummary {
  widgets: RenderedWidget[];
}

export interface ReportRunRow {
  id: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  periodFrom: string;
  periodTo: string;
  rowCount: number;
  summary: string | null;
  error: string | null;
  scheduleId: string | null;
}

export interface Insights {
  /** `facts` is the vocabulary a metric may be built from, served alongside the list. */
  metrics(): Promise<{ data: MetricRow[]; facts: unknown }>;
  query(query: MetricQuery): Promise<MetricResult>;
  /** The daily series and a straight line through it, `horizonDays` (default 14) further on. */
  forecast(query: Omit<MetricQuery, 'groupBy' | 'series' | 'bucket'> & { horizonDays?: number }): Promise<{
    result: MetricResult;
    trend: MetricTrend | null;
  }>;
  dashboards(): Promise<DashboardRow[]>;
  dashboard(id: string): Promise<DashboardDetail>;
  /** Every widget evaluated: what a page draws. */
  render(id: string): Promise<RenderedDashboard>;
  createDashboard(input: DashboardInput): Promise<DashboardSummary>;
  /** `widgets`, when sent, replaces the whole set. */
  updateDashboard(id: string, patch: Partial<DashboardInput>): Promise<DashboardSummary>;
  deleteDashboard(id: string): Promise<void>;
  reports(): Promise<ReportRow[]>;
  reportRuns(reportId: string, limit?: number): Promise<ReportRunRow[]>;
  /** Runs now, over `period` or the last 30 days. The CSV is at `/analytics/report-runs/<id>/csv`. */
  runReport(
    reportId: string,
    period?: { from: string; to: string },
  ): Promise<{ id: string; status: string; period: { from: string; to: string }; summary: string | null; rowCount: number; sections: unknown }>;
}

// ---------------------------------------------------------------------------
// Integrations: actions, credentials, the error queue (MOD-14)
// ---------------------------------------------------------------------------

export interface ActionRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  kind: string;
  config: unknown;
  credentialRef: string | null;
  credentialHeader: string | null;
  retryMax: number;
  timeoutMs: number;
  responseMapping: unknown;
  status: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Metadata and a fingerprint. Never a value — there is no route that returns
 * one, by design, so there is no field here that could hold one.
 */
export interface CredentialRow {
  ref: string;
  kind: string;
  description: string | null;
  fingerprint: string;
  createdAt: string;
  rotatedAt: string | null;
  lastUsedAt: string | null;
  expiresAt: string | null;
  /** True when the key-encryption key has rotated since this was written. */
  needsRewrap: boolean;
}

export interface ErrorQueueRow {
  id: string;
  source: string;
  sourceId: string;
  actionKey: string | null;
  payload: unknown;
  idempotencyKey: string;
  error: string;
  attempts: number;
  status: string;
  dismissedReason: string | null;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
}

/** What running an action produced. `permanent` means retrying cannot help: fix the configuration. */
export interface ActionOutcome {
  ok: boolean;
  output: Record<string, unknown>;
  status?: number;
  error?: string;
  permanent?: boolean;
}

export interface Integrations {
  actions(): Promise<ActionRow[]>;
  publishAction(key: string): Promise<{ key: string; status: string }>;
  credentials(): Promise<CredentialRow[]>;
  /** The value goes in and never comes out: the answer is the metadata and a fingerprint. */
  createCredential(input: { ref: string; value: string; kind?: string; description?: string; expiresAt?: string }): Promise<CredentialRow>;
  rotateCredential(ref: string, value: string): Promise<CredentialRow>;
  deleteCredential(ref: string): Promise<void>;
  /** Defaults to `open`, as the route does. */
  errorQueue(status?: string): Promise<ErrorQueueRow[]>;
  /** Replays with the original idempotency key, so a retry cannot repeat what the first attempt did. */
  replay(id: string): Promise<ActionOutcome>;
  dismiss(id: string, reason: string): Promise<{ status: 'dismissed' }>;
}

// ---------------------------------------------------------------------------
// Security and audit (MOD-13)
// ---------------------------------------------------------------------------

export interface SecurityAlertRow {
  id: string;
  type: string;
  severity: string;
  details: unknown;
  createdAt: string;
}

export interface AuditEventRow {
  id: string;
  seq: number;
  action: string;
  actorType: string;
  actorId: string | null;
  targetType: string;
  targetId: string;
  before: unknown;
  after: unknown;
  reason: string | null;
  correlationId: string | null;
  occurredAt: string;
}

export interface AuditFilter {
  actorId?: string;
  action?: string;
  targetType?: string;
  targetId?: string;
  from?: string;
  to?: string;
  cursor?: string;
  limit?: number;
}

/** One question's score against what people settled on (ADR-0051). */
export interface DecisionQuestionScore {
  question: string;
  scored: number;
  accuracy: number | null;
  brier: number | null;
  calibration: { from: number; to: number; count: number; accuracy: number | null; meanConfidence: number | null }[];
  autoGate: { eligible: boolean; considered: number; agreement: number | null; reason: string } | null;
  /** What agents did with this field's suggestions, in `suggest` mode. */
  responses: { accepted: number; dismissed: number };
  /** What the AI set by itself, in `auto` mode, and how much of it people changed or undid. */
  applied: { applied: number; overridden: number };
}

export interface DecisionScore {
  purpose: string;
  mode: string;
  thresholds: { auto: number; suggest: number };
  since: string;
  decisions: number;
  settled: number;
  fellToRules: number;
  byProvider: Record<string, number>;
  skips: Record<string, number>;
  costMicros: string;
  costDisplay: string;
  meanLatencyMs: number | null;
  questions: DecisionQuestionScore[];
  /** Whose record the `auto` gates were read from: the chain's first available provider, or null. */
  gateProvider: string | null;
  autoEligible: boolean;
  /** The automatic step-down's meter: corrections over the most recent applied decisions. */
  stepDown: {
    window: number;
    considered: number;
    overridden: number;
    rate: number | null;
    limit: number;
    wouldStepDown: boolean;
  };
  /** The last time `auto` switched itself back to `suggest`, if ever. */
  lastStepDown: { at: string; overridden: number; window: number } | null;
}

export interface DecisionRow {
  id: string;
  purpose: string;
  subjectType: string;
  subjectId: string;
  mode: string;
  outcome: string;
  provider: string;
  model: string | null;
  latencyMs: number;
  costMicros: string;
  costDisplay: string;
  answers: Record<string, { value: unknown; confidence: number }>;
  attempts: { provider: string; outcome: string; reason: string | null; model: string | null; ms: number }[];
  createdAt: string;
}

/**
 * This month's AI spend against its lines. `spentMicros` is a string because
 * it is a bigint on the server; `spentDisplay` is the one to show.
 */
export interface AiBudget {
  periodKey: string;
  limitPence: number | null;
  warnPence: number | null;
  spentMicros: string;
  spentDisplay: string;
  state: 'ok' | 'warned' | 'blocked';
}

export interface AiDecisions {
  /** Totals only; every holder of `ai.read`. */
  score(filter?: { purpose?: string; days?: number }): Promise<DecisionScore>;
  /** Every decision in the tenant needs `ai.manage`; one ticket's needs sight of the ticket. */
  decisions(filter?: { purpose?: string; subjectId?: string; limit?: number }): Promise<DecisionRow[]>;
  budget(): Promise<AiBudget>;
  /** Null removes a line. The warning must sit below the limit. */
  setBudget(input: { limitPence: number | null; warnPence: number | null }): Promise<Omit<AiBudget, 'spentMicros'>>;
}

export interface MajorIncidentRow {
  number: string;
  title: string;
  severity: string;
  status: string;
  commanderId: string | null;
  customerFacing: boolean;
  declaredAt: string;
  resolvedAt: string | null;
  nextUpdateDueAt: string | null;
}

export interface Operations {
  readonly queues: Queues;
  readonly ai: AiDecisions;
  readonly estate: Estate;
  readonly insights: Insights;
  readonly integrations: Integrations;

  securityAlerts(): Promise<SecurityAlertRow[]>;
  auditEvents(filter?: AuditFilter): Promise<{ data: AuditEventRow[]; nextCursor: string | null }>;

  /**
   * The desk's tickets, through the same grammar the workbench uses.
   *
   * `filter[status]`, not `status` — and an unrecognised query parameter is
   * ignored rather than refused, so a browser that spelled it itself would
   * quietly list every ticket on the desk while claiming to be filtered.
   * `ticketQuery` is imported rather than re-implemented for exactly that
   * reason.
   */
  tickets(filter?: TicketFilter): Promise<Page<Ticket>>;
  ticket(idOrNumber: string): Promise<Ticket>;
  ticketSla(idOrNumber: string): Promise<SlaTimers>;
  /** `open: true` for the ones still running, which is what a banner wants. */
  majorIncidents(filter?: { open?: boolean; status?: string; severity?: string }): Promise<MajorIncidentRow[]>;
}

const unwrap = <T>(body: { data: T }): T => body.data;

export function operations(client: Client): Operations {
  return {
    queues: {
      availability: () => client.request<{ data: AvailabilityRow[] }>('/api/v1/workload/availability').then(unwrap),
      setAvailability: (input) => client.request('/api/v1/workload/availability', { method: 'PUT', body: input }),
      shifts: (teamId) =>
        client.request<{ data: ShiftRow[] }>('/api/v1/workload/shifts', { query: { teamId } }).then(unwrap),
      createShift: (input) => client.request('/api/v1/workload/shifts', { method: 'POST', body: input }),
      deleteShift: (key) =>
        client.request<void>(`/api/v1/workload/shifts/${encodeURIComponent(key)}`, { method: 'DELETE' }),
      assignShift: (shiftKey, input) =>
        client.request(`/api/v1/workload/shifts/${encodeURIComponent(shiftKey)}/assignments`, { method: 'POST', body: input }),
      unassignShift: (assignmentId) =>
        client.request<void>(`/api/v1/workload/shift-assignments/${encodeURIComponent(assignmentId)}`, { method: 'DELETE' }),
      rotations: (teamId) =>
        client.request<{ data: RotationRow[] }>('/api/v1/workload/rotations', { query: { teamId } }).then(unwrap),
      createRotation: (input) => client.request('/api/v1/workload/rotations', { method: 'POST', body: input }),
      updateRotation: (key, patch) =>
        client.request(`/api/v1/workload/rotations/${encodeURIComponent(key)}`, { method: 'PATCH', body: patch }),
      onCall: (rotationKey, at) =>
        client.request<OnCallRow>(`/api/v1/workload/rotations/${encodeURIComponent(rotationKey)}/on-call`, { query: { at } }),
      addOverride: (rotationKey, input) =>
        client.request(`/api/v1/workload/rotations/${encodeURIComponent(rotationKey)}/overrides`, { method: 'POST', body: input }),
      removeOverride: (id) =>
        client.request<void>(`/api/v1/workload/overrides/${encodeURIComponent(id)}`, { method: 'DELETE' }),
      skills: () => client.request<{ data: SkillRow[] }>('/api/v1/workload/skills').then(unwrap),
      createSkill: (input) => client.request('/api/v1/workload/skills', { method: 'POST', body: input }),
      grantSkill: (skillKey, userId, level) =>
        client.request(`/api/v1/workload/skills/${encodeURIComponent(skillKey)}/agents`, {
          method: 'PUT',
          body: level === undefined ? { userId } : { userId, level },
        }),
      revokeSkill: (skillKey, userId) =>
        client.request<void>(`/api/v1/workload/skills/${encodeURIComponent(skillKey)}/agents/${encodeURIComponent(userId)}`, {
          method: 'DELETE',
        }),
      routing: (teamId) => client.request<RoutingPolicy>(`/api/v1/workload/routing/${encodeURIComponent(teamId)}`),
      setRouting: (teamId, policy) =>
        client.request(`/api/v1/workload/routing/${encodeURIComponent(teamId)}`, { method: 'PUT', body: policy }),
      explainRouting: (teamId, options = {}) =>
        client.request<RoutingExplanation>(`/api/v1/workload/routing/${encodeURIComponent(teamId)}/explain`, {
          query: { strategy: options.strategy, ticketId: options.ticketId },
        }),
    },

    estate: {
      classes: () => client.request<{ data: CiClassRow[] }>('/api/v1/ci-classes').then(unwrap),
      classAttributes: (classKey) =>
        client.request<{ data: CiAttribute[] }>(`/api/v1/ci-classes/${encodeURIComponent(classKey)}/attributes`).then(unwrap),
      createClass: (input) => client.request('/api/v1/ci-classes', { method: 'POST', body: input }),
      updateClass: (classKey, patch) =>
        client.request<CiClassRow>(`/api/v1/ci-classes/${encodeURIComponent(classKey)}`, { method: 'PATCH', body: patch }),
      cis: (filter = {}) => client.request<{ data: CiRow[] }>('/api/v1/cis', { query: { ...filter } }).then(unwrap),
      ci: (id) => client.request<CiRow>(`/api/v1/cis/${encodeURIComponent(id)}`),
      createCi: (input) => client.request<CiRow>('/api/v1/cis', { method: 'POST', body: input }),
      updateCi: (id, patch) => client.request<CiRow>(`/api/v1/cis/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch }),
      setCiStatus: (id, status, note) =>
        client.request<CiRow>(`/api/v1/cis/${encodeURIComponent(id)}/status`, {
          method: 'POST',
          body: note ? { status, note } : { status },
        }),
      retireCi: (id, reason) =>
        client.request<CiRow>(`/api/v1/cis/${encodeURIComponent(id)}/retire`, { method: 'POST', body: { reason } }),
      relationships: (id) => client.request<CiRelationships>(`/api/v1/cis/${encodeURIComponent(id)}/relationships`),
      relate: (relationship) =>
        client.request<{ id: string; reads: string }>('/api/v1/ci-relationships', { method: 'POST', body: relationship }),
      // A DELETE with a body: the edge is named by its two ends and its type,
      // which is what the caller holds, rather than by an id it would have to look up.
      unrelate: (relationship) => client.request<void>('/api/v1/ci-relationships', { method: 'DELETE', body: relationship }),
      impact: (id, options = {}) =>
        client.request<ImpactResult>(`/api/v1/cis/${encodeURIComponent(id)}/impact`, { query: traversal(options) }),
      dependencies: (id, options = {}) =>
        client.request<ImpactResult>(`/api/v1/cis/${encodeURIComponent(id)}/dependencies`, { query: traversal(options) }),
      history: (id) => client.request<CiHistory>(`/api/v1/cis/${encodeURIComponent(id)}/history`),
      assets: (filter = {}) =>
        client.request<{ data: AssetRow[] }>('/api/v1/assets', { query: { ...filter } }).then(unwrap),
      asset: (tag) => client.request<AssetDetail>(`/api/v1/assets/${encodeURIComponent(tag)}`),
      createAsset: (input) => client.request<AssetRow>('/api/v1/assets', { method: 'POST', body: input }),
      updateAsset: (tag, patch) =>
        client.request<AssetRow>(`/api/v1/assets/${encodeURIComponent(tag)}`, { method: 'PATCH', body: patch }),
      assignAsset: (tag, input) =>
        client.request<AssetRow>(`/api/v1/assets/${encodeURIComponent(tag)}/assign`, { method: 'POST', body: input }),
      returnAsset: (tag, location) =>
        client.request<AssetRow>(`/api/v1/assets/${encodeURIComponent(tag)}/return`, {
          method: 'POST',
          body: location ? { location } : {},
        }),
      retireAsset: (tag, reason, disposed = false) =>
        client.request<AssetRow>(`/api/v1/assets/${encodeURIComponent(tag)}/retire`, {
          method: 'POST',
          body: { reason, disposed },
        }),
      warranties: (withinDays) =>
        client
          .request<{ data: (AssetRow & { expired: boolean })[] }>('/api/v1/assets-warranties', { query: { withinDays } })
          .then(unwrap),
    },

    insights: {
      metrics: () => client.request<{ data: MetricRow[]; facts: unknown }>('/api/v1/analytics/metrics'),
      // A POST that writes nothing: a query carries filters that do not fit a URL.
      query: (query) => client.request<MetricResult>('/api/v1/analytics/query', { method: 'POST', body: query }),
      forecast: (query) => client.request('/api/v1/analytics/forecast', { method: 'POST', body: query }),
      dashboards: () => client.request<{ data: DashboardRow[] }>('/api/v1/analytics/dashboards').then(unwrap),
      dashboard: (id) => client.request<DashboardDetail>(`/api/v1/analytics/dashboards/${encodeURIComponent(id)}`),
      render: (id) => client.request<RenderedDashboard>(`/api/v1/analytics/dashboards/${encodeURIComponent(id)}/render`),
      createDashboard: (input) =>
        client.request<DashboardSummary>('/api/v1/analytics/dashboards', { method: 'POST', body: input }),
      updateDashboard: (id, patch) =>
        client.request<DashboardSummary>(`/api/v1/analytics/dashboards/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch }),
      deleteDashboard: (id) =>
        client.request<void>(`/api/v1/analytics/dashboards/${encodeURIComponent(id)}`, { method: 'DELETE' }),
      reports: () => client.request<{ data: ReportRow[] }>('/api/v1/analytics/reports').then(unwrap),
      reportRuns: (reportId, limit) =>
        client
          .request<{ data: ReportRunRow[] }>(`/api/v1/analytics/reports/${encodeURIComponent(reportId)}/runs`, { query: { limit } })
          .then(unwrap),
      runReport: (reportId, period) =>
        client.request(`/api/v1/analytics/reports/${encodeURIComponent(reportId)}/run`, { method: 'POST', body: period ?? {} }),
    },

    integrations: {
      actions: () => client.request<{ data: ActionRow[] }>('/api/v1/actions').then(unwrap),
      publishAction: (key) =>
        client.request(`/api/v1/actions/${encodeURIComponent(key)}/publish`, { method: 'POST', body: {} }),
      credentials: () => client.request<{ data: CredentialRow[] }>('/api/v1/credentials').then(unwrap),
      createCredential: (input) => client.request<CredentialRow>('/api/v1/credentials', { method: 'POST', body: input }),
      rotateCredential: (ref, value) =>
        client.request<CredentialRow>(`/api/v1/credentials/${encodeURIComponent(ref)}/rotate`, { method: 'POST', body: { value } }),
      deleteCredential: (ref) =>
        client.request<void>(`/api/v1/credentials/${encodeURIComponent(ref)}`, { method: 'DELETE' }),
      errorQueue: (status) =>
        client.request<{ data: ErrorQueueRow[] }>('/api/v1/error-queue', { query: { status } }).then(unwrap),
      replay: (id) =>
        client.request<ActionOutcome>(`/api/v1/error-queue/${encodeURIComponent(id)}/replay`, { method: 'POST', body: {} }),
      dismiss: (id, reason) =>
        client.request<{ status: 'dismissed' }>(`/api/v1/error-queue/${encodeURIComponent(id)}/dismiss`, {
          method: 'POST',
          body: { reason },
        }),
    },

    ai: {
      score: (filter = {}) => client.request<DecisionScore>('/api/v1/ai/decisions/score', { query: { ...filter } }),
      decisions: (filter = {}) =>
        client.request<{ data: DecisionRow[] }>('/api/v1/ai/decisions', { query: { ...filter } }).then(unwrap),
      budget: () => client.request<AiBudget>('/api/v1/ai/budget'),
      setBudget: (input) => client.request('/api/v1/ai/budget', { method: 'PUT', body: input }),
    },

    securityAlerts: () => client.request<{ data: SecurityAlertRow[] }>('/api/v1/security/alerts').then(unwrap),

    auditEvents: (filter = {}) =>
      client.request<{ data: AuditEventRow[]; nextCursor: string | null }>('/api/v1/audit-events', {
        query: { ...filter },
      }),

    tickets: (filter = {}) => client.request<Page<Ticket>>('/api/v1/tickets', { query: ticketQuery(filter) }),

    ticket: (idOrNumber) => client.request<Ticket>(`/api/v1/tickets/${encodeURIComponent(idOrNumber)}`),

    ticketSla: (idOrNumber) => client.request<SlaTimers>(`/api/v1/tickets/${encodeURIComponent(idOrNumber)}/sla`),

    // `open` is sent as a word either way. It is the one boolean filter whose
    // `false` means something — closed ones only — rather than "no filter",
    // so it cannot go through the rule that drops `false` from a query.
    majorIncidents: (filter = {}) =>
      client
        .request<{ data: MajorIncidentRow[] }>('/api/v1/major-incidents', {
          query: {
            open: filter.open === undefined ? undefined : String(filter.open),
            status: filter.status,
            severity: filter.severity,
          },
        })
        .then(unwrap),
  };
}

/** The traversal query: `types` as the comma list the route splits. */
function traversal(options: { depth?: number; types?: readonly RelationshipType[] }): Record<string, string | number | undefined> {
  return {
    depth: options.depth,
    types: options.types && options.types.length > 0 ? options.types.join(',') : undefined,
  };
}
