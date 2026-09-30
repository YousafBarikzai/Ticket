import { moreContrast } from '../feedback/tone.js';
import { css, layer, mq } from '../styles/css.js';

/**
 * Forced colours take the hues away, so each line keeps its identity by its
 * dash instead (and the legend and end labels say which is which).
 */
const dashes: Readonly<Record<number, string>> = { 2: '6 3', 3: '1.5 3', 4: '8 3 1.5 3', 5: '3 3', 6: '10 4', 7: '1.5 5', 8: '12 3 3 3' };
const forcedDashes = Object.entries(dashes)
  .map(([slot, dash]) => `  .itsm-XYChart__line[data-slot="${slot}"] { stroke-dasharray: ${dash}; }`)
  .join('\n');

/**
 * The line and area charts' frame (`charts/xy.tsx`; area washes are in
 * `AreaChart.styles.ts`): a grid of the y-axis ticks, the plot, the direct
 * end labels, and the x-axis ticks under the plot.
 *
 * Marks: 2 px lines with round joins that stay 2 px at any width
 * (`non-scaling-stroke`), markers of 8 px with a 2 px ring in the surface
 * colour. Chrome: solid hairline gridlines, the baseline one step stronger,
 * ticks in `caption` with tabular figures in `text.muted`.
 *
 * It adapts to its own width, not the viewport: below 32rem the end labels
 * give way to the legend, and below 30rem the x axis keeps its first, middle
 * and last ticks.
 */
export const lineChartStyles = layer(
  'components',
  css`
.itsm-XYChart {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  grid-template-areas:
    "legend legend"
    "y plot"
    ". x";
  column-gap: var(--itsm-space-xs);
  align-items: start;
}

.itsm-XYChart[data-ends] {
  grid-template-columns: auto minmax(0, 1fr) auto;
  grid-template-areas:
    "legend legend legend"
    "y plot ends"
    ". x .";
}

.itsm-XYChart__legend {
  grid-area: legend;
  margin-block-end: var(--itsm-space-sm);
}

.itsm-XYChart__y,
.itsm-XYChart__x {
  font-size: var(--itsm-text-caption-size);
  line-height: var(--itsm-text-caption-line);
  font-weight: var(--itsm-text-caption-weight);
  letter-spacing: var(--itsm-text-caption-tracking);
  font-variant-numeric: tabular-nums;
  color: var(--itsm-colour-text-muted);
}

.itsm-XYChart__y {
  grid-area: y;
  position: relative;
  block-size: var(--_itsm-plot-h);
  text-align: end;
}

.itsm-XYChart__sizer {
  display: block;
  block-size: 0;
  overflow: hidden;
  visibility: hidden;
  white-space: nowrap;
}

.itsm-XYChart__yTick {
  position: absolute;
  inset-inline-end: 0;
  transform: translateY(-50%);
  white-space: nowrap;
}

.itsm-XYChart__plot {
  grid-area: plot;
  position: relative;
  min-inline-size: 0;
  block-size: var(--_itsm-plot-h);
}

.itsm-XYChart__svg {
  display: block;
  inline-size: 100%;
  block-size: var(--_itsm-plot-h);
  overflow: visible;
}

.itsm-XYChart__paths {
  overflow: visible;
}

.itsm-XYChart__gridline {
  stroke: var(--itsm-colour-chart-grid);
  stroke-width: 1;
  shape-rendering: crispEdges;
}

.itsm-XYChart__gridline[data-axis] {
  stroke: var(--itsm-colour-chart-axis);
}

.itsm-XYChart__line {
  fill: none;
  stroke: var(--_itsm-series);
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
  vector-effect: non-scaling-stroke;
}

.itsm-XYChart__dot,
.itsm-XYChart__end {
  fill: var(--_itsm-series);
  stroke: var(--_itsm-chart-surface);
  paint-order: stroke;
}

.itsm-XYChart__dot {
  stroke-width: 2;
}

.itsm-XYChart__end {
  stroke-width: 4;
}

.itsm-XYChart__ends {
  grid-area: ends;
  position: relative;
  block-size: var(--_itsm-plot-h);
  max-inline-size: 10rem;
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  color: var(--itsm-colour-text-secondary);
}

.itsm-XYChart__ends > .itsm-XYChart__sizer {
  display: flex;
  gap: var(--itsm-space-2xs);
}

.itsm-XYChart__endLabel {
  position: absolute;
  inset-inline-start: 0;
  display: flex;
  align-items: center;
  gap: var(--itsm-space-2xs);
  max-inline-size: 100%;
  transform: translateY(-50%);
  white-space: nowrap;
}

.itsm-XYChart__endKey {
  flex: none;
  inline-size: var(--itsm-space-xs);
  block-size: var(--itsm-border-thick);
  border-radius: var(--itsm-radius-pill);
  background: var(--_itsm-series);
}

.itsm-XYChart__endName {
  min-inline-size: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.itsm-XYChart__endValue {
  font-weight: var(--itsm-font-weight-semibold);
  font-variant-numeric: tabular-nums;
  color: var(--itsm-colour-text-primary);
}

.itsm-XYChart__x {
  grid-area: x;
  position: relative;
  block-size: calc(var(--itsm-text-caption-line) + var(--itsm-space-xs));
}

.itsm-XYChart__xTick {
  position: absolute;
  inset-block-start: var(--itsm-space-xs);
  max-inline-size: 8rem;
  overflow: hidden;
  transform: translateX(-50%);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.itsm-XYChart__xTick[data-edge="start"] {
  transform: none;
}

.itsm-XYChart__xTick[data-edge="end"] {
  transform: translateX(-100%);
}

@container itsm-chart (max-width: 32rem) {
  .itsm-XYChart[data-ends] {
    grid-template-columns: auto minmax(0, 1fr);
    grid-template-areas:
      "legend legend"
      "y plot"
      ". x";
  }
  .itsm-XYChart__ends {
    display: none;
  }
}

@container itsm-chart (max-width: 30rem) {
  .itsm-XYChart__xTick[data-wide] {
    display: none;
  }
}

${moreContrast((scope) => `${scope} .itsm-XYChart__line { stroke-width: 2.5; }`)}

${mq.forcedColors} {
  .itsm-XYChart__svg {
    forced-color-adjust: none;
  }
  .itsm-XYChart__line {
    stroke: CanvasText;
  }
${forcedDashes}
  .itsm-XYChart__dot,
  .itsm-XYChart__end {
    fill: CanvasText;
    stroke: Canvas;
  }
  .itsm-XYChart__gridline {
    stroke: GrayText;
  }
  .itsm-XYChart__gridline[data-axis] {
    stroke: CanvasText;
  }
  .itsm-XYChart__endKey {
    forced-color-adjust: none;
    background: CanvasText;
  }
}
`,
);
