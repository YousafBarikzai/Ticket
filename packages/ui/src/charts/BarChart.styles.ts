import { moreContrast } from '../feedback/tone.js';
import { css, layer, mq, prefers } from '../styles/css.js';
import { textureImages, textureVariables } from './texture-css.js';

const hatch = (ink: string): string => textureImages(ink)[2]!;

/**
 * `BarChart`: vertical columns with a value axis, horizontal bars with the
 * value at the tip, and the `list` of label · bar · value rows.
 *
 * The marks follow the chart rules (A8 §4.8): bars at most 24 px thick
 * (list bars 8 px), a 4 px rounded data end and a square baseline, a 2 px
 * surface gap between stacked parts — the gap is real space, not a stroke —
 * and one colour for one series. Rows line up across the chart because the
 * value column is sized in `ch` from the widest value, so every bar starts
 * and scales from the same place. Grouped columns share 70 % of their band,
 * 2 px apart. Colour comes from the kit's shared slot, tone and style rules;
 * a `neutralSoft` part draws the outline its tone asks for, and a hatched
 * part ("Other · n", "unassigned", a forecast) is hatched in every theme.
 *
 * Part labels are each part's own size container: a label shows only where
 * its part is at least 28 px long, on a chip of the card's colour, so the
 * text keeps its contrast whatever the part's colour. Totals sit above
 * their columns. One reveal grows the bars from their baseline.
 *
 * With more contrast (and in forced colours) every slot and tone wears its
 * hatch as well as its colour.
 */
export const barChartStyles = layer(
  'components',
  css`
.itsm-BarChart {
  display: flex;
  flex-direction: column;
  gap: var(--itsm-space-sm);
}

.itsm-BarChart__bar {
  display: flex;
  gap: var(--itsm-border-thick);
  transition: opacity var(--itsm-duration-fast) var(--itsm-easing-standard);
}

.itsm-BarChart__segment {
  flex: 1 1 0;
  min-inline-size: 0;
  min-block-size: 0;
  background: var(--_itsm-series);
  box-shadow: inset 0 0 0 1px var(--_itsm-series-edge, transparent);
}

.itsm-BarChart[data-labels="segments"] .itsm-BarChart__segment {
  container: itsm-bar / inline-size;
  display: grid;
  place-items: center;
  overflow: hidden;
}

.itsm-BarChart[data-labels="segments"] .itsm-BarChart__column .itsm-BarChart__segment {
  container-type: size;
}

.itsm-BarChart__segmentLabel {
  display: none;
  padding-inline: var(--itsm-space-3xs);
  border-radius: var(--itsm-radius-xs);
  background: var(--_itsm-chart-surface);
  color: var(--itsm-colour-text-primary);
}

@container itsm-bar (min-width: 28px) {
  .itsm-BarChart[data-layout="rows"] .itsm-BarChart__segmentLabel { display: block; }
}

@container itsm-bar (min-height: 28px) {
  .itsm-BarChart__column .itsm-BarChart__segmentLabel { display: block; }
}

.itsm-BarChart__segmentLabel,
.itsm-BarChart__total {
  font-size: var(--itsm-text-caption-size);
  line-height: var(--itsm-text-caption-line);
  font-weight: var(--itsm-font-weight-semibold);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

/* The dashed target across each row's track, at the same place in every row. */
.itsm-BarChart__target {
  position: absolute;
  inset-block: calc(-1 * var(--itsm-space-2xs));
  inset-inline-start: calc(var(--_itsm-target) * (100% - var(--_itsm-track-pad, 0px)));
  border-inline-start: 1px dashed var(--itsm-colour-text-secondary);
}

/* Rows: the list and horizontal bars --------------------------------------- */

.itsm-BarChart__rows {
  display: grid;
  gap: var(--itsm-space-2xs);
  margin: 0;
  padding: 0;
  list-style: none;
}

.itsm-BarChart__row {
  --_itsm-value-column: calc(var(--_itsm-value-ch) * 1ch + var(--itsm-space-xs));
  display: grid;
  align-items: center;
  column-gap: var(--itsm-space-sm);
  min-block-size: var(--itsm-control-height-md);
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
  letter-spacing: var(--itsm-text-callout-tracking);
}

.itsm-BarChart__label {
  display: flex;
  align-items: center;
  gap: var(--itsm-space-xs);
  min-inline-size: 0;
  color: var(--itsm-colour-text-primary);
}

.itsm-BarChart__icon {
  flex: none;
  color: var(--itsm-colour-text-secondary);
}

.itsm-BarChart__name {
  min-inline-size: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.itsm-BarChart__link {
  border-radius: var(--itsm-radius-xs);
  color: inherit;
  text-decoration: none;
}

@media (hover: hover) {
  .itsm-BarChart__link:hover {
    color: var(--itsm-colour-text-link);
    text-decoration: underline;
    text-underline-offset: 0.2em;
  }
}

.itsm-BarChart__secondary {
  flex: none;
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  color: var(--itsm-colour-text-muted);
  white-space: nowrap;
}

.itsm-BarChart__value {
  font-weight: var(--itsm-font-weight-medium);
  font-variant-numeric: tabular-nums;
  color: var(--itsm-colour-text-primary);
  text-align: end;
  white-space: nowrap;
}

.itsm-BarChart__track {
  position: relative;
  display: block;
  min-inline-size: 0;
}

.itsm-BarChart__row .itsm-BarChart__bar {
  block-size: 100%;
  inline-size: calc(var(--_itsm-bar) * 100%);
}

.itsm-BarChart__row .itsm-BarChart__segment {
  min-inline-size: 3px;
}

.itsm-BarChart__row .itsm-BarChart__segment:last-child {
  border-start-end-radius: var(--itsm-radius-xs);
  border-end-end-radius: var(--itsm-radius-xs);
}

/* The list: label · bar · value, a thin bar; label and value above the bar in a narrow card. */
.itsm-BarChart[data-layout="list"] .itsm-BarChart__row {
  grid-template-columns: minmax(0, 2fr) minmax(0, 3fr) var(--_itsm-value-column);
}

.itsm-BarChart[data-layout="list"] .itsm-BarChart__label { grid-column: 1; grid-row: 1; }
.itsm-BarChart[data-layout="list"] .itsm-BarChart__track { grid-column: 2; grid-row: 1; block-size: var(--itsm-space-xs); }
.itsm-BarChart[data-layout="list"] .itsm-BarChart__value { grid-column: 3; grid-row: 1; }

@container itsm-chart (max-width: 26rem) {
  .itsm-BarChart[data-layout="list"] .itsm-BarChart__row {
    grid-template-columns: minmax(0, 1fr) auto;
    row-gap: var(--itsm-space-2xs);
    padding-block: var(--itsm-space-2xs);
  }
  .itsm-BarChart[data-layout="list"] .itsm-BarChart__value { grid-column: 2; }
  .itsm-BarChart[data-layout="list"] .itsm-BarChart__track { grid-column: 1 / -1; grid-row: 2; }
}

/* Horizontal bars: label, then a 20 px bar with its value just past the tip. */
.itsm-BarChart[data-layout="rows"] .itsm-BarChart__row {
  grid-template-columns: minmax(0, 2fr) minmax(0, 5fr);
}

.itsm-BarChart[data-layout="rows"] .itsm-BarChart__label { grid-column: 1; grid-row: 1; }

.itsm-BarChart[data-layout="rows"] .itsm-BarChart__track {
  grid-column: 2;
  grid-row: 1;
  block-size: 1.25rem;
  --_itsm-track-pad: calc(var(--_itsm-value-column) + var(--itsm-space-xs));
  padding-inline-end: var(--_itsm-track-pad);
}

.itsm-BarChart[data-layout="rows"] .itsm-BarChart__value {
  grid-column: 2;
  grid-row: 1;
  justify-self: start;
  margin-inline-start: calc(var(--_itsm-bar) * (100% - var(--_itsm-value-column) - var(--itsm-space-xs)) + var(--itsm-space-xs));
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
}

@container itsm-chart (max-width: 26rem) {
  .itsm-BarChart[data-layout="rows"] .itsm-BarChart__row {
    grid-template-columns: minmax(0, 1fr);
    row-gap: var(--itsm-space-2xs);
  }
  .itsm-BarChart[data-layout="rows"] .itsm-BarChart__track,
  .itsm-BarChart[data-layout="rows"] .itsm-BarChart__value {
    grid-column: 1;
    grid-row: 2;
  }
}

/* Vertical columns with a value axis --------------------------------------- */

.itsm-BarChart[data-layout="columns"] {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  grid-template-areas:
    "legend legend"
    "y plot"
    ". x";
  column-gap: var(--itsm-space-xs);
  row-gap: 0;
}

.itsm-BarChart[data-layout="columns"] .itsm-BarChart__legend {
  grid-area: legend;
  margin-block-end: var(--itsm-space-sm);
}

.itsm-BarChart__y,
.itsm-BarChart__x {
  font-size: var(--itsm-text-caption-size);
  line-height: var(--itsm-text-caption-line);
  font-weight: var(--itsm-text-caption-weight);
  letter-spacing: var(--itsm-text-caption-tracking);
  font-variant-numeric: tabular-nums;
  color: var(--itsm-colour-text-muted);
}

.itsm-BarChart__y {
  grid-area: y;
  position: relative;
  block-size: var(--_itsm-plot-h);
  text-align: end;
}

.itsm-BarChart__sizer {
  display: block;
  block-size: 0;
  overflow: hidden;
  visibility: hidden;
  white-space: nowrap;
}

.itsm-BarChart__yTick {
  position: absolute;
  inset-inline-end: 0;
  transform: translateY(-50%);
  white-space: nowrap;
}

.itsm-BarChart__plot {
  grid-area: plot;
  min-inline-size: 0;
}

.itsm-BarChart__canvas {
  position: relative;
  block-size: var(--_itsm-plot-h);
}

.itsm-BarChart__grid {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.itsm-BarChart__gridline {
  position: absolute;
  inset-inline: 0;
  block-size: var(--itsm-hairline);
  background: var(--itsm-colour-chart-grid);
}

.itsm-BarChart__gridline[data-axis] {
  background: var(--itsm-colour-chart-axis);
}

.itsm-BarChart__columns {
  position: absolute;
  inset: var(--_itsm-plot-top) 0 0;
  display: flex;
  margin: 0;
  padding: 0;
  list-style: none;
}

.itsm-BarChart__column {
  position: relative;
  display: flex;
  flex: 1 1 0;
  align-items: flex-end;
  justify-content: center;
  min-inline-size: 0;
}

.itsm-BarChart__column .itsm-BarChart__bar {
  position: relative;
  flex-direction: column-reverse;
  inline-size: min(1.5rem, 64%);
  block-size: calc(var(--_itsm-bar) * 100%);
}

/* Grouped: up to three bars side by side in 70 % of the band, 2 px apart. */
.itsm-BarChart__group {
  display: flex;
  align-items: flex-end;
  justify-content: center;
  gap: var(--itsm-border-thick);
  inline-size: 70%;
  block-size: 100%;
}

.itsm-BarChart__group > .itsm-BarChart__bar {
  flex: 0 1 1.5rem;
  inline-size: auto;
  min-inline-size: 0;
}

.itsm-BarChart__total {
  position: absolute;
  inset-block-end: 100%;
  inset-inline: -1rem;
  padding-block-end: var(--itsm-space-3xs);
  color: var(--itsm-colour-text-secondary);
  text-align: center;
}

.itsm-BarChart__overlay {
  position: absolute;
  inset: 0;
  overflow: visible;
  pointer-events: none;
}

.itsm-BarChart__column .itsm-BarChart__segment {
  min-block-size: 2px;
}

.itsm-BarChart__column .itsm-BarChart__segment:last-child {
  border-start-start-radius: var(--itsm-radius-xs);
  border-start-end-radius: var(--itsm-radius-xs);
}

.itsm-BarChart__x {
  grid-area: x;
  display: flex;
  padding-block-start: var(--itsm-space-xs);
}

.itsm-BarChart__xTick {
  flex: 1 1 0;
  min-inline-size: 0;
  padding-inline: var(--itsm-space-3xs);
  overflow: hidden;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.itsm-BarChart__xTick[data-hidden] {
  visibility: hidden;
}

@container itsm-chart (max-width: 30rem) {
  .itsm-BarChart__xTick[data-wide] {
    visibility: hidden;
  }
}

/* Reading (interactive): the bar being read stays; the rest step back. */
.itsm-ChartReader[data-reading] [data-point]:not([data-active]) .itsm-BarChart__bar {
  opacity: 0.4;
}

/* One reveal on first paint, from the baseline (A8 §6.4). */
@keyframes itsm-bar-grow {
  from { transform: scaleX(0); }
}

@keyframes itsm-column-grow {
  from { transform: scaleY(0); }
}

.itsm-BarChart[data-reveal] .itsm-BarChart__row .itsm-BarChart__bar {
  transform-origin: 0 50%;
  animation: itsm-bar-grow var(--itsm-duration-reveal) var(--itsm-easing-entrance);
}

.itsm-BarChart__row .itsm-BarChart__bar:dir(rtl) {
  transform-origin: 100% 50%;
}

.itsm-BarChart[data-reveal] .itsm-BarChart__column .itsm-BarChart__bar {
  transform-origin: 50% 100%;
  animation: itsm-column-grow var(--itsm-duration-reveal) var(--itsm-easing-entrance);
}

${textureVariables('.itsm-BarChart__segment')}

${moreContrast(
  (scope) => `${scope} .itsm-BarChart__segment { --_itsm-ink: var(--_itsm-chart-surface); background: var(--_itsm-texture, none), var(--_itsm-series); }`,
)}

/* After the contrast rules, so a hatched part keeps its hatch there too. */
.itsm-BarChart :is(.itsm-BarChart__segment, .itsm-ChartLegend__key)[data-pattern="hatch"] {
  background: ${hatch('var(--_itsm-chart-surface)')}, var(--_itsm-series);
}

/* As specific as the reveal, and after it, so reduced motion wins. */
${mq.reducedMotion} {
  .itsm-BarChart__bar {
    transition: none;
  }
  .itsm-BarChart[data-reveal] :is(.itsm-BarChart__row, .itsm-BarChart__column) .itsm-BarChart__bar {
    animation: none;
  }
}

${prefers.reducedMotion} .itsm-BarChart__bar {
  transition: none;
}

${prefers.reducedMotion} .itsm-BarChart[data-reveal] :is(.itsm-BarChart__row, .itsm-BarChart__column) .itsm-BarChart__bar {
  animation: none;
}

/*
 * Forced colours: as specific as the contrast rules and after them, because
 * a system high-contrast theme usually asks for more contrast as well.
 */
${mq.forcedColors} {
  :root .itsm-BarChart .itsm-BarChart__segment {
    forced-color-adjust: none;
    --_itsm-ink: CanvasText;
    background: var(--_itsm-texture, none), Canvas;
    box-shadow: inset 0 0 0 1px CanvasText;
  }
  :root .itsm-BarChart .itsm-BarChart__segment[data-slot="1"] {
    background: CanvasText;
  }
  :root .itsm-BarChart :is(.itsm-BarChart__segment, .itsm-ChartLegend__key)[data-pattern] {
    background: ${hatch('CanvasText')}, Canvas;
  }
  .itsm-BarChart__overlay {
    forced-color-adjust: none;
  }
  .itsm-BarChart__gridline {
    forced-color-adjust: none;
    background: GrayText;
  }
  .itsm-BarChart__gridline[data-axis] {
    background: CanvasText;
  }
}
`,
);
