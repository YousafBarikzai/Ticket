import { HEALTH_VERDICT_LOOK, type HealthVerdict } from '@itsm/contracts/health';
import type { SlaTimer, Ticket } from '@itsm/sdk';

/**
 * What the Overview works out from what the API answered (A6 §5.2; SPEC
 * §7.1.1): the scope and range in the URL, the day boundaries of the reader's
 * own zone, the queue's verdict, the KPI figures, the "Needs you" rows and
 * the estimated history behind the sparklines.
 *
 * Pure, with no React, no clock and no request: every function takes the
 * instant it is judging at and the zone it is judging in, so the same answers
 * always make the same page, a test can pin a day that changes its clocks,
 * and the Command centre may copy the verdict and the series (apps do not
 * import one another, A6 §2.2).
 */

/* -------------------------------------------------------------- The URL */

/** Whose work the page reads: the reader's own, or their teams'. */
export type Scope = 'mine' | 'team';

/** The page's period, which drives the Resolved tile and the analytics row (`?range=`). */
export type RangeKey = '7d' | '30d' | '90d';

export const RANGES: readonly RangeKey[] = ['7d', '30d', '90d'];
export const RANGE_DAYS: Readonly<Record<RangeKey, number>> = { '7d': 7, '30d': 30, '90d': 90 };
export const DEFAULT_RANGE: RangeKey = '30d';

/** The "Needs you" tabs (`?attention=`), in the order they are drawn. */
export const ATTENTION_TABS = ['all', 'breached', 'due-soon', 'replied', 'new', 'waiting-long', 'unassigned-urgent'] as const;
export type AttentionTabId = (typeof ATTENTION_TABS)[number];

export const ATTENTION_LABELS: Readonly<Record<AttentionTabId, string>> = {
  all: 'All',
  breached: 'Breached',
  'due-soon': 'Due soon',
  replied: 'Replied',
  new: 'New for you',
  'waiting-long': 'Waiting long',
  'unassigned-urgent': 'Unassigned urgent',
};

/** What the URL asked for, read as words this page knows; anything else is the default. */
export interface OverviewQuery {
  readonly scope: Scope;
  readonly range: RangeKey;
  readonly attention: AttentionTabId;
}

export type SearchParams = Record<string, string | string[] | undefined>;

function one(params: SearchParams, key: string): string {
  const value = params[key];
  const found = Array.isArray(value) ? value[0] : value;
  return typeof found === 'string' ? found.trim() : '';
}

/**
 * The page's query. `scope=team` only for somebody who has teams to read (or
 * reads every team): for anybody else the control is not drawn, and a
 * hand-written `?scope=team` reads their own work rather than an empty page.
 */
export function overviewQuery(params: SearchParams, options: { readonly teamScope: boolean }): OverviewQuery {
  const scope = one(params, 'scope') === 'team' && options.teamScope ? 'team' : 'mine';
  const range = (RANGES as readonly string[]).includes(one(params, 'range')) ? (one(params, 'range') as RangeKey) : DEFAULT_RANGE;
  const attention = (ATTENTION_TABS as readonly string[]).includes(one(params, 'attention')) ? (one(params, 'attention') as AttentionTabId) : 'all';
  return { scope, range, attention };
}

/**
 * The Overview with some of its query changed, defaults left out so the
 * plain page is plain `/overview`. `hash` is the card to land on: a "Needs
 * you" tab keeps the reader at the list rather than at the top of the page.
 */
export function overviewHref(query: OverviewQuery, change: Partial<OverviewQuery> = {}, hash?: string): string {
  const next = { ...query, ...change };
  const params = new URLSearchParams();
  if (next.scope !== 'mine') params.set('scope', next.scope);
  if (next.range !== DEFAULT_RANGE) params.set('range', next.range);
  if (next.attention !== 'all') params.set('attention', next.attention);
  const search = params.toString();
  return `/overview${search ? `?${search}` : ''}${hash ? `#${hash}` : ''}`;
}

/* ------------------------------------------------------------ Time */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** The window in which a running clock is "due soon" (R2's `due_soon`, the API's own hour). */
export const DUE_SOON_MS = HOUR;
/** A waiting ticket with no change for longer than this is "Waiting long". */
export const WAITING_LONG_MS = 3 * DAY;
/** The oldest unassigned ticket is judged against this (A6 §5.2.3 Team queue, §5.2.4 tile 5). */
export const UNASSIGNED_TARGET_MS = 4 * HOUR;
/** The Open tile's estimated history, in days (A6 §5.2.4). */
export const OPEN_SERIES_DAYS = 14;

interface WallClock {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

const wallFormats = new Map<string, Intl.DateTimeFormat>();

function wallClock(instant: Date, timeZone: string): WallClock {
  let format = wallFormats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    wallFormats.set(timeZone, format);
  }
  const parts: Record<string, number> = {};
  for (const part of format.formatToParts(instant)) if (part.type !== 'literal') parts[part.type] = Number(part.value);
  return { year: parts.year!, month: parts.month!, day: parts.day!, hour: parts.hour! % 24, minute: parts.minute!, second: parts.second! };
}

/** How far the zone's clocks are ahead of UTC at an instant, in ms. */
function offsetAt(instant: number, timeZone: string): number {
  const wall = wallClock(new Date(instant), timeZone);
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  return asUtc - (instant - (((instant % 1000) + 1000) % 1000));
}

/** `YYYY-MM-DD` of the day an instant falls on in a zone. */
export function localDayKey(instant: Date, timeZone: string): string {
  const wall = wallClock(instant, timeZone);
  return `${wall.year}-${String(wall.month).padStart(2, '0')}-${String(wall.day).padStart(2, '0')}`;
}

/** A calendar day `days` after (or before) another, by the calendar alone. */
export function addDays(key: string, days: number): string {
  const [year, month, day] = key.split('-').map(Number) as [number, number, number];
  const moved = new Date(Date.UTC(year, month - 1, day + days));
  return moved.toISOString().slice(0, 10);
}

/**
 * The instant a local day starts in a zone. Found by asking the zone its
 * offset twice, so a day whose clocks change — 25 Oct 2026 in London is 25
 * hours long, 28 Mar 2027 is 23 — starts at its own midnight.
 */
export function localMidnight(key: string, timeZone: string): Date {
  const [year, month, day] = key.split('-').map(Number) as [number, number, number];
  const guess = Date.UTC(year, month - 1, day);
  let instant = guess - offsetAt(guess, timeZone);
  instant = guess - offsetAt(instant, timeZone);
  return new Date(instant);
}

/** Today in the reader's zone, as the half-open window `[start, end)`. */
export function todayWindow(now: Date, timeZone: string): { readonly start: Date; readonly end: Date } {
  const key = localDayKey(now, timeZone);
  return { start: localMidnight(key, timeZone), end: localMidnight(addDays(key, 1), timeZone) };
}

/**
 * The `days` local days up to and including today, oldest first, each as
 * its `[start, end)` window: the buckets of the list-derived sparklines, in
 * the reader's own days (analytics buckets are UTC days, ADR-0064).
 */
export function localDays(now: Date, timeZone: string, days: number): { readonly key: string; readonly start: Date; readonly end: Date }[] {
  const today = localDayKey(now, timeZone);
  return Array.from({ length: Math.max(0, days) }, (_, index) => {
    const key = addDays(today, index - days + 1);
    return { key, start: localMidnight(key, timeZone), end: localMidnight(addDays(key, 1), timeZone) };
  });
}

/** The current period of `days` local days ending today, and the one before it. */
export function periods(now: Date, timeZone: string, days: number): { readonly start: Date; readonly previousStart: Date } {
  const today = localDayKey(now, timeZone);
  return {
    start: localMidnight(addDays(today, 1 - days), timeZone),
    previousStart: localMidnight(addDays(today, 1 - 2 * days), timeZone),
  };
}

/**
 * Where the resolved tickets behind the sparklines are read from: the
 * range's first day or the Open series' first day, whichever is earlier, so
 * one read serves both tiles.
 */
export function seriesSince(now: Date, timeZone: string, days: number): string {
  const range = periods(now, timeZone, days).start.getTime();
  const open = localDays(now, timeZone, OPEN_SERIES_DAYS)[0]!.start.getTime();
  return new Date(Math.min(range, open)).toISOString();
}

/** "40 min", "2 h", "3 d": a span floored to its largest whole unit, never rounded up. */
export function compactDuration(ms: number): string {
  const span = Math.max(0, ms);
  if (span < HOUR) return `${Math.max(1, Math.floor(span / MINUTE))} min`;
  if (span < DAY) return `${Math.floor(span / HOUR)} h`;
  return `${Math.floor(span / DAY)} d`;
}

/** "40 minutes", "1 hour", "4 days": the same span in words, for context lines. */
export function longDuration(ms: number): string {
  const span = Math.max(0, ms);
  const [count, unit] =
    span < HOUR ? [Math.max(1, Math.floor(span / MINUTE)), 'minute'] : span < DAY ? [Math.floor(span / HOUR), 'hour'] : [Math.floor(span / DAY), 'day'];
  return `${count} ${unit}${count === 1 ? '' : 's'}`;
}

/** "+40m", "+3h", "+2d": how far past its time something is. */
export function slip(ms: number): string {
  const span = Math.max(0, ms);
  if (span < HOUR) return `+${Math.max(1, Math.floor(span / MINUTE))}m`;
  if (span < DAY) return `+${Math.floor(span / HOUR)}h`;
  return `+${Math.floor(span / DAY)}d`;
}

/** "14:32" in the reader's zone and locale. */
export function clockLabel(instant: Date, locale: string, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(instant);
}

/** "2 Oct", in the reader's zone. */
export function dateLabel(instant: Date, locale: string, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, { timeZone, day: 'numeric', month: 'short' }).format(instant);
}

/** The page's one "As at": "As at Fri 2 Oct, 14:32" (A6 §5.2.2), in the reader's zone. */
export function asAtLabel(now: Date, locale: string, timeZone: string): string {
  const weekday = new Intl.DateTimeFormat(locale, { timeZone, weekday: 'short' }).format(now);
  return `As at ${weekday} ${dateLabel(now, locale, timeZone)}, ${clockLabel(now, locale, timeZone)}`;
}

/**
 * When something happened or is due, in words relative to the reader's
 * today: "today at 15:10", "yesterday at 15:10", "tomorrow at 09:00", or "on
 * 28 Sep at 15:10".
 */
export function dayAndTime(instant: Date, now: Date, locale: string, timeZone: string): string {
  const day = localDayKey(instant, timeZone);
  const today = localDayKey(now, timeZone);
  const clock = clockLabel(instant, locale, timeZone);
  if (day === today) return `today at ${clock}`;
  if (day === addDays(today, -1)) return `yesterday at ${clock}`;
  if (day === addDays(today, 1)) return `tomorrow at ${clock}`;
  return `on ${dateLabel(instant, locale, timeZone)} at ${clock}`;
}

/** A due time as a list shows it: "16:00" today, "Tomorrow 09:00", otherwise "2 Oct". */
export function dueLabel(instant: Date, now: Date, locale: string, timeZone: string): string {
  const day = localDayKey(instant, timeZone);
  const today = localDayKey(now, timeZone);
  if (day === today) return clockLabel(instant, locale, timeZone);
  if (day === addDays(today, 1)) return `Tomorrow ${clockLabel(instant, locale, timeZone)}`;
  return dateLabel(instant, locale, timeZone);
}

/* ------------------------------------------------------------ Tickets */

/** The waiting states (MOD-04): a requester, a supplier or an approval holds the ticket. */
export const WAITING_STATES = ['pending_requester', 'pending_third_party', 'pending_approval'] as const;
export type WaitingState = (typeof WAITING_STATES)[number];

/** "Requester", "Supplier", "Approval": who the ticket waits on, as the Waiting card says it. */
export const WAITING_ON: Readonly<Record<WaitingState, string>> = {
  pending_requester: 'Requester',
  pending_third_party: 'Supplier',
  pending_approval: 'Approval',
};

export function isWaiting(ticket: Pick<Ticket, 'status'>): boolean {
  return (WAITING_STATES as readonly string[]).includes(ticket.status);
}

function time(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  return Number.isFinite(at) ? at : null;
}

/** Open work whose due time has come (R2's `breached`): paused work is never breached, its clock is stopped. */
export function isBreached(ticket: Pick<Ticket, 'statusCategory' | 'dueAt'>, now: Date): boolean {
  const due = time(ticket.dueAt);
  return ticket.statusCategory === 'open' && due !== null && due <= now.getTime();
}

/** Open work due after now and within the hour (R2's `due_soon`). */
export function isDueSoon(ticket: Pick<Ticket, 'statusCategory' | 'dueAt'>, now: Date): boolean {
  const due = time(ticket.dueAt);
  return ticket.statusCategory === 'open' && due !== null && due > now.getTime() && due <= now.getTime() + DUE_SOON_MS;
}

/** Open work due within the reader's today, `[local midnight, next local midnight)`; a ticket breached yesterday is not due today. */
export function dueToday<T extends Pick<Ticket, 'statusCategory' | 'dueAt'>>(rows: readonly T[], now: Date, timeZone: string): T[] {
  const { start, end } = todayWindow(now, timeZone);
  return rows.filter((row) => {
    const due = time(row.dueAt);
    return row.statusCategory === 'open' && due !== null && due >= start.getTime() && due < end.getTime();
  });
}

/** The soonest open, not yet breached due time, or `null`. */
export function nextDue<T extends Pick<Ticket, 'statusCategory' | 'dueAt'>>(rows: readonly T[], now: Date): T | null {
  let best: T | null = null;
  for (const row of rows) {
    const due = time(row.dueAt);
    if (row.statusCategory !== 'open' || due === null || due <= now.getTime()) continue;
    if (best === null || due < time(best.dueAt)!) best = row;
  }
  return best;
}

/** The longest-breached open ticket, or `null`. */
export function oldestBreach<T extends Pick<Ticket, 'statusCategory' | 'dueAt'>>(rows: readonly T[], now: Date): T | null {
  let best: T | null = null;
  for (const row of rows) {
    if (!isBreached(row, now)) continue;
    if (best === null || time(row.dueAt)! < time(best.dueAt)!) best = row;
  }
  return best;
}

/* ------------------------------------------------------------ Counting */

/**
 * A figure and how far it can be trusted (A6 §3.2 rule 3): exact, a lower
 * bound because the count capped ("999+") or the probe list had more
 * ("200+"), or not known at all ("—", never a guessed 0).
 */
export interface Figure {
  readonly value: number | null;
  readonly atLeast: boolean;
  /** Counted from a probe list rather than a count: the InfoTip says so. */
  readonly probe: boolean;
}

export const UNKNOWN: Figure = { value: null, atLeast: false, probe: false };

export function exact(value: number): Figure {
  return { value, atLeast: false, probe: false };
}

/** A `/tickets/count` answer: capped at 1,000, which reads "999+". */
export function fromCount(count: { readonly count: number; readonly capped: boolean }): Figure {
  return count.capped ? { value: Math.min(count.count, 999), atLeast: true, probe: false } : exact(count.count);
}

/** A figure counted from a probe list: "200+" when the list had a next page. */
export function fromProbe(matched: number, capped: boolean): Figure {
  return { value: matched, atLeast: capped, probe: true };
}

/** Counts by key, from rows: what a grouped count would have said, when the API cannot say it. */
export function countBy<T>(rows: readonly T[], key: (row: T) => string | null): Map<string | null, number> {
  const counts = new Map<string | null, number>();
  for (const row of rows) {
    const value = key(row);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

export const PRIORITIES = ['P1', 'P2', 'P3', 'P4'] as const;

/** "2 P2 · 4 P3 · 3 P4": the priorities present, in order, zeros left out. */
export function prioritySplit(counts: ReadonlyMap<string | null, number> | Readonly<Record<string, number>>): string {
  const get = (key: string): number => (counts instanceof Map ? (counts.get(key) ?? 0) : ((counts as Record<string, number>)[key] ?? 0));
  const parts = PRIORITIES.filter((priority) => get(priority) > 0).map((priority) => `${get(priority)} ${priority}`);
  return parts.length > 0 ? parts.join(' · ') : 'None open';
}

/**
 * Tickets a day by local day: `instants` are the moments (ISO strings) to
 * count, `days` the buckets from `localDays`. An instant outside every
 * bucket is not counted.
 */
export function dailyCounts(instants: readonly (string | null | undefined)[], days: readonly { readonly start: Date; readonly end: Date }[]): number[] {
  const counts = days.map(() => 0);
  for (const iso of instants) {
    const at = time(iso);
    if (at === null) continue;
    const index = days.findIndex((day) => at >= day.start.getTime() && at < day.end.getTime());
    if (index >= 0) counts[index]! += 1;
  }
  return counts;
}

/** When a ticket stopped being open work: resolved, or closed without a resolution (a cancellation). */
function finishedAt(ticket: Pick<Ticket, 'resolvedAt' | 'closedAt'>): number | null {
  return time(ticket.resolvedAt) ?? time(ticket.closedAt);
}

/**
 * The open work there was at the end of each of the last `days` local days
 * (A6 §5.2.4 tile 1), estimated from when tickets were raised and resolved:
 * open(t) = raised by t and not finished by t. `open` is what is open now,
 * `finished` what was resolved within the window; a ticket finished before
 * it does not matter to it. Today's point is now.
 *
 * An estimate, and the tile says so: a ticket reassigned to the reader
 * counts from when it was raised, and one that was resolved and reopened in
 * the window counts as open throughout.
 */
export function deriveOpenSeries(
  open: readonly Pick<Ticket, 'createdAt'>[],
  finished: readonly Pick<Ticket, 'createdAt' | 'resolvedAt' | 'closedAt'>[],
  now: Date,
  timeZone: string,
  days: number = OPEN_SERIES_DAYS,
): number[] {
  return localDays(now, timeZone, days).map((day) => {
    const at = Math.min(day.end.getTime(), now.getTime());
    let count = 0;
    for (const ticket of open) {
      const raised = time(ticket.createdAt);
      if (raised !== null && raised <= at) count += 1;
    }
    for (const ticket of finished) {
      const raised = time(ticket.createdAt);
      const done = finishedAt(ticket);
      if (raised !== null && raised <= at && (done === null || done > at)) count += 1;
    }
    return count;
  });
}

/** R2g's age buckets (A8 R2g), youngest first: what a backlog's age is made of. */
export const AGE_BUCKETS = ['under_1d', '1d_3d', '3d_7d', '7d_30d', 'over_30d'] as const;
export type AgeBucket = (typeof AGE_BUCKETS)[number];

/**
 * Ages counted into R2g's buckets, each `[lower, upper)` in age — a ticket
 * exactly one day old is `1d_3d` — so a page that cannot ask the API for a
 * grouped count draws the same breakdown from a list.
 */
export function ageBuckets(instants: readonly (string | null | undefined)[], now: Date): Record<AgeBucket, number> {
  const out: Record<AgeBucket, number> = { under_1d: 0, '1d_3d': 0, '3d_7d': 0, '7d_30d': 0, over_30d: 0 };
  for (const iso of instants) {
    const at = time(iso);
    if (at === null) continue;
    const age = now.getTime() - at;
    const bucket: AgeBucket = age < DAY ? 'under_1d' : age < 3 * DAY ? '1d_3d' : age < 7 * DAY ? '3d_7d' : age < 30 * DAY ? '7d_30d' : 'over_30d';
    out[bucket] += 1;
  }
  return out;
}

/* ------------------------------------------------------------ The verdict */

/** What the verdict is judged on: the scope's figures and the desk's live facts. */
export interface VerdictInput {
  /** Open tickets past their due time. */
  readonly breached: number;
  /** Open tickets due within the hour. */
  readonly dueWithinHour: number;
  /** Unassigned P1 and P2 tickets in the reader's teams. */
  readonly unassignedUrgent: number;
  /** Whether a major incident is running (only for readers who may see one). */
  readonly majorIncident: boolean;
  /** Open tickets due within the reader's today. */
  readonly dueToday: number;
}

/** One reason the verdict is what it is, most pressing first. */
export type VerdictReason = 'breached' | 'due-within-hour' | 'unassigned-urgent' | 'major-incident' | 'due-today';

/** At this many tickets due today, the queue is at risk even if none is close. */
export const BUSY_DAY = 3;

/**
 * The queue's health (A6 §5.2.3, X-M3), in the one vocabulary every hero
 * uses (`@itsm/contracts/health`): **Off track** when anything is past its
 * due time; **At risk** when something is due within the hour, an urgent
 * ticket has nobody, a major incident is running, or three or more are due
 * today; otherwise **On track**. The reasons are every contributor, most
 * pressing first, for "Why?".
 */
export function queueVerdict(input: VerdictInput): { readonly verdict: HealthVerdict; readonly reasons: readonly VerdictReason[] } {
  const reasons: VerdictReason[] = [];
  if (input.breached > 0) reasons.push('breached');
  if (input.dueWithinHour > 0) reasons.push('due-within-hour');
  if (input.unassignedUrgent > 0) reasons.push('unassigned-urgent');
  if (input.majorIncident) reasons.push('major-incident');
  if (input.dueToday >= BUSY_DAY) reasons.push('due-today');
  const verdict: HealthVerdict = input.breached > 0 ? 'off_track' : reasons.length > 0 ? 'at_risk' : 'on_track';
  return { verdict, reasons };
}

/** The verdict's tone, label and glyph, from the shared map (never retyped). */
export function verdictLook(verdict: HealthVerdict): (typeof HEALTH_VERDICT_LOOK)[HealthVerdict] {
  return HEALTH_VERDICT_LOOK[verdict];
}

/* ------------------------------------------------------------ Clocks */

/** A running clock as the Overview reads it: which ticket, which target, how much of its time is used. */
export interface Clock {
  readonly ticket: Pick<Ticket, 'id' | 'number' | 'title'>;
  readonly targetType: string;
  readonly dueAt: string | null;
  /** Business time used, as a fraction of the time allowed: past 1 is breached. */
  readonly used: number;
  readonly breached: boolean;
  readonly breachedAt: string | null;
}

/**
 * The clock that decides a ticket's next deadline: of its timers that are
 * still counting — running, or breached and not yet met — the one due first.
 * Paused and finished timers are not running clocks (A6 §5.2.5 Time left).
 */
export function headlineTimer(timers: readonly SlaTimer[]): SlaTimer | null {
  const counting = timers.filter((timer) => (timer.state === 'running' || timer.state === 'breached') && !timer.metAt);
  if (counting.length === 0) return null;
  const dueOf = (timer: SlaTimer): number => time(timer.dueAt) ?? time(timer.breachedAt) ?? Number.POSITIVE_INFINITY;
  return [...counting].sort((a, b) => dueOf(a) - dueOf(b))[0]!;
}

/**
 * The share of a clock's allowed business time already used,
 * `elapsed / (elapsed + remaining)` (A6 §5.2.3 aside): business time, not
 * wall-clock, because that is what the target is measured in. A breached
 * clock is past 1; one whose budget cannot be read is drawn as just past.
 */
export function timeUsed(timer: Pick<SlaTimer, 'elapsedMs' | 'remainingMs' | 'state' | 'breachedAt'>): number {
  const elapsed = Math.max(0, timer.elapsedMs);
  const budget = elapsed + timer.remainingMs;
  const breached = timer.state === 'breached' || timer.breachedAt !== null || timer.remainingMs < 0;
  if (budget <= 0) return breached ? 1.01 : 0;
  const used = elapsed / budget;
  return breached ? Math.max(used, 1.01) : used;
}

/** "Resolution", "First response", "Update": a target's name, for "Resolution time used". */
export function targetName(targetType: string): string {
  switch (targetType) {
    case 'response':
      return 'Response';
    case 'resolution':
      return 'Resolution';
    case 'update':
      return 'Update';
    default: {
      const words = targetType.replace(/[_-]+/g, ' ').trim();
      return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Target';
    }
  }
}

/** A clock from a ticket and its timers, or `null` when none is counting. */
export function clockFrom(ticket: Pick<Ticket, 'id' | 'number' | 'title'>, timers: readonly SlaTimer[]): Clock | null {
  const timer = headlineTimer(timers);
  if (!timer) return null;
  const breached = timer.state === 'breached' || timer.breachedAt !== null || timer.remainingMs < 0;
  return { ticket, targetType: timer.targetType, dueAt: timer.dueAt, used: timeUsed(timer), breached, breachedAt: timer.breachedAt };
}

/** Clocks past this share of their time are worth a glance; the bullet turns amber there (A8 §4.6 `capWarn`). */
export const CLOCK_WARN = 0.8;

/* ------------------------------------------------------------ Needs you */

/** One ticket that needs the reader, and why. A ticket can be in several tabs; "All" keeps its most pressing reason. */
export interface AttentionEntry {
  readonly tab: Exclude<AttentionTabId, 'all'>;
  readonly ticket: Ticket;
  /** When the reason began: the breach, the reply, the last change. For the words and for ordering. */
  readonly since?: string | null;
}

/** The tabs' order of precedence when one ticket has several reasons. */
const PRECEDENCE: readonly Exclude<AttentionTabId, 'all'>[] = ['breached', 'due-soon', 'unassigned-urgent', 'replied', 'new', 'waiting-long'];

export interface AttentionInput {
  /** Open and paused tickets in scope (soonest due first). */
  readonly open: readonly Ticket[];
  /** The reader's own open tickets, for "New for you". */
  readonly mine: readonly Ticket[];
  /** Waiting tickets in scope. */
  readonly waiting: readonly Ticket[];
  /** Unassigned P1 and P2 tickets in the reader's teams. */
  readonly unassignedUrgent: readonly Ticket[];
  /** Unread notifications that say a customer replied: ticket id → when. */
  readonly replies: ReadonlyMap<string, string>;
  readonly now: Date;
}

/**
 * Every tab's entries (A6 §5.2.5 Needs you): Breached and Due soon from the
 * scope's open work; Replied, where an unread "comment added" notice names
 * one of those tickets; New for you, the reader's own new tickets; Waiting
 * long, a wait with no change for more than three days; Unassigned urgent,
 * a P1 or P2 nobody has. "All" is each ticket once, at its most pressing.
 */
export function attentionFrom(input: AttentionInput): Readonly<Record<AttentionTabId, readonly AttentionEntry[]>> {
  const { now } = input;
  const breached = input.open.filter((ticket) => isBreached(ticket, now)).map((ticket) => ({ tab: 'breached' as const, ticket, since: ticket.dueAt }));
  const dueSoon = input.open.filter((ticket) => isDueSoon(ticket, now)).map((ticket) => ({ tab: 'due-soon' as const, ticket, since: ticket.dueAt }));
  const replied = input.open
    .filter((ticket) => input.replies.has(ticket.id))
    .map((ticket) => ({ tab: 'replied' as const, ticket, since: input.replies.get(ticket.id) ?? null }))
    .sort((a, b) => (time(b.since) ?? 0) - (time(a.since) ?? 0));
  const fresh = input.mine.filter((ticket) => ticket.status === 'new').map((ticket) => ({ tab: 'new' as const, ticket, since: ticket.createdAt }));
  const waitingLong = input.waiting
    .filter((ticket) => isWaiting(ticket) && now.getTime() - (time(ticket.updatedAt) ?? now.getTime()) > WAITING_LONG_MS)
    .map((ticket) => ({ tab: 'waiting-long' as const, ticket, since: ticket.updatedAt }))
    .sort((a, b) => (time(a.since) ?? 0) - (time(b.since) ?? 0));
  const urgent = input.unassignedUrgent.map((ticket) => ({ tab: 'unassigned-urgent' as const, ticket, since: ticket.createdAt }));

  const byTab = { breached, 'due-soon': dueSoon, replied, new: fresh, 'waiting-long': waitingLong, 'unassigned-urgent': urgent };
  const seen = new Set<string>();
  const all: AttentionEntry[] = [];
  for (const tab of PRECEDENCE) {
    for (const entry of byTab[tab]) {
      if (seen.has(entry.ticket.id)) continue;
      seen.add(entry.ticket.id);
      all.push(entry);
    }
  }
  return { all, ...byTab };
}

/* ------------------------------------------------------------ KPIs */

/** The six KPI figures (A6 §5.2.4), identical with or without analytics (D9). */
export interface KpiFigures {
  readonly open: Figure;
  readonly dueToday: Figure;
  readonly breached: Figure;
  readonly waiting: Figure;
  readonly unassigned: Figure;
  readonly resolved: Figure;
}

/** A probe as the KPIs read it: the first page of rows and whether there was more. */
export interface ProbeRows {
  readonly rows: readonly Ticket[];
  readonly capped: boolean;
}

/**
 * What the KPI figures are worked out from. Each source is `null` when its
 * read failed or the API could not answer it (a grouped count on an API
 * older than R2g, a window it did not apply).
 */
export interface KpiSources {
  /** The scope's open and paused work, soonest due first. */
  readonly open: ProbeRows | null;
  /** The scope's waiting work. */
  readonly waiting: ProbeRows | null;
  /** Grouped-count totals (R2g), each exact. */
  readonly openTotal: number | null;
  readonly dueTodayTotal: number | null;
  readonly breachedTotal: number | null;
  readonly waitingTotal: number | null;
  /** `GET /tickets/count` of unassigned open work. */
  readonly unassigned: Figure | null;
  /** `GET /tickets/count` of resolved work in the period (R2). */
  readonly resolved: Figure | null;
  /** The resolved tickets read for the sparkline, for when the count could not say. */
  readonly resolvedRows: { readonly rows: readonly Ticket[]; readonly complete: boolean } | null;
  /** The period's first instant. */
  readonly periodStart: string;
  readonly now: Date;
  readonly timeZone: string;
}

/** A figure from a grouped count's total, else counted from the probe's rows, else unknown. */
function preferred(total: number | null, probe: ProbeRows | null, match: (ticket: Ticket) => boolean): Figure {
  if (total !== null) return exact(total);
  if (probe) return fromProbe(probe.rows.filter(match).length, probe.capped);
  return UNKNOWN;
}

/**
 * The six KPI figures (A6 §5.2.4), in one order of preference for each: a
 * grouped count's total (exact), a count (capped at "999+"), then the
 * probe's rows ("200+" when the page was full), and `UNKNOWN` ("—", never a
 * guessed 0) when nothing could say. The same for every reader, whatever
 * their analytics (D9).
 */
export function kpisFrom(sources: KpiSources): KpiFigures {
  const { now, timeZone } = sources;
  const { start, end } = todayWindow(now, timeZone);
  const since = Date.parse(sources.periodStart);
  const resolvedFromRows = (): Figure => {
    if (!sources.resolvedRows) return UNKNOWN;
    const matched = sources.resolvedRows.rows.filter((ticket) => (time(ticket.resolvedAt) ?? Number.NEGATIVE_INFINITY) >= since).length;
    return sources.resolvedRows.complete ? exact(matched) : fromProbe(matched, true);
  };
  return {
    open: preferred(sources.openTotal, sources.open, () => true),
    dueToday: preferred(sources.dueTodayTotal, sources.open, (ticket) => {
      const due = time(ticket.dueAt);
      return ticket.statusCategory === 'open' && due !== null && due >= start.getTime() && due < end.getTime();
    }),
    breached: preferred(sources.breachedTotal, sources.open, (ticket) => isBreached(ticket, now)),
    waiting: preferred(sources.waitingTotal, sources.waiting, () => true),
    unassigned: sources.unassigned ?? UNKNOWN,
    resolved: sources.resolved ?? resolvedFromRows(),
  };
}

/** The change between two figures, or `null` when either is unknown or only a lower bound. */
export function change(current: Figure, previous: Figure): number | null {
  if (current.value === null || previous.value === null || current.atLeast || previous.atLeast) return null;
  return current.value - previous.value;
}
