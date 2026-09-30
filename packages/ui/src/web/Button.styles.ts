import { css, layer, mq, prefers } from '../styles/css.js';

/**
 * `Button`, and the anchored bubble it shares with `IconButton` (the reason
 * a button is unavailable, the icon button's tooltip).
 *
 * Every size is a control height from the tokens, so density and coarse
 * pointers resize buttons without a rule here. Hover and pressed states for
 * the tinted and secondary variants lay a translucent fill over the base
 * colour with a gradient, rather than swapping to a different solid: the same
 * two fills (`fill.hover`, `fill.pressed`) then work on every base colour and
 * in every theme, and the text colour never changes under the pointer.
 *
 * The focus ring comes from the base layer. A variant that draws its own
 * `box-shadow` re-states the ring's inner gap here, because a component rule
 * beats the base layer whatever its specificity.
 *
 * The spinner turns once every 0.8 s, a literal rather than a duration token:
 * the duration tokens collapse to 1ms under reduced motion, which is right for
 * a transition and wrong for a loop — a 1ms rotation is a strobe (the defect
 * the legacy spinner had). Under reduced motion it pulses instead, and the
 * pulse has its own literal period for the same reason.
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
  font-weight: var(--itsm-font-weight-medium);
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

/* Sizes */

.itsm-Button--sm {
  --_icon: var(--itsm-icon-xs);
  gap: var(--itsm-space-2xs);
  min-block-size: var(--itsm-control-height-sm);
  min-inline-size: var(--itsm-control-height-sm);
  padding-inline: calc(var(--itsm-space-xs) + var(--itsm-space-3xs));
  border-radius: var(--itsm-radius-md);
  font-size: var(--itsm-text-subheadline-size);
  line-height: var(--itsm-text-subheadline-line);
  letter-spacing: var(--itsm-text-subheadline-tracking);
}

.itsm-Button--lg {
  --_icon: var(--itsm-icon-md);
  gap: var(--itsm-space-xs);
  min-block-size: var(--itsm-control-height-lg);
  min-inline-size: var(--itsm-control-height-lg);
  padding-inline: var(--itsm-space-ml);
  font-size: var(--itsm-text-body-size);
  line-height: var(--itsm-text-body-line);
  letter-spacing: var(--itsm-text-body-tracking);
  font-weight: var(--itsm-font-weight-semibold);
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
  color: var(--itsm-colour-brand-solidText);
}
.itsm-Button--primary:hover,
.itsm-Button--primary:active {
  background-color: var(--itsm-colour-brand-solidHover);
}

.itsm-Button--danger {
  background-color: var(--itsm-colour-danger-solid);
  color: var(--itsm-colour-danger-solidText);
}
.itsm-Button--danger:hover,
.itsm-Button--danger:active {
  background-color: var(--itsm-colour-danger-solidHover);
}

.itsm-Button--secondary {
  background-color: var(--itsm-colour-fill-secondary);
  color: var(--itsm-colour-text-primary);
  box-shadow: var(--itsm-elevation-xs);
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

.itsm-Button--secondary:hover,
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
  background-color: var(--itsm-colour-fill-hover);
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

/* Unavailable: disabled text on the secondary fill, never opacity. A busy button keeps its colours. */

.itsm-Button:disabled,
.itsm-Button[aria-disabled="true"]:not([aria-busy="true"]) {
  background-color: var(--itsm-colour-fill-secondary);
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

.itsm-Button__spinner {
  flex: none;
  box-sizing: border-box;
  inline-size: var(--_icon);
  block-size: var(--_icon);
  border: var(--itsm-border-thick) solid color-mix(in srgb, currentColor 28%, transparent);
  border-block-start-color: currentColor;
  border-radius: var(--itsm-radius-pill);
  animation: itsm-spin 0.8s linear infinite;
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

@keyframes itsm-Button-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}

${mq.reducedMotion} {
  .itsm-Button__spinner {
    border-color: currentColor;
    animation: itsm-Button-pulse 1.6s ease-in-out infinite;
  }
}

${prefers.reducedMotion} .itsm-Button__spinner {
  border-color: currentColor;
  animation: itsm-Button-pulse 1.6s ease-in-out infinite;
}

${mq.forcedColors} {
  .itsm-Button {
    border-color: ButtonText;
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
