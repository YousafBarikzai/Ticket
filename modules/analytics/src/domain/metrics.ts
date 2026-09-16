/**
 * What can be measured, and how.
 *
 * Two catalogues live here. The **field catalogue** says, for each fact table,
 * which columns a filter or a breakdown may name and what type each one is. The
 * **metric catalogue** is the built-in metrics: a fact, an aggregate and
 * optionally a field, expressed in exactly the same shape a tenant-defined
 * metric takes, so there is one evaluator rather than a built-in path and a
 * custom path that drift apart.
 *
 * Everything a query can say is an entry in one of these lists. That is the
 * decision (ADR-0032): nothing a person types is ever an identifier in SQL.
 */

export const FACTS = ['ticket', 'sla_timer', 'approval', 'task', 'notification', 'survey', 'time_entry'] as const;
export type FactName = (typeof FACTS)[number];

export const AGGREGATES = ['count', 'sum', 'avg', 'p50', 'p90', 'rate'] as const;
export type Aggregate = (typeof AGGREGATES)[number];

export type FieldType = 'string' | 'number' | 'boolean' | 'date';

export interface FieldSpec {
  /** The column, as the database names it. Never user-supplied. */
  column: string;
  type: FieldType;
  /**
   * The column is a UUID. A bound parameter arrives as text, and PostgreSQL
   * will not compare `uuid = text` on its own, so the parameter is cast. The
   * value is still a parameter; only the cast is in the statement.
   */
  uuid?: boolean;
  /** May a widget break a metric down by this field? */
  dimension?: boolean;
  /** For a dimension: the table that names it, for labelling a chart. */
  labelledBy?: 'dim_team' | 'dim_service' | 'dim_category' | 'dim_channel' | 'dim_user';
}

export interface FactSpec {
  table: string;
  /** The instant a row belongs to on a time axis. */
  timeColumn: string;
  fields: Record<string, FieldSpec>;
}

const eventTimeFields = (created: string): Record<string, FieldSpec> => ({
  [created]: { column: snake(created), type: 'date' },
});

function snake(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

export const FACT_CATALOGUE: Record<FactName, FactSpec> = {
  ticket: {
    table: 'fact_ticket',
    timeColumn: 'created_at',
    fields: {
      type: { column: 'type', type: 'string', dimension: true },
      priority: { column: 'priority', type: 'string', dimension: true },
      status: { column: 'status', type: 'string', dimension: true },
      serviceId: { column: 'service_id', type: 'string', uuid: true, dimension: true, labelledBy: 'dim_service' },
      categoryId: { column: 'category_id', type: 'string', uuid: true, dimension: true, labelledBy: 'dim_category' },
      teamId: { column: 'team_id', type: 'string', uuid: true, dimension: true, labelledBy: 'dim_team' },
      assigneeId: { column: 'assignee_id', type: 'string', uuid: true, dimension: true, labelledBy: 'dim_user' },
      requesterId: { column: 'requester_id', type: 'string', uuid: true },
      channel: { column: 'channel', type: 'string', dimension: true, labelledBy: 'dim_channel' },
      ...eventTimeFields('createdAt'),
      firstResponseAt: { column: 'first_response_at', type: 'date' },
      resolvedAt: { column: 'resolved_at', type: 'date' },
      closedAt: { column: 'closed_at', type: 'date' },
      timeToFirstResponseMinutes: { column: 'time_to_first_response_minutes', type: 'number' },
      timeToResolveMinutes: { column: 'time_to_resolve_minutes', type: 'number' },
      elapsedToResolveMinutes: { column: 'elapsed_to_resolve_minutes', type: 'number' },
      reopenCount: { column: 'reopen_count', type: 'number' },
      commentCount: { column: 'comment_count', type: 'number' },
      breached: { column: 'breached', type: 'boolean' },
    },
  },
  sla_timer: {
    table: 'fact_sla_timer',
    timeColumn: 'started_at',
    fields: {
      target: { column: 'target', type: 'string', dimension: true },
      priority: { column: 'priority', type: 'string', dimension: true },
      teamId: { column: 'team_id', type: 'string', uuid: true, dimension: true, labelledBy: 'dim_team' },
      serviceId: { column: 'service_id', type: 'string', uuid: true, dimension: true, labelledBy: 'dim_service' },
      outcome: { column: 'outcome', type: 'string', dimension: true },
      startedAt: { column: 'started_at', type: 'date' },
      stoppedAt: { column: 'stopped_at', type: 'date' },
      pausedMinutes: { column: 'paused_minutes', type: 'number' },
      businessMinutes: { column: 'business_minutes', type: 'number' },
      marginMinutes: { column: 'margin_minutes', type: 'number' },
    },
  },
  approval: {
    table: 'fact_approval',
    timeColumn: 'requested_at',
    fields: {
      subjectType: { column: 'subject_type', type: 'string', dimension: true },
      outcome: { column: 'outcome', type: 'string', dimension: true },
      deciderId: { column: 'decider_id', type: 'string', uuid: true, dimension: true, labelledBy: 'dim_user' },
      requestedAt: { column: 'requested_at', type: 'date' },
      decidedAt: { column: 'decided_at', type: 'date' },
      turnaroundMinutes: { column: 'turnaround_minutes', type: 'number' },
    },
  },
  task: {
    table: 'fact_task',
    timeColumn: 'created_at',
    fields: {
      assigneeId: { column: 'assignee_id', type: 'string', uuid: true, dimension: true, labelledBy: 'dim_user' },
      teamId: { column: 'team_id', type: 'string', uuid: true, dimension: true, labelledBy: 'dim_team' },
      createdAt: { column: 'created_at', type: 'date' },
      completedAt: { column: 'completed_at', type: 'date' },
      completionMinutes: { column: 'completion_minutes', type: 'number' },
    },
  },
  notification: {
    table: 'fact_notification',
    timeColumn: 'queued_at',
    fields: {
      channel: { column: 'channel', type: 'string', dimension: true, labelledBy: 'dim_channel' },
      templateKey: { column: 'template_key', type: 'string', dimension: true },
      outcome: { column: 'outcome', type: 'string', dimension: true },
      queuedAt: { column: 'queued_at', type: 'date' },
      sentAt: { column: 'sent_at', type: 'date' },
      latencyMinutes: { column: 'latency_minutes', type: 'number' },
    },
  },
  time_entry: {
    table: 'fact_time_entry',
    timeColumn: 'logged_at',
    fields: {
      userId: { column: 'user_id', type: 'string', uuid: true, dimension: true, labelledBy: 'dim_user' },
      teamId: { column: 'team_id', type: 'string', uuid: true, dimension: true, labelledBy: 'dim_team' },
      serviceId: { column: 'service_id', type: 'string', uuid: true, dimension: true, labelledBy: 'dim_service' },
      activityKey: { column: 'activity_key', type: 'string', dimension: true },
      kind: { column: 'kind', type: 'string', dimension: true },
      currency: { column: 'currency', type: 'string', dimension: true },
      billable: { column: 'billable', type: 'boolean' },
      loggedAt: { column: 'logged_at', type: 'date' },
      minutes: { column: 'minutes', type: 'number' },
      cost: { column: 'cost', type: 'number' },
    },
  },
  survey: {
    table: 'fact_survey',
    timeColumn: 'responded_at',
    fields: {
      teamId: { column: 'team_id', type: 'string', uuid: true, dimension: true, labelledBy: 'dim_team' },
      serviceId: { column: 'service_id', type: 'string', uuid: true, dimension: true, labelledBy: 'dim_service' },
      scale: { column: 'scale', type: 'string', dimension: true },
      respondedAt: { column: 'responded_at', type: 'date' },
      score: { column: 'score', type: 'number' },
    },
  },
};

export type FilterOperator = 'eq' | 'neq' | 'in' | 'not_in' | 'gt' | 'gte' | 'lt' | 'lte' | 'is_null' | 'not_null';

export interface Filter {
  field: string;
  op: FilterOperator;
  value?: string | number | boolean | (string | number)[] | null;
}

export type Unit = 'count' | 'minutes' | 'percent' | 'money';

/** One metric, built-in or tenant-defined: the same shape either way. */
export interface MetricSpec {
  key: string;
  name: string;
  description: string;
  fact: FactName;
  aggregate: Aggregate;
  field?: string;
  filters: Filter[];
  /** For `rate`: the rows counted as the numerator, over `filters` as the whole. */
  numeratorFilters?: Filter[];
  /**
   * Which instant puts a row in a period. Defaults to the fact's own time
   * column — when the ticket was raised — but "tickets resolved this week"
   * means resolved this week, so a metric can say which date it lives on.
   */
  timeField?: string;
  unit: Unit;
  builtin: boolean;
}

const settled = (field: string): Filter => ({ field, op: 'not_null' });

/**
 * The built-in catalogue.
 *
 * Fourteen, chosen because each is a question a service review actually asks,
 * and named by the question rather than the column. Anything a tenant would
 * define is a variation on one of these with a filter.
 */
export const BUILTIN_METRICS: readonly MetricSpec[] = [
  {
    key: 'tickets.created',
    name: 'Tickets raised',
    description: 'How many tickets were raised in the period.',
    fact: 'ticket',
    aggregate: 'count',
    filters: [],
    unit: 'count',
    builtin: true,
  },
  {
    key: 'tickets.resolved',
    name: 'Tickets resolved',
    description: 'How many tickets were resolved in the period.',
    fact: 'ticket',
    aggregate: 'count',
    filters: [],
    timeField: 'resolvedAt',
    unit: 'count',
    builtin: true,
  },
  {
    key: 'tickets.open',
    name: 'Tickets still open',
    description: 'Tickets raised in the period that are not yet resolved or closed.',
    fact: 'ticket',
    aggregate: 'count',
    filters: [{ field: 'resolvedAt', op: 'is_null' }, { field: 'closedAt', op: 'is_null' }],
    unit: 'count',
    builtin: true,
  },
  {
    key: 'tickets.reopened',
    name: 'Tickets reopened',
    description: 'Tickets raised in the period that were reopened at least once.',
    fact: 'ticket',
    aggregate: 'count',
    filters: [{ field: 'reopenCount', op: 'gt', value: 0 }],
    unit: 'count',
    builtin: true,
  },
  {
    key: 'tickets.breached',
    name: 'Tickets that breached',
    description: 'Tickets raised in the period on which any SLA target was missed.',
    fact: 'ticket',
    aggregate: 'count',
    filters: [{ field: 'breached', op: 'eq', value: true }],
    unit: 'count',
    builtin: true,
  },
  {
    key: 'tickets.time_to_resolve',
    name: 'Time to resolve',
    description: 'Mean working minutes from raised to resolved, for tickets resolved in the period.',
    fact: 'ticket',
    aggregate: 'avg',
    field: 'timeToResolveMinutes',
    filters: [settled('timeToResolveMinutes')],
    timeField: 'resolvedAt',
    unit: 'minutes',
    builtin: true,
  },
  {
    key: 'tickets.time_to_resolve_p90',
    name: 'Time to resolve (90th percentile)',
    description: 'Nine in ten tickets resolved in the period were resolved within this many working minutes.',
    fact: 'ticket',
    aggregate: 'p90',
    field: 'timeToResolveMinutes',
    filters: [settled('timeToResolveMinutes')],
    timeField: 'resolvedAt',
    unit: 'minutes',
    builtin: true,
  },
  {
    key: 'tickets.first_response',
    name: 'Time to first response',
    description: 'Mean working minutes from raised to the first public reply, for tickets first answered in the period.',
    fact: 'ticket',
    aggregate: 'avg',
    field: 'timeToFirstResponseMinutes',
    filters: [settled('timeToFirstResponseMinutes')],
    timeField: 'firstResponseAt',
    unit: 'minutes',
    builtin: true,
  },
  {
    key: 'sla.attainment',
    name: 'SLA attainment',
    description: 'The share of finished targets that were met.',
    fact: 'sla_timer',
    aggregate: 'rate',
    filters: [{ field: 'outcome', op: 'in', value: ['met', 'breached'] }],
    numeratorFilters: [{ field: 'outcome', op: 'eq', value: 'met' }],
    unit: 'percent',
    builtin: true,
  },
  {
    key: 'sla.breaches',
    name: 'SLA breaches',
    description: 'Targets that were missed.',
    fact: 'sla_timer',
    aggregate: 'count',
    filters: [{ field: 'outcome', op: 'eq', value: 'breached' }],
    unit: 'count',
    builtin: true,
  },
  {
    key: 'approvals.turnaround',
    name: 'Approval turnaround',
    description: 'Mean minutes from request to decision, wall clock, for approvals decided in the period.',
    fact: 'approval',
    aggregate: 'avg',
    field: 'turnaroundMinutes',
    filters: [settled('turnaroundMinutes')],
    timeField: 'decidedAt',
    unit: 'minutes',
    builtin: true,
  },
  {
    key: 'tasks.completion_time',
    name: 'Task completion time',
    description: 'Mean working minutes from a task being raised to it being done, for tasks completed in the period.',
    fact: 'task',
    aggregate: 'avg',
    field: 'completionMinutes',
    filters: [settled('completionMinutes')],
    timeField: 'completedAt',
    unit: 'minutes',
    builtin: true,
  },
  {
    key: 'notifications.delivery_rate',
    name: 'Notification delivery rate',
    description: 'The share of settled notifications that were delivered. Below 100 % somebody is not being reached.',
    fact: 'notification',
    aggregate: 'rate',
    filters: [{ field: 'outcome', op: 'in', value: ['sent', 'failed'] }],
    numeratorFilters: [{ field: 'outcome', op: 'eq', value: 'sent' }],
    unit: 'percent',
    builtin: true,
  },
  {
    key: 'time.logged',
    name: 'Time logged',
    description: 'Minutes of effort recorded by hand or on a timer. Elapsed time is not effort and is not here.',
    fact: 'time_entry',
    aggregate: 'sum',
    field: 'minutes',
    filters: [{ field: 'kind', op: 'in', value: ['manual', 'timer'] }],
    unit: 'minutes',
    builtin: true,
  },
  {
    key: 'time.cost',
    name: 'Cost of time',
    description: 'What the recorded effort cost, at the rates that applied when it was logged. Mixed currencies are summed as numbers; break down by currency to keep them apart.',
    fact: 'time_entry',
    aggregate: 'sum',
    field: 'cost',
    filters: [{ field: 'kind', op: 'in', value: ['manual', 'timer'] }],
    unit: 'money',
    builtin: true,
  },
  {
    key: 'time.elapsed',
    name: 'Elapsed in working states',
    description: 'Minutes tickets spent in a working state, measured, not logged. A measure of how long work takes, never of how much was done.',
    fact: 'time_entry',
    aggregate: 'sum',
    field: 'minutes',
    filters: [{ field: 'kind', op: 'eq', value: 'automatic' }],
    unit: 'minutes',
    builtin: true,
  },
  {
    key: 'surveys.score',
    name: 'Satisfaction score',
    description: 'Mean survey score, 0–100. Reads zero rows until MOD-18 exists.',
    fact: 'survey',
    aggregate: 'avg',
    field: 'score',
    filters: [settled('score')],
    unit: 'percent',
    builtin: true,
  },
];

export function builtinMetric(key: string): MetricSpec | undefined {
  return BUILTIN_METRICS.find((metric) => metric.key === key);
}

/** The column a metric's period applies to. */
export function timeColumnFor(metric: Pick<MetricSpec, 'fact' | 'timeField'>): string {
  const spec = FACT_CATALOGUE[metric.fact];
  if (!metric.timeField) return spec.timeColumn;
  const field = spec.fields[metric.timeField];
  if (!field || field.type !== 'date') throw new Error(`${metric.fact}.${metric.timeField} is not a date`);
  return field.column;
}

/** Every dimension a fact can be broken down by, for a widget builder. */
export function dimensionsOf(fact: FactName): string[] {
  return Object.entries(FACT_CATALOGUE[fact].fields)
    .filter(([, spec]) => spec.dimension)
    .map(([name]) => name);
}
