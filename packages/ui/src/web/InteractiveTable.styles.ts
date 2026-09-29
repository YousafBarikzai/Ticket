import { css, layer } from '../styles/css.js';

/**
 * `InteractiveTable` (deprecated wrapper): the sortable column header it adds to `Table`.
 */
export const interactiveTableStyles = layer(
  'components',
  css`
.itsm-Table__sort { display: inline-flex; align-items: center; gap: var(--itsm-space-3xs); background: none; border: 0; padding: 0; font: inherit; color: inherit; cursor: pointer; }
.itsm-Table__sortIndicator { font-size: var(--itsm-font-size-2xs); color: var(--itsm-colour-text-muted); }
`,
);
