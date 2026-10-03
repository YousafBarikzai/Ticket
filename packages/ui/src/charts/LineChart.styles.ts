import { moreContrast } from '../feedback/tone.js';
import { css, layer, mq, prefers } from '../styles/css.js';

/**
 * Forced colours take the hues away, so each line keeps its identity by its
 * dash instead (and the legend and end labels say which is which). A
 * comparison or forecast keeps the dash its style has everywhere.
 */
const dashes: Readonly<Record<number, string>> = { 2: '6 3', 3: '1.5 3', 4: '8 3 1.5 3', 5: '3 3', 6: '10 4', 7: '1.5 5', 8: '12 3 3 3' };
const forcedDashes = Object.entries(dashes)
  .map(([slot, dash]) => `  .itsm-XYChart__line[data-slot="${slot}"] { stroke-dasharray: ${dash}; }`)
  .join('\n');

/**
 * The line and area charts' frame (`charts/xy.tsx`; washes are in
 * `AreaChart.styles.ts`, markers and the legend in `ChartFigure.styles.ts`):
 * the legend chips above, a grid of the y-axis ticks, the plot, the end
 * labels in a gutter of at most `min(22%, 170px)`, and the x-axis ticks.
 *
 * Series styles (A8 §4.3.2): `actual` 2 px in its colour (2.5 px for the
 * primary of several); `comparison` 1.5 px solid and `baseline` 1.5 px dashed
 * 2 3, both in the comparison grey; `forecast` 1.5 px dashed 5 4 in its
 * series' colour, its end dot hollow. Every stroke stays its width at any
 * plot width (`non-scaling-stroke`). Chrome recedes: hairline gridlines, the
 * baseline one step stronger, ticks in `caption`.
 *
 * One reveal on first paint (A8 §6.4): the plot wipes in from the start over
 * `--itsm-duration-reveal`, never under reduced motion or `animate={false}`;
 * React keeps the same nodes on a refetch, so it never replays.
 *
 * It adapts to its own width, not the viewport: below 32rem the end labels
 * give way to the legend, and below 30rem the x axis keeps its first, middle
 * and last ticks.
 */
export const lineChartStyles = layer(
  'components',
  css`
@keyframes itsm-xy-reveal {
  from { clip-path: inset(-0.5rem 100% -0.5rem -0.5rem); }
  to { clip-path: inset(-0.5rem); }
}

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
  grid-template-columns: auto minmax(0, 1fr) fit-content(min(22%, 10.625rem));
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
.itsm-XYChart__x,
.itsm-XYChart__ends {
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

.itsm-XYChart[data-reveal] .itsm-XYChart__svg {
  animation: itsm-xy-reveal var(--itsm-duration-reveal) var(--itsm-easing-entrance);
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

.itsm-XYChart__line[data-primary] {
  stroke-width: 2.5;
}

.itsm-XYChart__line:is([data-style="comparison"], [data-style="baseline"], [data-style="forecast"]) {
  stroke-width: 1.5;
}

.itsm-XYChart__line[data-style="baseline"] {
  stroke-dasharray: 2 3;
}

.itsm-XYChart__line[data-style="forecast"] {
  stroke-dasharray: 5 4;
}

/* v2's reference line (a calibrated diagonal): thin, dashed, grey. */
.itsm-XYChart__line[data-reference] {
  stroke-width: 1.5;
  stroke-dasharray: 4 4;
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

/* A forecast ends on a hollow dot: a point not yet reached. */
.itsm-XYChart__end[data-style="forecast"] {
  fill: var(--_itsm-chart-surface);
  stroke: var(--_itsm-series);
  stroke-width: 1.5;
  paint-order: normal;
}

.itsm-XYChart__ends {
  grid-area: ends;
  position: relative;
  block-size: var(--_itsm-plot-h);
  color: var(--itsm-colour-text-secondary);
  font-weight: var(--itsm-font-weight-regular);
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

/* The PMO's 8 × 8 swatch, radius 2: a chip like the legend's, so the two read as one key. */
.itsm-XYChart__endKey {
  flex: none;
  inline-size: 0.5rem;
  block-size: 0.5rem;
  border-radius: 0.125rem;
  background: var(--_itsm-series);
  box-shadow: inset 0 0 0 1px var(--_itsm-series-edge, transparent);
}

.itsm-XYChart__endKey:is([data-style="baseline"], [data-style="forecast"]) {
  box-sizing: border-box;
  border: 1.5px dashed var(--_itsm-series);
  background: transparent;
}

.itsm-XYChart__endName {
  min-inline-size: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.itsm-XYChart__endValue {
  font-weight: var(--itsm-font-weight-semibold);
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

${mq.reducedMotion} {
  .itsm-XYChart[data-reveal] .itsm-XYChart__svg {
    animation: none;
  }
}

${prefers.reducedMotion} .itsm-XYChart[data-reveal] .itsm-XYChart__svg {
  animation: none;
}

${moreContrast(
  (scope) => `${scope} .itsm-XYChart__line { stroke-width: 2.5; }
${scope} .itsm-XYChart__line:is([data-style="comparison"], [data-style="baseline"], [data-style="forecast"], [data-reference]) { stroke-width: 2; }
${scope} .itsm-XYChart__gridline[data-axis] { stroke: var(--itsm-colour-border-strong); }`,
)}

${mq.forcedColors} {
  .itsm-XYChart__svg,
  .itsm-XYChart__endKey {
    forced-color-adjust: none;
  }
  .itsm-XYChart__line {
    stroke: CanvasText;
  }
${forcedDashes}
  .itsm-XYChart__line:is([data-style="comparison"], [data-style="baseline"]) {
    stroke-dasharray: 2 3;
  }
  .itsm-XYChart__line[data-style="forecast"] {
    stroke-dasharray: 5 4;
  }
  .itsm-XYChart__dot,
  .itsm-XYChart__end {
    fill: CanvasText;
    stroke: Canvas;
  }
  .itsm-XYChart__end[data-style="forecast"] {
    fill: Canvas;
    stroke: CanvasText;
  }
  .itsm-XYChart__gridline {
    stroke: GrayText;
  }
  .itsm-XYChart__gridline[data-axis] {
    stroke: CanvasText;
  }
  .itsm-XYChart__endKey {
    background: CanvasText;
  }
  .itsm-XYChart__endKey:is([data-style="baseline"], [data-style="forecast"]) {
    background: Canvas;
    border-color: CanvasText;
  }
}
`,
);
