import type { MetricRange, MetricResult, MetricRow } from '@itsm/sdk';
import { channelInfo, type IconName } from '@itsm/ui';
import type { BarDatum, ChartSeries } from '@itsm/ui/charts';

/**
 * How the analytics module's numbers are written on a page (MOD-12; SPEC
 * §4.8, §6.1 Insights). Pure and serialisable-in, serialisable-out, so a
 * server component and a client drawer write a metric the same way.
 *
 * Three things the API leaves to the reader, decided once here:
 *
 *   - **Units.** `percent` arrives as 0–100 and is written as a percentage
 *     (the design system's formats take ratios); `minutes` is a duration —
 *     "1 h 12 min" on a stat, and hours or days on an axis once minutes stop
 *     being readable; `money` has no currency on the wire, so it is a plain
 *     two-decimal number rather than a guessed "£".
 *   - **Words.** Facts, dimensions and aggregates have names a person reads
 *     ("Average of time to resolve, over tickets"), never column names.
 *   - **Empty.** A group with no key is "Not set", never a blank bar.
 */

export type MetricUnit = MetricResult['metric']['unit'];

export const RANGE_LABELS: Readonly<Record<Exclude<MetricRange, 'custom'>, string>> = {
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
  '12m': 'Last 12 months',
  ytd: 'This year',
};

/** A range key from the URL or a widget, or the fallback when it is not one the API knows. */
export function rangeFrom(value: unknown, fallback: Exclude<MetricRange, 'custom'> = '30d'): Exclude<MetricRange, 'custom'> {
  return typeof value === 'string' && value in RANGE_LABELS ? (value as Exclude<MetricRange, 'custom'>) : fallback;
}

export function rangeLabel(range: string): string {
  return RANGE_LABELS[range as Exclude<MetricRange, 'custom'>] ?? 'Custom range';
}

/* -------------------------------------------------------------------------
 * Numbers
 * ---------------------------------------------------------------------- */

/** A stat card's value, from the API's: a percentage becomes a ratio. */
export function statValue(unit: MetricUnit, value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return unit === 'percent' ? value / 100 : value;
}

/** A stat card's format for a unit (`StatCard format`). */
export function statFormat(unit: MetricUnit): Intl.NumberFormatOptions & { readonly compact?: boolean; readonly duration?: 'minutes' } {
  switch (unit) {
    case 'percent':
      return { style: 'percent', maximumFractionDigits: 1 };
    case 'minutes':
      return { duration: 'minutes' };
    case 'money':
      return { minimumFractionDigits: 2, maximumFractionDigits: 2 };
    default:
      return { maximumFractionDigits: 0 };
  }
}

/**
 * How a chart of this unit is scaled and written: values are multiplied by
 * `factor` before drawing. Minutes move to hours past two hours and to days
 * past three days, so an axis reads "36 h" rather than "2,160 min".
 */
export interface ChartScale {
  readonly factor: number;
  readonly format: Intl.NumberFormatOptions;
}

export function chartScale(unit: MetricUnit, values: readonly (number | null | undefined)[]): ChartScale {
  if (unit === 'percent') return { factor: 1 / 100, format: { style: 'percent', maximumFractionDigits: 1 } };
  if (unit === 'money') return { factor: 1, format: { minimumFractionDigits: 2, maximumFractionDigits: 2 } };
  if (unit === 'minutes') {
    const largest = Math.max(0, ...values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value)));
    if (largest >= 72 * 60) return { factor: 1 / (24 * 60), format: { style: 'unit', unit: 'day', unitDisplay: 'short', maximumFractionDigits: 1 } };
    if (largest >= 120) return { factor: 1 / 60, format: { style: 'unit', unit: 'hour', unitDisplay: 'short', maximumFractionDigits: 1 } };
    return { factor: 1, format: { style: 'unit', unit: 'minute', unitDisplay: 'short', maximumFractionDigits: 0 } };
  }
  return { factor: 1, format: { maximumFractionDigits: 0 } };
}

function scaled(value: number | null | undefined, factor: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value * factor : null;
}

/** A series from `insights.query({ series: true })`, as a chart series. */
export function toSeries(id: string, label: string, series: MetricResult['series'], factor = 1, slot?: ChartSeries['slot']): ChartSeries {
  return {
    id,
    label,
    ...(slot ? { slot } : {}),
    points: (series ?? []).map((point) => ({ x: point.at, y: scaled(point.value, factor) })),
  };
}

/** Whether a result has anything worth drawing: a value, a point or a group that is not zero. */
export function hasData(result: MetricResult | undefined | null): boolean {
  if (!result) return false;
  if (typeof result.value === 'number' && result.value !== 0) return true;
  if (result.series?.some((point) => typeof point.value === 'number' && point.value !== 0)) return true;
  return result.groups?.some((group) => typeof group.value === 'number' && group.value !== 0) ?? false;
}

/* -------------------------------------------------------------------------
 * Groups and words
 * ---------------------------------------------------------------------- */

/** A breakdown's rows as bars. `channel` groups get the channel's glyph and word. */
export function toBars(groups: MetricResult['groups'], factor = 1, dimension?: string): BarDatum[] {
  return (groups ?? [])
    .filter((group) => typeof group.value === 'number' && Number.isFinite(group.value))
    .map((group, index) => {
      const key = group.key ?? '';
      const channel = dimension === 'channel' && key ? channelInfo(key) : null;
      const label = channel && (!group.label || group.label === key) ? channel.label : groupLabel(group, dimension);
      return {
        id: key || `none-${index}`,
        label,
        value: (group.value as number) * factor,
        ...(channel ? { icon: channel.icon as IconName } : {}),
      };
    });
}

const SENTENCE_KEYS: Readonly<Record<string, string>> = { P1: 'P1', P2: 'P2', P3: 'P3', P4: 'P4' };

/** A group's label: the dimension table's name, else the key in words, else "Not set". */
export function groupLabel(group: { readonly key: string | null; readonly label: string | null }, _dimension?: string): string {
  if (group.label && group.label.trim() !== '') return SENTENCE_KEYS[group.label] ?? sentence(group.label);
  if (group.key && group.key.trim() !== '') return SENTENCE_KEYS[group.key] ?? sentence(group.key);
  return 'Not set';
}

/** `pending_requester` → "Pending requester"; a label that already has capitals is left alone. */
function sentence(text: string): string {
  if (/[A-Z]/.test(text)) return text;
  const words = text.replace(/[_-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const DIMENSIONS: Readonly<Record<string, string>> = {
  type: 'Type',
  priority: 'Priority',
  status: 'Status',
  serviceId: 'Service',
  categoryId: 'Category',
  teamId: 'Team',
  assigneeId: 'Assignee',
  channel: 'Channel',
  target: 'Target',
  outcome: 'Outcome',
  subjectType: 'What was approved',
  deciderId: 'Approver',
  templateKey: 'Template',
  userId: 'Person',
  activityKey: 'Activity',
  kind: 'Kind',
  currency: 'Currency',
  scale: 'Scale',
};

/** A dimension a metric can be broken down by, in words. */
export function dimensionLabel(name: string): string {
  return DIMENSIONS[name] ?? sentence(name.replace(/Id$/, '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase());
}

const FACTS: Readonly<Record<string, string>> = {
  ticket: 'tickets',
  sla_timer: 'SLA targets',
  approval: 'approvals',
  task: 'tasks',
  notification: 'notifications',
  survey: 'survey responses',
  time_entry: 'time entries',
};

export function factLabel(fact: string): string {
  return FACTS[fact] ?? fact.replace(/_/g, ' ');
}

const FIELDS: Readonly<Record<string, string>> = {
  timeToResolveMinutes: 'time to resolve',
  timeToFirstResponseMinutes: 'time to first response',
  elapsedToResolveMinutes: 'elapsed time to resolve',
  reopenCount: 'reopens',
  commentCount: 'comments',
  pausedMinutes: 'paused time',
  businessMinutes: 'working time',
  marginMinutes: 'margin',
  turnaroundMinutes: 'turnaround',
  completionMinutes: 'completion time',
  latencyMinutes: 'delivery time',
  minutes: 'minutes',
  cost: 'cost',
  score: 'score',
};

function fieldLabel(field: string): string {
  return FIELDS[field] ?? field.replace(/Minutes$/, '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
}

/** What a metric measures, in one line: "Average of time to resolve, over tickets". */
export function measureSentence(metric: Pick<MetricRow, 'aggregate' | 'field' | 'fact'>): string {
  const over = factLabel(metric.fact);
  const field = metric.field ? fieldLabel(metric.field) : null;
  switch (metric.aggregate) {
    case 'count':
      return `Count of ${over}`;
    case 'rate':
      return `Share of ${over} that meet the condition`;
    case 'sum':
      return field ? `Total ${field}, over ${over}` : `Total, over ${over}`;
    case 'avg':
      return field ? `Average ${field}, over ${over}` : `Average, over ${over}`;
    case 'p50':
      return field ? `Median ${field}, over ${over}` : `Median, over ${over}`;
    case 'p90':
      return field ? `90th percentile of ${field}, over ${over}` : `90th percentile, over ${over}`;
    default:
      return `${sentence(metric.aggregate)} of ${over}`;
  }
}

const UNITS: Readonly<Record<string, string>> = { count: 'Count', minutes: 'Duration', percent: 'Percentage', money: 'Money' };

export function unitLabel(unit: string): string {
  return UNITS[unit] ?? sentence(unit);
}
