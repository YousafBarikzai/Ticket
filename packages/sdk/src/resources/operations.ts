import type { Client } from '../client.js';
import type { Page, Ticket } from './types.js';
import { ticketQuery, type TicketFilter } from './workbench.js';

/**
 * What the desk is doing, as opposed to how it is set up.
 *
 * `configure.*` writes the rules; this reads the consequences — the queues, the
 * tickets in them, the estate they run on, the numbers, the integrations, the
 * audit trail. Almost all of it is read-only, and that is a decision rather
 * than an omission: every one of these screens exists because an administrator
 * needs to *see* something the API has always served and no screen has ever
 * shown, and a read-only screen is the honest first version of one.
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

export interface Queues {
  availability(): Promise<AvailabilityRow[]>;
  shifts(teamId?: string): Promise<ShiftRow[]>;
  rotations(teamId?: string): Promise<RotationRow[]>;
  skills(): Promise<SkillRow[]>;
  /** Who is on call now, for one rotation. */
  onCall(rotationKey: string): Promise<unknown>;
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

export interface Estate {
  classes(): Promise<CiClassRow[]>;
  cis(filter?: CiFilter): Promise<CiRow[]>;
  assets(filter?: AssetFilter): Promise<AssetRow[]>;
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

export interface Insights {
  /** `facts` is the vocabulary a metric may be built from, served alongside the list. */
  metrics(): Promise<{ data: MetricRow[]; facts: unknown }>;
  dashboards(): Promise<DashboardRow[]>;
  reports(): Promise<ReportRow[]>;
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

export interface Integrations {
  actions(): Promise<ActionRow[]>;
  credentials(): Promise<CredentialRow[]>;
  /** Defaults to `open`, as the route does. */
  errorQueue(status?: string): Promise<ErrorQueueRow[]>;
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

export interface AiDecisions {
  /** Totals only; every holder of `ai.read`. */
  score(filter?: { purpose?: string; days?: number }): Promise<DecisionScore>;
  /** Every decision in the tenant needs `ai.manage`; one ticket's needs sight of the ticket. */
  decisions(filter?: { purpose?: string; subjectId?: string; limit?: number }): Promise<DecisionRow[]>;
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
}

const unwrap = <T>(body: { data: T }): T => body.data;

export function operations(client: Client): Operations {
  return {
    queues: {
      availability: () => client.request<{ data: AvailabilityRow[] }>('/api/v1/workload/availability').then(unwrap),
      shifts: (teamId) =>
        client.request<{ data: ShiftRow[] }>('/api/v1/workload/shifts', { query: { teamId } }).then(unwrap),
      rotations: (teamId) =>
        client.request<{ data: RotationRow[] }>('/api/v1/workload/rotations', { query: { teamId } }).then(unwrap),
      skills: () => client.request<{ data: SkillRow[] }>('/api/v1/workload/skills').then(unwrap),
      onCall: (rotationKey) =>
        client.request(`/api/v1/workload/rotations/${encodeURIComponent(rotationKey)}/on-call`),
    },

    estate: {
      classes: () => client.request<{ data: CiClassRow[] }>('/api/v1/ci-classes').then(unwrap),
      cis: (filter = {}) => client.request<{ data: CiRow[] }>('/api/v1/cis', { query: { ...filter } }).then(unwrap),
      assets: (filter = {}) =>
        client.request<{ data: AssetRow[] }>('/api/v1/assets', { query: { ...filter } }).then(unwrap),
    },

    insights: {
      metrics: () => client.request<{ data: MetricRow[]; facts: unknown }>('/api/v1/analytics/metrics'),
      dashboards: () => client.request<{ data: DashboardRow[] }>('/api/v1/analytics/dashboards').then(unwrap),
      reports: () => client.request<{ data: ReportRow[] }>('/api/v1/analytics/reports').then(unwrap),
    },

    integrations: {
      actions: () => client.request<{ data: ActionRow[] }>('/api/v1/actions').then(unwrap),
      credentials: () => client.request<{ data: CredentialRow[] }>('/api/v1/credentials').then(unwrap),
      errorQueue: (status) =>
        client.request<{ data: ErrorQueueRow[] }>('/api/v1/error-queue', { query: { status } }).then(unwrap),
    },

    ai: {
      score: (filter = {}) => client.request<DecisionScore>('/api/v1/ai/decisions/score', { query: { ...filter } }),
      decisions: (filter = {}) =>
        client.request<{ data: DecisionRow[] }>('/api/v1/ai/decisions', { query: { ...filter } }).then(unwrap),
    },

    securityAlerts: () => client.request<{ data: SecurityAlertRow[] }>('/api/v1/security/alerts').then(unwrap),

    auditEvents: (filter = {}) =>
      client.request<{ data: AuditEventRow[]; nextCursor: string | null }>('/api/v1/audit-events', {
        query: { ...filter },
      }),

    tickets: (filter = {}) => client.request<Page<Ticket>>('/api/v1/tickets', { query: ticketQuery(filter) }),
  };
}
