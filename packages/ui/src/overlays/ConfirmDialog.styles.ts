import { css, layer } from '../styles/css.js';

/**
 * `ConfirmDialog`: a small `Dialog` whose body is a short form. The fields
 * stack on the 16 px rhythm; the name to type back is set in the mono face
 * on the sunken surface so it reads as a value to copy, not as prose. A
 * confirmation with nothing but a question drops the empty body, so the
 * question sits directly above the buttons.
 */
export const confirmDialogStyles = layer(
  'components',
  css`
.itsm-ConfirmDialog__form {
  display: flex;
  flex-direction: column;
  gap: var(--itsm-space-md);
}
.itsm-ConfirmDialog .itsm-Dialog__body:has(> .itsm-ConfirmDialog__form:empty) {
  display: none;
}
.itsm-ConfirmDialog__list {
  margin: 0;
  padding-inline-start: var(--itsm-space-md);
}
.itsm-ConfirmDialog__list > li + li {
  margin-block-start: var(--itsm-space-3xs);
}
.itsm-ConfirmDialog__token {
  padding: 0 var(--itsm-space-2xs);
  border-radius: var(--itsm-radius-xs);
  background: var(--itsm-colour-surface-sunken);
  font-family: var(--itsm-font-family-mono);
  font-size: 0.92em;
  color: var(--itsm-colour-text-primary);
  overflow-wrap: anywhere;
}
`,
);
