import { compactDuration, dayAndTime } from './derive.js';

/**
 * The Overview's sentences (A6 §3.5; SPEC §7.0.4): each card's headline, the
 * hero's narrative and its trend line, written on the server next to the
 * data by pure functions.
 *
 * The rules every one keeps, and `headlines.test.ts` holds them to:
 *
 * 1. What changed, then by how much: "Resolved 412, raised 398 in 30 days:
 *    the queue fell by 14".
 * 2. One sentence, at most 110 characters, no full stop at the end.
 * 3. Numbers in the reader's locale.
 * 4. No data: "No tickets in this period"; too little to mean anything
 *    (fewer than three points): "Not enough history yet".
 * 5. No false precision: whole percentages, except a gap under one point
 *    ("0.6 points under").
 * 6. Nothing about the future without a forecast behind it: a due time is a
 *    fact, a trend line is not drawn forward.
 *
 * The SLA target is always the API's (`attainmentTarget()`), passed in;
 * there is no percentage literal here.
 */

export const MAX_HEADLINE = 110;
export const NO_TICKETS = 'No tickets in this period';
export const NOT_ENOUGH = 'Not enough history yet';
/** Points a series needs before a headline describes its shape (A6 §3.5 rule 4). */
export const MIN_POINTS = 3;

/** A sentence as a headline: no closing full stop, and the shorter form when the long one would not fit. */
export function finish(sentence: string, shorter?: string): string {
  const trimmed = sentence.trim().replace(/[.。]+$/u, '');
  if (trimmed.length <= MAX_HEADLINE || shorter === undefined) return trimmed;
  return finish(shorter);
}

function count(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value);
}

/** "85%": whole per cent, in the locale. */
function percent(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(value / 100);
}

/** "5 points", "0.6 points", "1 point": a gap, whole unless it is under one point. */
function points(gap: number, locale: string): string {
  const size = Math.abs(gap);
  const digits = size < 1 ? 1 : 0;
  const rounded = Number(size.toFixed(digits));
  const words = new Intl.NumberFormat(locale, { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(rounded);
  return `${words} ${rounded === 1 ? 'point' : 'points'}`;
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/** The known values of a series: `null` is a gap, not a zero. */
function known(series: readonly (number | null | undefined)[]): number[] {
  return series.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
}

/* -------------------------------------------------------------- Raised vs resolved */

export interface RaisedResolvedInput {
  readonly raised: readonly (number | null)[];
  readonly resolved: readonly (number | null)[];
  /** The period's length in days, as the range control says it. */
  readonly days: number;
  readonly locale: string;
}

/**
 * "Resolved 412, raised 398 in 30 days: the queue fell by 14" — or grew, or
 * held steady. The queue's change is resolved less raised, which is all the
 * two lines can claim: a reopened ticket is not in either.
 */
export function raisedVsResolved({ raised, resolved, days, locale }: RaisedResolvedInput): string {
  const raisedKnown = known(raised);
  const resolvedKnown = known(resolved);
  const raisedTotal = raisedKnown.reduce((sum, value) => sum + value, 0);
  const resolvedTotal = resolvedKnown.reduce((sum, value) => sum + value, 0);
  if (raisedTotal === 0 && resolvedTotal === 0) return NO_TICKETS;
  if (Math.min(raisedKnown.length, resolvedKnown.length) < MIN_POINTS) return NOT_ENOUGH;
  const difference = resolvedTotal - raisedTotal;
  const movement =
    difference > 0 ? `the queue fell by ${count(difference, locale)}` : difference < 0 ? `the queue grew by ${count(-difference, locale)}` : 'the queue held steady';
  return finish(`Resolved ${count(resolvedTotal, locale)}, raised ${count(raisedTotal, locale)} in ${count(days, locale)} days: ${movement}`);
}

/* -------------------------------------------------------------- SLA met */

export interface SlaMetInput {
  /** Attainment over the period, 0–100, or `null` when no target finished in it. */
  readonly attainment: number | null;
  /** The target, 0–100, from `attainmentTarget()`. */
  readonly target: number;
  readonly days: number;
  /** Attainment by target type (`response`, `resolution`, `update`), 0–100 each. */
  readonly byTarget?: readonly { readonly key: string | null; readonly value: number | null }[];
  readonly locale: string;
}

/** "updates", "responses", "resolutions": a target type as the subject of a clause. */
function targetPlural(key: string): string {
  switch (key) {
    case 'response':
      return 'responses';
    case 'resolution':
      return 'resolutions';
    case 'update':
      return 'updates';
    default:
      return key.replace(/[_-]+/g, ' ');
  }
}

/**
 * "85% of targets met in 30 days, 5 points under the 90% target; updates
 * fell furthest short". The gap is whole points unless it is under one; the
 * clause about the weakest target appears only when the desk is short and a
 * breakdown came with the answer.
 */
export function slaMet({ attainment, target, days, byTarget = [], locale }: SlaMetInput): string {
  if (attainment === null || !Number.isFinite(attainment)) return NO_TICKETS;
  const met = `${percent(attainment, locale)} of targets met in ${count(days, locale)} days`;
  const gap = attainment - target;
  const goal = `the ${percent(target, locale)} target`;
  if (Math.abs(gap) < 0.05) return finish(`${met}, on ${goal}`);
  if (gap > 0) return finish(`${met}, ${points(gap, locale)} above ${goal}`);
  const short = `${met}, ${points(gap, locale)} under ${goal}`;
  const weakest = byTarget
    .filter((row): row is { key: string; value: number } => typeof row.key === 'string' && typeof row.value === 'number' && row.value < target)
    .sort((a, b) => a.value - b.value)[0];
  return weakest ? finish(`${short}; ${targetPlural(weakest.key)} fell furthest short`, short) : finish(short);
}

/* -------------------------------------------------------------- Time left */

/**
 * "1 of 6 running clocks is past 80% used", or that some are past their
 * target, or that all have time to spare.
 */
export function timeLeft({ used, warnAt, locale }: { readonly used: readonly number[]; readonly warnAt: number; readonly locale: string }): string {
  const total = used.length;
  if (total === 0) return 'No clocks are running';
  const breached = used.filter((value) => value > 1).length;
  const warned = used.filter((value) => value >= warnAt).length;
  if (breached > 0) {
    return finish(`${count(breached, locale)} of ${count(total, locale)} running ${plural(total, 'clock', 'clocks')} ${plural(breached, 'is past its target', 'are past their target')}`);
  }
  if (warned > 0) {
    return finish(
      `${count(warned, locale)} of ${count(total, locale)} running ${plural(total, 'clock', 'clocks')} ${plural(warned, 'is', 'are')} past ${percent(warnAt * 100, locale)} used`,
    );
  }
  return total === 1 ? 'The one running clock has time to spare' : finish(`All ${count(total, locale)} running clocks have time to spare`);
}

/* -------------------------------------------------------------- Needs you */

/** "6 things need you · 1 breached". */
export function needsYou({ total, breached, locale }: { readonly total: number; readonly breached: number; readonly locale: string }): string {
  if (total === 0) return 'Nothing needs you right now';
  const head = `${count(total, locale)} ${plural(total, 'thing needs', 'things need')} you`;
  return finish(breached > 0 ? `${head} · ${count(breached, locale)} breached` : head);
}

/* -------------------------------------------------------------- Distributions */

export interface PriorityInput {
  readonly counts: ReadonlyMap<string | null, number>;
  readonly total: number;
  /** "your", or the teams' words: "in your teams", "across all teams". */
  readonly whose: { readonly kind: 'mine' } | { readonly kind: 'team'; readonly words: string };
  readonly locale: string;
}

/** "2 of your 9 are P2; none is P1" — the most urgent priority present, and that nothing is more urgent. */
export function myWorkByPriority({ counts, total, whose, locale }: PriorityInput): string {
  const of = (n: number): string =>
    whose.kind === 'mine' ? `${count(n, locale)} of your ${count(total, locale)}` : `${count(n, locale)} of ${count(total, locale)} ${whose.words}`;
  if (total === 0) return whose.kind === 'mine' ? 'Nothing open is yours' : finish(`Nothing open ${whose.words}`);
  const p1 = counts.get('P1') ?? 0;
  const p2 = counts.get('P2') ?? 0;
  if (p1 > 0) return finish(`${of(p1)} ${plural(p1, 'is', 'are')} P1`);
  if (p2 > 0) return finish(`${of(p2)} ${plural(p2, 'is', 'are')} P2; none is P1`);
  return finish(whose.kind === 'mine' ? `None of your ${count(total, locale)} is P1 or P2` : `None of ${count(total, locale)} ${whose.words} is P1 or P2`);
}

/** "41 open in your teams: 9 new, 26 in progress, 6 waiting". */
export function teamQueueByStatus({
  fresh,
  progress,
  waiting,
  other = 0,
  words,
  locale,
}: {
  readonly fresh: number;
  readonly progress: number;
  readonly waiting: number;
  readonly other?: number;
  /** "in your teams", "across all teams". */
  readonly words: string;
  readonly locale: string;
}): string {
  const total = fresh + progress + waiting + other;
  if (total === 0) return finish(`Nothing open ${words}`);
  const parts = [`${count(fresh, locale)} new`, `${count(progress, locale)} in progress`, `${count(waiting, locale)} waiting`];
  if (other > 0) parts.push(`${count(other, locale)} other`);
  return finish(`${count(total, locale)} open ${words}: ${parts.join(', ')}`);
}

/* -------------------------------------------------------------- The hero */

/** A ticket the hero names, with the moment that matters about it. */
export interface NamedTicket {
  readonly number: string;
  readonly at: Date;
  /** For a breach: the target it passed ("resolution"), when known. */
  readonly target?: string;
}

export interface NarrativeInput {
  /** The longest-breached ticket, and how many are breached in all. */
  readonly breached: NamedTicket | null;
  readonly breachedCount: number;
  /** The next ticket to come due. */
  readonly next: NamedTicket | null;
  readonly now: Date;
  readonly locale: string;
  readonly timeZone: string;
}

/** "is due in 40 min" today; "is due tomorrow at 09:00" or "on 5 Oct at 09:00" otherwise. */
function dueClause(next: NamedTicket, now: Date, locale: string, timeZone: string): string {
  const ms = next.at.getTime() - now.getTime();
  const sameDay = dayAndTime(next.at, now, locale, timeZone).startsWith('today');
  return sameDay ? `${next.number} is due in ${compactDuration(ms)}` : `${next.number} is due ${dayAndTime(next.at, now, locale, timeZone)}`;
}

/**
 * The hero's one sentence (A6 §5.2.3): what broke and when, then what breaks
 * next — "INC-004503 passed its resolution target yesterday at 15:10;
 * INC-004521 is due in 40 min". Facts only: a due time, never a trend.
 */
export function queueNarrative({ breached, breachedCount, next, now, locale, timeZone }: NarrativeInput): string {
  const nextPart = next ? dueClause(next, now, locale, timeZone) : null;
  if (breached && breachedCount > 0) {
    const when = dayAndTime(breached.at, now, locale, timeZone);
    const first =
      breachedCount === 1
        ? `${breached.number} passed its ${breached.target ? `${breached.target} ` : ''}target ${when}`
        : `${count(breachedCount, locale)} tickets are past their targets, the oldest ${breached.number} since ${when}`;
    return nextPart ? finish(`${first}; ${nextPart}`, first) : finish(first);
  }
  if (nextPart) return finish(`Nothing is past its target; ${nextPart}`);
  return 'Nothing is past its target and nothing has a deadline';
}

/**
 * The hero's trend line (X-M4): "Next breach in 40 min" when something comes
 * due today, otherwise that nothing (else) does. Never "As at" — the toolbar
 * says that, once — and never "since this week": verdict history is not
 * stored, so the line claims nothing it cannot know (A6 R-7).
 */
export function trendLine({ next, breachedCount, now, timeZone, locale }: Omit<NarrativeInput, 'breached'>): string {
  if (next && dayAndTime(next.at, now, locale, timeZone).startsWith('today')) return `Next breach in ${compactDuration(next.at.getTime() - now.getTime())}`;
  return breachedCount > 0 ? 'Nothing else due today' : 'Nothing due today';
}
