import type { ReactNode } from 'react';
import { cx } from '../web/cx.js';
import type { LineChartProps } from './LineChart.js';

/** The same data and options as a line chart, filled to the baseline. */
export type AreaChartProps = LineChartProps;

/**
 * Stub (SPEC §4.8): renders the titled figure; the charts package draws it.
 */
export function AreaChart({ title, height = 220, className }: AreaChartProps): ReactNode {
  return (
    <figure className={cx('itsm-AreaChart', className)} data-height={height}>
      <figcaption>{title}</figcaption>
    </figure>
  );
}
