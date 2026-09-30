import { css, layer, mq } from '../styles/css.js';

/**
 * `RadioGroup`: the drawn radio, the option rows, and the `cards` variant.
 * The row is `itsm-Choice` (`Checkbox.styles.ts`) and the group label, hint
 * and error are the field's (`FormField.styles.ts`).
 *
 * The radio is 18 px like the checkbox; checked, it fills with the accent and
 * a dot in the solid-text colour grows into its centre. Each option is the
 * focusable element, so the focus ring goes round the whole row (or card):
 * rows get a little padding and a radius for it, taken back with negative
 * margins so the radios still line up with the label above.
 *
 * Cards lay out in one column until the group is wide enough for two or
 * three (a container query on the group, not the viewport).
 */
export const radioGroupStyles = layer(
  'components',
  css`
.itsm-RadioGroup__options {
  display: flex;
  flex-direction: column;
  gap: var(--itsm-space-3xs);
}
.itsm-RadioGroup__options[data-orientation="horizontal"] {
  flex-direction: row;
  flex-wrap: wrap;
  column-gap: var(--itsm-space-md);
}

.itsm-RadioGroup__option {
  margin-inline: calc(-1 * var(--itsm-space-xs));
  padding: var(--itsm-space-2xs) var(--itsm-space-xs);
  border-radius: var(--itsm-radius-md);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.itsm-RadioGroup__option[aria-disabled="true"] {
  cursor: not-allowed;
}
.itsm-RadioGroup__option .itsm-Choice__label {
  cursor: inherit;
}

/* The radio */

.itsm-Radio {
  position: relative;
  display: inline-grid;
  flex: none;
  place-items: center;
  box-sizing: border-box;
  inline-size: var(--itsm-icon-md);
  block-size: var(--itsm-icon-md);
  margin-block-start: calc((var(--itsm-text-body-line) - var(--itsm-icon-md)) / 2);
  border: var(--itsm-border-hair) solid var(--itsm-colour-border-interactive);
  border-radius: var(--itsm-radius-pill);
  background-color: var(--itsm-colour-surface-raised);
  transition:
    background-color var(--itsm-duration-fast) var(--itsm-easing-standard),
    border-color var(--itsm-duration-fast) var(--itsm-easing-standard);
}

.itsm-Radio::after {
  content: "";
  inline-size: calc(var(--itsm-icon-md) / 3);
  block-size: calc(var(--itsm-icon-md) / 3);
  border-radius: var(--itsm-radius-pill);
  background-color: var(--itsm-colour-brand-solidText);
  transform: scale(0);
  transition: transform var(--itsm-duration-fast) var(--itsm-easing-entrance);
}

.itsm-RadioGroup__option:not([aria-disabled="true"]):hover .itsm-Radio {
  border-color: var(--itsm-colour-border-strong);
}

.itsm-Radio[data-checked="true"],
.itsm-RadioGroup__option:not([aria-disabled="true"]):hover .itsm-Radio[data-checked="true"] {
  border-color: var(--itsm-colour-accent);
  background-color: var(--itsm-colour-accent);
}
.itsm-Radio[data-checked="true"]::after {
  transform: scale(1);
}

.itsm-RadioGroup__option[aria-disabled="true"] .itsm-Radio {
  border-color: var(--itsm-colour-border-subtle);
  background-color: var(--itsm-colour-fill-secondary);
}
.itsm-RadioGroup__option[aria-disabled="true"] .itsm-Radio::after {
  background-color: var(--itsm-colour-text-disabled);
}
.itsm-RadioGroup__option[aria-disabled="true"] .itsm-Choice__label {
  color: var(--itsm-colour-text-disabled);
}

.itsm-RadioGroup__options[aria-invalid="true"] .itsm-Radio:not([data-checked="true"]) {
  border-color: var(--itsm-colour-danger-border);
}

/* Cards */

.itsm-RadioGroup--cards {
  container-type: inline-size;
}

.itsm-RadioGroup--cards .itsm-RadioGroup__options {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--itsm-space-sm);
}

@container (min-width: 30rem) {
  .itsm-RadioGroup__options[data-columns="2"],
  .itsm-RadioGroup__options[data-columns="3"] {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@container (min-width: 46rem) {
  .itsm-RadioGroup__options[data-columns="3"] {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

.itsm-RadioGroup__card {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: start;
  gap: var(--itsm-space-sm);
  margin: 0;
  padding: var(--itsm-space-md);
  border: var(--itsm-border-hair) solid var(--itsm-colour-border-subtle);
  border-radius: var(--itsm-radius-xl);
  background-color: var(--itsm-colour-surface-raised);
  box-shadow: var(--itsm-elevation-xs);
  transition:
    background-color var(--itsm-duration-fast) var(--itsm-easing-standard),
    border-color var(--itsm-duration-fast) var(--itsm-easing-standard),
    box-shadow var(--itsm-duration-fast) var(--itsm-easing-standard);
}
.itsm-RadioGroup__card > .itsm-Choice__text {
  grid-column: 2;
}
.itsm-RadioGroup__card > .itsm-Radio {
  grid-column: 3;
  margin-block-start: calc((var(--itsm-text-headline-line) - var(--itsm-icon-md)) / 2);
}
.itsm-RadioGroup__card .itsm-Choice__label {
  font-size: var(--itsm-text-headline-size);
  line-height: var(--itsm-text-headline-line);
  letter-spacing: var(--itsm-text-headline-tracking);
  font-weight: var(--itsm-text-headline-weight);
}
.itsm-RadioGroup__card .itsm-Choice__description {
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
}

.itsm-RadioGroup__cardIcon {
  grid-column: 1;
  display: inline-grid;
  place-items: center;
  inline-size: var(--itsm-icon-2xl);
  block-size: var(--itsm-icon-2xl);
  border-radius: var(--itsm-radius-md);
  background-color: var(--itsm-colour-brand-subtle);
  color: var(--itsm-colour-brand-subtleText);
}

.itsm-RadioGroup__card:not([aria-disabled="true"]):hover {
  border-color: var(--itsm-colour-border-strong);
  background-color: var(--itsm-colour-surface-accentHover);
}

.itsm-RadioGroup__card[aria-checked="true"],
.itsm-RadioGroup__card[aria-checked="true"]:hover {
  border-color: var(--itsm-colour-accent);
  background-color: var(--itsm-colour-surface-selected);
  box-shadow: inset 0 0 0 var(--itsm-border-hair) var(--itsm-colour-accent);
}
.itsm-RadioGroup__card[aria-checked="true"]:focus-visible {
  box-shadow:
    inset 0 0 0 var(--itsm-border-hair) var(--itsm-colour-accent),
    0 0 0 var(--itsm-focus-offset) var(--itsm-colour-focusGap);
}
.itsm-RadioGroup__card:focus-visible {
  box-shadow: 0 0 0 var(--itsm-focus-offset) var(--itsm-colour-focusGap);
}

.itsm-RadioGroup__card[aria-disabled="true"] {
  background-color: var(--itsm-colour-surface-sunken);
  box-shadow: none;
}
.itsm-RadioGroup__card[aria-disabled="true"] .itsm-RadioGroup__cardIcon {
  background-color: var(--itsm-colour-fill-secondary);
  color: var(--itsm-colour-text-disabled);
}

${mq.forcedColors} {
  .itsm-Radio {
    border-color: CanvasText;
  }
  .itsm-Radio[data-checked="true"] {
    forced-color-adjust: none;
    border-color: Highlight;
    background-color: Highlight;
  }
  .itsm-Radio[data-checked="true"]::after {
    background-color: HighlightText;
  }
  .itsm-RadioGroup__card {
    border-color: CanvasText;
  }
  .itsm-RadioGroup__card[aria-checked="true"] {
    border-color: Highlight;
    outline: var(--itsm-border-hair) solid Highlight;
  }
}
`,
);
