import { css, layer } from '../styles/css.js';

/**
 * `Tabs`.
 */
export const tabsStyles = layer(
  'components',
  css`
.itsm-Tabs__list { display: flex; gap: var(--itsm-space-3xs); border-block-end: var(--itsm-border-hair) solid var(--itsm-colour-border-subtle); overflow-x: auto; }
.itsm-Tabs__tab {
  appearance: none;
  background: none;
  border: 0;
  border-block-end: var(--itsm-border-thick) solid transparent;
  padding: var(--itsm-space-xs) var(--itsm-space-sm);
  font-size: var(--itsm-font-size-md);
  font-weight: var(--itsm-font-weight-medium);
  color: var(--itsm-colour-text-secondary);
  cursor: pointer;
  white-space: nowrap;
}
.itsm-Tabs__tab[aria-selected="true"] { color: var(--itsm-colour-brand-subtleText); border-block-end-color: var(--itsm-colour-brand-solid); }
.itsm-Tabs__tab:disabled { color: var(--itsm-colour-text-disabled); cursor: not-allowed; }
.itsm-Tabs__panel { padding-block: var(--itsm-space-md); }
`,
);
