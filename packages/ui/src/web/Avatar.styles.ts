import { css, layer } from '../styles/css.js';

/**
 * `Avatar`.
 */
export const avatarStyles = layer(
  'components',
  css`
.itsm-Avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  position: relative;
  overflow: visible;
  border-radius: var(--itsm-radius-pill);
  background: var(--itsm-colour-neutral-subtle);
  color: var(--itsm-colour-neutral-subtleText);
  font-weight: var(--itsm-font-weight-semibold);
  flex: none;
}
.itsm-Avatar__image { inline-size: 100%; block-size: 100%; border-radius: var(--itsm-radius-pill); object-fit: cover; }
.itsm-Avatar__status {
  position: absolute;
  inset-block-end: 0;
  inset-inline-end: 0;
  inline-size: 30%;
  block-size: 30%;
  min-inline-size: 8px;
  min-block-size: 8px;
  border-radius: var(--itsm-radius-pill);
  border: var(--itsm-border-thick) solid var(--itsm-colour-surface-raised);
}
`,
);
