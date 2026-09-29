import { css, layer } from '../styles/css.js';

/**
 * `FormField`: the label, hint and error around a control. `RadioGroup` uses the same block for its group label.
 */
export const formFieldStyles = layer(
  'components',
  css`
.itsm-Field { display: flex; flex-direction: column; gap: var(--itsm-space-2xs); margin-block-end: var(--itsm-space-md); }
.itsm-Field__label {
  font-size: var(--itsm-font-size-sm);
  font-weight: var(--itsm-font-weight-medium);
  color: var(--itsm-colour-text-primary);
}
.itsm-Field__required { color: var(--itsm-colour-danger-subtleText); margin-inline-start: var(--itsm-space-3xs); }
.itsm-Field__hint { font-size: var(--itsm-font-size-xs); color: var(--itsm-colour-text-muted); }
.itsm-Field__error {
  display: flex;
  gap: var(--itsm-space-3xs);
  font-size: var(--itsm-font-size-xs);
  color: var(--itsm-colour-danger-subtleText);
  font-weight: var(--itsm-font-weight-medium);
}
`,
);
