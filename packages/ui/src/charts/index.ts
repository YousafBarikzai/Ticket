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
export { CHART_TABLE_DEFAULTS, type ChartTableCell, type ChartTableKind } from './ChartFigure.js';
export type { ChartBand, ChartCommon, ChartEmptyReason, ChartMarker, ChartMarkerKind, ChartTarget, SeriesLook, SeriesStyle, TimeBucket } from './common.js';
export { DonutChart, type DonutChartProps, type DonutSegment } from './DonutChart.js';
export { LineChart, type ChartSeries, type LineChartProps } from './LineChart.js';
export { MARKER_TIER_HEIGHT, MarkerBackdrop, MarkerLayer, layoutMarkers, markerTableColumn, resolveBands, resolveMarkers, type MarkerAxis, type MarkerBackdropProps, type MarkerContext, type MarkerLayerProps, type MarkerLayout, type PlacedMarker, type ResolvedBand, type ResolvedMarker } from './markers.js';
export { CHART_EMPTY_TEXT, ChartEmpty, ChartLegend, type ChartEmptyProps, type LegendItem, type LegendMark } from './parts.js';
export { ProgressRing, type ProgressRingProps } from './ProgressRing.js';
export { Sparkline, type SparklineProps } from './Sparkline.js';
export { StatCard, type StatCardDelta, type StatCardProps } from './StatCard.js';
export type { StatCardInfo } from './StatCard.js';
export { StatGrid, type StatGridProps } from './StatGrid.js';
export { asAtLabel, formatShortDate, inferBucket, localDateKey, markerPosition, type TodayPlacement } from './time.js';
export { chartToneOutline, chartToneVar } from './tone.js';
export type { ChartSlot, ChartTableMode } from './types.js';
export type { ChartTone } from './types.js';
/** "Rising, 12 → 18": the words a `Sparkline` is named by. */
export { describeTrend } from './scale.js';
// Deprecated: wrappers over `StatCard` and `StatGrid` until nothing imports them.
export { Metric, MetricGrid, type MetricProps } from '../web/Metric.js';
