import { z } from 'zod';
import { ValidationError } from '@itsm/platform';
import {
  AGGREGATES,
  FACTS,
  FACT_CATALOGUE,
  type Aggregate,
  type FactName,
  type FieldSpec,
  type Filter,
  type FilterOperator,
  type MetricSpec,
} from './metrics.js';

/**
 * Validating what a query asks for, before anything touches a database.
 *
 * A filter names a field, an operator and a value. The field has to exist in
 * the catalogue for the fact, the operator has to make sense for the field's
 * type, and the value has to be of that type. All three are checked here, so
 * the query builder downstream can assume a well-formed request and the error
 * a person sees names the filter rather than a SQL type mismatch.
 */

const scalar = z.union([z.string(), z.number(), z.boolean()]);

export const filterSchema: z.ZodType<Filter> = z.object({
  field: z.string().min(1).max(60),
  op: z.enum(['eq', 'neq', 'in', 'not_in', 'gt', 'gte', 'lt', 'lte', 'is_null', 'not_null']),
  value: z.union([scalar, z.array(z.union([z.string(), z.number()])).max(100), z.null()]).optional(),
});

export const metricDefinitionSchema = z.object({
  key: z
    .string()
    .regex(/^[a-z][a-z0-9_.]{1,60}$/, 'a key is lower-case letters, digits, dots and underscores'),
  name: z.string().min(1).max(120),
  description: z.string().max(1000).optional(),
  fact: z.enum(FACTS),
  aggregate: z.enum(AGGREGATES),
  field: z.string().max(60).optional(),
  filters: z.array(filterSchema).max(20).default([]),
  numeratorFilters: z.array(filterSchema).max(20).optional(),
  timeField: z.string().max(60).optional(),
  unit: z.enum(['count', 'minutes', 'percent']).default('count'),
});
export type MetricDefinitionInput = z.input<typeof metricDefinitionSchema>;

const OPERATORS_BY_TYPE: Record<FieldSpec['type'], readonly FilterOperator[]> = {
  string: ['eq', 'neq', 'in', 'not_in', 'is_null', 'not_null'],
  number: ['eq', 'neq', 'in', 'not_in', 'gt', 'gte', 'lt', 'lte', 'is_null', 'not_null'],
  boolean: ['eq', 'neq', 'is_null', 'not_null'],
  date: ['gt', 'gte', 'lt', 'lte', 'is_null', 'not_null'],
};

export function fieldFor(fact: FactName, name: string): FieldSpec {
  const spec = FACT_CATALOGUE[fact].fields[name];
  if (!spec) throw new ValidationError(`${fact} has no field "${name}"`);
  return spec;
}

function valueMatches(type: FieldSpec['type'], value: unknown): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'date':
      return typeof value === 'string' && !Number.isNaN(Date.parse(value));
  }
}

/** Throws a `ValidationError` naming the first filter that does not fit the fact. */
export function assertFilters(fact: FactName, filters: Filter[], label = 'filter'): void {
  filters.forEach((filter, index) => {
    const where = `${label} ${index + 1} (${filter.field})`;
    const spec = fieldFor(fact, filter.field);
    if (!OPERATORS_BY_TYPE[spec.type].includes(filter.op)) {
      throw new ValidationError(`${where}: "${filter.op}" does not apply to a ${spec.type}`);
    }

    if (filter.op === 'is_null' || filter.op === 'not_null') return;

    if (filter.op === 'in' || filter.op === 'not_in') {
      if (!Array.isArray(filter.value) || filter.value.length === 0) {
        throw new ValidationError(`${where}: "${filter.op}" needs a non-empty list`);
      }
      if (!filter.value.every((entry) => valueMatches(spec.type, entry))) {
        throw new ValidationError(`${where}: every value must be a ${spec.type}`);
      }
      return;
    }

    if (!valueMatches(spec.type, filter.value)) {
      throw new ValidationError(`${where}: value must be a ${spec.type}`);
    }
  });
}

/**
 * Checks that a metric hangs together: the field exists and is numeric where
 * the aggregate needs one, `count` and `rate` take none, and a rate says what
 * it is a rate of.
 */
export function assertMetric(metric: Omit<MetricSpec, 'builtin' | 'key' | 'name' | 'description'>): void {
  const needsField: Aggregate[] = ['sum', 'avg', 'p50', 'p90'];

  if (needsField.includes(metric.aggregate)) {
    if (!metric.field) throw new ValidationError(`${metric.aggregate} needs a field`);
    const spec = fieldFor(metric.fact, metric.field);
    if (spec.type !== 'number') throw new ValidationError(`${metric.aggregate} needs a numeric field; ${metric.field} is a ${spec.type}`);
  } else if (metric.field) {
    throw new ValidationError(`${metric.aggregate} takes no field`);
  }

  if (metric.aggregate === 'rate') {
    if (!metric.numeratorFilters || metric.numeratorFilters.length === 0) {
      throw new ValidationError('a rate needs numerator filters saying which rows count');
    }
    assertFilters(metric.fact, metric.numeratorFilters, 'numerator filter');
  } else if (metric.numeratorFilters) {
    throw new ValidationError('only a rate takes numerator filters');
  }

  if (metric.timeField && fieldFor(metric.fact, metric.timeField).type !== 'date') {
    throw new ValidationError(`${metric.timeField} is not a date, so a period cannot apply to it`);
  }

  assertFilters(metric.fact, metric.filters);
}

/** A breakdown field must be one the catalogue marks as a dimension. */
export function assertDimension(fact: FactName, groupBy: string): FieldSpec {
  const spec = fieldFor(fact, groupBy);
  if (!spec.dimension) throw new ValidationError(`${fact} cannot be broken down by ${groupBy}`);
  return spec;
}
