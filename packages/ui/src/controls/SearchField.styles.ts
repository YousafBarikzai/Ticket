import { css, layer, mq } from '../styles/css.js';

/**
 * `SearchField`: a filled box (`fill.secondary`) with the magnifier, the
 * text, then a spinner, the clear button or the shortcut's key cap.
 *
 * At rest it has no visible border — a search field is identified by its
 * icon and label, as on Apple's platforms — but keeps a transparent one so
 * the box does not move when focus draws it: focus turns the box raised,
 * the border accent, and adds the field ring. The high-contrast themes (and
 * a system that asks for more contrast) keep an interactive border at rest,
 * and forced colours draw the system's own.
 */
export const searchFieldStyles = layer(
  'components',
  css`
.itsm-SearchField {
  --_h: var(--itsm-control-height-md);
  display: flex;
  flex-direction: column;
  gap: calc(var(--itsm-space-2xs) + var(--itsm-space-3xs));
  min-inline-size: 0;
}

.itsm-SearchField--sm {
  --_h: var(--itsm-control-height-sm);
}

.itsm-SearchField--lg {
  --_h: var(--itsm-control-height-lg);
}

.itsm-SearchField__label {
  font-size: var(--itsm-text-subheadline-size);
  line-height: var(--itsm-text-subheadline-line);
  font-weight: var(--itsm-text-subheadline-weight);
  letter-spacing: var(--itsm-text-subheadline-tracking);
  color: var(--itsm-colour-text-primary);
}

.itsm-SearchField__box {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--itsm-space-xs);
  box-sizing: border-box;
  inline-size: 100%;
  min-block-size: var(--_h);
  padding-inline: calc(var(--itsm-space-xs) + var(--itsm-space-3xs));
  border: var(--itsm-border-hair) solid transparent;
  border-radius: var(--itsm-radius-lg);
  background-color: var(--itsm-colour-fill-secondary);
  color: var(--itsm-colour-text-primary);
  cursor: text;
  transition:
    background-color var(--itsm-duration-fast) var(--itsm-easing-standard),
    border-color var(--itsm-duration-fast) var(--itsm-easing-standard),
    box-shadow var(--itsm-duration-fast) var(--itsm-easing-standard);
}

.itsm-SearchField--sm .itsm-SearchField__box {
  gap: calc(var(--itsm-space-2xs) + var(--itsm-space-3xs));
  padding-inline: var(--itsm-space-xs);
  border-radius: var(--itsm-radius-md);
}

.itsm-SearchField__box:hover {
  background-image: linear-gradient(var(--itsm-colour-fill-hover), var(--itsm-colour-fill-hover));
}

.itsm-SearchField__box:has(.itsm-SearchField__input:focus-visible) {
  border-color: var(--itsm-colour-accent);
  background-color: var(--itsm-colour-surface-raised);
  background-image: none;
  outline: var(--itsm-focus-width) solid var(--itsm-colour-border-focus);
  outline-offset: var(--itsm-border-hair);
  box-shadow: 0 0 0 var(--itsm-border-hair) var(--itsm-colour-focusGap), var(--itsm-elevation-sm);
}

.itsm-SearchField__icon {
  flex: none;
  color: var(--itsm-colour-text-muted);
  pointer-events: none;
}

.itsm-SearchField__input {
  flex: 1 1 auto;
  align-self: stretch;
  min-inline-size: 0;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font-family: inherit;
  font-size: var(--itsm-text-body-size);
  line-height: var(--itsm-text-body-line);
  letter-spacing: var(--itsm-text-body-tracking);
  outline: none;
  -webkit-appearance: none;
  appearance: none;
}
.itsm-SearchField--sm .itsm-SearchField__input {
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
  letter-spacing: var(--itsm-text-callout-tracking);
}
.itsm-SearchField__input::placeholder {
  color: var(--itsm-colour-text-muted);
  opacity: 1;
}
.itsm-SearchField__input::-webkit-search-decoration,
.itsm-SearchField__input::-webkit-search-cancel-button,
.itsm-SearchField__input::-webkit-search-results-button {
  -webkit-appearance: none;
  appearance: none;
}

.itsm-SearchField__kbd {
  flex: none;
  color: var(--itsm-colour-text-muted);
}

.itsm-SearchField__clear {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  inline-size: calc(var(--itsm-icon-md) + var(--itsm-space-2xs) + var(--itsm-space-3xs));
  block-size: calc(var(--itsm-icon-md) + var(--itsm-space-2xs) + var(--itsm-space-3xs));
  margin-inline-end: calc(-1 * var(--itsm-space-2xs));
  padding: 0;
  border: var(--itsm-border-hair) solid transparent;
  border-radius: var(--itsm-radius-pill);
  background: transparent;
  color: var(--itsm-colour-text-muted);
  cursor: pointer;
  transition:
    background-color var(--itsm-duration-fast) var(--itsm-easing-standard),
    color var(--itsm-duration-fast) var(--itsm-easing-standard);
}
.itsm-SearchField__clear:hover {
  background-color: var(--itsm-colour-fill-hover);
  color: var(--itsm-colour-text-primary);
}
.itsm-SearchField__clear:active {
  background-color: var(--itsm-colour-fill-pressed);
}

.itsm-SearchField .itsm-SearchField__spinner {
  /* The shared activity indicator, a step down to sit beside the magnifier's text. */
  inline-size: var(--itsm-icon-xs);
  block-size: var(--itsm-icon-xs);
}

[data-itsm-theme^="high-contrast"] .itsm-SearchField__box {
  border-color: var(--itsm-colour-border-interactive);
}
@media (prefers-contrast: more) {
  :root:not([data-itsm-theme]) .itsm-SearchField__box {
    border-color: var(--itsm-colour-border-interactive);
  }
}

${mq.coarse} {
  .itsm-SearchField__input {
    font-size: var(--itsm-font-size-lg);
    line-height: var(--itsm-text-headline-line);
  }
}

${mq.forcedColors} {
  .itsm-SearchField__box {
    border-color: FieldText;
  }
  .itsm-SearchField__box:has(.itsm-SearchField__input:focus-visible) {
    outline-color: Highlight;
  }
}
`,
);
