/**
 * `@itsm/ui/charts` — figures, charts and the stat cards around them.
 *
 * The charts render as static SVG on the server; `interactive` adds a small
 * client layer for hover and keyboard reading. Its own subpath so a page with
 * no chart ships none of it.
 */
export { AreaChart, type AreaChartProps } from './AreaChart.js';
export { BarChart, type BarChartProps, type BarDatum } from './BarChart.js';
export { ChartFigure, type ChartFigureProps, type ChartFigureTable } from './ChartFigure.js';
export { DonutChart, type DonutChartProps, type DonutSegment } from './DonutChart.js';
export { LineChart, type ChartSeries, type LineChartProps } from './LineChart.js';
export { ProgressRing, type ProgressRingProps } from './ProgressRing.js';
export { Sparkline, type SparklineProps } from './Sparkline.js';
export { StatCard, type StatCardDelta, type StatCardProps } from './StatCard.js';
export { StatGrid, type StatGridProps } from './StatGrid.js';
export type { ChartSlot, ChartTableMode } from './types.js';
/** "Rising, 12 → 18": the words a `Sparkline` is named by. */
export { describeTrend } from './scale.js';
// Deprecated: wrappers over `StatCard` and `StatGrid` until nothing imports them.
export { Metric, MetricGrid, type MetricProps } from '../web/Metric.js';
