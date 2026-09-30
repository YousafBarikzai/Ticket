import type { ReactNode } from 'react';
import { Icon } from '../icons/Icon.js';
import { cx } from '../web/cx.js';
import { Skeleton } from '../web/Skeleton.js';
import type { SeriesSlot } from './scale.js';

/**
 * Pieces every chart is assembled from: the legend, and what the plot shows
 * while it has nothing to plot. Server-safe. Styled in `ChartFigure.styles.ts`,
 * which holds the frame all the charts share.
 */

export interface LegendItem {
  readonly id: string;
  readonly label: string;
  readonly slot: SeriesSlot;
  /** Shown after the label, for legends that double as direct labels (the donut's). */
  readonly value?: string;
  readonly detail?: string;
}

/**
 * The series a chart draws, each keyed by a mark in its colour: a short line
 * for lines, a square for areas, bars and segments (the legend mirrors the
 * mark). A chart of one series has none: its title already says what it is.
 */
export function ChartLegend({ items, mark, className }: { readonly items: readonly LegendItem[]; readonly mark: 'line' | 'box'; readonly className?: string }): ReactNode {
  return (
    <ul className={cx('itsm-ChartLegend', className)} aria-label="Legend">
      {items.map((item) => (
        <li key={item.id} className="itsm-ChartLegend__item">
          <span className="itsm-ChartLegend__key" data-mark={mark} data-slot={item.slot} aria-hidden="true" />
          <span className="itsm-ChartLegend__label">{item.label}</span>
          {item.value ? <span className="itsm-ChartLegend__value">{item.value}</span> : null}
          {item.detail ? <span className="itsm-ChartLegend__detail">{item.detail}</span> : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * The plot with nothing in it: the same height as a drawn one, so a card does
 * not jump when data arrives, and a sentence rather than an empty frame.
 */
export function ChartEmpty({ text, height }: { readonly text: string; readonly height: number }): ReactNode {
  return (
    <div className="itsm-Chart__empty" style={{ minBlockSize: `${height}px` }}>
      <Icon name="insights" size="lg" className="itsm-Chart__emptyIcon" />
      <p className="itsm-Chart__emptyText">{text}</p>
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
