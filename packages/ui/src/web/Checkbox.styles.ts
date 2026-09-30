import { css, layer, mq } from '../styles/css.js';

/**
 * `Checkbox`, and the `itsm-Choice` row it shares with `Switch` and each
 * `RadioGroup` option: a control, its label and an optional description.
 *
 * The box is 18 px (`--itsm-icon-md`) inside a 26 px hit square whose extra
 * ring is taken back with negative margins, so it lines up with the first
 * line of its label as if it were only 18 px. Unchecked it is the raised
 * surface with an interactive border (3:1); checked or indeterminate it fills
 * with the accent and the mark is drawn in the solid-text colour, white in
 * every theme but high-contrast dark, where the pale accent takes black.
 */
export const checkboxStyles = layer(
  'components',
  css`
.itsm-Choice {
  display: flex;
  align-items: flex-start;
  gap: calc(var(--itsm-space-xs) + var(--itsm-space-3xs));
  min-block-size: var(--itsm-text-body-line);
  padding-block: var(--itsm-space-3xs);
}

.itsm-Choice__text {
  display: flex;
  flex-direction: column;
  gap: var(--itsm-space-3xs);
  min-inline-size: 0;
}
.itsm-Choice__text--hidden {
  display: contents;
}

.itsm-Choice__label {
  font-size: var(--itsm-text-body-size);
  line-height: var(--itsm-text-body-line);
  letter-spacing: var(--itsm-text-body-tracking);
  color: var(--itsm-colour-text-primary);
  cursor: pointer;
}

.itsm-Choice__description {
  display: block;
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  color: var(--itsm-colour-text-muted);
}

.itsm-Choice[data-disabled] .itsm-Choice__label,
.itsm-Choice[aria-disabled="true"] .itsm-Choice__label {
  color: var(--itsm-colour-text-disabled);
  cursor: not-allowed;
}

/* The box */

.itsm-Checkbox__box {
  position: relative;
  display: inline-grid;
  flex: none;
  place-items: center;
  inline-size: calc(var(--itsm-icon-md) + 2 * var(--itsm-space-2xs));
  block-size: calc(var(--itsm-icon-md) + 2 * var(--itsm-space-2xs));
  margin: calc(-1 * var(--itsm-space-2xs));
  margin-block-start: calc((var(--itsm-text-body-line) - var(--itsm-icon-md)) / 2 - var(--itsm-space-2xs));
  cursor: pointer;
}

.itsm-Checkbox__input,
.itsm-Checkbox__mark {
  grid-area: 1 / 1;
}

.itsm-Checkbox__input {
  -webkit-appearance: none;
  appearance: none;
  box-sizing: border-box;
  inline-size: var(--itsm-icon-md);
  block-size: var(--itsm-icon-md);
  margin: 0;
  border: var(--itsm-border-hair) solid var(--itsm-colour-border-interactive);
  border-radius: var(--itsm-radius-sm);
  background-color: var(--itsm-colour-surface-raised);
  cursor: pointer;
  transition:
    background-color var(--itsm-duration-fast) var(--itsm-easing-standard),
    border-color var(--itsm-duration-fast) var(--itsm-easing-standard);
}

.itsm-Checkbox__box:hover .itsm-Checkbox__input:not(:disabled),
.itsm-Checkbox:hover .itsm-Checkbox__input:not(:disabled) {
  border-color: var(--itsm-colour-border-strong);
}

.itsm-Checkbox__input:checked,
.itsm-Checkbox__input:indeterminate {
  border-color: var(--itsm-colour-accent);
  background-color: var(--itsm-colour-accent);
}
.itsm-Checkbox:hover .itsm-Checkbox__input:checked:not(:disabled),
.itsm-Checkbox:hover .itsm-Checkbox__input:indeterminate:not(:disabled) {
  border-color: var(--itsm-colour-accent);
}

.itsm-Checkbox__input[aria-invalid="true"]:not(:checked) {
  border-color: var(--itsm-colour-danger-border);
  box-shadow: inset 0 0 0 var(--itsm-border-hair) var(--itsm-colour-danger-border);
}

.itsm-Checkbox__input:disabled {
  border-color: var(--itsm-colour-border-subtle);
  background-color: var(--itsm-colour-fill-secondary);
  cursor: not-allowed;
}
.itsm-Checkbox[data-disabled] .itsm-Checkbox__box {
  cursor: not-allowed;
}

/* The mark: a tick that draws itself, or the indeterminate dash. */

.itsm-Checkbox__mark {
  inline-size: var(--itsm-icon-md);
  block-size: var(--itsm-icon-md);
  fill: none;
  stroke: var(--itsm-colour-brand-solidText);
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
  pointer-events: none;
}

.itsm-Checkbox__tick {
  stroke-dasharray: 1;
  stroke-dashoffset: 1;
  transition: stroke-dashoffset var(--itsm-duration-fast) var(--itsm-easing-entrance);
}

.itsm-Checkbox__dash {
  opacity: 0;
}

.itsm-Checkbox__input:checked + .itsm-Checkbox__mark .itsm-Checkbox__tick {
  stroke-dashoffset: 0;
}

.itsm-Checkbox__input:indeterminate + .itsm-Checkbox__mark .itsm-Checkbox__tick {
  stroke-dashoffset: 1;
  transition: none;
}

.itsm-Checkbox__input:indeterminate + .itsm-Checkbox__mark .itsm-Checkbox__dash {
  opacity: 1;
}

.itsm-Checkbox__input:disabled + .itsm-Checkbox__mark {
  stroke: var(--itsm-colour-text-disabled);
}

${mq.forcedColors} {
  .itsm-Checkbox__input {
    -webkit-appearance: auto;
    appearance: auto;
  }
  .itsm-Checkbox__mark {
    display: none;
  }
}
`,
);
