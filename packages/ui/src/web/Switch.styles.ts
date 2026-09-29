import { css, layer } from '../styles/css.js';

/**
 * `Switch`.
 */
export const switchStyles = layer(
  'components',
  css`
.itsm-Switch {
  inline-size: 44px;
  block-size: 24px;
  padding: 2px;
  border: var(--itsm-border-hair) solid var(--itsm-colour-border-interactive);
  border-radius: var(--itsm-radius-pill);
  background: var(--itsm-colour-surface-sunken);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  transition: background-color var(--itsm-duration-fast) var(--itsm-easing-standard);
}
.itsm-Switch[aria-checked="true"] { background: var(--itsm-colour-brand-solid); border-color: var(--itsm-colour-brand-solid); justify-content: flex-end; }
.itsm-Switch[aria-disabled="true"] { cursor: not-allowed; opacity: 0.6; }
.itsm-Switch__thumb {
  inline-size: 18px;
  block-size: 18px;
  border-radius: var(--itsm-radius-pill);
  background: var(--itsm-colour-surface-raised);
  box-shadow: var(--itsm-elevation-sm);
}
`,
);
