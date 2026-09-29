import { css, layer } from '../styles/css.js';

/**
 * `FormRenderer`.
 *
 * A whole-form failure: the definition itself cannot be evaluated, so the
 * message is addressed to somebody who can report it rather than to a field.
 */
export const formRendererStyles = layer(
  'components',
  css`
.itsm-FormRenderer__error {
  margin: 0 0 var(--itsm-space-md);
  padding: var(--itsm-space-sm) var(--itsm-space-md);
  border-radius: var(--itsm-radius-md);
  background: var(--itsm-colour-danger-subtle);
  color: var(--itsm-colour-danger-subtleText);
  font-size: var(--itsm-font-size-sm);
  font-weight: var(--itsm-font-weight-medium);
}
`,
);
