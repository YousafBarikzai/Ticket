import { moreContrast } from '../feedback/tone.js';
import { css, layer, mq, prefers } from '../styles/css.js';
import { textureRules } from './texture-css.js';
import { chartToneOutline, chartToneVar } from './tone.js';
import type { ChartTone } from './types.js';

/** Inside a chart, and in a legend wherever it is drawn. */
const scoped = (attribute: string): string => `.itsm-Chart ${attribute}, .itsm-ChartLegend ${attribute}`;

/** The categorical slots (SPEC §1.11), each a component-local `--_itsm-series`. */
const slots = [1, 2, 3, 4, 5, 6, 7, 8]
  .map((slot) => `${scoped(`[data-slot="${slot}"]`)} { --_itsm-series: var(--itsm-colour-chart-${slot}); }`)
  .join('\n');

/**
 * The state tones (D5, `chartToneVar`), after the slots so a mark carrying
 * both is painted by its state. A tone whose fill is under 3:1 also sets the
 * outline its marks must draw (`--_itsm-series-edge`).
 */
const tones = (Object.keys(chartToneVar) as ChartTone[])
  .map((tone) => {
    const edge = chartToneOutline[tone];
    return `${scoped(`[data-tone="${tone}"]`)} { --_itsm-series: ${chartToneVar[tone]};${edge ? ` --_itsm-series-edge: ${edge};` : ''} }`;
  })
  .join('\n');

/** Comparison and baseline series are read against, not read: one grey whatever their slot (A8 §4.3.2). */
const styles = `${scoped('[data-style="comparison"]')},
${scoped('[data-style="baseline"]')} { --_itsm-series: var(--itsm-colour-chart-comparison); }`;

/**
 * The frame every chart shares: the figure and its caption, the "View as
 * table" disclosure and table, the series colours, the legend, the empty and
 * loading plots, and the client reading layer (crosshair, tooltip).
 *
 * - **Colour** is one local property per mark, `--_itsm-series`, set from the
 *   mark's `data-slot` — so a legend key, a line, a bar and a tooltip key of
 *   the same series can never disagree, and no colour is ever inline. "Other"
 *   is the de-emphasis grey (`text.disabled`: 3:1 on every surface, and still
 *   grey in the high-contrast themes, where the border greys turn black).
 * - **Chrome recedes**: gridlines are hairlines in the chart grid token, the
 *   axis one step stronger, ticks in `caption` (the one place it is used,
 *   X-76) and tabular figures. Text never wears a series colour.
 * - **The tooltip** is an opaque overlay card, value first and strong, series
 *   name after it in secondary, keyed by a short line in the series colour.
 * - `--_itsm-chart-surface` is the colour the chart sits on, used for the
 *   2 px rings around markers; a chart on a sunken well sets it.
 * - **State tones** (`data-tone`) come after the slots and win over them, and
 *   comparison and baseline styles after both: a P1 segment is the P1 colour
 *   whatever slot it would have had, and a plan line is grey whatever it is.
 * - **Markers** (`charts/markers.tsx`) live here too: they belong to no one
 *   chart. Lines and diamonds in the marker navy, the "today" line in the
 *   secondary ink at 60 %, pills navy with white text (inverted in the dark
 *   themes by the tokens), gate labels muted; container queries hide gate
 *   labels on narrow cards, never pills or diamonds.
 */
export const chartFigureStyles = layer(
  'components',
  css`
@keyframes itsm-chart-reveal {
  from { opacity: 0; }
  to { opacity: 1; }
}

.itsm-ChartFigure {
  display: flex;
  flex-direction: column;
  gap: var(--itsm-space-sm);
  inline-size: 100%;
  min-inline-size: 0;
  margin: 0;
}

.itsm-ChartFigure__caption {
  display: flex;
  flex-direction: column;
  gap: var(--itsm-space-3xs);
  min-inline-size: 0;
}

.itsm-ChartFigure__title {
  font-size: var(--itsm-text-headline-size);
  line-height: var(--itsm-text-headline-line);
  font-weight: var(--itsm-text-headline-weight);
  letter-spacing: var(--itsm-text-headline-tracking);
  color: var(--itsm-colour-text-primary);
  text-wrap: balance;
}

.itsm-ChartFigure__summary {
  max-inline-size: 68ch;
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
  letter-spacing: var(--itsm-text-callout-tracking);
  color: var(--itsm-colour-text-secondary);
  text-wrap: pretty;
}

.itsm-ChartFigure__body {
  container: itsm-chart / inline-size;
  min-inline-size: 0;
}

.itsm-ChartFigure__data {
  min-inline-size: 0;
}

.itsm-ChartFigure__toggle {
  display: inline-flex;
  align-items: center;
  gap: var(--itsm-space-xs);
  min-block-size: var(--itsm-control-height-sm);
  margin-inline: calc(-1 * var(--itsm-space-xs));
  padding-inline: var(--itsm-space-xs);
  border-radius: var(--itsm-radius-md);
  font-size: var(--itsm-text-subheadline-size);
  line-height: var(--itsm-text-subheadline-line);
  font-weight: var(--itsm-text-subheadline-weight);
  letter-spacing: var(--itsm-text-subheadline-tracking);
  color: var(--itsm-colour-text-link);
  list-style: none;
  cursor: pointer;
  user-select: none;
  transition: background-color var(--itsm-duration-fast) var(--itsm-easing-standard);
}

.itsm-ChartFigure__toggle::-webkit-details-marker {
  display: none;
}

/* A drawn chevron: right when closed, down when open. */
.itsm-ChartFigure__toggle::before {
  content: "";
  inline-size: 0.4em;
  block-size: 0.4em;
  margin-inline: var(--itsm-space-3xs);
  border-inline-end: 1.5px solid currentColor;
  border-block-end: 1.5px solid currentColor;
  transform: rotate(-45deg);
  transition: transform var(--itsm-duration-fast) var(--itsm-easing-standard);
}

.itsm-ChartFigure__toggle:dir(rtl)::before {
  transform: rotate(135deg);
}

.itsm-ChartFigure__data[open] > .itsm-ChartFigure__toggle::before {
  transform: rotate(45deg);
}

@media (hover: hover) {
  .itsm-ChartFigure__toggle:hover {
    background: var(--itsm-colour-fill-hover);
  }
}

.itsm-ChartFigure__toggle:active {
  background: var(--itsm-colour-fill-pressed);
}

.itsm-ChartFigure__scroll {
  max-block-size: 20rem;
  margin-block-start: var(--itsm-space-xs);
  overflow: auto;
  overscroll-behavior: contain;
  border: var(--itsm-hairline) solid var(--itsm-colour-border-subtle);
  border-radius: var(--itsm-radius-lg);
  background: var(--itsm-colour-surface-raised);
}

.itsm-ChartFigure__table {
  inline-size: 100%;
  border-collapse: separate;
  border-spacing: 0;
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
  letter-spacing: var(--itsm-text-callout-tracking);
  font-variant-numeric: tabular-nums;
  color: var(--itsm-colour-text-primary);
}

.itsm-ChartFigure__table th,
.itsm-ChartFigure__table td {
  padding: var(--itsm-space-xs) var(--itsm-space-sm);
  border-block-end: var(--itsm-hairline) solid var(--itsm-colour-border-subtle);
  text-align: start;
  white-space: nowrap;
}

.itsm-ChartFigure__table thead th {
  position: sticky;
  inset-block-start: 0;
  z-index: 1;
  background: var(--itsm-colour-surface-raised);
  font-size: var(--itsm-text-subheadline-size);
  line-height: var(--itsm-text-subheadline-line);
  font-weight: var(--itsm-text-subheadline-weight);
  color: var(--itsm-colour-text-secondary);
}

.itsm-ChartFigure__table tbody th {
  font-weight: var(--itsm-font-weight-regular);
}

/* A matrix's column groups ("Monday" over its hours): a second sticky header row, centred over its span. */
.itsm-ChartFigure__groups > th {
  text-align: center;
}

.itsm-ChartFigure__table thead tr + tr th {
  inset-block-start: calc(var(--itsm-text-subheadline-line) + 2 * var(--itsm-space-xs) + var(--itsm-hairline));
}

.itsm-ChartFigure__table [data-numeric] {
  text-align: end;
}

.itsm-ChartFigure__table tbody tr:last-child > * {
  border-block-end: 0;
}

@media (hover: hover) {
  .itsm-ChartFigure__table tbody tr:hover > * {
    background: var(--itsm-colour-surface-hover);
  }
}

/* Series colours ----------------------------------------------------- */

.itsm-Chart {
  --_itsm-chart-surface: var(--itsm-colour-surface-raised);
  position: relative;
  min-inline-size: 0;
}

${slots}
${scoped('[data-slot="other"]')} { --_itsm-series: var(--itsm-colour-text-disabled); }
${tones}
${styles}

/* Legend ------------------------------------------------------------- */

.itsm-ChartLegend {
  display: flex;
  flex-wrap: wrap;
  gap: var(--itsm-space-2xs) var(--itsm-space-md);
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  color: var(--itsm-colour-text-secondary);
}

.itsm-ChartLegend__item {
  display: inline-flex;
  align-items: center;
  gap: var(--itsm-space-xs);
  min-inline-size: 0;
}

.itsm-ChartLegend__key {
  flex: none;
  background: var(--_itsm-series);
}

.itsm-ChartLegend__key[data-mark="line"] {
  inline-size: var(--itsm-space-sm);
  block-size: var(--itsm-border-thick);
  border-radius: var(--itsm-radius-pill);
}

.itsm-ChartLegend__key[data-mark="box"] {
  inline-size: 0.625rem;
  block-size: 0.625rem;
  border-radius: var(--itsm-radius-xs);
}

/* The v3 key: a 10 × 10 chip, radius 2.5 (A8-S2). */
.itsm-ChartLegend__key[data-mark="chip"] {
  inline-size: 0.625rem;
  block-size: 0.625rem;
  border-radius: 0.15625rem;
  box-shadow: inset 0 0 0 1px var(--_itsm-series-edge, transparent);
}

/* Dashed lines get dashed keys: a hollow chip with a dashed edge in the line's colour. */
.itsm-ChartLegend__key[data-style="baseline"],
.itsm-ChartLegend__key[data-style="forecast"] {
  background: transparent;
  border: 1.5px dashed var(--_itsm-series);
  box-shadow: none;
  box-sizing: border-box;
}

.itsm-ChartLegend__label {
  min-inline-size: 0;
  overflow-wrap: anywhere;
}

.itsm-ChartLegend__value {
  font-weight: var(--itsm-font-weight-semibold);
  font-variant-numeric: tabular-nums;
  color: var(--itsm-colour-text-primary);
}

.itsm-ChartLegend__detail {
  font-variant-numeric: tabular-nums;
  color: var(--itsm-colour-text-muted);
}

/* Empty and loading plots ---------------------------------------------- */

.itsm-Chart__empty,
.itsm-Chart__loading {
  grid-column: 1 / -1;
  inline-size: 100%;
}

.itsm-Chart__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--itsm-space-xs);
  padding: var(--itsm-space-md);
  border-radius: var(--itsm-radius-lg);
  background: var(--itsm-colour-surface-sunken);
  color: var(--itsm-colour-text-muted);
  text-align: center;
}

.itsm-Chart__emptyDisc {
  display: grid;
  place-items: center;
  inline-size: 3rem;
  block-size: 3rem;
  border-radius: 50%;
  background: var(--itsm-colour-brand-subtle);
  color: var(--itsm-colour-brand-subtleText);
}

.itsm-Chart__empty[data-reason="insufficient"] .itsm-Chart__emptyDisc {
  background: var(--itsm-colour-neutral-subtle);
  color: var(--itsm-colour-neutral-subtleText);
}

.itsm-Chart__empty[data-reason="error"] .itsm-Chart__emptyDisc {
  background: var(--itsm-colour-danger-subtle);
  color: var(--itsm-colour-danger-subtleText);
}

.itsm-Chart__emptyText {
  max-inline-size: 36ch;
  margin: 0;
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
  letter-spacing: var(--itsm-text-callout-tracking);
  color: var(--itsm-colour-text-secondary);
}

.itsm-Chart__emptyDetail {
  max-inline-size: 40ch;
  margin: 0;
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  color: var(--itsm-colour-text-muted);
}

.itsm-Chart__loading {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding-block: var(--itsm-space-xs) 0;
  animation: itsm-chart-reveal var(--itsm-duration-normal) var(--itsm-easing-standard) 200ms both;
}

.itsm-Chart__loadingLine {
  display: block;
  block-size: var(--itsm-hairline);
  background: var(--itsm-colour-chart-grid);
}

.itsm-Chart__loadingLine:last-of-type {
  background: var(--itsm-colour-chart-axis);
}

.itsm-Chart__loadingBars {
  position: absolute;
  inset: var(--itsm-space-lg) var(--itsm-space-sm) 0;
  display: flex;
  align-items: flex-end;
  justify-content: space-around;
  gap: var(--itsm-space-sm);
}

.itsm-Chart__loadingBars > .itsm-Skeleton {
  flex: 0 1 var(--itsm-space-lg);
  border-end-start-radius: 0;
  border-end-end-radius: 0;
}

/* Markers (charts/markers.tsx) ------------------------------------------ */

/* The layer lies over the chart's plot box, which is positioned; nothing in it takes the pointer. */
.itsm-Markers {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.itsm-Markers__lines {
  position: absolute;
  inset: 0;
  inline-size: 100%;
  block-size: 100%;
  overflow: visible;
}

.itsm-Markers__line {
  stroke: var(--itsm-colour-chart-marker);
  stroke-width: 1.5;
  shape-rendering: crispEdges;
}

/* "Today": the page's "now", in the secondary ink, so the navy pill above it is what draws the eye. */
.itsm-Markers__line[data-kind="today"] {
  stroke: var(--itsm-colour-text-secondary);
  stroke-opacity: 0.6;
  stroke-dasharray: 4 3;
}

.itsm-Markers__line[data-kind="deadline"] {
  stroke-dasharray: 5 4;
}

.itsm-Markers__line[data-kind="milestone"],
.itsm-Markers__line[data-kind="event"] {
  stroke-width: 1;
  stroke-opacity: 0.3;
  stroke-dasharray: 2 3;
}

.itsm-Markers__band {
  fill: var(--itsm-colour-fill-secondary);
  fill-opacity: 0.5;
}

.itsm-Markers__target {
  stroke: var(--itsm-colour-text-secondary);
  stroke-width: 1;
  stroke-dasharray: 4 4;
  shape-rendering: crispEdges;
}

.itsm-Markers__diamond {
  position: absolute;
  overflow: visible;
  transform: translate(-50%, -50%);
}

.itsm-Markers__diamond path {
  fill: var(--_itsm-chart-surface, var(--itsm-colour-surface-raised));
  stroke: var(--itsm-colour-chart-marker);
  stroke-width: 1.5;
}

/* A reached milestone and every deadline are solid; a milestone still ahead is hollow. */
.itsm-Markers__diamond[data-reached] path {
  fill: var(--itsm-colour-chart-marker);
}

/* Pills and gate labels: 600 10/14 (A8 §3.1), on tiers of 18 px above the data. */
.itsm-Markers__label {
  position: absolute;
  inset-block-start: 0;
  max-inline-size: 12rem;
  overflow: hidden;
  font-size: 0.625rem;
  line-height: 0.875rem;
  font-weight: var(--itsm-font-weight-semibold);
  font-variant-numeric: tabular-nums;
  text-overflow: ellipsis;
  white-space: nowrap;
  transform: translateX(-50%);
}

.itsm-Markers__label[data-tier="2"] {
  inset-block-start: 1.125rem;
}

.itsm-Markers__label[data-pill] {
  padding: 0.125rem 0.4375rem;
  border-radius: var(--itsm-radius-pill);
  background: var(--itsm-colour-chart-marker);
  color: var(--itsm-colour-chart-markerText);
}

.itsm-Markers__label[data-gate] {
  padding-block: 0.125rem;
  color: var(--itsm-colour-text-muted);
}

/* Near an edge a label aligns inwards rather than being cut off (as the x ticks do). */
.itsm-Markers__label[data-edge="start"] {
  transform: none;
}

.itsm-Markers__label[data-edge="end"] {
  transform: translateX(-100%);
}

.itsm-Markers__targetLabel,
.itsm-Markers__bandLabel {
  position: absolute;
  overflow: hidden;
  font-size: var(--itsm-text-caption-size);
  line-height: var(--itsm-text-caption-line);
  font-weight: var(--itsm-text-caption-weight);
  letter-spacing: var(--itsm-text-caption-tracking);
  color: var(--itsm-colour-text-muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.itsm-Markers__targetLabel {
  inset-inline-start: var(--itsm-space-2xs);
  max-inline-size: 60%;
  transform: translateY(calc(-100% - 2px));
}

.itsm-Markers__bandLabel {
  padding-inline: var(--itsm-space-2xs);
  text-align: center;
}

/* Narrow cards: the second tier of gate labels goes first, then every gate label; pills and diamonds stay. */
@container itsm-chart (max-width: 40rem) {
  .itsm-Markers__label[data-gate][data-tier="2"] {
    display: none;
  }
}

@container itsm-chart (max-width: 32rem) {
  .itsm-Markers__label[data-gate] {
    display: none;
  }
}

/* The reading layer (interactive charts) -------------------------------- */

.itsm-ChartReader {
  position: relative;
  border-radius: var(--itsm-radius-md);
  touch-action: pan-y;
}

.itsm-ChartReader__overlay {
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;
}

.itsm-ChartReader__crosshair {
  position: absolute;
  inset-block: 0;
  inline-size: var(--itsm-hairline);
  margin-inline-start: calc(var(--itsm-hairline) / -2);
  background: var(--itsm-colour-border-strong);
}

.itsm-ChartReader__dot {
  position: absolute;
  inline-size: 0.625rem;
  block-size: 0.625rem;
  margin: -0.3125rem 0 0 -0.3125rem;
  border-radius: 50%;
  background: var(--_itsm-series);
  box-shadow: 0 0 0 var(--itsm-border-thick) var(--_itsm-chart-surface);
}

.itsm-ChartReader__tip {
  position: absolute;
  z-index: 2;
  min-inline-size: 7.5rem;
  max-inline-size: 16rem;
  padding: var(--itsm-space-xs) var(--itsm-space-sm);
  border: var(--itsm-hairline) solid var(--itsm-colour-border-subtle);
  border-radius: var(--itsm-radius-lg);
  background: var(--itsm-colour-surface-overlay);
  box-shadow: var(--itsm-elevation-lg), var(--itsm-edge-highlight);
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  color: var(--itsm-colour-text-primary);
  transform: translate(var(--itsm-space-sm), 0);
  animation: itsm-chart-reveal var(--itsm-duration-fast) var(--itsm-easing-entrance);
}

.itsm-ChartReader__tip[data-side="start"] {
  transform: translate(calc(-100% - var(--itsm-space-sm)), 0);
}

.itsm-ChartReader__tip[data-placement="above"] {
  transform: translate(-50%, calc(-100% - var(--itsm-space-2xs)));
}

.itsm-ChartReader__tipTitle {
  margin: 0 0 var(--itsm-space-2xs);
  font-weight: var(--itsm-font-weight-medium);
  color: var(--itsm-colour-text-secondary);
  white-space: nowrap;
}

.itsm-ChartReader__tipRows {
  display: grid;
  gap: var(--itsm-space-3xs);
  margin: 0;
  padding: 0;
  list-style: none;
}

.itsm-ChartReader__tipRow {
  display: grid;
  grid-template-columns: auto auto minmax(0, 1fr);
  align-items: center;
  column-gap: var(--itsm-space-xs);
}

.itsm-ChartReader__key {
  inline-size: var(--itsm-space-sm);
  block-size: var(--itsm-border-thick);
  border-radius: var(--itsm-radius-pill);
  background: var(--_itsm-series);
}

.itsm-ChartReader__key[data-empty] {
  background: transparent;
}

.itsm-ChartReader__tipValue {
  font-weight: var(--itsm-font-weight-semibold);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.itsm-ChartReader__tipLabel {
  min-inline-size: 0;
  overflow: hidden;
  color: var(--itsm-colour-text-secondary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* More contrast: the tooltip and table get an edge; box keys wear their slot's hatch, like their marks. */
${moreContrast(
  (scope) => `${scope} .itsm-ChartReader__tip { border-color: var(--itsm-colour-border-strong); }
${scope} .itsm-ChartFigure__scroll { border-color: var(--itsm-colour-border-strong); }
${scope} .itsm-Markers__line[data-kind="milestone"], ${scope} .itsm-Markers__line[data-kind="event"] { stroke-opacity: 0.7; }
${scope} .itsm-Markers__band { fill-opacity: 1; }
${textureRules(scope, '.itsm-ChartLegend__key[data-mark="box"]', 'var(--_itsm-chart-surface)')}
${textureRules(scope, '.itsm-ChartLegend__key[data-mark="chip"]', 'var(--_itsm-chart-surface)')}
${scope} .itsm-ChartLegend__key[data-mark="chip"][data-style="baseline"],
${scope} .itsm-ChartLegend__key[data-mark="chip"][data-style="forecast"] { background: transparent; }`,
)}

${mq.reducedMotion} {
  .itsm-Chart__loading,
  .itsm-ChartReader__tip {
    animation: none;
  }
  .itsm-ChartFigure__toggle,
  .itsm-ChartFigure__toggle::before {
    transition: none;
  }
}

${prefers.reducedMotion} .itsm-Chart__loading,
${prefers.reducedMotion} .itsm-ChartReader__tip {
  animation: none;
}

${prefers.reducedMotion} .itsm-ChartFigure__toggle,
${prefers.reducedMotion} .itsm-ChartFigure__toggle::before {
  transition: none;
}

${mq.forcedColors} {
  .itsm-ChartLegend__key,
  .itsm-ChartReader__key,
  .itsm-ChartReader__dot {
    forced-color-adjust: none;
    background: CanvasText;
    box-shadow: 0 0 0 var(--itsm-border-thick) Canvas;
  }
  .itsm-ChartReader__key[data-empty] {
    background: transparent;
    box-shadow: none;
  }
  .itsm-ChartLegend__key[data-mark="box"],
  .itsm-ChartLegend__key[data-mark="chip"] {
    background: Canvas;
    box-shadow: inset 0 0 0 1px CanvasText;
  }
  .itsm-ChartLegend__key[data-mark="box"][data-slot="1"],
  .itsm-ChartLegend__key[data-mark="box"][data-slot="other"],
  .itsm-ChartLegend__key[data-mark="chip"][data-slot="1"],
  .itsm-ChartLegend__key[data-mark="chip"][data-slot="other"] {
    background: CanvasText;
  }
${textureRules('  ', '.itsm-ChartLegend__key[data-mark="box"]', 'CanvasText', 'Canvas')}
${textureRules('  ', '.itsm-ChartLegend__key[data-mark="chip"]', 'CanvasText', 'Canvas')}
  /* After the textures, and as specific: a dashed key stays hollow. */
  .itsm-ChartLegend__key[data-mark="chip"][data-style="baseline"],
  .itsm-ChartLegend__key[data-mark="chip"][data-style="forecast"] {
    background: Canvas;
    border-color: CanvasText;
    box-shadow: none;
  }
  .itsm-Markers__lines,
  .itsm-Markers__diamond,
  .itsm-Markers__label {
    forced-color-adjust: none;
  }
  .itsm-Markers__line,
  .itsm-Markers__target {
    stroke: Highlight;
    stroke-opacity: 1;
  }
  .itsm-Markers__diamond path {
    fill: Canvas;
    stroke: Highlight;
  }
  .itsm-Markers__diamond[data-reached] path {
    fill: Highlight;
  }
  .itsm-Markers__label[data-pill] {
    background: Highlight;
    color: HighlightText;
  }
  .itsm-Markers__label[data-gate] {
    color: CanvasText;
  }
  .itsm-Chart__emptyDisc {
    forced-color-adjust: none;
    background: Canvas;
    color: CanvasText;
    box-shadow: inset 0 0 0 1px CanvasText;
  }
  .itsm-ChartReader__crosshair {
    forced-color-adjust: none;
    background: Highlight;
  }
  .itsm-ChartReader__tip {
    border-color: CanvasText;
  }
  .itsm-Chart__loadingLine {
    forced-color-adjust: none;
    background: GrayText;
  }
}
`,
);
