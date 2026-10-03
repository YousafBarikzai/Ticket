import { css, layer, mq, prefers } from '../styles/css.js';

/**
 * `Popover`: the menu's material and motion around free content (v3 §2.14).
 *
 * `material.popover` (glass at ≥ 0.96 alpha, solid where transparency is
 * reduced), a 1 px `border.subtle`, radius `xl` (12), elevation `md` — the
 * menu's surface exactly. Free content keeps 16 px padding where a menu's
 * rows have 6: text needs the room a row's own padding gives it. The title is
 * a `headline` in sentence case; the body reads in `callout`, the size of
 * everything else that floats. Scales in from the trigger's side over
 * `fast`, and only fades under reduced motion.
 */
export const popoverStyles = layer(
  'components',
  css`
.itsm-Popover {
  z-index: var(--itsm-z-dropdown);
  box-sizing: border-box;
  inline-size: min(22.5rem, calc(100vw - 2 * var(--itsm-space-xs)));
  max-block-size: var(--radix-popover-content-available-height, 32rem);
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: var(--itsm-space-md);
  border: var(--itsm-border-hair) solid var(--itsm-colour-border-subtle);
  border-radius: var(--itsm-radius-xl);
  background: var(--itsm-colour-material-popover);
  -webkit-backdrop-filter: var(--itsm-material-popover-filter);
  backdrop-filter: var(--itsm-material-popover-filter);
  box-shadow: var(--itsm-elevation-md), var(--itsm-edge-highlight);
  color: var(--itsm-colour-text-primary);
  font-family: var(--itsm-font-family-sans);
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
  letter-spacing: var(--itsm-text-callout-tracking);
  outline: none;
  transform-origin: var(--radix-popover-content-transform-origin, top);
  animation: itsm-overlay-zoom-in var(--itsm-duration-fast) var(--itsm-easing-entrance);
}
.itsm-Popover[data-state="closed"] {
  animation: itsm-overlay-zoom-out var(--itsm-duration-fast) var(--itsm-easing-exit) forwards;
}
.itsm-Popover--sm { inline-size: min(17.5rem, calc(100vw - 2 * var(--itsm-space-xs))); }
.itsm-Popover--lg { inline-size: min(30rem, calc(100vw - 2 * var(--itsm-space-xs))); }

.itsm-Popover__title {
  margin: 0 0 var(--itsm-space-xs);
  font-size: var(--itsm-text-headline-size);
  line-height: var(--itsm-text-headline-line);
  font-weight: var(--itsm-text-headline-weight);
  letter-spacing: var(--itsm-text-headline-tracking);
  color: var(--itsm-colour-text-primary);
  text-wrap: balance;
}
.itsm-Popover__body > :first-child { margin-block-start: 0; }
.itsm-Popover__body > :last-child { margin-block-end: 0; }

${mq.reducedMotion} {
  .itsm-Popover { animation-name: itsm-overlay-fade-in; }
  .itsm-Popover[data-state="closed"] { animation-name: itsm-overlay-fade-out; }
}
${prefers.reducedMotion} .itsm-Popover { animation-name: itsm-overlay-fade-in; }
${prefers.reducedMotion} .itsm-Popover[data-state="closed"] { animation-name: itsm-overlay-fade-out; }

${mq.forcedColors} {
  .itsm-Popover { border-color: CanvasText; }
}
`,
);
