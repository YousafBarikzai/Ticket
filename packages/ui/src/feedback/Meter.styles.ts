import { css, layer, mq } from '../styles/css.js';

/**
 * `Meter`: a caption row (label, reading), an 8 px bar, and — only when there
 * is something to say — a footer with the level sentence and the legend for
 * the marks.
 *
 * The bar is `fill.track` with its inset ring, as every track in the product
 * (SPEC §1.2); the fill is the accent while the value is comfortable and the
 * warning, then danger, solid colour past the thresholds. The marks sit on
 * top of the bar and stand a little proud of it, so they read as lines across
 * the gauge rather than as part of the fill: the soft line in
 * `border.strong`, the hard limit in the primary text colour.
 */
export const meterStyles = layer(
  'components',
  css`
.itsm-Meter {
  --_itsm-meter-fill: var(--itsm-colour-accent);
  --_itsm-meter-text: var(--itsm-colour-text-muted);
  display: flex;
  flex-direction: column;
  gap: var(--itsm-space-xs);
  min-inline-size: 0;
}

.itsm-Meter[data-level="warning"] {
  --_itsm-meter-fill: var(--itsm-colour-warning-solid);
  --_itsm-meter-text: var(--itsm-colour-warning-subtleText);
}

.itsm-Meter[data-level="danger"] {
  --_itsm-meter-fill: var(--itsm-colour-danger-solid);
  --_itsm-meter-text: var(--itsm-colour-danger-subtleText);
}

.itsm-Meter__caption {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  column-gap: var(--itsm-space-sm);
  font-size: var(--itsm-text-subheadline-size);
  line-height: var(--itsm-text-subheadline-line);
  letter-spacing: var(--itsm-text-subheadline-tracking);
}

.itsm-Meter__label {
  min-inline-size: 0;
  font-weight: var(--itsm-text-subheadline-weight);
  color: var(--itsm-colour-text-secondary);
  overflow-wrap: anywhere;
}

.itsm-Meter__value {
  margin-inline-start: auto;
  color: var(--itsm-colour-text-primary);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.itsm-Meter__track {
  position: relative;
  display: block;
  padding-block: var(--itsm-space-3xs);
}

.itsm-Meter__bar {
  position: relative;
  display: block;
  block-size: var(--itsm-space-xs);
  border-radius: var(--itsm-radius-pill);
  background: var(--itsm-colour-fill-track);
  box-shadow: var(--itsm-track-ring);
  overflow: hidden;
}

.itsm-Meter__fill {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: var(--_itsm-meter-fill);
  transform: translateX(calc((1 - var(--_itsm-meter, 0)) * -100%));
  transition: transform var(--itsm-duration-normal) var(--itsm-easing-standard),
    background-color var(--itsm-duration-normal) var(--itsm-easing-standard);
}

:where([dir="rtl"]) .itsm-Meter__fill {
  transform: translateX(calc((1 - var(--_itsm-meter, 0)) * 100%));
}

.itsm-Meter__fill:dir(rtl) {
  transform: translateX(calc((1 - var(--_itsm-meter, 0)) * 100%));
}

.itsm-Meter__line {
  position: absolute;
  inset-block: 0;
  inline-size: var(--itsm-border-thick);
  margin-inline-start: calc(var(--itsm-border-thick) / -2);
  border-radius: var(--itsm-radius-pill);
  background: var(--itsm-colour-border-strong);
  box-shadow: 0 0 0 var(--itsm-hairline) var(--itsm-colour-surface-raised);
}

.itsm-Meter__line[data-kind="hard"] {
  background: var(--itsm-colour-text-primary);
}

.itsm-Meter__footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--itsm-space-2xs) var(--itsm-space-sm);
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  color: var(--itsm-colour-text-muted);
}

.itsm-Meter__status {
  display: inline-flex;
  align-items: center;
  gap: var(--itsm-space-2xs);
  font-weight: var(--itsm-font-weight-medium);
  color: var(--_itsm-meter-text);
}

.itsm-Meter__legend {
  display: inline-flex;
  flex-wrap: wrap;
  gap: var(--itsm-space-sm);
  margin-inline-start: auto;
  font-variant-numeric: tabular-nums;
}

.itsm-Meter__legendItem {
  display: inline-flex;
  align-items: center;
  gap: var(--itsm-space-2xs);
}

.itsm-Meter__legendItem::before {
  content: "";
  inline-size: var(--itsm-border-thick);
  block-size: var(--itsm-space-sm);
  border-radius: var(--itsm-radius-pill);
  background: var(--itsm-colour-border-strong);
}

.itsm-Meter__legendItem[data-kind="hard"]::before {
  background: var(--itsm-colour-text-primary);
}

${mq.forcedColors} {
  .itsm-Meter__bar {
    border: var(--itsm-hairline) solid CanvasText;
  }

  .itsm-Meter__fill {
    background: Highlight;
  }

  .itsm-Meter__line,
  .itsm-Meter__legendItem::before {
    background: CanvasText;
  }
}
`,
);
