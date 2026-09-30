import type { ReactNode } from 'react';
import { XYChart, type LineChartProps } from './xy.js';

/** The same data and options as a line chart, filled to the baseline. */
export type AreaChartProps = LineChartProps;

/**
 * A line chart with its area washed in: for a quantity whose size matters as
 * well as its shape, or (`stacked`) for parts that add up to a whole over
 * time. The wash is the series colour at a tenth of its strength and the line
 * on top carries the identity, so overlapping areas stay readable.
 * Server-safe static SVG with an optional client layer.
 */
export function AreaChart(props: AreaChartProps): ReactNode {
  return <XYChart kind="area" props={props} />;
}
