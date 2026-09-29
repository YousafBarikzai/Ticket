import { css, layer } from '../styles/css.js';

/**
 * `Input`, and the box it shares with `Textarea` and `Select`.
 *
 * One rule for the three because they are one control to the person filling
 * the form in: the same height, border, invalid and disabled states. What only
 * the textarea needs is in `Textarea.styles.ts`, which the registry orders
 * after this module.
 */
export const inputStyles = layer(
  'components',
  css`
.itsm-Input, .itsm-Textarea, .itsm-Select {
  inline-size: 100%;
  min-height: var(--itsm-control-height-md);
  padding: var(--itsm-space-2xs) var(--itsm-space-sm);
  border: var(--itsm-border-hair) solid var(--itsm-colour-border-interactive);
  border-radius: var(--itsm-radius-md);
  background: var(--itsm-colour-surface-raised);
  color: var(--itsm-colour-text-primary);
  font-size: var(--itsm-font-size-md);
  font-family: inherit;
}

.itsm-Input::placeholder, .itsm-Textarea::placeholder { color: var(--itsm-colour-text-muted); }
.itsm-Input[aria-invalid="true"], .itsm-Textarea[aria-invalid="true"], .itsm-Select[aria-invalid="true"] {
  border-color: var(--itsm-colour-danger-solid);
  border-width: var(--itsm-border-thick);
}
.itsm-Input:disabled, .itsm-Textarea:disabled, .itsm-Select:disabled {
  background: var(--itsm-colour-surface-sunken);
  color: var(--itsm-colour-text-disabled);
  cursor: not-allowed;
}
.itsm-Input[readonly] { background: var(--itsm-colour-surface-sunken); }
`,
);
