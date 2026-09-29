import { css, layer } from '../styles/css.js';

/**
 * `RadioGroup`: the drawn radio. The row around it is `itsm-Choice`, in `Checkbox.styles.ts`.
 */
export const radioGroupStyles = layer(
  'components',
  css`
.itsm-Radio {
  inline-size: 20px;
  block-size: 20px;
  border: var(--itsm-border-thick) solid var(--itsm-colour-border-interactive);
  border-radius: var(--itsm-radius-pill);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--itsm-colour-surface-raised);
}
.itsm-Radio[data-checked="true"] { border-color: var(--itsm-colour-brand-solid); }
.itsm-Radio[data-checked="true"]::after {
  content: "";
  inline-size: 10px;
  block-size: 10px;
  border-radius: var(--itsm-radius-pill);
  background: var(--itsm-colour-brand-solid);
}
`,
);
