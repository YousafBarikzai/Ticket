/**
 * The arithmetic behind every chart: nice ticks, positions, paths, folding
 * the long tail into "Other", and the sentences a chart is summarised by.
 *
 * Server-safe and pure. Everything here runs while a server component renders
 * a chart to static markup, and again (the same code, the same answers) when
 * a client parent renders one — so nothing reads the clock, the DOM or a
 * random number, and every output is a plain string or number.
 */
import { formatDateTime, formatNumber } from '../format/format.js';
import type { ChartSlot } from './types.js';

/** The locale a chart formats in when the caller names none: the product's (`lang="en-GB"`). */
export const DEFAULT_LOCALE = 'en-GB';

/* -------------------------------------------------------------------------
 * Numbers
 * ---------------------------------------------------------------------- */

export interface NiceScale {
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly ticks: readonly number[];
}

/** The number of decimals a step needs, so `0.1 + 0.2` never reaches an axis as `0.30000000000000004`. */
function decimalsOf(step: number): number {
  if (!Number.isFinite(step) || step >= 1) return 0;
  return Math.min(10, Math.ceil(-Math.log10(step)) + 1);
}

/**
 * A step of 1, 2 or 5 times a power of ten: the steps a person counts in,
 * chosen as the one nearest to `range / count` (the thresholds are the
 * geometric means between the candidates), so an axis lands close to the
 * tick count asked for rather than always rounding the step up.
 */
function niceStep(range: number, count: number): number {
  const raw = range / Math.max(1, count);
  const power = Math.floor(Math.log10(raw));
  const error = raw / 10 ** power;
  const factor = error >= Math.sqrt(50) ? 10 : error >= Math.sqrt(10) ? 5 : error >= Math.SQRT2 ? 2 : 1;
  return factor * 10 ** power;
}

/** The next nice step up: 1 → 2 → 5 → 10. */
function nextStep(step: number): number {
  const power = 10 ** Math.floor(Math.log10(step));
  const factor = Math.round(step / power);
  return (factor < 2 ? 2 : factor < 5 ? 5 : 10) * power;
}

/**
 * Round-numbered bounds and ticks around some values: 0 / 10 / 20 / 30 rather
 * than 0 / 7.3 / 14.6. Counts get whole-number ticks only — "2.5 tickets" is
 * an axis nobody can read.
 *
 * `zero` keeps the baseline at zero (the honest default for anything with a
 * length or an area, whose size is read against the baseline); `auto` fits the
 * data, for a line whose story is the change rather than the size.
 */
export function niceScale(values: readonly number[], { baseline = 'zero', count = 4 }: { baseline?: 'zero' | 'auto'; count?: number } = {}): NiceScale {
  const finite = values.filter((value) => Number.isFinite(value));
  let low = finite.length > 0 ? Math.min(...finite) : 0;
  let high = finite.length > 0 ? Math.max(...finite) : 0;
  if (baseline === 'zero') {
    low = Math.min(0, low);
    high = Math.max(0, high);
  }
  if (low === high) {
    // One value, or all equal: give it room on the side away from zero.
    if (high === 0) high = 1;
    else if (high > 0) low = baseline === 'zero' ? 0 : high - Math.abs(high) * 0.5;
    else high = baseline === 'zero' ? 0 : low + Math.abs(low) * 0.5;
    if (low === high) high = low + 1;
  }
  const integers = finite.every((value) => Number.isInteger(value));
  let step = niceStep(high - low, count);
  // Rounding the step down can leave half as many ticks again as asked for:
  // a plot 220 px tall reads better with fewer, wider bands.
  if ((high - low) / step > count + 1) step = nextStep(step);
  if (integers && step < 1) step = 1;
  const decimals = decimalsOf(step);
  const round = (value: number): number => Number(value.toFixed(decimals));
  const min = round(Math.floor(low / step) * step);
  const max = round(Math.ceil(high / step) * step);
  const ticks: number[] = [];
  for (let index = 0; ; index++) {
    const tick = round(min + index * step);
    if (tick > max + step / 2 || index > 50) break;
    ticks.push(tick);
  }
  return { min, max, step, ticks };
}

/** Where a value sits between a scale's bounds, 0 at `min` and 1 at `max`, clamped. */
export function fraction(value: number, scale: Pick<NiceScale, 'min' | 'max'>): number {
  if (scale.max === scale.min) return 0;
  return Math.min(1, Math.max(0, (value - scale.min) / (scale.max - scale.min)));
}

/** A number formatter for one chart. It never throws: a bad locale or option falls back to the default. */
export function numberFormatter(locale: string | undefined, options: Intl.NumberFormatOptions | undefined): (value: number) => string {
  const resolved = locale ?? DEFAULT_LOCALE;
  return (value) => formatNumber(value, { ...options, locale: resolved });
}

/**
 * The same formatter, for the axis: compact above ten thousand ("12k"),
 * because a tick has a few characters of room and the exact number is in the
 * tooltip and the table. Percentages and currencies keep their own style.
 */
export function axisFormatter(locale: string | undefined, options: Intl.NumberFormatOptions | undefined, largest: number): (value: number) => string {
  if (Math.abs(largest) >= 10_000 && (options?.style === undefined || options.style === 'decimal')) {
    return numberFormatter(locale, { ...options, notation: 'compact', maximumFractionDigits: 1 });
  }
  return numberFormatter(locale, options);
}

/* -------------------------------------------------------------------------
 * Categories and the long tail
 * ---------------------------------------------------------------------- */

/** The colour slot of the "Other" bucket: the de-emphasis grey, never a ninth hue. */
export type SeriesSlot = ChartSlot | 'other';

/** Slots 1–8 in order. A ninth series is a design problem, not a colour: it wraps to "other". */
export function slotAt(index: number): SeriesSlot {
  return index >= 0 && index < 8 ? ((index + 1) as ChartSlot) : 'other';
}

/**
 * Keeps the largest `max - 1` items and folds the rest into one "Other" item,
 * so a chart never grows past what a reader can tell apart (and never invents
 * a ninth colour). Order among the survivors is kept.
 */
export function foldOther<T extends { readonly id: string; readonly value: number }>(
  items: readonly T[],
  max: number | undefined,
  other: (value: number, folded: readonly T[]) => T,
): readonly T[] {
  if (max === undefined || !Number.isFinite(max) || max < 2 || items.length <= max) return items;
  const ranked = [...items].sort((a, b) => b.value - a.value);
  const kept = new Set(ranked.slice(0, max - 1).map((item) => item.id));
  const folded = items.filter((item) => !kept.has(item.id));
  const total = folded.reduce((sum, item) => sum + (Number.isFinite(item.value) ? item.value : 0), 0);
  return [...items.filter((item) => kept.has(item.id)), other(total, folded)];
}

/* -------------------------------------------------------------------------
 * Time
 * ---------------------------------------------------------------------- */

const DAY = 86_400_000;

/** Parses the x values of a time axis. `null` when any of them is not a date, so the chart falls back to categories. */
export function parseTimes(xs: readonly string[]): number[] | null {
  const times: number[] = [];
  for (const x of xs) {
    const time = Date.parse(x);
    if (Number.isNaN(time)) return null;
    times.push(time);
  }
  return times;
}

/** Whether the x values are whole days (`2026-09-01`), which are dates in no time zone and read in UTC. */
function dateOnly(xs: readonly string[]): boolean {
  return xs.length > 0 && xs.every((x) => /^\d{4}-\d{2}-\d{2}$/.test(x));
}

export interface TimeLabels {
  /** Short, for the axis: "3 Sep", "14:00", "Sep 2026". */
  readonly tick: (index: number) => string;
  /** Full, for the tooltip, the table and the summary: "Tue 3 Sep 2026", "Tue 3 Sep, 14:00". */
  readonly full: (index: number) => string;
}

/**
 * Labels for a time axis, chosen by the span of the data: hours within a day,
 * days within a year, months beyond it.
 */
export function timeLabels(xs: readonly string[], times: readonly number[], locale: string, timeZone: string | undefined): TimeLabels {
  const zone = dateOnly(xs) ? 'UTC' : (timeZone ?? 'UTC');
  const span = times.length > 1 ? Math.max(...times) - Math.min(...times) : 0;
  const intraday = span > 0 && span < 2 * DAY && !dateOnly(xs);
  const long = span > 365 * DAY;
  const format = (time: number, options: Intl.DateTimeFormatOptions): string => {
    try {
      return new Intl.DateTimeFormat(locale, { ...options, timeZone: zone }).format(time);
    } catch {
      return formatDateTime(time, { locale, timeZone: zone, style: 'date' });
    }
  };
  return {
    tick: (index) => {
      const time = times[index] ?? 0;
      if (intraday) return format(time, { hour: '2-digit', minute: '2-digit' });
      if (long) return format(time, { month: 'short', year: 'numeric' });
      return format(time, { day: 'numeric', month: 'short' });
    },
    full: (index) => {
      const time = times[index] ?? 0;
      if (intraday) return format(time, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      return format(time, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    },
  };
}

/**
 * Which of `count` positions carry an axis label: at most `max`, at an even
 * step from the first, and always the last (which takes the place of the one
 * before it when the two would crowd each other). Each is marked `wide` when
 * it should only show in a wide container, so a phone keeps the first, the
 * middle and the last.
 */
export function tickIndices(count: number, max = 6): { readonly index: number; readonly wide: boolean }[] {
  if (count <= 0) return [];
  if (count === 1) return [{ index: 0, wide: false }];
  const step = Math.max(1, Math.ceil((count - 1) / (Math.max(2, max) - 1)));
  const picked: number[] = [];
  for (let index = 0; index < count; index += step) picked.push(index);
  const last = count - 1;
  if (picked[picked.length - 1] !== last) {
    if (picked.length > 1 && last - picked[picked.length - 1]! <= step / 2) picked.pop();
    picked.push(last);
  }
  const middle = picked[Math.floor((picked.length - 1) / 2)];
  return picked.map((index, position) => ({
    index,
    wide: !(position === 0 || position === picked.length - 1 || (picked.length > 3 && index === middle)),
  }));
}

/* -------------------------------------------------------------------------
 * Paths
 * ---------------------------------------------------------------------- */

/** One point of a drawn series: x as a fraction of the plot's width, y in pixels from its top; `null` y is a gap. */
export interface PlotPoint {
  readonly x: number;
  readonly y: number | null;
}

/** The width the scaled path layer draws in. Lines keep 2 px on screen through `vector-effect`. */
export const PATH_WIDTH = 1000;

const fixed = (value: number): string => (Math.round(value * 100) / 100).toString();

/**
 * The runs of consecutive drawn points, split at gaps. A missing value is a
 * gap in the line, never a drop to zero — zero is a value, "no data" is not.
 */
export function runs(points: readonly PlotPoint[]): { x: number; y: number }[][] {
  const out: { x: number; y: number }[][] = [];
  let current: { x: number; y: number }[] = [];
  for (const point of points) {
    if (point.y === null || !Number.isFinite(point.y)) {
      if (current.length > 0) out.push(current);
      current = [];
    } else current.push({ x: point.x, y: point.y });
  }
  if (current.length > 0) out.push(current);
  return out;
}

/**
 * The `d` of a line through the points: by default in the path layer's
 * coordinates (x over `PATH_WIDTH`, y in px); `toX` maps x otherwise.
 */
export function linePath(points: readonly PlotPoint[], toX: (x: number) => number = (x) => x * PATH_WIDTH): string {
  return runs(points)
    .filter((run) => run.length > 1)
    .map((run) => run.map((point, index) => `${index === 0 ? 'M' : 'L'}${fixed(toX(point.x))} ${fixed(point.y)}`).join(''))
    .join('');
}

/**
 * The `d` of the area between a line and a floor (the baseline, or the series
 * below it when stacked). Both arrays are the same length; a gap in the upper
 * line is a gap in the area.
 */
export function areaPath(upper: readonly PlotPoint[], lower: readonly PlotPoint[]): string {
  const segments: string[] = [];
  let start = -1;
  const close = (end: number): void => {
    if (start < 0 || end - start < 1) return;
    let d = '';
    for (let index = start; index <= end; index++) {
      d += `${index === start ? 'M' : 'L'}${fixed(upper[index]!.x * PATH_WIDTH)} ${fixed(upper[index]!.y ?? 0)}`;
    }
    for (let index = end; index >= start; index--) {
      d += `L${fixed(lower[index]!.x * PATH_WIDTH)} ${fixed(lower[index]!.y ?? 0)}`;
    }
    segments.push(`${d}Z`);
  };
  for (let index = 0; index < upper.length; index++) {
    const drawn = upper[index]!.y !== null && lower[index]?.y !== null;
    if (drawn && start < 0) start = index;
    if (!drawn && start >= 0) {
      close(index - 1);
      start = -1;
    }
  }
  if (start >= 0) close(upper.length - 1);
  return segments.join('');
}

/** Points that stand alone between gaps: drawn as a dot, or they would not be drawn at all. */
export function isolatedPoints(points: readonly PlotPoint[]): { x: number; y: number }[] {
  return runs(points)
    .filter((run) => run.length === 1)
    .map((run) => run[0]!);
}

/**
 * An annular sector — a donut segment — from `start` to `end` (fractions of a
 * turn, clockwise from twelve o'clock), in a square of side 100.
 */
export function arcPath(start: number, end: number, outer: number, inner: number, centre = 50): string {
  const sweep = Math.max(0, end - start);
  if (sweep >= 0.9999) {
    // A full ring cannot be drawn as one arc (its ends coincide): two halves.
    return `${arcPath(0, 0.5, outer, inner, centre)}${arcPath(0.5, 1, outer, inner, centre)}`;
  }
  const point = (turn: number, radius: number): string => {
    const angle = turn * 2 * Math.PI - Math.PI / 2;
    return `${fixed(centre + radius * Math.cos(angle))} ${fixed(centre + radius * Math.sin(angle))}`;
  };
  const large = sweep > 0.5 ? 1 : 0;
  return (
    `M${point(start, outer)}A${outer} ${outer} 0 ${large} 1 ${point(end, outer)}` +
    `L${point(end, inner)}A${inner} ${inner} 0 ${large} 0 ${point(start, inner)}Z`
  );
}

/* -------------------------------------------------------------------------
 * Words
 * ---------------------------------------------------------------------- */

/**
 * The direction of a trend as a word and its ends, for a sparkline's name:
 * "Rising, 12 → 18". A change within 2 % of the larger end is "Steady".
 */
export function describeTrend(values: readonly number[], format: (value: number) => string = (value) => formatNumber(value, { locale: DEFAULT_LOCALE })): string {
  const finite = values.filter((value) => Number.isFinite(value));
  if (finite.length === 0) return 'No data';
  const first = finite[0]!;
  const last = finite[finite.length - 1]!;
  const span = Math.max(Math.abs(first), Math.abs(last));
  const word = finite.length === 1 || Math.abs(last - first) <= span * 0.02 ? 'Steady' : last > first ? 'Rising' : 'Falling';
  return `${word}, ${format(first)} → ${format(last)}`;
}

/** Joins a few clauses the way a sentence would: "a", "a and b", "a, b and c". */
export function sentenceList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/* -------------------------------------------------------------------------
 * Identity
 * ---------------------------------------------------------------------- */

/**
 * A stable id for the SVG definitions one chart needs (its texture patterns),
 * from what the chart is. A server component cannot call `useId`, and a
 * counter would differ between the server's render and the browser's; a hash
 * of the chart's own props is the same wherever it is computed. Two identical
 * charts on one page get identical definitions, so sharing an id is harmless.
 */
export function chartId(kind: string, parts: readonly string[]): string {
  let hash = 0x811c9dc5;
  const text = `${kind}\u0000${parts.join('\u0000')}`;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `itsm-${kind}-${hash.toString(36)}`;
}
