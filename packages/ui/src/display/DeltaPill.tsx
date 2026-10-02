import type { ReactNode } from 'react';
import { formatNumber } from '../format/format.js';
import { Icon } from '../icons/Icon.js';
import { cx } from '../web/cx.js';

/** Which way a value moved. A change too small to survive its own rounding ("+0%") is `flat`. */
export type DeltaDirection = 'up' | 'down' | 'flat';

/** Whether the move is good news, bad news, or neither. */
export type DeltaSentiment = 'good' | 'bad' | 'neutral';

export interface DeltaPillProps {
  /** The change itself: `-4`, or `0.12` with `format={{ style: 'percent' }}` for "+12%". */
  readonly value: number;
  /** How the change is written; `{ style: 'percent' }` for a relative change given as a ratio. */
  readonly format?: Intl.NumberFormatOptions;
  /** After the number, smaller: "pts" for percentage points (spoken "points"). */
  readonly unit?: string;
  /** Which way is good news (default `up`); `none` for a change that is neither, drawn neutral. */
  readonly goodDirection?: 'up' | 'down' | 'none';
  /** What the change is measured against, spoken and never shown: "vs last week". */
  readonly period?: string;
  /**
   * No pill for no change (default true): a grey "0" in a row of coloured
   * pills is noise. "No change" is still said, to a screen reader only.
   */
  readonly hideZero?: boolean;
  /** `md` (default) is 20 px, beside a KPI tile's value; `sm` is 18 px, in a row or a caption. */
  readonly size?: 'sm' | 'md';
  /** For the digits; `en-GB` by default. A prop rather than the provider's, so the pill renders on the server. */
  readonly locale?: string;
  readonly className?: string;
}

/** A delta read once: what the pill shows, what a screen reader hears, and how it is coloured. */
export interface DeltaReading {
  readonly direction: DeltaDirection;
  readonly sentiment: DeltaSentiment;
  /** The signed number the pill shows: "+12%", "-4", "0". */
  readonly shown: string;
  /** The sentence it stands for: "Up 9 points, better, vs last week". */
  readonly spoken: string;
}

/** Units a screen reader would spell out letter by letter, with the words it should say instead. */
const SPOKEN_UNITS: Readonly<Record<string, { readonly one: string; readonly other: string }>> = {
  pt: { one: 'point', other: 'points' },
  pts: { one: 'point', other: 'points' },
};

function spokenUnit(unit: string | undefined, magnitude: number): string {
  if (!unit) return '';
  const words = SPOKEN_UNITS[unit.trim().toLowerCase()];
  return ` ${words ? (magnitude === 1 ? words.one : words.other) : unit}`;
}

/**
 * Reads a delta the way `DeltaPill` draws it, for a caller that needs the
 * direction or the sentiment without the pill (a KPI tile's data attributes).
 * `null` for a value that is not a number: an unknown change is not "no
 * change", so nothing is claimed about it.
 */
export function readDelta({
  value,
  format,
  unit,
  goodDirection = 'up',
  period,
  locale = 'en-GB',
}: Pick<DeltaPillProps, 'value' | 'format' | 'unit' | 'goodDirection' | 'period' | 'locale'>): DeltaReading | null {
  if (!Number.isFinite(value)) return null;
  const magnitude = formatNumber(Math.abs(value), { ...format, signDisplay: 'never', locale });
  // A change that rounds away ("0%" from 0.0004) is drawn as none, never as an up arrow on a zero.
  const flat = value === 0 || magnitude === formatNumber(0, { ...format, signDisplay: 'never', locale });
  const direction: DeltaDirection = flat ? 'flat' : value > 0 ? 'up' : 'down';
  const sentiment: DeltaSentiment = direction === 'flat' || goodDirection === 'none' ? 'neutral' : direction === goodDirection ? 'good' : 'bad';
  const shown = flat ? formatNumber(0, { ...format, signDisplay: 'never', locale }) : formatNumber(value, { ...format, signDisplay: 'exceptZero', locale });
  const said =
    direction === 'flat'
      ? 'No change'
      : `${direction === 'up' ? 'Up' : 'Down'} ${magnitude}${spokenUnit(unit, Math.abs(value))}${sentiment === 'good' ? ', better' : sentiment === 'bad' ? ', worse' : ''}`;
  return { direction, sentiment, shown, spoken: period ? `${said}, ${period}` : said };
}

const ARROW: Readonly<Record<DeltaDirection, 'arrow-up' | 'arrow-down' | 'minus'>> = { up: 'arrow-up', down: 'arrow-down', flat: 'minus' };

/**
 * A change as a small tinted pill — "↑ +9 pts" — that says which way a number
 * moved and whether that is good (v3 §2.13, A1 §7.2). A KPI tile's delta, and
 * the same pill wherever a change is shown beside a figure.
 *
 * The arrow and the sign say the direction; the tint says the judgement —
 * `success` for good, `danger` for bad, neutral when no way is better — so
 * nothing relies on colour alone. The digits and the unit are drawn for the
 * eye and hidden from assistive technology, and one visually hidden sentence
 * says it all instead: "Up 9 points, better, vs last week". The period is in
 * that sentence and not on the pill, because a tile already shows it in its
 * context line.
 *
 * Server-safe: no hooks, no provider, no handlers. The locale is a prop.
 */
export function DeltaPill({ value, format, unit, goodDirection = 'up', period, hideZero = true, size = 'md', locale = 'en-GB', className }: DeltaPillProps): ReactNode {
  const reading = readDelta({ value, goodDirection, locale, ...(format ? { format } : {}), ...(unit ? { unit } : {}), ...(period ? { period } : {}) });
  if (!reading) return null;
  if (reading.direction === 'flat' && hideZero) {
    return (
      <span className={cx('itsm-visually-hidden', className)} data-direction="flat">
        {reading.spoken}
      </span>
    );
  }
  return (
    <span className={cx('itsm-DeltaPill', className)} data-direction={reading.direction} data-sentiment={reading.sentiment} data-size={size}>
      <Icon name={ARROW[reading.direction]} size={12} className="itsm-DeltaPill__icon" />
      <span className="itsm-DeltaPill__value" aria-hidden="true">
        {reading.shown}
      </span>
      {unit ? (
        <span className="itsm-DeltaPill__unit" aria-hidden="true">
          {unit}
        </span>
      ) : null}
      <span className="itsm-visually-hidden">{reading.spoken}</span>
    </span>
  );
}
