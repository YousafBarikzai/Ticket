import type { ReactNode } from 'react';
import { cx } from '../web/cx.js';
import type { ChartSlot, ChartTableMode } from './types.js';

export interface ChartSeries {
  readonly id: string;
  readonly label: string;
  readonly slot?: ChartSlot;
  /** `y: null` is a gap, not a zero. */
  readonly points: readonly { readonly x: string; readonly y: number | null }[];
}

export interface LineChartProps {
  readonly title: string;
  readonly description?: string;
  readonly series: readonly ChartSeries[];
  readonly xType: 'time' | 'category';
  readonly yFormat?: Intl.NumberFormatOptions;
  /** Default 220. */
  readonly height?: number;
  readonly baseline?: 'zero' | 'auto';
  readonly stacked?: boolean;
  readonly legend?: 'auto' | 'none';
  readonly directLabels?: 'end' | 'none';
  readonly table?: ChartTableMode;
  /** Adds the client hover and keyboard layer; without it the chart is static server-rendered SVG. */
  readonly interactive?: boolean;
  readonly emptyText?: string;
  readonly loading?: boolean;
  readonly className?: string;
}

/**
 * Values over time or across categories. Server-safe static SVG, with an
 * optional client layer for the crosshair and keyboard readout. Replaces the
 * drafts' `TimeSeries`.
 *
 * Stub (SPEC §4.8): renders the titled figure; the charts package draws it.
 */
export function LineChart({ title, height = 220, className }: LineChartProps): ReactNode {
  return (
    <figure className={cx('itsm-LineChart', className)} data-height={height}>
      <figcaption>{title}</figcaption>
    </figure>
  );
}
