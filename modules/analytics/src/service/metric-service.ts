import { z, ZodError } from 'zod';
import type { ProblemDetails } from '@itsm/contracts';
import {
  ConflictError,
  DomainError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  authz,
  describeSetting,
  loadConfig,
  logger,
  newId,
  readTransaction,
  recordAudit,
  toProblemDetails,
  transaction,
  type TenantContext,
  type Tx,
} from '@itsm/platform';
import {
  BUILTIN_METRICS,
  FACT_CATALOGUE,
  builtinMetric,
  dimensionsOf,
  type Filter,
  type MetricSpec,
} from '../domain/metrics.js';
import { assertDimension, assertFilters, assertMetric, filterSchema, metricDefinitionSchema, type MetricDefinitionInput } from '../domain/filters.js';
import { RANGES, bucketFor, resolveRange, type Bucket, type Period, type RangeKey } from '../domain/ranges.js';
import { linearTrend, type Trend } from '../domain/forecast.js';
import * as query from '../repo/query-repo.js';
import { bumpQueryVersion, queryHash, readThrough, scopeKeyFor } from './query-cache.js';

/**
 * Metrics: what they are, and asking one a question.
 *
 * A metric is resolved by key — a tenant's own definition first, then the
 * built-in catalogue — and evaluated over a period with whatever filters and
 * breakdown the caller adds. The evaluator does not know or care which kind it
 * got; both are the same shape, which is the whole reason they are.
 */

export const querySchema = z.object({
  metricKey: z.string().min(1).max(80),
  filters: z.array(filterSchema).max(20).default([]),
  range: z.enum(RANGES).default('30d'),
  from: z.string().optional(),
  to: z.string().optional(),
  groupBy: z.string().max(60).optional(),
  /** Ask for a time series; the bucket is chosen from the range unless given. */
  series: z.boolean().default(false),
  bucket: z.enum(['day', 'week', 'month']).optional(),
});
export type QueryInput = z.input<typeof querySchema>;

/**
 * What the desk aims for, carried on every `sla.attainment` answer (A8 S1), so
 * a gauge draws the tenant's target rather than a number a page typed in.
 * `default` when nobody has set it.
 */
export interface AttainmentTarget {
  value: number;
  unit: 'percent';
  source: 'setting' | 'default';
}

export interface QueryResult {
  metric: Pick<MetricSpec, 'key' | 'name' | 'unit' | 'aggregate' | 'fact'>;
  period: Period;
  bucket?: Bucket;
  value?: number | null;
  series?: query.SeriesPoint[];
  groups?: (query.GroupValue & { label: string | null })[];
  /** Which path answered, so a test can assert both agree and an operator can see which ran. */
  source: 'facts' | 'rollup';
  /** On `sla.attainment` answers only. */
  target?: AttainmentTarget;
}

/**
 * A `QueryResult` as it travels: instants as ISO strings. This is what the
 * cache holds and what `evaluateCached` returns, so a cached answer and a
 * fresh one are the same bytes.
 */
export interface QueryAnswer {
  metric: QueryResult['metric'];
  period: { from: string; to: string };
  bucket?: Bucket;
  value?: number | null;
  series?: { at: string; value: number | null }[];
  groups?: (query.GroupValue & { label: string | null })[];
  source: 'facts' | 'rollup';
  target?: AttainmentTarget;
}

// ---------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------

function fromRow(row: {
  key: string; name: string; description: string | null; fact: string; aggregate: string; field: string | null;
  filters: unknown; numeratorFilters: unknown; timeField?: string | null; unit: string;
}): MetricSpec {
  return {
    key: row.key,
    name: row.name,
    description: row.description ?? '',
    fact: row.fact as MetricSpec['fact'],
    aggregate: row.aggregate as MetricSpec['aggregate'],
    ...(row.field ? { field: row.field } : {}),
    filters: (row.filters as Filter[]) ?? [],
    ...(row.numeratorFilters ? { numeratorFilters: row.numeratorFilters as Filter[] } : {}),
    unit: row.unit as MetricSpec['unit'],
    builtin: false,
  };
}

export async function listMetrics(ctx: TenantContext): Promise<MetricSpec[]> {
  authz.require(ctx, 'analytics.read');
  const rows = await transaction(ctx, (tx) => tx.metricDefinition.findMany({ orderBy: { key: 'asc' } }));
  return [...BUILTIN_METRICS, ...rows.map(fromRow)];
}

export async function resolveMetric(ctx: TenantContext, key: string, tx?: Tx): Promise<MetricSpec> {
  const load = async (client: Tx) => client.metricDefinition.findFirst({ where: { key } });
  const row = tx ? await load(tx) : await transaction(ctx, load);
  if (row) return fromRow(row);
  const builtin = builtinMetric(key);
  if (!builtin) throw new NotFoundError('metric', key);
  return builtin;
}

/** The catalogue a widget builder needs: facts, their fields and dimensions. */
export function describeFacts() {
  return Object.entries(FACT_CATALOGUE).map(([fact, spec]) => ({
    fact,
    timeField: Object.entries(spec.fields).find(([, field]) => field.column === spec.timeColumn)?.[0] ?? null,
    fields: Object.entries(spec.fields).map(([name, field]) => ({ name, type: field.type, dimension: field.dimension ?? false })),
    dimensions: dimensionsOf(fact as MetricSpec['fact']),
  }));
}

export async function createMetric(ctx: TenantContext, input: MetricDefinitionInput) {
  authz.require(ctx, 'analytics.manage');
  const parsed = metricDefinitionSchema.parse(input);
  assertMetric(parsed);
  if (builtinMetric(parsed.key)) throw new ConflictError(`${parsed.key} is a built-in metric`);

  const created = await transaction(ctx, async (tx) => {
    const existing = await tx.metricDefinition.findFirst({ where: { key: parsed.key } });
    if (existing) throw new ConflictError(`a metric with the key ${parsed.key} already exists`);

    const row = await tx.metricDefinition.create({
      data: {
        id: newId(),
        tenantId: ctx.tenantId,
        key: parsed.key,
        name: parsed.name,
        description: parsed.description ?? null,
        fact: parsed.fact,
        aggregate: parsed.aggregate,
        field: parsed.field ?? null,
        filters: parsed.filters as never,
        numeratorFilters: (parsed.numeratorFilters ?? null) as never,
        unit: parsed.unit,
        createdBy: ctx.actor.id,
      },
    });
    await recordAudit(tx, ctx, { action: 'analytics.metric.created', targetType: 'metric_definition', targetId: row.id, after: parsed });
    return fromRow(row);
  });
  // Nothing cached can name a metric that did not exist (a refusal is never
  // kept), but "every metric write moves the version" is a rule worth having
  // without an exception to remember.
  await bumpQueryVersion(ctx.tenantId);
  return created;
}

export async function updateMetric(ctx: TenantContext, key: string, input: Partial<MetricDefinitionInput>) {
  authz.require(ctx, 'analytics.manage');
  const updated = await transaction(ctx, async (tx) => {
    const existing = await tx.metricDefinition.findFirst({ where: { key } });
    if (!existing) throw new NotFoundError('metric', key);

    const merged = metricDefinitionSchema.parse({ ...fromRow(existing), ...input, key });
    assertMetric(merged);

    const row = await tx.metricDefinition.update({
      where: { id: existing.id },
      data: {
        name: merged.name,
        description: merged.description ?? null,
        fact: merged.fact,
        aggregate: merged.aggregate,
        field: merged.field ?? null,
        filters: merged.filters as never,
        numeratorFilters: (merged.numeratorFilters ?? null) as never,
        unit: merged.unit,
        version: { increment: 1 },
      },
    });
    await recordAudit(tx, ctx, { action: 'analytics.metric.updated', targetType: 'metric_definition', targetId: row.id, before: fromRow(existing), after: merged });
    return fromRow(row);
  });
  // The same key now means something else; every answer under it is old.
  await bumpQueryVersion(ctx.tenantId);
  return updated;
}

export async function deleteMetric(ctx: TenantContext, key: string): Promise<void> {
  authz.require(ctx, 'analytics.manage');
  await transaction(ctx, async (tx) => {
    const existing = await tx.metricDefinition.findFirst({ where: { key } });
    if (!existing) throw new NotFoundError('metric', key);
    const inUse = await tx.dashboardWidget.count({ where: { metricKey: key } });
    if (inUse > 0) throw new ConflictError(`${key} is used by ${inUse} widget(s); remove those first`);
    await tx.metricDefinition.delete({ where: { id: existing.id } });
    await recordAudit(tx, ctx, { action: 'analytics.metric.deleted', targetType: 'metric_definition', targetId: existing.id, before: fromRow(existing) });
  });
  // An answer for a metric that no longer exists must become a 404.
  await bumpQueryVersion(ctx.tenantId);
}

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

/**
 * A lead with team-scoped `analytics.read` sees their own teams' numbers. For
 * a fact that carries a team that is a filter; for one that does not —
 * approvals, notifications — there is no honest way to narrow it, so it is
 * refused rather than shown in full.
 */
function scopeFilters(ctx: TenantContext, metric: MetricSpec): Filter[] {
  const scope = authz.effectiveScope(ctx, 'analytics.read');
  if (scope === 'any') return [];
  if (scope !== 'team') throw new ForbiddenError('analytics.read is required');

  const hasTeam = 'teamId' in FACT_CATALOGUE[metric.fact].fields;
  if (!hasTeam) throw new ForbiddenError(`${metric.fact} figures are not broken down by team, so a team-scoped reader cannot see them`);
  if (ctx.teamIds.length === 0) throw new ForbiddenError('you are not in a team');
  return [{ field: 'teamId', op: 'in', value: ctx.teamIds }];
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

const ROLLUP_MEASURES: Record<string, query.RollupMeasure> = {
  'tickets.created': 'created',
  'tickets.resolved': 'resolved',
  'tickets.breached': 'breached',
  'tickets.time_to_resolve': 'resolveMinutes',
  'tickets.first_response': 'firstResponseMinutes',
};

const SLICE_AXES = ['teamId', 'serviceId', 'priority'] as const;

/**
 * Whether the rollup can answer, and how.
 *
 * Eligible when the metric is one the rollup pre-sums, every filter is an
 * equality (or a single-value `in`) on a slice axis, and the axes involved —
 * fixed by a filter or opened by a breakdown — form a slice the cube stores.
 * Otherwise the facts are scanned. Both give the same answer; the integration
 * suite asserts it.
 */
export function rollupPlan(metric: MetricSpec, filters: Filter[], groupBy?: string): query.RollupPlan | null {
  if (!metric.builtin) return null;
  const measure = ROLLUP_MEASURES[metric.key];
  if (!measure) return null;

  const fixed: query.RollupPlan['fixed'] = { teamId: null, serviceId: null, priority: null };
  for (const filter of filters) {
    if (!(SLICE_AXES as readonly string[]).includes(filter.field)) return null;
    const axis = filter.field as (typeof SLICE_AXES)[number];
    const single = filter.op === 'eq' ? filter.value : filter.op === 'in' && Array.isArray(filter.value) && filter.value.length === 1 ? filter.value[0] : undefined;
    if (typeof single !== 'string' || fixed[axis] !== null) return null;
    fixed[axis] = single;
  }

  if (groupBy !== undefined && !(SLICE_AXES as readonly string[]).includes(groupBy)) return null;
  const grouped = groupBy as query.RollupPlan['groupBy'] | undefined;
  if (grouped && fixed[grouped] !== null) return null;

  const axes = new Set<string>([...SLICE_AXES.filter((axis) => fixed[axis] !== null), ...(grouped ? [grouped] : [])]);
  // The cube stores every subset except team+service, with or without priority.
  if (axes.has('teamId') && axes.has('serviceId')) return null;

  return { measure, fixed, groupBy: grouped ?? null };
}

/** A question, parsed and pinned to instants: everything an answer and its cache key depend on. */
interface PreparedQuery {
  parsed: z.output<typeof querySchema>;
  period: Period;
  bucket: Bucket;
}

/**
 * Parses a question and resolves its period once, so the cache key and the
 * answer are computed for the same instants even across midnight.
 */
function prepare(input: QueryInput, now: Date = new Date()): PreparedQuery {
  const parsed = querySchema.parse(input);
  const period = resolveRange(parsed.range as RangeKey, now, { from: parsed.from, to: parsed.to });
  return { parsed, period, bucket: parsed.bucket ?? bucketFor(period) };
}

/** The answer itself, without the S1 target (which is read fresh, after any cache). */
async function compute(ctx: TenantContext, { parsed, period, bucket }: PreparedQuery): Promise<QueryResult> {
  const metric = await resolveMetric(ctx, parsed.metricKey);

  assertFilters(metric.fact, parsed.filters);
  if (parsed.groupBy) assertDimension(metric.fact, parsed.groupBy);
  if (parsed.groupBy && parsed.series) throw new ValidationError('ask for a breakdown or a series, not both');

  const filters = [...parsed.filters, ...scopeFilters(ctx, metric)];
  const plan = rollupPlan(metric, filters, parsed.groupBy);
  const base = { metric: { key: metric.key, name: metric.name, unit: metric.unit, aggregate: metric.aggregate, fact: metric.fact }, period };

  return readTransaction(ctx, async (tx) => {
    const spec: query.QuerySpec = { metric, filters, period };

    if (parsed.series) {
      const series = plan ? await query.rollupSeries(tx, plan, period, bucket) : await query.series(tx, spec, bucket);
      return { ...base, bucket, series, source: plan ? 'rollup' : 'facts' };
    }

    if (parsed.groupBy) {
      const groups = plan ? await query.rollupGroups(tx, plan, period) : await query.groups(tx, spec, parsed.groupBy);
      const labelledBy = FACT_CATALOGUE[metric.fact].fields[parsed.groupBy]?.labelledBy;
      const labels = await query.labelsFor(tx, labelledBy, groups.map((group) => group.key).filter((key): key is string => key !== null));
      return {
        ...base,
        groups: groups.map((group) => ({ ...group, label: group.key === null ? null : (labels.get(group.key) ?? group.key) })),
        source: plan ? 'rollup' : 'facts',
      };
    }

    const value = plan ? await query.rollupScalar(tx, plan, period) : await query.scalar(tx, spec);
    return { ...base, value, source: plan ? 'rollup' : 'facts' };
  });
}

/** The metric whose answers carry a target (S1). A tenant's own copy of it does not: its target is its author's business. */
export const ATTAINMENT_METRIC = 'sla.attainment';

/** Declared by the SLA module's manifest; read here by key, so analytics needs nothing from that module but the string. */
export const ATTAINMENT_TARGET_SETTING = 'sla.attainment.target';

/**
 * The tenant's attainment target, as the reader's organisation resolves it.
 *
 * Read through `describeSetting`, which has no permission check (A8 E4): the
 * target belongs to the answer, so anybody allowed the answer may know what it
 * is measured against, and no page needs `admin.setting.read` for it. `null`
 * when it cannot be read: an answer without a target is one the SDK labels a
 * fallback, which is honest; a made-up 90 labelled `default` would not be.
 */
export async function attainmentTargetFor(ctx: TenantContext): Promise<AttainmentTarget | null> {
  try {
    const resolved = await describeSetting(ctx, ATTAINMENT_TARGET_SETTING);
    if (typeof resolved.value !== 'number') return null;
    return { value: resolved.value, unit: 'percent', source: resolved.source === 'platform-default' ? 'default' : 'setting' };
  } catch (error) {
    logger.warn('could not read the SLA attainment target; answering without one', { error: (error as Error).message });
    return null;
  }
}

type TargetReader = () => Promise<AttainmentTarget | null>;

/** Adds the S1 target to an attainment answer, and to nothing else. */
async function withTarget<T extends { metric: { key: string } }>(answer: T, readTarget: TargetReader): Promise<T> {
  if (answer.metric.key !== ATTAINMENT_METRIC) return answer;
  const target = await readTarget();
  return target ? { ...answer, target } : answer;
}

function toAnswer(result: QueryResult): QueryAnswer {
  return {
    metric: result.metric,
    period: { from: result.period.from.toISOString(), to: result.period.to.toISOString() },
    ...(result.bucket ? { bucket: result.bucket } : {}),
    ...(result.value !== undefined ? { value: result.value } : {}),
    ...(result.series ? { series: result.series.map((point) => ({ at: point.at.toISOString(), value: point.value })) } : {}),
    ...(result.groups ? { groups: result.groups } : {}),
    source: result.source,
  };
}

/**
 * One question, answered, with `Date`s: what forecasts, dashboard renders and
 * reports build on. Never cached (A8 R4c) — those callers do arithmetic on
 * the dates, and a render is many questions a cache in front of each answers.
 */
export async function evaluate(ctx: TenantContext, input: QueryInput): Promise<QueryResult> {
  authz.require(ctx, 'analytics.read');
  const result = await compute(ctx, prepare(input));
  return withTarget(result, () => attainmentTargetFor(ctx));
}

/**
 * One question, answered through the cache (A8 R4c): what `POST
 * /analytics/query` and the batch return. The permission check comes first,
 * and the cache key carries the caller's scope, so an answer is only ever
 * handed to somebody entitled to exactly the same one. The S1 target is read
 * after the cache, so a changed target shows at once.
 *
 * Off unless `ANALYTICS_QUERY_CACHE_SECONDS` is set; the answer is the same
 * shape either way.
 */
export async function evaluateCached(
  ctx: TenantContext,
  input: QueryInput,
  readTarget: TargetReader = () => attainmentTargetFor(ctx),
): Promise<QueryAnswer> {
  authz.require(ctx, 'analytics.read');
  const prepared = prepare(input);
  const load = async () => toAnswer(await compute(ctx, prepared));

  const ttl = loadConfig().ANALYTICS_QUERY_CACHE_SECONDS;
  const scope = scopeKeyFor(ctx);
  const answer =
    ttl > 0 && scope
      ? await readThrough(ctx.tenantId, queryHash({ scope, query: prepared.parsed, period: prepared.period, bucket: prepared.bucket }), ttl, load)
      : await load();
  return withTarget(answer, readTarget);
}

// ---------------------------------------------------------------------------
// Batches (A8 R4)
// ---------------------------------------------------------------------------

/** A Command centre asks 21 questions; thirty leaves room without inviting a scan of the catalogue. */
export const MAX_BATCH_QUERIES = 30;

/** Four read transactions at once per request: well inside the pool, and enough to overlap the slow ones. */
export const BATCH_CONCURRENCY = 4;

export const batchSchema = z
  .object({
    queries: z
      .array(z.object({ id: z.string().min(1).max(64).optional() }).passthrough())
      .min(1)
      .max(MAX_BATCH_QUERIES),
  })
  .strict()
  .superRefine((body, context) => {
    // A caller keys its answers by the ids it sent; two alike would make one
    // of them unreachable, so it is the envelope that is wrong.
    const seen = new Set<string>();
    body.queries.forEach((entry, index) => {
      if (entry.id === undefined) return;
      if (seen.has(entry.id)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['queries', index, 'id'], message: 'ids must be unique within a batch' });
      }
      seen.add(entry.id);
    });
  });

export type BatchInput = z.input<typeof batchSchema>;

export type BatchEntry =
  | { id?: string; ok: true; result: QueryAnswer }
  | { id?: string; ok: false; problem: ProblemDetails };

/** Runs `fn` over `items` at most `limit` at a time, keeping their order. `fn` must not throw. */
async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * One entry's failure as the problem the single route would have answered:
 * the same 422 for a malformed question, the same 403 for a team-less fact,
 * the same 404 for an unknown metric.
 */
function problemFor(error: unknown, ctx: TenantContext): ProblemDetails {
  const domain =
    error instanceof ZodError
      ? new ValidationError(
          'the request did not match the expected shape',
          error.issues.map((issue) => ({ field: issue.path.join('.') || '(body)', code: issue.code, message: issue.message })),
        )
      : error;
  if (!(domain instanceof DomainError) || domain.status >= 500) {
    logger.error('a batched metric query failed', { message: (error as Error).message, correlationId: ctx.correlationId });
  }
  return toProblemDetails(domain, ctx.correlationId);
}

/**
 * Many questions, one round trip (A8 R4).
 *
 * `analytics.read` is checked once, up front, so a reader with none gets one
 * 403 for the whole call rather than thirty (D9). After that every entry is
 * exactly a single query — the same cache, the same scope filters, the same
 * refusals — and a failure is that entry's problem, not the call's: a lead
 * asking for an approvals figure among ticket figures gets the ticket figures.
 * The S1 target is read at most once per call.
 */
export async function evaluateBatch(ctx: TenantContext, input: BatchInput): Promise<{ results: BatchEntry[] }> {
  authz.require(ctx, 'analytics.read');
  const { queries } = batchSchema.parse(input);

  let target: Promise<AttainmentTarget | null> | undefined;
  const readTarget: TargetReader = () => (target ??= attainmentTargetFor(ctx));

  const results = await mapLimit(queries, BATCH_CONCURRENCY, async (entry): Promise<BatchEntry> => {
    const { id, ...question } = entry;
    const echo = id === undefined ? {} : { id };
    try {
      return { ...echo, ok: true, result: await evaluateCached(ctx, question as QueryInput, readTarget) };
    } catch (error) {
      return { ...echo, ok: false, problem: problemFor(error, ctx) };
    }
  });
  return { results };
}

export const forecastSchema = querySchema.pick({ metricKey: true, filters: true, range: true, from: true, to: true }).extend({
  horizonDays: z.number().int().min(1).max(90).default(14),
});

/** A straight line through the series, extended. See `linearTrend` for what it is not. */
export async function forecast(ctx: TenantContext, input: z.input<typeof forecastSchema>): Promise<{ result: QueryResult; trend: Trend | null }> {
  const parsed = forecastSchema.parse(input);
  const result = await evaluate(ctx, { ...parsed, series: true, bucket: 'day' });
  const points = (result.series ?? []).filter((point) => point.value !== null).map((point) => ({ at: point.at, value: point.value! }));
  return { result, trend: linearTrend(points, parsed.horizonDays) };
}
