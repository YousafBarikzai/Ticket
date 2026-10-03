import { css, layer, mq, prefers } from '../styles/css.js';

/**
 * `InfoTip`: the ⓘ button and the bubble it opens (v3 §2.14).
 *
 * The button is 24 × 24 — the WCAG 2.5.8 minimum, and small enough to sit in
 * a label row without pushing it taller — ghost, with a 14 px glyph in
 * `text.muted` that turns `text.primary` under the pointer or while open. On
 * a touch screen an invisible `::after` grows the hit area to the large
 * control height without moving anything, as `IconButton` does.
 *
 * The bubble is the tooltip's material: `surface.inverse` and `text.inverse`
 * (an audited pair in every theme), radius `md`, padding 8 × 10, at most
 * 300 px. Title `footnote` 600, body `footnote` 400, source `caption` 400
 * under a rule of the inverse text at 20 %. It fades in over `fast`, which
 * reduced motion collapses with the duration token.
 */
export const infoTipStyles = layer(
  'components',
  css`
.itsm-InfoTip__trigger {
  position: relative;
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  inline-size: var(--itsm-space-lg);
  block-size: var(--itsm-space-lg);
  margin: 0;
  padding: 0;
  border: var(--itsm-border-hair) solid transparent;
  border-radius: var(--itsm-radius-md);
  background-color: transparent;
  color: var(--itsm-colour-text-muted);
  font: inherit;
  line-height: 1;
  vertical-align: middle;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
  transition:
    background-color var(--itsm-duration-fast) var(--itsm-easing-standard),
    color var(--itsm-duration-fast) var(--itsm-easing-standard);
}
.itsm-InfoTip__trigger:hover,
.itsm-InfoTip__trigger[aria-expanded="true"] {
  background-color: var(--itsm-colour-fill-hover);
  color: var(--itsm-colour-text-primary);
}
.itsm-InfoTip__trigger:active {
  background-color: var(--itsm-colour-fill-pressed);
  color: var(--itsm-colour-text-primary);
}
.itsm-InfoTip__glyph {
  flex: none;
}

[data-surface="hero"] .itsm-InfoTip__trigger {
  color: var(--itsm-colour-hero-textMuted);
}
[data-surface="hero"] .itsm-InfoTip__trigger:is(:hover, :active, [aria-expanded="true"]) {
  background-color: var(--itsm-colour-hero-fill);
  color: var(--itsm-colour-hero-text);
}

.itsm-InfoTip {
  z-index: var(--itsm-z-dropdown);
  box-sizing: border-box;
  max-inline-size: min(18.75rem, calc(100vw - 2 * var(--itsm-space-xs)));
  padding: var(--itsm-space-xs) calc(var(--itsm-space-xs) + var(--itsm-space-3xs));
  border: var(--itsm-border-hair) solid transparent;
  border-radius: var(--itsm-radius-md);
  background: var(--itsm-colour-surface-inverse);
  color: var(--itsm-colour-text-inverse);
  box-shadow: var(--itsm-elevation-md);
  font-family: var(--itsm-font-family-sans);
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  letter-spacing: var(--itsm-text-footnote-tracking);
  text-align: start;
  overflow-wrap: anywhere;
  text-wrap: pretty;
  outline: none;
  animation: itsm-overlay-fade-in var(--itsm-duration-fast) var(--itsm-easing-entrance);
}
.itsm-InfoTip[data-state="closed"] {
  animation: itsm-overlay-fade-out var(--itsm-duration-fast) var(--itsm-easing-exit) forwards;
}
.itsm-InfoTip__title,
.itsm-InfoTip__body,
.itsm-InfoTip__source {
  margin: 0;
}
.itsm-InfoTip__title {
  margin-block-end: var(--itsm-space-3xs);
  font-weight: var(--itsm-font-weight-semibold);
}
.itsm-InfoTip__body {
  font-weight: var(--itsm-font-weight-regular);
}
.itsm-InfoTip__source {
  margin-block-start: var(--itsm-space-xs);
  padding-block-start: var(--itsm-space-xs);
  border-block-start: var(--itsm-hairline) solid color-mix(in srgb, var(--itsm-colour-text-inverse) 20%, transparent);
  font-size: var(--itsm-text-caption-size);
  line-height: var(--itsm-text-caption-line);
  font-weight: var(--itsm-font-weight-regular);
  letter-spacing: 0;
}

${mq.reducedMotion} {
  .itsm-InfoTip,
  .itsm-InfoTip[data-state="closed"] { animation: none; }
}
${prefers.reducedMotion} .itsm-InfoTip,
${prefers.reducedMotion} .itsm-InfoTip[data-state="closed"] { animation: none; }

${mq.coarse} {
  .itsm-InfoTip__trigger::after {
    content: "";
    position: absolute;
    inset: 50%;
    min-inline-size: var(--itsm-control-height-lg);
    min-block-size: var(--itsm-control-height-lg);
    translate: -50% -50%;
  }
}

${mq.forcedColors} {
  .itsm-InfoTip__trigger {
    color: ButtonText;
  }
  .itsm-InfoTip__trigger[aria-expanded="true"] {
    border-color: Highlight;
  }
  .itsm-InfoTip {
    border-color: CanvasText;
    background: Canvas;
    color: CanvasText;
  }
  .itsm-InfoTip__source {
    border-block-start-color: CanvasText;
  }
}
`,
);
