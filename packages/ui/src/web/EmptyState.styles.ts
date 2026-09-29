import { css, layer } from '../styles/css.js';

/**
 * `EmptyState`.
 */
export const emptyStateStyles = layer(
  'components',
  css`
.itsm-EmptyState { display: flex; flex-direction: column; align-items: center; text-align: center; gap: var(--itsm-space-xs); padding: var(--itsm-space-2xl) var(--itsm-space-md); color: var(--itsm-colour-text-secondary); }
.itsm-EmptyState__title { margin: 0; font-size: var(--itsm-font-size-lg); font-weight: var(--itsm-font-weight-semibold); color: var(--itsm-colour-text-primary); }
.itsm-EmptyState__body { margin: 0; max-inline-size: 42ch; font-size: var(--itsm-font-size-md); }
.itsm-EmptyState__icon { color: var(--itsm-colour-text-muted); }
`,
);
