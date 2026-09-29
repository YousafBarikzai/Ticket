import { css, layer } from '../styles/css.js';

/**
 * `Badge`.
 */
export const badgeStyles = layer(
  'components',
  css`
.itsm-Badge {
  display: inline-flex;
  align-items: center;
  gap: var(--itsm-space-3xs);
  padding: 2px var(--itsm-space-xs);
  border: var(--itsm-border-hair) solid transparent;
  border-radius: var(--itsm-radius-pill);
  font-size: var(--itsm-font-size-xs);
  font-weight: var(--itsm-font-weight-medium);
  white-space: nowrap;
}
.itsm-Badge__dot { inline-size: 6px; block-size: 6px; border-radius: var(--itsm-radius-pill); background: currentColor; }
`,
);
