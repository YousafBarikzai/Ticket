import { css, layer, mq } from '../styles/css.js';

/**
 * `SegmentedControl`: a `fill.secondary` track with a raised thumb that
 * slides to the selected segment on the `spring` curve.
 *
 * The thumb is one element placed by script from the selected segment's box
 * (dynamic geometry, the one use of inline style). Until it has been placed —
 * on the server and in the first client render — the selected segment paints
 * its own raised background, so the control is right without script and
 * nothing slides in on load; transitions switch on only after the first
 * placement has been painted (`data-animate`).
 *
 * The thumb is the overlay surface with the dark themes' edge highlight. In a
 * dark scheme it is lightened by the pressed fill (`light-dark()`), so it
 * stands above the track whether the control sits on the black canvas or on
 * a raised card; the light and high-contrast themes keep it white.
 *
 * Every label reserves the width of its bold self, so the segments do not
 * shift when the selection moves; the selected label is `text.primary` at
 * 600, the others `text.secondary`.
 */
export const segmentedControlStyles = layer(
  'components',
  css`
.itsm-SegmentedControl {
  --_pad: var(--itsm-space-3xs);
  --_h: var(--itsm-control-height-md);
  position: relative;
  display: inline-flex;
  box-sizing: border-box;
  max-inline-size: 100%;
  min-block-size: var(--_h);
  padding: var(--_pad);
  border-radius: var(--itsm-radius-lg);
  background-color: var(--itsm-colour-fill-secondary);
  isolation: isolate;
}

.itsm-SegmentedControl--sm {
  --_h: var(--itsm-control-height-sm);
  border-radius: var(--itsm-radius-md);
}

.itsm-SegmentedControl--fullWidth {
  display: flex;
  inline-size: 100%;
}

.itsm-SegmentedControl__list {
  display: grid;
  flex: 1 1 auto;
  grid-auto-flow: column;
  grid-auto-columns: minmax(0, 1fr);
  gap: var(--_pad);
  min-inline-size: 0;
  margin: 0;
  padding: 0;
  list-style: none;
}

.itsm-SegmentedControl__list > li {
  display: flex;
  min-inline-size: 0;
}

.itsm-SegmentedControl__segment {
  position: relative;
  z-index: 1;
  display: inline-flex;
  flex: 1 1 auto;
  align-items: center;
  justify-content: center;
  gap: calc(var(--itsm-space-2xs) + var(--itsm-space-3xs));
  box-sizing: border-box;
  min-inline-size: 0;
  min-block-size: calc(var(--_h) - 2 * var(--_pad));
  margin: 0;
  padding-block: 0;
  padding-inline: var(--itsm-space-sm);
  border: var(--itsm-border-hair) solid transparent;
  border-radius: calc(var(--itsm-radius-lg) - var(--_pad));
  background: transparent;
  color: var(--itsm-colour-text-secondary);
  font-family: inherit;
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
  letter-spacing: var(--itsm-text-callout-tracking);
  font-weight: var(--itsm-font-weight-medium);
  text-decoration: none;
  white-space: nowrap;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
  transition:
    color var(--itsm-duration-fast) var(--itsm-easing-standard),
    background-color var(--itsm-duration-fast) var(--itsm-easing-standard);
}

.itsm-SegmentedControl--sm .itsm-SegmentedControl__segment {
  padding-inline: calc(var(--itsm-space-xs) + var(--itsm-space-3xs));
  border-radius: calc(var(--itsm-radius-md) - var(--_pad));
  font-size: var(--itsm-text-subheadline-size);
  line-height: var(--itsm-text-subheadline-line);
  letter-spacing: var(--itsm-text-subheadline-tracking);
}

.itsm-SegmentedControl__segment:hover:not([data-selected]):not([aria-disabled="true"]) {
  background-color: var(--itsm-colour-fill-hover);
  color: var(--itsm-colour-text-primary);
}

.itsm-SegmentedControl__segment:active:not([data-selected]):not([aria-disabled="true"]) {
  background-color: var(--itsm-colour-fill-pressed);
}

.itsm-SegmentedControl__segment[data-selected] {
  color: var(--itsm-colour-text-primary);
  font-weight: var(--itsm-font-weight-semibold);
}

.itsm-SegmentedControl__segment[aria-disabled="true"] {
  color: var(--itsm-colour-text-disabled);
  cursor: not-allowed;
}

.itsm-SegmentedControl__icon {
  flex: none;
}

/* Each label reserves its bold width, so the selection never nudges the row. */
.itsm-SegmentedControl__label {
  display: inline-flex;
  flex-direction: column;
  min-inline-size: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.itsm-SegmentedControl__label::after {
  content: attr(data-text);
  block-size: 0;
  overflow: hidden;
  visibility: hidden;
  font-weight: var(--itsm-font-weight-semibold);
  user-select: none;
  pointer-events: none;
}

.itsm-SegmentedControl__count {
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  font-weight: var(--itsm-font-weight-medium);
  font-variant-numeric: tabular-nums;
  color: var(--itsm-colour-text-muted);
}

/*
 * The wrap option: equal where there is room, by their words where there is not, and
 * onto another row before anything is cut short. Each segment starts from
 * nothing and grows equally, but never below its own words; a flex row wraps
 * when those minimums no longer fit. The thumb is placed from the selected
 * segment's box, row included, so it follows onto a second row.
 */
.itsm-SegmentedControl--wrap .itsm-SegmentedControl__list {
  display: flex;
  flex-wrap: wrap;
}
.itsm-SegmentedControl--wrap .itsm-SegmentedControl__list > li,
.itsm-SegmentedControl--wrap .itsm-SegmentedControl__list > .itsm-SegmentedControl__segment {
  flex: 1 1 0;
  min-inline-size: max-content;
}
.itsm-SegmentedControl--wrap.itsm-SegmentedControl--fullWidth {
  container: itsm-segmented / inline-size;
}
@container itsm-segmented (width < 22rem) {
  .itsm-SegmentedControl__segment,
  .itsm-SegmentedControl--sm .itsm-SegmentedControl__segment {
    padding-inline: var(--itsm-space-xs);
  }
}

/* The thumb, and the selected segment's own background until the thumb is placed. */

.itsm-SegmentedControl__thumb {
  position: absolute;
  inset-block-start: 0;
  left: 0;
  z-index: 0;
  display: none;
  box-sizing: border-box;
  border-radius: calc(var(--itsm-radius-lg) - var(--_pad));
  pointer-events: none;
}
.itsm-SegmentedControl--sm .itsm-SegmentedControl__thumb {
  border-radius: calc(var(--itsm-radius-md) - var(--_pad));
}

.itsm-SegmentedControl__thumb,
.itsm-SegmentedControl:not([data-ready]) .itsm-SegmentedControl__segment[data-selected] {
  background-color: var(--itsm-colour-surface-overlay);
  background-image: linear-gradient(
    light-dark(transparent, var(--itsm-colour-fill-pressed)),
    light-dark(transparent, var(--itsm-colour-fill-pressed))
  );
  box-shadow: var(--itsm-elevation-xs), var(--itsm-elevation-sm), var(--itsm-edge-highlight);
}

.itsm-SegmentedControl[data-ready] .itsm-SegmentedControl__thumb {
  display: block;
}

.itsm-SegmentedControl[data-animate] .itsm-SegmentedControl__thumb {
  transition:
    transform var(--itsm-duration-normal) var(--itsm-easing-spring),
    inline-size var(--itsm-duration-normal) var(--itsm-easing-spring);
}

.itsm-SegmentedControl__segment:focus-visible {
  z-index: 2;
}

${mq.forcedColors} {
  .itsm-SegmentedControl {
    outline: var(--itsm-border-hair) solid CanvasText;
  }
  .itsm-SegmentedControl[data-ready] .itsm-SegmentedControl__thumb {
    display: none;
  }
  .itsm-SegmentedControl__segment[data-selected] {
    forced-color-adjust: none;
    background-color: Highlight;
    color: HighlightText;
  }
  .itsm-SegmentedControl__segment[aria-disabled="true"] {
    color: GrayText;
  }
}
`,
);
