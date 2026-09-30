import type { ReactNode } from 'react';
import { XYChart, type ChartSeries, type LineChartProps } from './xy.js';

export type { ChartSeries, LineChartProps };

/**
 * Values over time or across categories, as 2 px lines. Server-safe static
 * SVG, with an optional client layer (`interactive`) for the crosshair and
 * keyboard readout. Replaces the drafts' `TimeSeries`.
 *
 * One series has no legend (the title names it) and a value at its end; two
 * to four are labelled where they end as well as in the legend, unless their
 * ends collide, when the legend alone carries them. Every value is also in
 * the table under "View as table".
 */
export function LineChart(props: LineChartProps): ReactNode {
  return <XYChart kind="line" props={props} />;
}
