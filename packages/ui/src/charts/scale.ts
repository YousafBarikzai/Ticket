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
import type { ChartMarkerKind } from './common.js';
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

/**
 * The `d` of a smooth line through the points that never overshoots them
 * (Fritsch–Carlson monotone cubic interpolation). A plain spline bulges past
 * a peak, inventing a value higher than any measured and, at a step from
 * zero, a dip below zero; on a chart that is a lie about the data. Here each
 * segment stays between its two points: the tangents are limited so that
 * both Bézier control points lie within the segment's own range.
 *
 * Same coordinates and gaps as `linePath`. Used for the landing's decorative
 * trends (`curve: 'monotone'`); product charts default to straight segments,
 * which claim nothing between the points.
 */
export function monotonePath(points: readonly PlotPoint[], toX: (x: number) => number = (x) => x * PATH_WIDTH): string {
  return runs(points)
    .filter((run) => run.length > 1)
    .map((run) => {
      const xs = run.map((point) => toX(point.x));
      const ys = run.map((point) => point.y);
      const n = run.length;
      // Secant slopes; a repeated x has no slope to follow, so it is flat.
      const secants: number[] = [];
      for (let index = 0; index < n - 1; index++) {
        const width = xs[index + 1]! - xs[index]!;
        secants.push(width === 0 ? 0 : (ys[index + 1]! - ys[index]!) / width);
      }
      const tangents: number[] = [secants[0]!];
      for (let index = 1; index < n - 1; index++) {
        const before = secants[index - 1]!;
        const after = secants[index]!;
        // A local peak or trough is flat at the point, so the curve turns there and not beyond it.
        tangents.push(before * after <= 0 ? 0 : (before + after) / 2);
      }
      tangents.push(secants[n - 2]!);
      for (let index = 0; index < n - 1; index++) {
        const secant = secants[index]!;
        if (secant === 0) {
          tangents[index] = 0;
          tangents[index + 1] = 0;
          continue;
        }
        const alpha = tangents[index]! / secant;
        const beta = tangents[index + 1]! / secant;
        const length = Math.hypot(alpha, beta);
        if (length > 3) {
          const tau = 3 / length;
          tangents[index] = tau * alpha * secant;
          tangents[index + 1] = tau * beta * secant;
        }
      }
      let d = `M${fixed(xs[0]!)} ${fixed(ys[0]!)}`;
      for (let index = 0; index < n - 1; index++) {
        const third = (xs[index + 1]! - xs[index]!) / 3;
        d +=
          `C${fixed(xs[index]! + third)} ${fixed(ys[index]! + tangents[index]! * third)} ` +
          `${fixed(xs[index + 1]! - third)} ${fixed(ys[index + 1]! - tangents[index + 1]! * third)} ` +
          `${fixed(xs[index + 1]!)} ${fixed(ys[index + 1]!)}`;
      }
      return d;
    })
    .join('');
}

/**
 * The `d` of a diamond (a square turned 45°) centred on a point, `radius`
 * from the centre to each corner. Drawn in its own small SVG so the marker
 * diamonds stay square however wide the plot is stretched.
 */
export function diamondAt(cx: number, cy: number, radius: number): string {
  return `M${fixed(cx)} ${fixed(cy - radius)}L${fixed(cx + radius)} ${fixed(cy)}L${fixed(cx)} ${fixed(cy + radius)}L${fixed(cx - radius)} ${fixed(cy)}Z`;
}

/* -------------------------------------------------------------------------
 * Steps
 * ---------------------------------------------------------------------- */

/**
 * Which of `steps` equal bands of a range a value falls in, 1 to `steps`, for
 * a sequential colour ramp: the lowest value is step 1, the highest is the
 * top step, a value on a boundary belongs to the band above it, and anything
 * outside the range takes the end it is past. 0 for a missing value, which a
 * heat map draws as "no data" rather than as the lightest step. A range with
 * no width (every value equal) is step 1 throughout.
 */
export function quantise(value: number | null, min: number, max: number, steps = 8): number {
  if (value === null || !Number.isFinite(value)) return 0;
  const count = Math.max(1, Math.floor(steps));
  if (!(max > min)) return 1;
  if (value <= min) return 1;
  if (value >= max) return count;
  return Math.min(count, 1 + Math.floor(((value - min) / (max - min)) * count));
}

/* -------------------------------------------------------------------------
 * Labels
 * ---------------------------------------------------------------------- */

/**
 * Moves labels apart along one axis until each is at least `gap` from the
 * next, keeping their order and staying between `min` and `max` where they
 * fit (A8 §4.3.3). Used for end-of-line labels: two lines that finish close
 * together keep a readable label each, nudged the least distance apart,
 * rather than one overprinting the other.
 *
 * Deterministic: equal positions keep their input order. Positions come back
 * in the order they were given. When the labels cannot all fit, they start
 * at `min` and run past `max`; the chart decides what gives way.
 */
export function relaxLabels(ys: readonly number[], gap = 14, min = 0, max = Number.POSITIVE_INFINITY): number[] {
  const order = ys.map((y, index) => ({ y, index })).sort((a, b) => a.y - b.y || a.index - b.index);
  const placed = order.map((entry) => entry.y);
  const last = placed.length - 1;
  if (last < 0) return [];
  const downwards = (): void => {
    placed[0] = Math.max(placed[0]!, min);
    for (let index = 1; index <= last; index++) placed[index] = Math.max(placed[index]!, placed[index - 1]! + gap);
  };
  downwards();
  if (placed[last]! > max) {
    placed[last] = max;
    for (let index = last - 1; index >= 0; index--) placed[index] = Math.min(placed[index]!, placed[index + 1]! - gap);
    if (placed[0]! < min) downwards();
  }
  const out = new Array<number>(ys.length);
  order.forEach((entry, position) => {
    out[entry.index] = placed[position]!;
  });
  return out;
}

/** The plot width, in px, that marker labels are fitted against for a full-width (12-column) card. */
export const MARKER_REFERENCE_WIDTH = 1040;

/** A marker label's width estimated from its length (A8 §4.3.4): nothing is measured on the server. */
export function markerLabelWidth(text: string, pill: boolean): number {
  return text.length * 5.6 + (pill ? 16 : 4);
}

/** One label above the plot, to be placed: `x` is a fraction of the plot width. */
export interface MarkerLabelInput {
  readonly id: string;
  readonly kind: ChartMarkerKind;
  readonly x: number;
  readonly label?: string;
}

/** Where a label went: its tier (1 nearest the top), or `null` when it gave way; and its alignment at an edge. */
export interface MarkerLabelPlacement {
  readonly id: string;
  readonly tier: 1 | 2 | null;
  readonly edge?: 'start' | 'end';
}

/** Pills by priority: a deadline is a commitment, "today" only orientation. */
const PILL_RANK: Readonly<Partial<Record<ChartMarkerKind, number>>> = { deadline: 0, today: 1 };

/** Space kept clear between two labels on one tier, in px. */
const LABEL_GAP = 4;

/** Labels within this fraction of an edge align inwards instead of centring, so they are not cut off. */
const EDGE = 0.08;

/**
 * Puts marker labels on at most two tiers above the plot without measuring
 * anything (A8 §4.3.4). The server does not know how wide the plot will be,
 * so collisions are decided in fractions of a reference width — the plot of
 * a card `span` columns wide out of 12 — from each label's estimated width.
 *
 * Gate labels (milestones, events) go first, each on the first tier where it
 * fits. Then the pills, deadlines before "today": tier 1 if free, else tier
 * 2; failing both, the pill takes the tier whose only obstacles are gate
 * labels and those labels give way (their diamonds and lines stay, and the
 * table twin still names them). A label within 8 % of an edge aligns inwards.
 *
 * The CSS completes it by container size: tier-2 gate labels hide below
 * 40rem and every gate label below 32rem; pills always show.
 *
 * Returns a placement per input, in input order, and how many tiers are used
 * (the height the chart reserves above the plot).
 */
export function placeMarkers(
  items: readonly MarkerLabelInput[],
  { span = 12 }: { readonly span?: number } = {},
): { readonly placements: readonly MarkerLabelPlacement[]; readonly tiers: 0 | 1 | 2 } {
  const width = (Math.min(12, Math.max(1, span)) / 12) * MARKER_REFERENCE_WIDTH;
  const gap = LABEL_GAP / width;
  interface Box {
    readonly id: string;
    readonly pill: boolean;
    readonly from: number;
    readonly to: number;
    readonly edge?: 'start' | 'end';
    tier: 1 | 2 | null;
  }
  const boxes = new Map<string, Box>();
  for (const item of items) {
    if (!item.label) continue;
    const pill = item.kind in PILL_RANK;
    const size = markerLabelWidth(item.label, pill) / width;
    const edge = item.x <= EDGE ? 'start' : item.x >= 1 - EDGE ? 'end' : undefined;
    const from = edge === 'start' ? item.x : edge === 'end' ? item.x - size : item.x - size / 2;
    boxes.set(item.id, { id: item.id, pill, from, to: from + size, ...(edge ? { edge } : {}), tier: null });
  }
  const clash = (a: Box, b: Box): boolean => a.from < b.to + gap && b.from < a.to + gap;
  const onTier = (tier: 1 | 2, box: Box): Box[] => [...boxes.values()].filter((other) => other !== box && other.tier === tier && clash(box, other));

  const byX = (a: MarkerLabelInput, b: MarkerLabelInput): number => a.x - b.x || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const gates = items.filter((item) => boxes.has(item.id) && !(item.kind in PILL_RANK)).sort(byX);
  const pills = items
    .filter((item) => boxes.has(item.id) && item.kind in PILL_RANK)
    .sort((a, b) => PILL_RANK[a.kind]! - PILL_RANK[b.kind]! || byX(a, b));

  for (const item of gates) {
    const box = boxes.get(item.id)!;
    box.tier = onTier(1, box).length === 0 ? 1 : onTier(2, box).length === 0 ? 2 : null;
  }
  for (const item of pills) {
    const box = boxes.get(item.id)!;
    const first = onTier(1, box);
    const second = onTier(2, box);
    if (first.length === 0) box.tier = 1;
    else if (second.length === 0) box.tier = 2;
    else {
      // Only gate labels in the way on a tier: they give way. Pills on both
      // (three pills within one label's width): share tier 2 rather than drop one.
      const tier: 1 | 2 = first.every((other) => !other.pill) ? 1 : 2;
      for (const other of tier === 1 ? first : second) if (!other.pill) other.tier = null;
      box.tier = tier;
    }
  }

  const placements = items.map((item): MarkerLabelPlacement => {
    const box = boxes.get(item.id);
    return { id: item.id, tier: box?.tier ?? null, ...(box?.edge ? { edge: box.edge } : {}) };
  });
  const tiers = placements.reduce<0 | 1 | 2>((most, placement) => (placement.tier !== null && placement.tier > most ? placement.tier : most), 0);
  return { placements, tiers };
}

/* -------------------------------------------------------------------------
 * Words
 * ---------------------------------------------------------------------- */

/**
 * The direction of a trend as a word and its ends, for a sparkline's name:
 * "Rising, 12 → 18". A change within 2 % of the larger end is "Steady".
 */
export function describeTrend(
  values: readonly (number | null)[],
  format: (value: number) => string = (value) => formatNumber(value, { locale: DEFAULT_LOCALE }),
): string {
  const finite = values.filter((value): value is number => value !== null && Number.isFinite(value));
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
