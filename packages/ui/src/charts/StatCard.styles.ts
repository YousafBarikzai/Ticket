import { moreContrast } from '../feedback/tone.js';
import { css, layer, mq } from '../styles/css.js';

// Keyboard focus marks the tile anywhere; the pointer only where it can hover,
// so a tile tapped on a touch screen does not stay marked.
const focused = '.itsm-StatCard[data-interactive]:has(.itsm-StatCard__link:focus-visible)';
const hovered = '.itsm-StatCard[data-interactive]:hover';

/**
 * `StatCard` v3, the KPI tile (v3 §2.13, A1 §7.2), and the deprecated
 * `Metric`, which draws one.
 *
 * **Border-first**, like every v3 card: `surface.raised`, a 1 px
 * `border.subtle` edge and no resting shadow (the stylesheet test greps for
 * the edge), radius 12, padding 16, at least 124 px tall so a row of tiles
 * without sparklines still reads as a row of tiles. `sunken` sits inside
 * another card: the sunken fill and a transparent edge, so it keeps the same
 * geometry without a second frame.
 *
 * **The grid** is the PMO tile, `"label label" "value delta" "spark spark"
 * "context context"`: the delta pill top right of the value, the spark row
 * (40 px: a sparkline or the caller's `visual`) under them, the context line
 * at the foot. A tile without a spark row has no such row — no placeholder —
 * and the context sits at the foot of the tile either way, so tiles stretched
 * to one row keep their numerals and their captions level.
 *
 * **The tile is its own container** (`itsm-stat`), so it adapts to the width
 * it is given, not the window's: below 16.25 rem the delta's unit goes;
 * below 13.75 rem the value steps down to 24/28 and the delta wraps under
 * it; below 10.625 rem the spark row goes (phones show two tiles a row
 * without sparklines, as the PMO does). The rules sit on the inner grid,
 * because a container query styles what is inside the container, never the
 * container itself.
 *
 * **`inline`** is the compact v2 flow for tiles inside a card: label, value,
 * then the delta and a small sparkline sharing a row, then the context.
 *
 * **Navigable** (`href`) is the stretched-link pattern: the label's link
 * covers the tile, so the tile is one target with one name. Hover and
 * keyboard focus give it the `border.soft` edge and elevation `sm` — colour
 * and shadow, no lift — and the focus ring is drawn round the whole tile.
 * The ⓘ and the retry button sit above the covering layer and take their own
 * presses.
 *
 * `attention` and `critical` colour the edge `warning.border` /
 * `danger.border` and add their icon — never colour alone — and keep that
 * edge on hover.
 */
export const statCardStyles = layer(
  'components',
  css`
.itsm-StatCard {
  --_itsm-chart-surface: var(--itsm-colour-surface-raised);
  container: itsm-stat / inline-size;
  position: relative;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  min-inline-size: 9rem;
  min-block-size: 7.75rem;
  padding: var(--itsm-space-md);
  border: var(--itsm-border-hair) solid var(--itsm-colour-border-subtle);
  border-radius: var(--itsm-radius-2xl);
  background: var(--itsm-colour-surface-raised);
  color: var(--itsm-colour-text-primary);
}

.itsm-StatCard[data-surface="sunken"] {
  --_itsm-chart-surface: var(--itsm-colour-surface-sunken);
  border-color: transparent;
  background: var(--itsm-colour-surface-sunken);
}

.itsm-StatCard[data-layout="inline"] {
  min-block-size: 0;
}

.itsm-StatCard[data-status="attention"] {
  border-color: var(--itsm-colour-warning-border);
}

.itsm-StatCard[data-status="critical"] {
  border-color: var(--itsm-colour-danger-border);
}

/* ------------------------------------------------------------- The grid */

.itsm-StatCard__grid {
  display: grid;
  flex: 1 1 auto;
  grid-template-columns: minmax(0, 1fr) auto;
  grid-template-rows: auto auto 1fr;
  grid-template-areas:
    "label label"
    "value delta"
    "context context";
  gap: var(--itsm-space-2xs) var(--itsm-space-xs);
  min-inline-size: 0;
}

.itsm-StatCard[data-spark] > .itsm-StatCard__grid {
  grid-template-rows: auto auto auto 1fr;
  grid-template-areas:
    "label label"
    "value delta"
    "spark spark"
    "context context";
}

/* ------------------------------------------------------------- Label row */

.itsm-StatCard__head {
  grid-area: label;
  display: flex;
  align-items: center;
  gap: var(--itsm-space-2xs);
  min-inline-size: 0;
  min-block-size: var(--itsm-text-footnote-line);
}

.itsm-StatCard__icon {
  flex: none;
  color: var(--itsm-colour-text-muted);
}

.itsm-StatCard__label {
  flex: 0 1 auto;
  min-inline-size: 0;
  margin: 0;
  font-family: var(--itsm-font-family-sans);
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  font-weight: var(--itsm-font-weight-medium);
  letter-spacing: var(--itsm-text-footnote-tracking);
  color: var(--itsm-colour-text-muted);
  overflow-wrap: anywhere;
}

/* The 24 px ⓘ on a 16 px line: its hit area overhangs the row instead of making it taller. */
.itsm-StatCard__info {
  position: relative;
  z-index: 1;
  flex: none;
  margin-block: calc((var(--itsm-text-footnote-line) - 1.5rem) / 2);
}

.itsm-StatCard__status {
  flex: none;
  margin-inline-start: auto;
}

.itsm-StatCard[data-status="attention"] .itsm-StatCard__status { color: var(--itsm-colour-warning-subtleText); }
.itsm-StatCard[data-status="critical"] .itsm-StatCard__status { color: var(--itsm-colour-danger-subtleText); }

/* ------------------------------------------------------------- Value and delta */

.itsm-StatCard__value {
  grid-area: value;
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  column-gap: var(--itsm-space-3xs);
  min-inline-size: 0;
  margin: 0;
  font-family: var(--itsm-text-statValue-family);
  font-size: var(--itsm-text-statValue-size);
  line-height: var(--itsm-text-statValue-line);
  font-weight: var(--itsm-text-statValue-weight);
  letter-spacing: var(--itsm-text-statValue-tracking);
  font-variant-numeric: proportional-nums;
  color: var(--itsm-colour-text-primary);
}

.itsm-StatCard__number {
  white-space: nowrap;
}

.itsm-StatCard__unit {
  font-size: 0.62em;
  font-weight: var(--itsm-font-weight-semibold);
  letter-spacing: 0;
  color: var(--itsm-colour-text-muted);
}

.itsm-StatCard__secondary {
  margin-inline-start: var(--itsm-space-3xs);
  font-family: var(--itsm-font-family-sans);
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
  font-weight: var(--itsm-font-weight-regular);
  letter-spacing: var(--itsm-text-callout-tracking);
  color: var(--itsm-colour-text-muted);
}

.itsm-StatCard__delta {
  grid-area: delta;
  display: flex;
  align-self: start;
  justify-self: end;
  min-inline-size: 0;
  /* Top right of the value, centred on the numeral's 32 px line rather than sitting on its top edge. */
  margin-block-start: calc((var(--itsm-text-statValue-line) - var(--itsm-space-ml)) / 2);
}

/* "No change" is said, not drawn: the hidden words take no row of their own. */
.itsm-StatCard__delta[data-direction="flat"] {
  position: absolute;
}

/* ------------------------------------------------------------- Spark row */

.itsm-StatCard__spark {
  grid-area: spark;
  display: flex;
  align-items: center;
  min-inline-size: 0;
  block-size: 2.5rem;
}

.itsm-StatCard__spark[data-kind="visual"] > * {
  flex: 1 1 auto;
  min-inline-size: 0;
}

/* ------------------------------------------------------------- Context line */

.itsm-StatCard__context {
  grid-area: context;
  align-self: end;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  overflow: hidden;
  min-inline-size: 0;
  margin: 0;
  font-family: var(--itsm-font-family-sans);
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  font-weight: var(--itsm-font-weight-regular);
  letter-spacing: var(--itsm-text-footnote-tracking);
  color: var(--itsm-colour-text-muted);
  overflow-wrap: anywhere;
}

.itsm-StatCard__footnote[data-tone="good"] { color: var(--itsm-colour-success-subtleText); }
.itsm-StatCard__footnote[data-tone="bad"] { color: var(--itsm-colour-danger-subtleText); }

/* ------------------------------------------------------------- Loading and problem */

/* The bones join the tile's grid, each in the area it stands for. */
.itsm-StatCard__loading {
  display: contents;
}

.itsm-StatCard__valueBone {
  grid-area: value;
  align-self: center;
}

.itsm-StatCard__sparkBone {
  grid-area: spark;
  align-self: center;
}

.itsm-StatCard__contextBone {
  grid-area: context;
  align-self: end;
}

.itsm-StatCard__problem {
  grid-area: value;
  grid-column: 1 / -1;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--itsm-space-2xs) var(--itsm-space-xs);
  min-inline-size: 0;
}

.itsm-StatCard__problemText {
  display: inline-flex;
  align-items: flex-start;
  gap: var(--itsm-space-2xs);
  margin: 0;
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
  color: var(--itsm-colour-text-secondary);
}

.itsm-StatCard__problemIcon {
  flex: none;
  margin-block-start: var(--itsm-space-3xs);
  color: var(--itsm-colour-danger-subtleText);
}

/* Above the stretched link, so it takes its own clicks. */
.itsm-StatCard__retry {
  position: relative;
  z-index: 1;
}

/* ------------------------------------------------------------- Inline layout */

.itsm-StatCard[data-layout="inline"] > .itsm-StatCard__grid {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  align-content: flex-start;
}

.itsm-StatCard[data-layout="inline"] :is(.itsm-StatCard__head, .itsm-StatCard__value, .itsm-StatCard__problem, .itsm-StatCard__context) {
  flex: 1 0 100%;
}

.itsm-StatCard[data-layout="inline"] .itsm-StatCard__delta {
  margin-block-start: 0;
}

.itsm-StatCard[data-layout="inline"] .itsm-StatCard__spark {
  block-size: auto;
  margin-inline-start: auto;
}

/* ------------------------------------------------------------- Container steps */

@container itsm-stat (width < 16.25rem) {
  .itsm-StatCard .itsm-DeltaPill__unit {
    display: none;
  }
}

@container itsm-stat (width < 13.75rem) {
  .itsm-StatCard[data-layout="tile"][data-delta] > .itsm-StatCard__grid {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto auto auto 1fr;
    grid-template-areas:
      "label"
      "value"
      "delta"
      "context";
  }
  .itsm-StatCard[data-layout="tile"][data-delta][data-spark] > .itsm-StatCard__grid {
    grid-template-rows: auto auto auto auto 1fr;
    grid-template-areas:
      "label"
      "value"
      "delta"
      "spark"
      "context";
  }
  .itsm-StatCard__value {
    font-size: 1.5rem;
    line-height: 1.75rem;
  }
  .itsm-StatCard__delta {
    justify-self: start;
    margin-block-start: 0;
  }
}

@container itsm-stat (width < 10.625rem) {
  .itsm-StatCard[data-layout="tile"][data-spark] > .itsm-StatCard__grid {
    grid-template-rows: auto auto 1fr;
    grid-template-areas:
      "label label"
      "value delta"
      "context context";
  }
  .itsm-StatCard[data-layout="tile"][data-spark][data-delta] > .itsm-StatCard__grid {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto auto auto 1fr;
    grid-template-areas:
      "label"
      "value"
      "delta"
      "context";
  }
  .itsm-StatCard__spark,
  .itsm-StatCard__sparkBone {
    display: none;
  }
}

/* ------------------------------------------------------------- Navigable: the stretched link */

.itsm-StatCard[data-interactive] {
  transition:
    border-color var(--itsm-duration-fast) var(--itsm-easing-standard),
    box-shadow var(--itsm-duration-fast) var(--itsm-easing-standard);
}

${focused} {
  box-shadow: var(--itsm-elevation-sm);
}
${focused}[data-status="default"] {
  border-color: var(--itsm-colour-border-soft);
}
${mq.hover} {
  ${hovered} {
    box-shadow: var(--itsm-elevation-sm);
  }
  ${hovered}[data-status="default"] {
    border-color: var(--itsm-colour-border-soft);
  }
}

.itsm-StatCard[data-interactive]:active {
  box-shadow: none;
}

.itsm-StatCard__link {
  color: inherit;
  text-decoration: none;
}

.itsm-StatCard__link::after {
  content: "";
  position: absolute;
  inset: calc(-1 * var(--itsm-border-hair));
  border-radius: var(--itsm-radius-2xl);
}

.itsm-StatCard__link:focus-visible {
  outline: none;
  box-shadow: none;
}

.itsm-StatCard__link:focus-visible::after {
  outline: var(--itsm-focus-width) solid var(--itsm-colour-border-focus);
  outline-offset: var(--itsm-focus-offset);
  box-shadow: 0 0 0 var(--itsm-focus-offset) var(--itsm-colour-focusGap);
}

${moreContrast(
  (scope) => `${scope} .itsm-StatCard[data-status="attention"],
${scope} .itsm-StatCard[data-status="critical"] { outline: var(--itsm-border-thick) solid; outline-offset: calc(-1 * var(--itsm-border-thick)); }
${scope} .itsm-StatCard[data-status="attention"] { outline-color: var(--itsm-colour-warning-border); }
${scope} .itsm-StatCard[data-status="critical"] { outline-color: var(--itsm-colour-danger-border); }`,
)}

${mq.forcedColors} {
  .itsm-StatCard,
  .itsm-StatCard[data-surface="sunken"] {
    border-color: CanvasText;
  }
  .itsm-StatCard__link:focus-visible::after {
    outline-color: Highlight;
  }
}
`,
);
