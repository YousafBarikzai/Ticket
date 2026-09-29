import type { ReactNode } from 'react';
import type { IconName } from '../types.js';
import { cx } from '../web/cx.js';
import type { ChartSlot, ChartTableMode } from './types.js';

export interface BarDatum {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly href?: string;
  readonly icon?: IconName;
  /** Stacked parts by series id, for `seriesDefs`. */
  readonly series?: Readonly<Record<string, number>>;
}

export interface BarChartProps {
  readonly title: string;
  readonly data: readonly BarDatum[];
  /** `list`: label · bar · value rows, for ranked breakdowns. */
  readonly variant?: 'bars' | 'list';
  readonly orientation?: 'horizontal' | 'vertical';
  /** Makes the bars stacked, one segment per series. */
  readonly seriesDefs?: readonly { readonly id: string; readonly label: string; readonly slot: ChartSlot }[];
  readonly valueFormat?: Intl.NumberFormatOptions;
  readonly sort?: 'value' | 'none';
  /** The rest are folded into "Other". */
  readonly maxBars?: number;
  readonly table?: ChartTableMode;
  readonly interactive?: boolean;
  readonly className?: string;
}

/**
 * Comparisons across categories, as bars or as a ranked list. Server-safe
 * static SVG with an optional client layer.
 *
 * Stub (SPEC §4.8): renders the titled figure; the charts package draws it.
 */
export function BarChart({ title, variant = 'bars', className }: BarChartProps): ReactNode {
  return (
    <figure className={cx('itsm-BarChart', className)} data-variant={variant}>
      <figcaption>{title}</figcaption>
    </figure>
  );
}
