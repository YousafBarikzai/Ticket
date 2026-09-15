import { Prisma, type Tx } from '@itsm/platform';
import {
  FACT_CATALOGUE,
  timeColumnFor,
  type FactName,
  type FieldSpec,
  type Filter,
  type MetricSpec,
} from '../domain/metrics.js';
import { bucketStarts, truncateTo, type Bucket, type Period } from '../domain/ranges.js';
import { addDelta, emptyDelta, mean, type Grouping, type RollupDelta } from '../domain/rollup.js';

/**
 * The only place a metric becomes SQL.
 *
 * Every identifier — table, column, aggregate function — comes from the
 * catalogue and is spliced in with `Prisma.raw`; every value a person supplied
 * travels as a bound parameter. The two never meet. That is the property that
 * lets a tenant define its own metrics without anyone reviewing them for
 * injection, and it is why this file is small and boring on purpose.
 */

export interface QuerySpec {
  metric: MetricSpec;
  /** Filters the caller added on top of the metric's own. */
  filters: Filter[];
  period: Period;
}

export interface SeriesPoint {
  at: Date;
  value: number | null;
}

export interface GroupValue {
  key: string | null;
  value: number | null;
}

function column(fact: FactName, field: string): FieldSpec {
  const spec = FACT_CATALOGUE[fact].fields[field];
  if (!spec) throw new Error(`unknown field ${fact}.${field}`);
  return spec;
}

function predicate(fact: FactName, filter: Filter): Prisma.Sql {
  const spec = column(fact, filter.field);
  const col = Prisma.raw(`"${spec.column}"`);
  const cast = spec.type === 'date' ? Prisma.raw('::timestamptz') : Prisma.empty;

  switch (filter.op) {
    case 'is_null':
      return Prisma.sql`${col} IS NULL`;
    case 'not_null':
      return Prisma.sql`${col} IS NOT NULL`;
    case 'eq':
      return Prisma.sql`${col} = ${filter.value}${cast}`;
    case 'neq':
      return Prisma.sql`${col} <> ${filter.value}${cast}`;
    case 'gt':
      return Prisma.sql`${col} > ${filter.value}${cast}`;
    case 'gte':
      return Prisma.sql`${col} >= ${filter.value}${cast}`;
    case 'lt':
      return Prisma.sql`${col} < ${filter.value}${cast}`;
    case 'lte':
      return Prisma.sql`${col} <= ${filter.value}${cast}`;
    case 'in':
      return Prisma.sql`${col} IN (${Prisma.join(filter.value as (string | number)[])})`;
    case 'not_in':
      return Prisma.sql`${col} NOT IN (${Prisma.join(filter.value as (string | number)[])})`;
  }
}

/** The WHERE clause: the period on the metric's time column, then every filter. */
export function whereFor(spec: QuerySpec): Prisma.Sql {
  const { metric, filters, period } = spec;
  const time = Prisma.raw(`"${timeColumnFor(metric)}"`);
  const parts = [
    Prisma.sql`${time} >= ${period.from}`,
    Prisma.sql`${time} < ${period.to}`,
    ...[...metric.filters, ...filters].map((filter) => predicate(metric.fact, filter)),
  ];
  return Prisma.join(parts, ' AND ');
}

/** The SELECT expression for the metric's aggregate. */
export function aggregateFor(metric: MetricSpec): Prisma.Sql {
  const field = metric.field ? Prisma.raw(`"${column(metric.fact, metric.field).column}"`) : Prisma.empty;

  switch (metric.aggregate) {
    case 'count':
      return Prisma.sql`count(*)::float`;
    case 'sum':
      return Prisma.sql`coalesce(sum(${field}), 0)::float`;
    case 'avg':
      return Prisma.sql`avg(${field})::float`;
    case 'p50':
      return Prisma.sql`percentile_cont(0.5) WITHIN GROUP (ORDER BY ${field})::float`;
    case 'p90':
      return Prisma.sql`percentile_cont(0.9) WITHIN GROUP (ORDER BY ${field})::float`;
    case 'rate': {
      const numerator = Prisma.join((metric.numeratorFilters ?? []).map((filter) => predicate(metric.fact, filter)), ' AND ');
      return Prisma.sql`(count(*) FILTER (WHERE ${numerator})::float * 100 / nullif(count(*), 0))`;
    }
  }
}

function table(metric: MetricSpec): Prisma.Sql {
  return Prisma.raw(`"${FACT_CATALOGUE[metric.fact].table}"`);
}

function asNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'bigint' ? Number(value) : Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/** One number for the whole period. */
export async function scalar(tx: Tx, spec: QuerySpec): Promise<number | null> {
  const rows = await tx.$queryRaw<{ value: unknown }[]>`
    SELECT ${aggregateFor(spec.metric)} AS value FROM ${table(spec.metric)} WHERE ${whereFor(spec)}
  `;
  return asNumber(rows[0]?.value);
}

/**
 * One number per bucket, with a point for every bucket in the period.
 *
 * Buckets are UTC — the same days the rollup is keyed on — so the two paths
 * can be compared exactly. A zone-aware axis is a presentation concern for the
 * client, which knows the viewer's zone; the server does not.
 */
export async function series(tx: Tx, spec: QuerySpec, bucket: Bucket): Promise<SeriesPoint[]> {
  const time = Prisma.raw(`"${timeColumnFor(spec.metric)}"`);
  const unit = Prisma.raw(`'${bucket}'`);
  const rows = await tx.$queryRaw<{ at: Date; value: unknown }[]>`
    SELECT date_trunc(${unit}, ${time} AT TIME ZONE 'UTC') AS at, ${aggregateFor(spec.metric)} AS value
    FROM ${table(spec.metric)}
    WHERE ${whereFor(spec)}
    GROUP BY 1 ORDER BY 1
  `;

  // date_trunc on a timestamp-without-zone comes back as a naive Date the
  // driver reads in local time; re-read it as UTC so the key matches.
  const found = new Map(rows.map((row) => [truncateTo(asUtc(row.at), bucket).getTime(), asNumber(row.value)]));
  const empty = spec.metric.aggregate === 'count' || spec.metric.aggregate === 'sum' ? 0 : null;
  return bucketStarts(spec.period, bucket).map((at) => ({ at, value: found.has(at.getTime()) ? found.get(at.getTime())! : empty }));
}

function asUtc(naive: Date): Date {
  return new Date(Date.UTC(naive.getFullYear(), naive.getMonth(), naive.getDate()));
}

/** One number per value of a dimension. */
export async function groups(tx: Tx, spec: QuerySpec, groupBy: string): Promise<GroupValue[]> {
  const dimension = Prisma.raw(`"${column(spec.metric.fact, groupBy).column}"`);
  const rows = await tx.$queryRaw<{ key: string | null; value: unknown }[]>`
    SELECT ${dimension}::text AS key, ${aggregateFor(spec.metric)} AS value
    FROM ${table(spec.metric)}
    WHERE ${whereFor(spec)}
    GROUP BY 1 ORDER BY 2 DESC NULLS LAST LIMIT 100
  `;
  return rows.map((row) => ({ key: row.key, value: asNumber(row.value) }));
}

/** Display names for dimension keys, from the dimension tables. */
export async function labelsFor(tx: Tx, labelledBy: FieldSpec['labelledBy'], keys: string[]): Promise<Map<string, string>> {
  const labels = new Map<string, string>();
  if (!labelledBy || keys.length === 0) return labels;

  switch (labelledBy) {
    case 'dim_team':
      for (const row of await tx.dimTeam.findMany({ where: { teamId: { in: keys } } })) labels.set(row.teamId, row.name);
      break;
    case 'dim_service':
      for (const row of await tx.dimService.findMany({ where: { serviceId: { in: keys } } })) labels.set(row.serviceId, row.name);
      break;
    case 'dim_category':
      for (const row of await tx.dimCategory.findMany({ where: { categoryId: { in: keys } } })) labels.set(row.categoryId, row.name);
      break;
    case 'dim_channel':
      for (const row of await tx.dimChannel.findMany({ where: { key: { in: keys } } })) labels.set(row.key, row.name);
      break;
    case 'dim_user':
      for (const row of await tx.dimUser.findMany({ where: { userId: { in: keys }, validTo: null } })) labels.set(row.userId, row.displayName);
      break;
  }
  return labels;
}

// ---------------------------------------------------------------------------
// The rollup path.
//
// For the headline ticket metrics the daily rollup already holds the answer,
// pre-summed, and a year is a few thousand rows rather than a scan. The plan
// says which counters to read and which slice of the cube; the service decides
// whether a query is eligible.
// ---------------------------------------------------------------------------

export type RollupMeasure = 'created' | 'resolved' | 'closed' | 'breached' | 'resolveMinutes' | 'firstResponseMinutes';

export interface RollupPlan {
  measure: RollupMeasure;
  /** Fixed by an equality filter. */
  fixed: Grouping;
  /** Broken down by, if any. */
  groupBy: 'teamId' | 'serviceId' | 'priority' | null;
}

function sliceWhere(plan: RollupPlan) {
  const axis = (field: keyof Grouping) =>
    plan.fixed[field] !== null ? plan.fixed[field] : plan.groupBy === field ? { not: null } : null;
  return { teamId: axis('teamId'), serviceId: axis('serviceId'), priority: axis('priority') };
}

function measure(delta: RollupDelta, which: RollupMeasure): number | null {
  switch (which) {
    case 'resolveMinutes':
      return mean(delta.resolveMinutesSum, delta.resolveMinutesCount);
    case 'firstResponseMinutes':
      return mean(delta.firstResponseMinutesSum, delta.firstResponseMinutesCount);
    default:
      return delta[which];
  }
}

async function rollupRows(tx: Tx, plan: RollupPlan, period: Period) {
  return tx.rollupTicketDaily.findMany({
    where: { date: { gte: truncateTo(period.from, 'day'), lt: period.to }, ...sliceWhere(plan) },
    orderBy: { date: 'asc' },
  });
}

function fold(rows: RollupDelta[]): RollupDelta {
  return rows.reduce((sum, row) => addDelta(sum, row), emptyDelta());
}

export async function rollupScalar(tx: Tx, plan: RollupPlan, period: Period): Promise<number | null> {
  return measure(fold(await rollupRows(tx, plan, period)), plan.measure);
}

export async function rollupSeries(tx: Tx, plan: RollupPlan, period: Period, bucket: Bucket): Promise<SeriesPoint[]> {
  const byBucket = new Map<number, RollupDelta>();
  for (const row of await rollupRows(tx, plan, period)) {
    const key = truncateTo(row.date, bucket).getTime();
    byBucket.set(key, addDelta(byBucket.get(key) ?? emptyDelta(), row));
  }
  const empty = plan.measure === 'resolveMinutes' || plan.measure === 'firstResponseMinutes' ? null : 0;
  return bucketStarts(period, bucket).map((at) => {
    const delta = byBucket.get(at.getTime());
    return { at, value: delta ? measure(delta, plan.measure) : empty };
  });
}

export async function rollupGroups(tx: Tx, plan: RollupPlan, period: Period): Promise<GroupValue[]> {
  if (!plan.groupBy) return [];
  const byKey = new Map<string, RollupDelta>();
  for (const row of await rollupRows(tx, plan, period)) {
    const key = row[plan.groupBy] ?? '';
    byKey.set(key, addDelta(byKey.get(key) ?? emptyDelta(), row));
  }
  return [...byKey]
    .map(([key, delta]) => ({ key, value: measure(delta, plan.measure) }))
    .sort((a, b) => (b.value ?? -1) - (a.value ?? -1));
}
