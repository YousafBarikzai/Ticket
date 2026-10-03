import { formatDuration, parseDuration } from '@itsm/ui/format';
import type { CalendarRow, SlaPolicyRow, SlaTargetRow } from '@itsm/sdk';
import { OPERATORS, fromExpression, isUnary } from '../../rules.js';
import { factFor, valueLabel } from '../../rules/facts.js';
import { PRIORITIES, PRIORITY_LABELS, type Priority } from '../../matrix.js';

/**
 * Service levels in words, and the pure models behind the editors (SPEC §6.1
 * `/sla/**`, B §3.4; fixes F26).
 *
 * Kept out of the components so the parts that can be wrong without anyone
 * noticing — a target silently dropped, a duration read as sixty minutes, a
 * policy described as matching tickets it does not — are functions with
 * tests.
 */

/* =========================================================================
 * Targets
 * ====================================================================== */

export const TARGET_TYPES = ['response', 'update', 'restoration', 'resolution', 'fulfilment', 'approval'] as const;
export type TargetType = (typeof TARGET_TYPES)[number];

/** What each promise is called, and what it measures. */
export const TARGET_LABELS: Readonly<Record<TargetType, { readonly label: string; readonly description: string }>> = {
  response: { label: 'Response', description: 'Time to the first reply' },
  update: { label: 'Update', description: 'Longest gap between updates' },
  restoration: { label: 'Restoration', description: 'Time to restore the service' },
  resolution: { label: 'Resolution', description: 'Time to resolve' },
  fulfilment: { label: 'Fulfilment', description: 'Time to fulfil a request' },
  approval: { label: 'Approval', description: 'Time to decide an approval' },
};

/** The two a new policy shows at first; the rest are behind "+ More targets". */
export const PRIMARY_TARGET_TYPES: readonly TargetType[] = ['response', 'resolution'];

export const DEFAULT_THRESHOLDS: readonly number[] = [50, 75, 90];

export function isTargetType(value: string): value is TargetType {
  return (TARGET_TYPES as readonly string[]).includes(value);
}

export function targetLabel(type: string): string {
  return isTargetType(type) ? TARGET_LABELS[type].label : type;
}

/**
 * A target in business time, written in hours and minutes: `1440` is "24 h",
 * not "1 d" — a day of an office calendar is nothing like a calendar day, and
 * "1 d" would be read as one.
 */
export function formatTarget(minutes: number, style: 'short' | 'long' = 'short'): string {
  return formatDuration(minutes, { units: ['h', 'm'], style, locale: 'en-GB' });
}

/**
 * What a duration field's text reads as, the way the field itself reads it:
 * minutes, `null` for empty, or `'invalid'` for anything that is not a
 * duration between a minute and a year. The field reports an unreadable
 * entry as "no value", which for a target would silently mean "no target" —
 * the bug this release fixes (`Number(x) || 60`, the other way round) — so
 * the editor keeps the text's own reading and refuses to save while a cell is
 * invalid.
 */
export function readDuration(text: string): number | null | 'invalid' {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  // Hours and minutes only, as the field is set up: a day of business time is not a day.
  if ((trimmed.toLowerCase().match(/[a-z]+/g) ?? []).some((word) => DAY_WORDS.has(word))) return 'invalid';
  const minutes = parseDuration(trimmed, { defaultUnit: 'm' });
  if (minutes === null || minutes < 1 || minutes > 525_600) return 'invalid';
  return minutes;
}

const DAY_WORDS: ReadonlySet<string> = new Set(['d', 'day', 'days']);

/** One cell of a targets grid: a priority × a promise, in minutes; absent = no target. */
export type TargetCells = Readonly<Record<string, number>>;

export const cellKey = (priority: string, type: string): string => `${priority}:${type}`;

export interface TargetsModel {
  readonly cells: TargetCells;
  /** Columns shown, in the fixed order: the types in use, or the primary two for an empty policy. */
  readonly types: readonly TargetType[];
  /** Warning thresholds per column. */
  readonly thresholds: Readonly<Record<string, readonly number[]>>;
}

/** The stored targets as a grid. Unknown priorities or types are kept aside by `targetsFrom`'s caller (they cannot be drawn). */
export function targetsModel(
  targets: readonly (Pick<SlaTargetRow, 'priority' | 'targetType' | 'minutes'> & { readonly warningThresholds?: readonly number[] | null })[],
): TargetsModel {
  const cells: Record<string, number> = {};
  const thresholds: Record<string, readonly number[]> = {};
  const used = new Set<string>();
  for (const target of targets) {
    cells[cellKey(target.priority, target.targetType)] = target.minutes;
    used.add(target.targetType);
    if (!thresholds[target.targetType]) thresholds[target.targetType] = [...(target.warningThresholds ?? DEFAULT_THRESHOLDS)];
  }
  const types = TARGET_TYPES.filter((type) => used.has(type));
  return { cells, types: types.length > 0 ? types : [...PRIMARY_TARGET_TYPES], thresholds };
}

/**
 * The grid as the API's target list: one entry per filled cell, in priority
 * then promise order. Empty cells are *no target*, never a default — and a
 * pair can appear once only, because a cell is keyed by it.
 */
export function targetsFrom(model: TargetsModel): { priority: Priority; targetType: TargetType; minutes: number; warningThresholds: number[] }[] {
  const out: { priority: Priority; targetType: TargetType; minutes: number; warningThresholds: number[] }[] = [];
  for (const priority of PRIORITIES) {
    for (const type of TARGET_TYPES) {
      const minutes = model.cells[cellKey(priority, type)];
      if (minutes === undefined) continue;
      out.push({ priority, targetType: type, minutes, warningThresholds: [...(model.thresholds[type] ?? DEFAULT_THRESHOLDS)] });
    }
  }
  return out;
}

/**
 * How many things differ between two grids: each cell added, removed or
 * changed, and each column whose thresholds changed. Cells whose text does
 * not read as a duration (`unreadable`) are changes too — something was
 * typed there — and are counted once however the grid holds them.
 */
export function targetChanges(before: TargetsModel, after: TargetsModel, unreadable: ReadonlySet<string> = new Set()): number {
  const keys = new Set([...Object.keys(before.cells), ...Object.keys(after.cells)]);
  const changed = new Set([...keys].filter((key) => before.cells[key] !== after.cells[key]));
  for (const key of unreadable) changed.add(key);
  let changes = changed.size;
  for (const type of TARGET_TYPES) {
    const hasCells = PRIORITIES.some((priority) => after.cells[cellKey(priority, type)] !== undefined);
    if (!hasCells) continue;
    const a = (before.thresholds[type] ?? DEFAULT_THRESHOLDS).join(',');
    const b = (after.thresholds[type] ?? DEFAULT_THRESHOLDS).join(',');
    if (a !== b) changes += 1;
  }
  return changes;
}

/**
 * Warning thresholds typed as "50, 75, 90": whole percentages from 1 to 99,
 * at most five (the API's limits), returned sorted and without repeats — or
 * a sentence saying what is wrong.
 */
export function readThresholds(text: string): { readonly value: number[] } | { readonly error: string } {
  const parts = text
    .split(/[,\s]+/)
    .map((part) => part.replace('%', '').trim())
    .filter(Boolean);
  if (parts.length === 0) return { value: [] };
  const numbers = parts.map(Number);
  if (numbers.some((number) => !Number.isInteger(number) || number < 1 || number > 99)) {
    return { error: 'Use whole percentages from 1 to 99, like 50, 75, 90.' };
  }
  const unique = [...new Set(numbers)].sort((a, b) => a - b);
  if (unique.length > 5) return { error: 'Warn at most five times.' };
  return { value: unique };
}

/* =========================================================================
 * Policies in words
 * ====================================================================== */

const OPERATOR_WORDS = new Map<string, string>(OPERATORS.map((entry) => [entry.value, entry.label]));

/**
 * What a policy's match reads as: "Every ticket", "Priority is P1 · Critical",
 * "Type is Incident and Channel is Email". An expression written outside the
 * builder (nested, negated) reads "Custom conditions" rather than a
 * simplified sentence that would describe different tickets.
 */
export function describeConditions(match: unknown): string {
  if (match === undefined || match === null) return 'Every ticket';
  const parsed = fromExpression(match);
  if (!parsed) return 'Custom conditions';
  if (parsed.conditions.length === 0) return 'Every ticket';
  const sentences = parsed.conditions.map((condition) => {
    const fact = factFor(condition.fact);
    const operator = OPERATOR_WORDS.get(condition.operator) ?? condition.operator;
    return isUnary(condition.operator) ? `${fact.label} ${operator}` : `${fact.label} ${operator} ${valueLabel(fact, condition.value)}`;
  });
  return sentences.join(parsed.join === 'or' ? ' or ' : ' and ');
}

/** How many conditions a match has: the automatic specificity is ten for each. */
export function conditionCount(match: unknown): number {
  const parsed = fromExpression(match);
  return parsed ? parsed.conditions.length : 1;
}

export function autoSpecificity(match: unknown): number {
  return Math.min(1000, conditionCount(match) * 10);
}

/**
 * Whose hours the clock runs on, in words.
 *
 * `group` follows the assigned team's calendar and falls back to the
 * policy's own (or around the clock). `fixed` — and `policy`, which the
 * seeded defaults store — use the policy's calendar. `requester` is accepted
 * by the API but the clock does not look up a requester's hours, so it is
 * described by what actually happens.
 */
export function describeClock(policy: Pick<SlaPolicyRow, 'calendarMode' | 'calendarId'>, calendars: readonly Pick<CalendarRow, 'id' | 'name'>[]): string {
  const calendar = policy.calendarId ? calendars.find((entry) => entry.id === policy.calendarId) : undefined;
  const own = policy.calendarId ? (calendar?.name ?? 'a calendar that no longer exists') : 'around the clock';
  switch (policy.calendarMode) {
    case 'group':
      return policy.calendarId ? `Team’s calendar, else ${calendar?.name ?? 'a calendar that no longer exists'}` : 'Team’s calendar';
    case 'requester':
      return policy.calendarId ? `Requester’s calendar · ${own}` : 'Requester’s calendar';
    default:
      return policy.calendarId ? `Fixed · ${own}` : 'Around the clock';
  }
}

/** A policy's state as a pill: every policy the API creates is live at once. */
export function policyState(status: string): { readonly label: string; readonly tone: 'success' | 'neutral' } {
  if (status === 'published') return { label: 'Live', tone: 'success' };
  if (status === 'draft') return { label: 'Draft', tone: 'neutral' };
  if (status === 'retired' || status === 'archived') return { label: 'Retired', tone: 'neutral' };
  // A state this page does not know keeps its own word, neutral: honest about not knowing, and not amber (D5).
  return { label: status.charAt(0).toUpperCase() + status.slice(1), tone: 'neutral' };
}

/** Evaluation order: most specific first (as the clock picks), then by name. */
export function inEvaluationOrder<T extends Pick<SlaPolicyRow, 'specificity' | 'name'>>(policies: readonly T[]): T[] {
  return [...policies].sort((a, b) => b.specificity - a.specificity || a.name.localeCompare(b.name));
}

/**
 * Where a new policy with this specificity would sit: the policies it
 * outranks and the ones still checked before it. Equal specificity is a tie
 * the clock breaks by storage order, which nobody can see, so it is called
 * out.
 */
export function rankAgainst(specificity: number, policies: readonly Pick<SlaPolicyRow, 'name' | 'specificity'>[]): {
  readonly above: string[];
  readonly below: string[];
  readonly tied: string[];
} {
  const ordered = inEvaluationOrder(policies);
  return {
    above: ordered.filter((policy) => policy.specificity > specificity).map((policy) => policy.name),
    below: ordered.filter((policy) => policy.specificity < specificity).map((policy) => policy.name),
    tied: ordered.filter((policy) => policy.specificity === specificity).map((policy) => policy.name),
  };
}

export const PRIORITY_ROWS: readonly { readonly id: Priority; readonly label: string }[] = PRIORITIES.map((priority) => ({
  id: priority,
  label: `${priority} · ${PRIORITY_LABELS[priority]}`,
}));

/* =========================================================================
 * Calendars
 * ====================================================================== */

/**
 * Every time zone this browser knows, the person's own first — so the common
 * choice is the first option and nobody types "Europe/Lo…" on their own desk.
 */
export function timeZones(own: string | undefined): string[] {
  let zones: string[] = [];
  try {
    zones = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.('timeZone') ?? [];
  } catch {
    zones = [];
  }
  if (zones.length === 0) zones = ['UTC', 'Europe/London'];
  if (!zones.includes('UTC')) zones = [...zones, 'UTC'];
  return own && zones.includes(own) ? [own, ...zones.filter((zone) => zone !== own)] : zones;
}

export interface HolidayDraft {
  readonly id: string;
  readonly date: string | null;
  readonly name: string;
}

/** The holidays as the API's `exceptions`, or what is wrong with them. */
export function holidaysFrom(rows: readonly HolidayDraft[]): { readonly value: { date: string; type: 'holiday'; name?: string }[] } | { readonly error: string } {
  const value: { date: string; type: 'holiday'; name?: string }[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row.date && row.name.trim() === '') continue;
    if (!row.date || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) return { error: `Choose a date for ${row.name.trim() ? `“${row.name.trim()}”` : 'each holiday'}.` };
    if (seen.has(row.date)) return { error: `${row.date} is listed twice.` };
    seen.add(row.date);
    value.push({ date: row.date, type: 'holiday', ...(row.name.trim() ? { name: row.name.trim() } : {}) });
  }
  return { value: value.sort((a, b) => a.date.localeCompare(b.date)) };
}

/** A calendar's hours as the week editor holds them: the API keys days `mon`…`sun`, as the clock reads them. */
export function weekFrom(hours: unknown): Partial<Record<'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun', { start: string; end: string }[]>> {
  const out: Partial<Record<'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun', { start: string; end: string }[]>> = {};
  if (typeof hours !== 'object' || hours === null) return out;
  for (const day of ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const) {
    const periods = (hours as Record<string, unknown>)[day];
    if (!Array.isArray(periods)) continue;
    const valid = periods.filter(
      (period): period is { start: string; end: string } =>
        typeof period === 'object' && period !== null && typeof (period as { start?: unknown }).start === 'string' && typeof (period as { end?: unknown }).end === 'string',
    );
    if (valid.length > 0) out[day] = valid.map((period) => ({ start: period.start, end: period.end }));
  }
  return out;
}

/** "Mon–Fri 09:00–17:30" style summary for a card's secondary line: how many days are open. */
export function openDaysSummary(hours: unknown): string {
  const week = weekFrom(hours);
  const open = Object.keys(week).length;
  if (open === 0) return 'Closed every day';
  if (open === 7) {
    const allDay = Object.values(week).every((periods) => periods?.length === 1 && periods[0]!.start === '00:00' && periods[0]!.end === '24:00');
    return allDay ? 'Open around the clock' : 'Open every day';
  }
  return `Open ${open} ${open === 1 ? 'day' : 'days'} a week`;
}
