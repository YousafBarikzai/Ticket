import { BACKLOG_ESTIMATE, type BacklogPoint } from './backlog.js';

/**
 * Administration's headline sentences (A7 §2.5; SPEC §7.0.4): the line under
 * a chart's title that says what the chart shows, written on the server from
 * the same data the chart draws. A chart passes it as `headline`, and it is
 * also the figure's accessible summary.
 *
 * The rules each function keeps, held by `headlines.test.ts`:
 *
 * 1. Numbers first, present tense, no adjectives, British English.
 * 2. One sentence, at most 110 characters, no full stop at the end; a
 *    shorter form when the long one would not fit.
 * 3. What changed, then by how much. Percentages compare in points.
 * 4. No data: "No tickets in this period". Too little to describe a shape:
 *    "Not enough history yet". Never "—" without words, never a figure the
 *    card does not show.
 * 5. Nothing about the future without a forecast and its fit.
 * 6. The SLA target comes in as a number (`attainmentTarget()`); there is no
 *    percentage literal here.
 */

export const MAX_HEADLINE = 110;
export const NO_TICKETS = 'No tickets in this period';
export const NOT_ENOUGH = 'Not enough history yet';
/** Points a series needs before a headline describes its shape. */
export const MIN_POINTS = 3;

/** A sentence as a headline: trimmed, no closing full stop, and the shorter form when the long one would not fit. */
export function finish(sentence: string, shorter?: string): string {
  const trimmed = sentence.trim().replace(/[.]+$/u, '');
  if (trimmed.length <= MAX_HEADLINE || shorter === undefined) return trimmed.length <= MAX_HEADLINE ? trimmed : `${trimmed.slice(0, MAX_HEADLINE - 1).trimEnd()}…`;
  return finish(shorter);
}

function whole(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value);
}

/** "85%": a 0–100 figure as a whole percentage in the locale. */
function percent(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(value / 100);
}

/** "5 points", "0.6 points", "1 point": a gap in percentage points, whole unless under one. */
function points(gap: number, locale: string): string {
  const size = Math.abs(gap);
  const digits = size < 1 ? 1 : 0;
  const rounded = Number(size.toFixed(digits));
  const words = new Intl.NumberFormat(locale, { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(rounded);
  return `${words} ${rounded === 1 ? 'point' : 'points'}`;
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

function known(values: readonly (number | null | undefined)[]): number[] {
  return values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
}

const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0);

/** "the last 30 days" and the like, as `periodPhrase()` writes it. */
export type PeriodWords = string;

/* ----------------------------------------------------------- Raised vs resolved */

/**
 * "Resolved 415, raised 448: the backlog grew by 33 in the last 30 days". The
 * change is resolved less raised, all the two lines can claim.
 */
export function volumeHeadline(
  raised: readonly (number | null)[],
  resolved: readonly (number | null)[],
  period: PeriodWords,
  locale = 'en-GB',
): string {
  const raisedKnown = known(raised);
  const resolvedKnown = known(resolved);
  const raisedTotal = sum(raisedKnown);
  const resolvedTotal = sum(resolvedKnown);
  if (raisedTotal === 0 && resolvedTotal === 0) return NO_TICKETS;
  if (Math.min(raisedKnown.length, resolvedKnown.length) < MIN_POINTS) return NOT_ENOUGH;
  const change = raisedTotal - resolvedTotal;
  const movement =
    change > 0 ? `the backlog grew by ${whole(change, locale)}` : change < 0 ? `the backlog fell by ${whole(-change, locale)}` : 'the backlog held steady';
  return finish(`Resolved ${whole(resolvedTotal, locale)}, raised ${whole(raisedTotal, locale)}: ${movement} in ${period}`);
}

/* ------------------------------------------------------------------ SLA */

export interface TargetAttainment {
  /** `response`, `update`, `resolution`. */
  readonly key: string | null;
  /** 0–100, or `null` when none of that target finished. */
  readonly value: number | null;
}

function targetNoun(key: string): string {
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
 * "85% of targets met, 5 points under the 90% target; updates missed most
 * (80%)". On or over target it says so; the clause about the weakest target
 * is added only when it is below the target and there is more than one.
 */
export function slaHeadline(rate: number | null, target: number, byTarget: readonly TargetAttainment[] = [], locale = 'en-GB'): string {
  if (rate === null || !Number.isFinite(rate)) return 'No targets finished in this period';
  const gap = rate - target;
  const lead =
    gap >= 0
      ? `${percent(rate, locale)} of targets met, ${gap === 0 ? 'on' : `${points(gap, locale)} over`} the ${percent(target, locale)} target`
      : `${percent(rate, locale)} of targets met, ${points(gap, locale)} under the ${percent(target, locale)} target`;
  const scored = byTarget.filter((entry): entry is { key: string; value: number } => entry.key !== null && typeof entry.value === 'number');
  if (scored.length < 2) return finish(lead);
  const weakest = scored.reduce((low, entry) => (entry.value < low.value ? entry : low));
  if (weakest.value >= target) return finish(lead);
  return finish(`${lead}; ${targetNoun(weakest.key)} missed most (${percent(weakest.value, locale)})`, lead);
}

/** "2 of 5 teams meet the target; Business Applications is lowest at 79%". */
export function teamSlaHeadline(rows: readonly { readonly label: string; readonly value: number | null }[], target: number, locale = 'en-GB'): string {
  const scored = rows.filter((row): row is { label: string; value: number } => typeof row.value === 'number');
  if (scored.length === 0) return 'No team has finished a target in this period';
  const meeting = scored.filter((row) => row.value >= target).length;
  const lowest = scored.reduce((low, row) => (row.value < low.value ? row : low));
  const lead =
    meeting === scored.length
      ? scored.length === 1
        ? `${scored[0]!.label} meets the target`
        : `All ${whole(scored.length, locale)} teams meet the target`
      : `${whole(meeting, locale)} of ${whole(scored.length, locale)} teams meet the target`;
  if (meeting === scored.length) return finish(lead);
  return finish(`${lead}; ${lowest.label} is lowest at ${percent(lowest.value, locale)}`, lead);
}

/* ----------------------------------------------------------- Breakdowns */

export interface CountGroupInput {
  readonly key: string | null;
  readonly label?: string | null;
  readonly value: number | null;
}

/** How a channel reads as the subject of a sentence. `import` never reaches a chart (D20). */
export function channelWords(key: string | null, label?: string | null): string {
  switch (key) {
    case 'portal':
      return 'The Help Portal';
    case 'email':
      return 'Email';
    case 'phone':
      return 'Phone';
    case 'chat':
      return 'Chat';
    case 'api':
      return 'The API';
    case 'agent':
    case 'workbench':
      return 'The Service Desk';
    default:
      return label ?? (key === null ? 'Other channels' : key);
  }
}

/** "The Help Portal brings 40% of tickets; email 28%". */
export function channelHeadline(groups: readonly CountGroupInput[], locale = 'en-GB'): string {
  const counted = groups.filter((group): group is CountGroupInput & { value: number } => typeof group.value === 'number' && group.value > 0 && group.key !== 'import');
  const total = sum(counted.map((group) => group.value));
  if (total === 0) return NO_TICKETS;
  const sorted = [...counted].sort((a, b) => b.value - a.value);
  const share = (value: number): string => percent((value * 100) / total, locale);
  const first = sorted[0]!;
  const lead = `${channelWords(first.key, first.label)} brings ${share(first.value)} of tickets`;
  const second = sorted[1];
  if (!second) return finish(lead);
  const name = channelWords(second.key, second.label);
  const lower = name.startsWith('The ') ? `the ${name.slice(4)}` : name.toLowerCase();
  return finish(`${lead}; ${lower} ${share(second.value)}`, lead);
}

/** "Most breaches were P3 (61 of 112)". */
export function breachesHeadline(groups: readonly CountGroupInput[], locale = 'en-GB'): string {
  const counted = groups.filter((group): group is CountGroupInput & { value: number } => typeof group.value === 'number' && group.value > 0);
  const total = sum(counted.map((group) => group.value));
  if (total === 0) return 'No breaches in this period';
  const top = counted.reduce((high, group) => (group.value > high.value ? group : high));
  const name = top.label ?? top.key ?? 'No priority';
  if (top.value === total) return finish(`Every breach was ${name} (${whole(total, locale)})`);
  return finish(`Most breaches were ${name} (${whole(top.value, locale)} of ${whole(total, locale)})`);
}

/* --------------------------------------------------------------- Backlog */

/** "About 108 open, up from 84 30 days ago (estimated from raised and resolved)". */
export function backlogHeadline(series: readonly BacklogPoint[], days: number, locale = 'en-GB'): string {
  if (series.length < MIN_POINTS) return NOT_ENOUGH;
  const now = series[series.length - 1]!.value;
  const then = series[0]!.value;
  const ago = `${whole(days, locale)} ${plural(days, 'day', 'days')} ago`;
  const change = now === then ? `the same as ${ago}` : `${now > then ? 'up' : 'down'} from ${whole(then, locale)} ${ago}`;
  return finish(`About ${whole(now, locale)} open, ${change} (${BACKLOG_ESTIMATE})`, `About ${whole(now, locale)} open, ${change}`);
}

/* -------------------------------------------------------------- Forecast */

export interface ForecastInput {
  /** The projected daily values, from `insights.forecast`. */
  readonly projected: readonly { readonly value: number }[];
  readonly rSquared: number;
}

/**
 * "On this trend, about 16 tickets a day over the next 14 days (rough fit,
 * r² 0.42)". A claim about the future only with the forecast behind it, and
 * its fit always said; no forecast, no claim.
 */
export function forecastHeadline(trend: ForecastInput | null, locale = 'en-GB'): string {
  if (!trend || trend.projected.length === 0 || !Number.isFinite(trend.rSquared)) return NOT_ENOUGH;
  const days = trend.projected.length;
  const perDay = Math.max(0, sum(trend.projected.map((point) => point.value)) / days);
  const fit = trend.rSquared >= 0.7 ? 'close fit' : trend.rSquared >= 0.4 ? 'rough fit' : 'loose fit';
  const r2 = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(trend.rSquared);
  return finish(`On this trend, about ${whole(perDay, locale)} ${plural(Math.round(perDay), 'ticket', 'tickets')} a day over the next ${whole(days, locale)} days (${fit}, r² ${r2})`);
}

/* ---------------------------------------------------------- Satisfaction */

/** A 0–100 satisfaction score as stars out of five: 1 + score × 4 / 100, one decimal (85 → 4.4). */
export function stars(score: number): number {
  return Math.round((1 + (score * 4) / 100) * 10) / 10;
}

/** "4.4 out of 5 from 115 responses, up 0.1 on the previous 30 days". */
export function csatHeadline(score: number | null, previous: number | null, responses: number | null, days: number, locale = 'en-GB'): string {
  if (score === null || !Number.isFinite(score)) return 'No survey responses in this period';
  const one = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const now = stars(score);
  const lead = `${one.format(now)} out of 5${responses !== null ? ` from ${whole(responses, locale)} ${plural(responses, 'response', 'responses')}` : ''}`;
  if (previous === null || !Number.isFinite(previous)) return finish(lead);
  const change = Math.round((now - stars(previous)) * 10) / 10;
  const span = `the previous ${whole(days, locale)} days`;
  const clause = change === 0 ? `the same as ${span}` : `${change > 0 ? 'up' : 'down'} ${one.format(Math.abs(change))} on ${span}`;
  return finish(`${lead}, ${clause}`, lead);
}

/* ---------------------------------------------------------------- Ageing */

export interface AgeingBuckets {
  /** Open more than seven days (two weeks included). */
  readonly overWeek: number;
  /** Open more than fourteen days. */
  readonly overTwoWeeks: number;
}

/** "18 tickets have been open more than a week; 6 more than two". */
export function ageingHeadline({ overWeek, overTwoWeeks }: AgeingBuckets, locale = 'en-GB'): string {
  if (overWeek <= 0) return 'Nothing has been open more than a week';
  const lead = `${whole(overWeek, locale)} ${plural(overWeek, 'ticket has', 'tickets have')} been open more than a week`;
  if (overTwoWeeks <= 0) return finish(lead);
  return finish(`${lead}; ${whole(overTwoWeeks, locale)} more than two`);
}

/* --------------------------------------------------------------- Registers */

export interface RegisterFact {
  readonly count: number;
  /** "breaching", "critical item": the words after the number, singular and plural. */
  readonly one: string;
  readonly many?: string;
  /** Stopped counting: "200+". */
  readonly capped?: boolean;
}

/**
 * A register card's headline: "3 breaching · 10 unassigned", "4 critical
 * items · 1 past its target date". Zero facts are left out; with none left
 * the headline is `null` and the card shows none, never "0 problems" (A7 §2.2).
 */
export function registerHeadline(facts: readonly RegisterFact[], locale = 'en-GB'): string | null {
  const parts = facts
    .filter((fact) => fact.count > 0)
    .map((fact) => `${whole(fact.count, locale)}${fact.capped ? '+' : ''} ${fact.count === 1 && !fact.capped ? fact.one : (fact.many ?? fact.one)}`);
  return parts.length === 0 ? null : finish(parts.join(' · '));
}
