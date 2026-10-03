import { css, layer, mq } from '../styles/css.js';

/**
 * `Tooltip` — the same bubble as `IconButton`'s own tooltip (web/Button
 * styles), drawn here for the Radix-hosted one so the two cannot be told
 * apart: `surface.inverse` (v3 slate `#0F172A`), `footnote` medium in
 * `text.inverse`, radius `md` (8 in v3), at most 240 px, elevation `md`, a
 * short fade on the entrance curve (v3 §2.14). A shortcut's key caps inside
 * it are drawn from the bubble's own text colour (`Kbd.styles.ts`), never
 * as light keys on the dark bubble.
 *
 * A fade and nothing else, so reduced motion needs no rule of its own (the
 * duration token collapses). The z-index is set on the content: Radix
 * copies it to the positioning wrapper it adds, which is the element that
 * has to sit above dialogs, menus and toasts.
 */
export const tooltipStyles = layer(
  'components',
  css`
.itsm-Tooltip__content {
  z-index: var(--itsm-z-tooltip);
  display: inline-flex;
  align-items: center;
  gap: var(--itsm-space-xs);
  box-sizing: border-box;
  max-inline-size: min(15rem, calc(100vw - 2 * var(--itsm-space-xs)));
  padding: calc(var(--itsm-space-2xs) + var(--itsm-space-3xs) / 2) var(--itsm-space-xs);
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
  user-select: none;
  animation: itsm-overlay-fade-in var(--itsm-duration-fast) var(--itsm-easing-entrance);
}
.itsm-Tooltip__content[data-state="closed"] {
  animation: itsm-overlay-fade-out var(--itsm-duration-fast) var(--itsm-easing-exit) forwards;
}
.itsm-Tooltip__text {
  min-inline-size: 0;
}

${mq.forcedColors} {
  .itsm-Tooltip__content {
    border-color: CanvasText;
    background: Canvas;
    color: CanvasText;
  }
}
`,
);
