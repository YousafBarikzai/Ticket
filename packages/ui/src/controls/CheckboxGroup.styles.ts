import { css, layer } from '../styles/css.js';

/**
 * `CheckboxGroup`: a `fieldset` with its browser frame removed, the legend
 * set as a field label and the options stacked (or wrapped in a row). The
 * legend, hint and error reuse the field's parts from `FormField.styles.ts`.
 */
export const checkboxGroupStyles = layer(
  'components',
  css`
.itsm-CheckboxGroup {
  min-inline-size: 0;
  margin: 0 0 var(--itsm-space-md);
  padding: 0;
  border: 0;
}

.itsm-CheckboxGroup__legend {
  float: none;
  display: block;
  margin-block-end: calc(var(--itsm-space-2xs) + var(--itsm-space-3xs));
  padding: 0;
}

.itsm-CheckboxGroup__hint {
  display: block;
  margin-block: calc(-1 * var(--itsm-space-3xs)) var(--itsm-space-xs);
}

.itsm-CheckboxGroup__options {
  display: flex;
  flex-direction: column;
  gap: var(--itsm-space-2xs);
}

.itsm-CheckboxGroup[data-orientation="horizontal"] .itsm-CheckboxGroup__options {
  flex-direction: row;
  flex-wrap: wrap;
  column-gap: var(--itsm-space-lg);
}

.itsm-CheckboxGroup__error {
  margin-block-start: var(--itsm-space-xs);
}
`,
);
