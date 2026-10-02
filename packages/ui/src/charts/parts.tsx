import type { ReactNode } from 'react';
import { Icon } from '../icons/Icon.js';
import type { IconName } from '../icons/registry.js';
import { cx } from '../web/cx.js';
import { Skeleton } from '../web/Skeleton.js';
import type { ChartEmptyReason, SeriesStyle } from './common.js';
import type { SeriesSlot } from './scale.js';
import type { ChartTone } from './types.js';

/**
 * Pieces every chart is assembled from: the legend, and what the plot shows
 * while it has nothing to plot. Server-safe. Styled in `ChartFigure.styles.ts`,
 * which holds the frame all the charts share.
 */

export interface LegendItem {
  readonly id: string;
  readonly label: string;
  /** The series' identity colour. */
  readonly slot?: SeriesSlot;
  /** A state colour (P1, breached, on track); wins over `slot`, as it does on the mark. */
  readonly tone?: ChartTone;
  /** `comparison` keys in the comparison grey; `baseline` and `forecast` keys are dashed outlines, like their lines. */
  readonly style?: SeriesStyle;
  /** Shown after the label in the strong weight, for legends that double as the data (the PMO's bold counts). */
  readonly value?: string;
  readonly detail?: string;
}

/** What a legend key looks like: a square chip (the v3 default), a short line, or the v2 box. */
export type LegendMark = 'chip' | 'line' | 'box';

/**
 * The series a chart draws, each keyed by a mark in its colour (A8 §4.16).
 *
 * Square chips are the default, 10 × 10 above the plot, left-aligned — the
 * PMO's key, read once and then out of the way — whatever the mark: a line's
 * colour is as easy to match from a chip as from a stroke, and one key shape
 * across every chart is one thing less to learn. `line` stays for keys of
 * lanes and timelines, `box` for v2 callers.
 *
 * A chart of one series has none: its title already says what it is.
 */
export function ChartLegend({
  items,
  mark = 'chip',
  className,
}: {
  readonly items: readonly LegendItem[];
  readonly mark?: LegendMark;
  readonly className?: string;
}): ReactNode {
  return (
    <ul className={cx('itsm-ChartLegend', className)} aria-label="Legend">
      {items.map((item) => (
        <li key={item.id} className="itsm-ChartLegend__item">
          <span
            className="itsm-ChartLegend__key"
            data-mark={mark}
            data-slot={item.tone === undefined ? (item.slot ?? 1) : undefined}
            data-tone={item.tone}
            data-style={item.style === undefined || item.style === 'actual' ? undefined : item.style}
            aria-hidden="true"
          />
          <span className="itsm-ChartLegend__label">{item.label}</span>
          {item.value ? <span className="itsm-ChartLegend__value">{item.value}</span> : null}
          {item.detail ? <span className="itsm-ChartLegend__detail">{item.detail}</span> : null}
        </li>
      ))}
    </ul>
  );
}

/** What a plot with nothing to draw says, by reason, when the page gives no words of its own. */
export const CHART_EMPTY_TEXT: Readonly<Record<ChartEmptyReason, string>> = Object.freeze({
  empty: 'No data for this period',
  insufficient: 'Not enough history yet',
  error: "Couldn't load this chart",
});

const EMPTY_ICON: Readonly<Record<ChartEmptyReason, IconName>> = Object.freeze({
  empty: 'insights',
  insufficient: 'hourglass',
  error: 'circle-alert',
});

export interface ChartEmptyProps {
  /** The plot's height in px: the empty plot takes the same room, so a card does not jump when data arrives. */
  readonly height: number;
  /** Why there is nothing to draw. Default `empty`. */
  readonly reason?: ChartEmptyReason;
  /** The sentence. Defaults to the reason's (`CHART_EMPTY_TEXT`). */
  readonly text?: string;
  /** A second, quieter line: what would change it ("Charts start once there are 3 days of data"). */
  readonly detail?: string;
}

/**
 * The plot with nothing in it: the same height as a drawn one and a sentence
 * rather than an empty frame (A8 §4.1 states). The three reasons look apart
 * at a glance — a tinted disc with the insights glyph for no data, a quiet
 * one with an hourglass for too little history, a danger one for a failed
 * read — because "nothing happened" and "we could not find out" must never
 * read as the same answer.
 */
export function ChartEmpty({ height, reason = 'empty', text, detail }: ChartEmptyProps): ReactNode {
  return (
    <div className="itsm-Chart__empty" data-reason={reason} style={{ minBlockSize: `${height}px` }}>
      <span className="itsm-Chart__emptyDisc">
        <Icon name={EMPTY_ICON[reason]} size="xl" className="itsm-Chart__emptyIcon" />
      </span>
      <p className="itsm-Chart__emptyText">{text ?? CHART_EMPTY_TEXT[reason]}</p>
      {detail ? <p className="itsm-Chart__emptyDetail">{detail}</p> : null}
    </div>
  );
}

/** Bar heights for the loading silhouette: varied, so it reads as "a chart is coming" rather than a grid of blocks. */
const SILHOUETTE = ['46%', '68%', '54%', '82%', '60%', '74%', '50%'];

/**
 * The plot while its data loads: faint gridlines at the final height and a
 * shimmering silhouette of bars, revealed after 200 ms so a quick answer
 * never flashes it. Decorative; the figure carries `aria-busy` and its
 * caption says what is loading.
 */
export function ChartLoading({ height }: { readonly height: number }): ReactNode {
  return (
    <div className="itsm-Chart__loading" style={{ minBlockSize: `${height}px` }} aria-hidden="true">
      <span className="itsm-Chart__loadingLine" />
      <span className="itsm-Chart__loadingLine" />
      <span className="itsm-Chart__loadingLine" />
      <span className="itsm-Chart__loadingLine" />
      <span className="itsm-Chart__loadingBars">
        {SILHOUETTE.map((size, index) => (
          <Skeleton key={index} height={size} radius="md" />
        ))}
      </span>
    </div>
  );
}
