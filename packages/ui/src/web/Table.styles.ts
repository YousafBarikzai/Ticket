import { css, layer } from '../styles/css.js';

/**
 * `Table`.
 *
 * A row marked `itsm-Interactive` rises by the small lift rather than the
 * medium one: in a list, a bigger movement would shove the neighbours about.
 */
export const tableStyles = layer(
  'components',
  css`
.itsm-Table tbody tr.itsm-Interactive:hover,
.itsm-Table tbody tr.itsm-Interactive:focus-within {
  transform: translateY(calc(-1 * var(--itsm-lift-sm)));
}

.itsm-Table__scroll { overflow-x: auto; }
.itsm-Table { inline-size: 100%; border-collapse: collapse; font-size: var(--itsm-font-size-sm); color: var(--itsm-colour-text-primary); }
.itsm-Table caption { text-align: start; padding-block-end: var(--itsm-space-xs); font-size: var(--itsm-font-size-sm); color: var(--itsm-colour-text-muted); }
.itsm-Table th, .itsm-Table td { padding: var(--itsm-space-xs) var(--itsm-space-sm); text-align: start; border-block-end: var(--itsm-border-hair) solid var(--itsm-colour-border-subtle); }
.itsm-Table thead th { font-weight: var(--itsm-font-weight-semibold); color: var(--itsm-colour-text-secondary); background: var(--itsm-colour-surface-sunken); position: sticky; inset-block-start: 0; z-index: var(--itsm-z-sticky); }
.itsm-Table tbody tr:hover { background: var(--itsm-colour-surface-hover); }
.itsm-Table tbody tr[aria-selected="true"] { background: var(--itsm-colour-surface-selected); }
`,
);
