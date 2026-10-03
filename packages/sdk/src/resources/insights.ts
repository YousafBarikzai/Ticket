import type { Client } from '../client.js';
import type { ProblemDetails } from './types.js';

/**
 * Asking the desk's numbers a question (MOD-12): metrics, dashboards and
 * reports.
 *
 * Its own file, moved out of `operations.ts`, because two surfaces now ask
 * the same questions. Administration reads the whole group through
 * `observe.insights`; the Service Desk's Overview and team pages ask only
 * the metric questions (`metricQueries`), and the two must not drift into
 * two spellings of one request. `operations.ts` re-exports every type that
 * used to live there, under the same names, so nothing that imported them
 * has to move.
 *
 * A reader with no `analytics.read` gets a 403 from every call. The agent
 * role holds none (D9), so a Service Desk page decides with
 * `permissionScope(me, 'analytics.read')` before it asks, rather than asking
 * and catching.
 */

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

/**
 * The share of SLA targets the desk aims to meet, as it comes with every
 * `sla.attainment` answer (S1). `source` says whether the tenant set it
 * (`setting`, from `sla.attainment.target`) or it is the platform's 90 %
 * (`default`). Read it through `attainmentTarget()`, which also knows what
 * to draw when an answer carries none.
 */
export interface AttainmentTarget {
  value: number;
  unit: 'percent';
  source: 'setting' | 'default';
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
  /**
   * The target an attainment is judged against: on `sla.attainment` answers
   * only, and absent from an API that predates it. Never a literal in a page
   * (`attainmentTarget()`).
   */
  target?: AttainmentTarget;
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

/**
 * One question in a batch. `id` is the caller's own name for it, echoed on
 * its answer; when sent it must be unique within the call (a duplicate is a
 * 422 for the whole batch), at most 64 characters.
 */
export type MetricBatchQuery = MetricQuery & { id?: string };

/**
 * One answer in a batch, in the position its question had.
 *
 * Discriminated on `ok`, because one bad question must not cost a page the
 * other eleven: an unknown metric is a 404 entry, a team-less fact asked by
 * a team-scoped reader a 403 entry, and the rest answer as they would alone.
 */
export type MetricBatchResult =
  | { id?: string; ok: true; result: MetricResult }
  | { id?: string; ok: false; problem: ProblemDetails };

/** The most questions one batch may carry; the API answers 422 above it. */
export const MAX_METRIC_BATCH = 30;

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

/** The metric questions alone: what a Service Desk page asks. */
export interface MetricQueries {
  query(query: MetricQuery): Promise<MetricResult>;
  /** The daily series and a straight line through it, `horizonDays` (default 14) further on. */
  forecast(query: Omit<MetricQuery, 'groupBy' | 'series' | 'bucket'> & { horizonDays?: number }): Promise<{
    result: MetricResult;
    trend: MetricTrend | null;
  }>;
  /**
   * Up to thirty questions in one round trip (R4), answered in order.
   *
   * A dashboard of twelve tiles was twelve requests across the public API
   * host, which is most of its page time. `analytics.read` is checked once,
   * so a reader without it gets one 403 for the call rather than twelve;
   * everything else is per question (`MetricBatchResult`). An empty list
   * asks nothing and answers nothing, because the API's minimum is one.
   * A 404 for the whole call means an API that predates the batch: ask the
   * questions one at a time.
   */
  queryBatch(queries: readonly MetricBatchQuery[]): Promise<MetricBatchResult[]>;
}

export interface Insights extends MetricQueries {
  /** `facts` is the vocabulary a metric may be built from, served alongside the list. */
  metrics(): Promise<{ data: MetricRow[]; facts: unknown }>;
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

const unwrap = <T>(body: { data: T }): T => body.data;

export function metricQueries(client: Client): MetricQueries {
  return {
    // A POST that writes nothing: a query carries filters that do not fit a URL.
    query: (query) => client.request<MetricResult>('/api/v1/analytics/query', { method: 'POST', body: query }),
    forecast: (query) => client.request('/api/v1/analytics/forecast', { method: 'POST', body: query }),
    queryBatch: async (queries) => {
      if (queries.length === 0) return [];
      const body = await client.request<{ results: MetricBatchResult[] }>('/api/v1/analytics/query/batch', {
        method: 'POST',
        body: { queries },
      });
      return body.results;
    },
  };
}

export function insights(client: Client): Insights {
  return {
    ...metricQueries(client),
    metrics: () => client.request<{ data: MetricRow[]; facts: unknown }>('/api/v1/analytics/metrics'),
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
  };
}
