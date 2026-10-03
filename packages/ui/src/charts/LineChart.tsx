import type { ReactNode } from 'react';
import { XYChart, type ChartSeries, type LineChartProps, type SeriesFill } from './xy.js';

export type { ChartSeries, LineChartProps, SeriesFill };

/**
 * Values over time or across categories, as lines (A8 §4.3). Server-safe
 * static SVG, with the reader island (`interactive`) for the crosshair and
 * keyboard readout.
 *
 * One series has no legend (the title names it) and its value at its end;
 * two or more are keyed by square chips above the plot and labelled where
 * they end, nudged apart rather than overprinted, up to four. An `actual`
 * series is the accent line, read against grey `comparison` lines; a
 * `forecast` carries its series on, dashed. Markers ("As at 2 Oct", a
 * deadline), a target line and bands sit on the same axis. Every value is
 * also in the table under "View as table".
 */
export function LineChart(props: LineChartProps): ReactNode {
  return <XYChart kind="line" props={props} />;
}
