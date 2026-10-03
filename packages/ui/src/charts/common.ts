/**
 * The vocabulary every v3 chart shares (SPEC-v3 §8.2, A8 §3.4). Types only:
 * no runtime code, so importing it costs nothing in any bundle and it can be
 * read by server and client modules alike.
 *
 * One set of names for the props every chart takes means a page can hand the
 * same `asAt`, `timeZone` and `locale` to every chart on it, and a card can
 * pass its headline down as any chart's `description`, without knowing which
 * chart it holds.
 */
import type { ChartSlot, ChartTableMode, ChartTone } from './types.js';

/**
 * Props every chart component takes, beyond its own data.
 *
 * `asAt` is how "today" reaches a chart: the kit never reads a clock (ADR-0064).
 * The page decides what "now" is, once per request, and every chart on it
 * agrees — so two charts rendered a second apart cannot disagree about which
 * day is today, and the same props always render the same markup.
 */
export interface ChartCommon {
  /** The figure's name. A `ChartCard` hides it visually and shows its own title. */
  readonly title: string;
  readonly titleHidden?: boolean;
  /** The takeaway sentence. A `ChartCard` passes its headline here. */
  readonly description?: string;
  /** The "View data" twin: offered behind a toggle, always shown, or left out. */
  readonly table?: ChartTableMode;
  /** Adds the hover and keyboard reader island. Never in the Help Portal (A8 §5.4). */
  readonly interactive?: boolean;
  readonly loading?: boolean;
  /** Default "No data for this period". */
  readonly emptyText?: string;
  /** Default "Not enough history yet". */
  readonly insufficientText?: string;
  /** Default `en-GB`: a server component has no provider to ask. */
  readonly locale?: string;
  /** IANA zone for instants and for "today". Default UTC. */
  readonly timeZone?: string;
  /** The ISO instant the page considers "now". No "today" marker is drawn without it. */
  readonly asAt?: string;
  /** The one first-paint reveal (A8 §6.4). Default true; off under reduced motion whatever this says. */
  readonly animate?: boolean;
  readonly className?: string;
}

/**
 * How a series is drawn (A8 §4.3.2): `actual` is the data the chart is about
 * (solid, the accent or its slot); `comparison` is what it is read against
 * (plan, "raised"), a thin solid grey; `baseline` the same, dashed; `forecast`
 * continues an actual series, dashed in its colour.
 */
export type SeriesStyle = 'actual' | 'comparison' | 'baseline' | 'forecast';

/**
 * Colour and style for one series or segment. A `tone` (state: P1, breached,
 * on track) wins over a `slot` (identity: a team, a channel), because a chart
 * coloured by state must never borrow an identity colour that happens to
 * match a state's.
 */
export interface SeriesLook {
  readonly slot?: ChartSlot;
  readonly tone?: ChartTone;
  readonly style?: SeriesStyle;
}

export type ChartMarkerKind = 'today' | 'deadline' | 'milestone' | 'event';

/**
 * A vertical marker on a time or category axis (A8 §4.3, X-m14).
 *
 * `today` carries no x: the chart places it from `asAt` and `timeZone` and
 * writes its pill ("As at 2 Oct") itself, so no page formats a date for it.
 * The others name the x they stand at, as one of the chart's x values or, on
 * a time axis, any instant inside the domain.
 */
export type ChartMarker =
  | { readonly kind: 'today'; readonly label?: string }
  | { readonly kind: 'deadline'; readonly x: string; readonly label: string }
  | { readonly kind: 'milestone'; readonly x: string; readonly label?: string; readonly reached?: boolean }
  | { readonly kind: 'event'; readonly x: string; readonly label: string };

/** A horizontal reference line: an SLA target, an approved budget. */
export interface ChartTarget {
  readonly value: number;
  readonly label?: string;
}

/** A shaded span of the x axis: a freeze, a maintenance window. */
export interface ChartBand {
  readonly from: string;
  readonly to: string;
  readonly label?: string;
}

/** Why a plot has nothing to draw: no data, too little history to mean anything, or a failed read. */
export type ChartEmptyReason = 'empty' | 'insufficient' | 'error';

/**
 * The width of one bucket of a time series. Buckets are UTC (ADR-0031,
 * ADR-0064): a day is a UTC date, a week starts on Monday 00:00 UTC, a month
 * on the 1st at 00:00 UTC.
 */
export type TimeBucket = 'day' | 'week' | 'month';
