import { css, layer, mq } from '../styles/css.js';

/**
 * `Button`, and the anchored bubble it shares with `IconButton` (the reason
 * a button is unavailable, the icon button's tooltip).
 *
 * v3 (§2.14, A1 §7.17) is the PMO's button:
 * - `primary` is the brand gradient (`--itsm-gradient-brand`, darker on
 *   hover) with the `xs` shadow and a one-pixel inner highlight along its top
 *   edge; the solid brand colour sits under the gradient so the label keeps
 *   its audited pair wherever gradients are not painted (forced colours,
 *   print). The high-contrast themes flatten the gradient in the tokens.
 * - `secondary` is a raised white button with a `border.soft` edge and the
 *   `xs` shadow, turning `surface.raisedAlt` with an `border.interactive`
 *   edge under the pointer.
 * - `tinted` is `brand.subtle` with `brand.subtleText`; `ghost` takes
 *   `surface.hover` under the pointer.
 * - Labels are 600 13/20 (12/16 small, 14/20 large); corners are the control
 *   radius (8) at 28 and 36 px and the `item` radius (10) at 44 px.
 *
 * Every size is a control height from the tokens, so density and coarse
 * pointers resize buttons without a rule here. Pressed states for the tinted
 * and secondary variants lay the translucent `fill.pressed` over the base
 * colour with a gradient rather than swapping to another solid, so the text
 * colour never changes under the pointer.
 *
 * Unavailable is the disabled text on the opaque sunken surface, never
 * opacity (which would drop the label below AA); a demo-locked action
 * (`disabledIcon="lock"`) adds a 14 px lock after its label.
 *
 * The focus ring comes from the base layer. A variant that draws its own
 * `box-shadow` re-states the ring's inner gap here, because a component rule
 * beats the base layer whatever its specificity. On navy
 * (`[data-surface="hero"]`) the hero card's module re-themes the ghost and
 * secondary buttons (A1 §7.3).
 *
 * A busy button draws the product's one activity indicator (`Spinner`),
 * which turns on its own literal period rather than a duration token — the
 * tokens collapse to 1ms under reduced motion, right for a transition and
 * wrong for a loop (a 1ms rotation is a strobe, the defect the legacy spinner
 * had) — and pulses instead under reduced motion.
 */
export const buttonStyles = layer(
  'components',
  css`
.itsm-Button {
  --_icon: var(--itsm-icon-sm);
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: calc(var(--itsm-space-2xs) + var(--itsm-space-3xs));
  min-block-size: var(--itsm-control-height-md);
  min-inline-size: var(--itsm-control-height-md);
  margin: 0;
  padding-block: 0;
  padding-inline: calc(var(--itsm-space-sm) + var(--itsm-space-3xs));
  border: var(--itsm-border-hair) solid transparent;
  border-radius: var(--itsm-radius-lg);
  background-color: transparent;
  color: var(--itsm-colour-text-primary);
  font-family: inherit;
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
  letter-spacing: var(--itsm-text-callout-tracking);
  font-weight: var(--itsm-font-weight-semibold);
  text-align: center;
  text-decoration: none;
  white-space: nowrap;
  vertical-align: middle;
  cursor: pointer;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
  transition:
    background-color var(--itsm-duration-fast) var(--itsm-easing-standard),
    border-color var(--itsm-duration-fast) var(--itsm-easing-standard),
    color var(--itsm-duration-fast) var(--itsm-easing-standard),
    box-shadow var(--itsm-duration-fast) var(--itsm-easing-standard),
    transform var(--itsm-duration-fast) var(--itsm-easing-standard);
}

.itsm-Button:focus-visible {
  box-shadow: 0 0 0 var(--itsm-focus-offset) var(--itsm-colour-focusGap);
}

.itsm-Button__label {
  min-inline-size: 0;
}

.itsm-Button__icon {
  flex: none;
  inline-size: var(--_icon);
  block-size: var(--_icon);
}

/* The demo-locked action's lock: 14 px, after the label, in the label's (disabled) colour. */
.itsm-Button__lock {
  flex: none;
  inline-size: var(--itsm-icon-xs);
  block-size: var(--itsm-icon-xs);
}

/* Sizes */

.itsm-Button--sm {
  --_icon: var(--itsm-icon-xs);
  gap: var(--itsm-space-2xs);
  min-block-size: var(--itsm-control-height-sm);
  min-inline-size: var(--itsm-control-height-sm);
  padding-inline: calc(var(--itsm-space-xs) + var(--itsm-space-3xs));
  border-radius: var(--itsm-radius-md);
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  letter-spacing: var(--itsm-text-footnote-tracking);
}

.itsm-Button--lg {
  --_icon: var(--itsm-icon-md);
  gap: var(--itsm-space-xs);
  min-block-size: var(--itsm-control-height-lg);
  min-inline-size: var(--itsm-control-height-lg);
  padding-inline: var(--itsm-space-ml);
  border-radius: var(--itsm-radius-item);
  font-size: var(--itsm-text-body-size);
  line-height: var(--itsm-text-callout-line);
  letter-spacing: var(--itsm-text-body-tracking);
}

.itsm-Button--capsule {
  border-radius: var(--itsm-radius-pill);
}

.itsm-Button--fullWidth {
  inline-size: 100%;
  white-space: normal;
}

/* Variants */

.itsm-Button--primary {
  background-color: var(--itsm-colour-brand-solid);
  background-image: var(--itsm-gradient-brand);
  color: var(--itsm-colour-brand-solidText);
  box-shadow: var(--itsm-elevation-xs), var(--itsm-highlight-inset);
}
.itsm-Button--primary:hover,
.itsm-Button--primary:active {
  background-color: var(--itsm-colour-brand-solidHover);
  background-image: var(--itsm-gradient-brand-hover);
}
.itsm-Button--primary:focus-visible {
  box-shadow: 0 0 0 var(--itsm-focus-offset) var(--itsm-colour-focusGap), var(--itsm-elevation-xs), var(--itsm-highlight-inset);
}

.itsm-Button--danger {
  background-color: var(--itsm-colour-danger-solid);
  color: var(--itsm-colour-danger-solidText);
  box-shadow: var(--itsm-elevation-xs);
}
.itsm-Button--danger:hover,
.itsm-Button--danger:active {
  background-color: var(--itsm-colour-danger-solidHover);
}
.itsm-Button--danger:focus-visible {
  box-shadow: 0 0 0 var(--itsm-focus-offset) var(--itsm-colour-focusGap), var(--itsm-elevation-xs);
}

.itsm-Button--secondary {
  border-color: var(--itsm-colour-border-soft);
  background-color: var(--itsm-colour-surface-raised);
  color: var(--itsm-colour-text-primary);
  box-shadow: var(--itsm-elevation-xs);
}
.itsm-Button--secondary:hover {
  border-color: var(--itsm-colour-border-interactive);
  background-color: var(--itsm-colour-surface-raisedAlt);
}
.itsm-Button--secondary:focus-visible {
  box-shadow: 0 0 0 var(--itsm-focus-offset) var(--itsm-colour-focusGap), var(--itsm-elevation-xs);
}

.itsm-Button--tinted,
.itsm-Button--subtle {
  background-color: var(--itsm-colour-brand-subtle);
  color: var(--itsm-colour-brand-subtleText);
}

.itsm-Button--dangerTinted {
  background-color: var(--itsm-colour-danger-subtle);
  color: var(--itsm-colour-danger-subtleText);
}

.itsm-Button--tinted:hover,
.itsm-Button--subtle:hover,
.itsm-Button--dangerTinted:hover {
  background-image: linear-gradient(var(--itsm-colour-fill-hover), var(--itsm-colour-fill-hover));
}
.itsm-Button--secondary:active,
.itsm-Button--tinted:active,
.itsm-Button--subtle:active,
.itsm-Button--dangerTinted:active {
  background-image: linear-gradient(var(--itsm-colour-fill-pressed), var(--itsm-colour-fill-pressed));
}

.itsm-Button--ghost {
  background-color: transparent;
  color: var(--itsm-colour-text-primary);
}
.itsm-Button--ghost:hover {
  background-color: var(--itsm-colour-surface-hover);
}
.itsm-Button--ghost:active {
  background-color: var(--itsm-colour-fill-pressed);
}

/* Filled and tinted buttons give slightly under the pointer; the token is 1 under reduced motion. */
.itsm-Button--primary:active,
.itsm-Button--danger:active,
.itsm-Button--secondary:active,
.itsm-Button--tinted:active,
.itsm-Button--subtle:active,
.itsm-Button--dangerTinted:active {
  transform: scale(var(--itsm-press-scale));
}

/* Unavailable: the disabled text on the opaque sunken surface, never opacity. A busy button keeps its colours. */

.itsm-Button:disabled,
.itsm-Button[aria-disabled="true"]:not([aria-busy="true"]) {
  border-color: transparent;
  background-color: var(--itsm-colour-surface-sunken);
  background-image: none;
  color: var(--itsm-colour-text-disabled);
  box-shadow: none;
  transform: none;
  cursor: not-allowed;
}
.itsm-Button--ghost:disabled,
.itsm-Button--ghost[aria-disabled="true"]:not([aria-busy="true"]) {
  background-color: transparent;
}
.itsm-Button[aria-disabled="true"]:not([aria-busy="true"]):focus-visible {
  box-shadow: 0 0 0 var(--itsm-focus-offset) var(--itsm-colour-focusGap);
}

.itsm-Button[aria-busy="true"] {
  cursor: progress;
  transform: none;
}

/* Busy */

/*
 * The spinner at the icon's size and in the button's own text colour —
 * white on a filled button, the label's colour on the others.
 */
.itsm-Button .itsm-Button__spinner {
  inline-size: var(--_icon);
  block-size: var(--_icon);
  color: inherit;
}

.itsm-Button__spinner[data-overlay] {
  position: absolute;
  inset: 0;
  margin: auto;
}

/* With no start icon to replace, the spinner sits over the label, which keeps its space (and its words, for screen readers). */
.itsm-Button[data-loading="overlay"] > .itsm-Button__label,
.itsm-Button[data-loading="overlay"] > .itsm-Button__icon {
  opacity: 0;
}

${mq.forcedColors} {
  .itsm-Button {
    border-color: ButtonText;
    background-image: none;
  }
  .itsm-Button:disabled,
  .itsm-Button[aria-disabled="true"]:not([aria-busy="true"]) {
    border-color: GrayText;
    color: GrayText;
  }
}

/* The anchored bubble: a tooltip, or the reason a button is unavailable. */

.itsm-Bubble {
  --_max: 15rem;
  position: fixed;
  inset: auto;
  top: 0;
  left: 0;
  z-index: var(--itsm-z-tooltip);
  display: inline-flex;
  align-items: center;
  gap: var(--itsm-space-xs);
  box-sizing: border-box;
  inline-size: max-content;
  max-inline-size: min(var(--_max), calc(100vw - 2 * var(--itsm-space-xs)));
  margin: 0;
  padding: calc(var(--itsm-space-2xs) + var(--itsm-space-3xs) / 2) var(--itsm-space-xs);
  overflow: visible;
  border: var(--itsm-border-hair) solid transparent;
  border-radius: var(--itsm-radius-md);
  background: var(--itsm-colour-surface-inverse);
  color: var(--itsm-colour-text-inverse);
  box-shadow: var(--itsm-elevation-md);
  font-family: var(--itsm-font-family-sans);
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  font-weight: var(--itsm-font-weight-medium);
  letter-spacing: var(--itsm-text-footnote-tracking);
  text-align: start;
  overflow-wrap: anywhere;
  text-wrap: pretty;
  pointer-events: auto;
  animation: itsm-fade-in var(--itsm-duration-fast) var(--itsm-easing-entrance);
}

.itsm-Bubble[data-tone="note"] {
  --_max: 17.5rem;
  font-weight: var(--itsm-font-weight-regular);
}

${mq.forcedColors} {
  .itsm-Bubble {
    border-color: CanvasText;
    background: Canvas;
    color: CanvasText;
  }
}
`,
);
