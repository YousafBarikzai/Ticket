import { css, layer, mq } from '../styles/css.js';

/**
 * `IconButton`: square, sized by the control-height tokens (28 / 36 / 44,
 * less in compact density, more on touch screens), colour-only feedback.
 *
 * On a coarse pointer an invisible `::after` grows the hit area to the large
 * control height (48 px on touch) without moving anything around it — the
 * 28 px toolbar button stays 28 px on screen and becomes a comfortable tap.
 *
 * Its tooltip is the anchored bubble drawn in `Button.styles.ts`.
 */
export const iconButtonStyles = layer(
  'components',
  css`
.itsm-IconButton {
  position: relative;
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  inline-size: var(--itsm-control-height-md);
  block-size: var(--itsm-control-height-md);
  margin: 0;
  padding: 0;
  border: var(--itsm-border-hair) solid transparent;
  border-radius: var(--itsm-radius-lg);
  background-color: transparent;
  color: var(--itsm-colour-text-secondary);
  font: inherit;
  line-height: 1;
  text-decoration: none;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
  transition:
    background-color var(--itsm-duration-fast) var(--itsm-easing-standard),
    color var(--itsm-duration-fast) var(--itsm-easing-standard);
}

.itsm-IconButton--sm {
  inline-size: var(--itsm-control-height-sm);
  block-size: var(--itsm-control-height-sm);
  border-radius: var(--itsm-radius-md);
}

.itsm-IconButton--lg {
  inline-size: var(--itsm-control-height-lg);
  block-size: var(--itsm-control-height-lg);
}

.itsm-IconButton__icon {
  flex: none;
}

/* Ghost: the toolbar default. */
.itsm-IconButton--ghost:hover {
  background-color: var(--itsm-colour-fill-hover);
  color: var(--itsm-colour-text-primary);
}
.itsm-IconButton--ghost:active {
  background-color: var(--itsm-colour-fill-pressed);
  color: var(--itsm-colour-text-primary);
}

.itsm-IconButton--secondary {
  background-color: var(--itsm-colour-fill-secondary);
  color: var(--itsm-colour-text-primary);
  box-shadow: var(--itsm-elevation-xs);
}
.itsm-IconButton--secondary:focus-visible {
  box-shadow: 0 0 0 var(--itsm-focus-offset) var(--itsm-colour-focusGap), var(--itsm-elevation-xs);
}

.itsm-IconButton--tinted {
  background-color: var(--itsm-colour-brand-subtle);
  color: var(--itsm-colour-brand-subtleText);
}

.itsm-IconButton--secondary:hover,
.itsm-IconButton--tinted:hover {
  background-image: linear-gradient(var(--itsm-colour-fill-hover), var(--itsm-colour-fill-hover));
}
.itsm-IconButton--secondary:active,
.itsm-IconButton--tinted:active {
  background-image: linear-gradient(var(--itsm-colour-fill-pressed), var(--itsm-colour-fill-pressed));
}
.itsm-IconButton--tinted:hover,
.itsm-IconButton--tinted:active {
  color: var(--itsm-colour-brand-subtleText);
}

/* A toggle that is on: the selected surface, and the accent on the glyph (3:1 on it in every theme). */
.itsm-IconButton[aria-pressed="true"] {
  background-color: var(--itsm-colour-surface-selected);
  background-image: none;
  color: var(--itsm-colour-accent);
}

.itsm-IconButton:disabled,
.itsm-IconButton[aria-disabled="true"] {
  background-color: transparent;
  background-image: none;
  box-shadow: none;
  color: var(--itsm-colour-text-disabled);
  cursor: not-allowed;
}
.itsm-IconButton--secondary:disabled,
.itsm-IconButton--tinted:disabled {
  background-color: var(--itsm-colour-fill-secondary);
}

${mq.coarse} {
  .itsm-IconButton::after {
    content: "";
    position: absolute;
    inset: 50%;
    min-inline-size: var(--itsm-control-height-lg);
    min-block-size: var(--itsm-control-height-lg);
    translate: -50% -50%;
  }
}

${mq.forcedColors} {
  .itsm-IconButton[aria-pressed="true"] {
    border-color: Highlight;
    color: Highlight;
  }
  .itsm-IconButton:disabled,
  .itsm-IconButton[aria-disabled="true"] {
    color: GrayText;
  }
}
`,
);
