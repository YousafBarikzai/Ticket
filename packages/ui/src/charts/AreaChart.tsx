import type { ReactNode } from 'react';
import { XYChart, type LineChartProps } from './xy.js';

/** The same data and options as a line chart; `fill` defaults to `wash`. */
export type AreaChartProps = LineChartProps;

/**
 * A line chart with its `actual` series washed in: for a quantity whose size
 * matters as well as its shape (a backlog, resolved work), or (`stacked`) for
 * parts that add up to a whole over time. The wash is the series colour at a
 * tenth of its strength (8 % when several are washed, a little more in the
 * dark themes), or with `fill="gradient"` a wash that fades towards the
 * baseline; the line on top carries the identity, so comparison lines and
 * overlapping areas stay readable. Server-safe static SVG with the optional
 * reader island.
 */
export function AreaChart(props: AreaChartProps): ReactNode {
  return <XYChart kind="area" props={props} />;
}
