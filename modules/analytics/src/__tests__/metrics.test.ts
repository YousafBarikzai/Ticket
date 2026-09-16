import { describe, expect, it } from 'vitest';
import { ValidationError } from '@itsm/platform';
import { AGGREGATES, BUILTIN_METRICS, FACT_CATALOGUE, timeColumnFor } from '../domain/metrics.js';
import { assertDimension, assertFilters, assertMetric } from '../domain/filters.js';
import { aggregateFor, whereFor } from '../repo/query-repo.js';
import { rollupPlan } from '../service/metric-service.js';

/**
 * The property this module rests on: nothing a person supplies is ever an
 * identifier in SQL. These tests read the generated statement as text and
 * check that user values landed as parameters and catalogue names landed as
 * quoted columns — and that anything not in the catalogue never got that far.
 */

const period = { from: new Date('2026-03-01T00:00:00Z'), to: new Date('2026-04-01T00:00:00Z') };
const created = BUILTIN_METRICS.find((metric) => metric.key === 'tickets.created')!;

describe('the built-in catalogue', () => {
  it('validates against its own rules, every entry', () => {
    // A built-in that a tenant could not have defined is a built-in with a
    // second evaluator hiding somewhere.
    for (const metric of BUILTIN_METRICS) expect(() => assertMetric(metric)).not.toThrow();
  });

  it('has unique keys', () => {
    expect(new Set(BUILTIN_METRICS.map((metric) => metric.key)).size).toBe(BUILTIN_METRICS.length);
  });

  it('puts "resolved" on the resolution date, not the raised date', () => {
    const resolved = BUILTIN_METRICS.find((metric) => metric.key === 'tickets.resolved')!;
    expect(timeColumnFor(resolved)).toBe('resolved_at');
    expect(timeColumnFor(created)).toBe('created_at');
  });

  it('covers every aggregate the schema allows with at least one example or a test', () => {
    const used = new Set(BUILTIN_METRICS.map((metric) => metric.aggregate));
    for (const aggregate of AGGREGATES) {
      if (aggregate === 'sum' || aggregate === 'p50') continue; // exercised below
      expect(used.has(aggregate)).toBe(true);
    }
  });
});

describe('filters are checked before they are compiled', () => {
  it('refuses a field the fact does not have', () => {
    expect(() => assertFilters('ticket', [{ field: 'password', op: 'eq', value: 'x' }])).toThrow(ValidationError);
  });

  it('refuses an operator that does not fit the type', () => {
    expect(() => assertFilters('ticket', [{ field: 'priority', op: 'gt', value: 'P1' }])).toThrow(/does not apply to a string/);
  });

  it('refuses a value of the wrong type', () => {
    expect(() => assertFilters('ticket', [{ field: 'reopenCount', op: 'gt', value: 'many' }])).toThrow(/must be a number/);
  });

  it('refuses an empty list', () => {
    expect(() => assertFilters('ticket', [{ field: 'priority', op: 'in', value: [] }])).toThrow(/non-empty/);
  });

  it('refuses breaking down by a measure', () => {
    expect(() => assertDimension('ticket', 'timeToResolveMinutes')).toThrow(/cannot be broken down/);
    expect(assertDimension('ticket', 'teamId').labelledBy).toBe('dim_team');
  });

  it('refuses a rate with nothing to count', () => {
    expect(() => assertMetric({ fact: 'ticket', aggregate: 'rate', filters: [], unit: 'percent' })).toThrow(/numerator/);
  });

  it('refuses an average of a string', () => {
    expect(() => assertMetric({ fact: 'ticket', aggregate: 'avg', field: 'priority', filters: [], unit: 'minutes' })).toThrow(/numeric/);
  });
});

describe('what reaches SQL', () => {
  it('quotes catalogue columns and parameterises values', () => {
    const where = whereFor({
      metric: created,
      filters: [
        { field: 'priority', op: 'in', value: ['P1', 'P2'] },
        { field: 'teamId', op: 'eq', value: '11111111-1111-4111-8111-111111111111' },
        { field: 'reopenCount', op: 'gt', value: 0 },
      ],
      period,
    });
    expect(where.sql).toContain('"created_at" >= ');
    expect(where.sql).toContain('"priority" IN (');
    expect(where.sql).toContain('"team_id" = ');
    // Every user value is a placeholder, never text in the statement.
    expect(where.sql).not.toContain('P1');
    expect(where.sql).not.toContain('11111111');
    expect(where.values).toEqual([period.from, period.to, 'P1', 'P2', '11111111-1111-4111-8111-111111111111', 0]);
  });

  it('casts a parameter compared with a UUID column, in a list too', () => {
    // Prisma sends a string as text, and PostgreSQL refuses `uuid = text`; the
    // first CI run of the team-scope test was a 500 for exactly this reason.
    const team = '11111111-1111-4111-8111-111111111111';
    const where = whereFor({
      metric: created,
      filters: [{ field: 'teamId', op: 'eq', value: team }, { field: 'assigneeId', op: 'in', value: [team, team] }],
      period,
    });
    expect(where.sql).toMatch(/"team_id" = (\$\d+|\?)::uuid/);
    expect(where.sql).toMatch(/"assignee_id" IN \((\$\d+|\?)::uuid,(\$\d+|\?)::uuid\)/);
    expect(where.sql).not.toContain(team);
    // A plain string column is not cast.
    const plain = whereFor({ metric: created, filters: [{ field: 'priority', op: 'eq', value: 'P1' }], period });
    expect(plain.sql).not.toContain('::uuid');
  });

  it('casts a date value at the parameter, not in the text', () => {
    const where = whereFor({ metric: created, filters: [{ field: 'resolvedAt', op: 'gte', value: '2026-03-15T00:00:00Z' }], period });
    expect(where.sql).toMatch(/"resolved_at" >= \$\d+::timestamptz|"resolved_at" >= \?::timestamptz/);
    expect(where.values).toContain('2026-03-15T00:00:00Z');
  });

  it('builds each aggregate from the catalogue column', () => {
    expect(aggregateFor(created).sql).toBe('count(*)::float');
    const p90 = BUILTIN_METRICS.find((metric) => metric.key === 'tickets.time_to_resolve_p90')!;
    expect(aggregateFor(p90).sql).toContain('percentile_cont(0.9) WITHIN GROUP (ORDER BY "time_to_resolve_minutes")');
    const rate = BUILTIN_METRICS.find((metric) => metric.key === 'sla.attainment')!;
    expect(aggregateFor(rate).sql).toContain('count(*) FILTER (WHERE "outcome" = ');
    expect(aggregateFor(rate).values).toEqual(['met']);
    const sum = aggregateFor({ ...created, aggregate: 'sum', field: 'commentCount' });
    expect(sum.sql).toBe('coalesce(sum("comment_count"), 0)::float');
    const p50 = aggregateFor({ ...created, aggregate: 'p50', field: 'commentCount' });
    expect(p50.sql).toContain('percentile_cont(0.5)');
  });

  it('every column name in the catalogue is a plain identifier', () => {
    // The one place a quoted identifier could be broken: a column name with a
    // quote in it. There is none, and this keeps it that way.
    for (const spec of Object.values(FACT_CATALOGUE)) {
      expect(spec.table).toMatch(/^[a-z_]+$/);
      for (const field of Object.values(spec.fields)) expect(field.column).toMatch(/^[a-z_]+$/);
    }
  });
});

describe('when the rollup may answer', () => {
  const team = '11111111-1111-4111-8111-111111111111';
  const service = '33333333-3333-4333-8333-333333333333';

  it('answers the headline count with no filters', () => {
    expect(rollupPlan(created, [])).toEqual({ measure: 'created', fixed: { teamId: null, serviceId: null, priority: null }, groupBy: null });
  });

  it('answers a team broken down by priority', () => {
    const plan = rollupPlan(created, [{ field: 'teamId', op: 'eq', value: team }], 'priority');
    expect(plan?.fixed.teamId).toBe(team);
    expect(plan?.groupBy).toBe('priority');
  });

  it('declines team and service together, which the cube does not store', () => {
    expect(rollupPlan(created, [{ field: 'teamId', op: 'eq', value: team }, { field: 'serviceId', op: 'eq', value: service }])).toBeNull();
    expect(rollupPlan(created, [{ field: 'teamId', op: 'eq', value: team }], 'serviceId')).toBeNull();
  });

  it('declines a filter on anything but a slice axis', () => {
    expect(rollupPlan(created, [{ field: 'channel', op: 'eq', value: 'email' }])).toBeNull();
    expect(rollupPlan(created, [{ field: 'priority', op: 'in', value: ['P1', 'P2'] }])).toBeNull();
  });

  it('declines a metric the rollup does not carry', () => {
    const reopened = BUILTIN_METRICS.find((metric) => metric.key === 'tickets.reopened')!;
    expect(rollupPlan(reopened, [])).toBeNull();
  });

  it('declines a tenant-defined metric even when it looks identical', () => {
    // A tenant's copy of "tickets raised" might add a filter tomorrow; the
    // rollup would not know.
    expect(rollupPlan({ ...created, builtin: false }, [])).toBeNull();
  });
});
