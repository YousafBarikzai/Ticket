import { z } from 'zod';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  authz,
  newId,
  readTransaction,
  recordAudit,
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

export interface QueryResult {
  metric: Pick<MetricSpec, 'key' | 'name' | 'unit' | 'aggregate' | 'fact'>;
  period: Period;
  bucket?: Bucket;
  value?: number | null;
  series?: query.SeriesPoint[];
  groups?: (query.GroupValue & { label: string | null })[];
  /** Which path answered, so a test can assert both agree and an operator can see which ran. */
  source: 'facts' | 'rollup';
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

  return transaction(ctx, async (tx) => {
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
}

export async function updateMetric(ctx: TenantContext, key: string, input: Partial<MetricDefinitionInput>) {
  authz.require(ctx, 'analytics.manage');
  return transaction(ctx, async (tx) => {
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

export async function evaluate(ctx: TenantContext, input: QueryInput): Promise<QueryResult> {
  authz.require(ctx, 'analytics.read');
  const parsed = querySchema.parse(input);
  const metric = await resolveMetric(ctx, parsed.metricKey);

  assertFilters(metric.fact, parsed.filters);
  if (parsed.groupBy) assertDimension(metric.fact, parsed.groupBy);
  if (parsed.groupBy && parsed.series) throw new ValidationError('ask for a breakdown or a series, not both');

  const filters = [...parsed.filters, ...scopeFilters(ctx, metric)];
  const period = resolveRange(parsed.range as RangeKey, new Date(), { from: parsed.from, to: parsed.to });
  const bucket = parsed.bucket ?? bucketFor(period);
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
