import { css, layer } from '../styles/css.js';

/**
 * `IconButton`.
 */
export const iconButtonStyles = layer(
  'components',
  css`
.itsm-IconButton {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  inline-size: var(--itsm-control-height-md);
  block-size: var(--itsm-control-height-md);
  padding: 0;
  border: var(--itsm-border-hair) solid transparent;
  border-radius: var(--itsm-radius-md);
  background: transparent;
  color: var(--itsm-colour-text-secondary);
  cursor: pointer;
}
.itsm-IconButton--sm { inline-size: var(--itsm-control-height-sm); block-size: var(--itsm-control-height-sm); }
.itsm-IconButton--lg { inline-size: var(--itsm-control-height-lg); block-size: var(--itsm-control-height-lg); }
.itsm-IconButton:hover:not(:disabled) { background: var(--itsm-colour-surface-hover); color: var(--itsm-colour-text-primary); }
.itsm-IconButton:disabled { cursor: not-allowed; color: var(--itsm-colour-text-disabled); }
`,
);
