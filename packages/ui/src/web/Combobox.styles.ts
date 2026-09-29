import { css, layer } from '../styles/css.js';

/**
 * `Combobox`. `CommandPalette` borrows `itsm-Combobox__meta` for its secondary line.
 */
export const comboboxStyles = layer(
  'components',
  css`
.itsm-Combobox { position: relative; }
.itsm-Combobox__list {
  position: absolute;
  inset-inline: 0;
  inset-block-start: calc(100% + var(--itsm-space-3xs));
  z-index: var(--itsm-z-dropdown);
  max-block-size: 16rem;
  overflow-y: auto;
  margin: 0;
  padding: var(--itsm-space-3xs);
  list-style: none;
  background: var(--itsm-colour-surface-overlay);
  border: var(--itsm-border-hair) solid var(--itsm-colour-border-subtle);
  border-radius: var(--itsm-radius-md);
  box-shadow: var(--itsm-elevation-lg);
}
.itsm-Combobox__option {
  padding: var(--itsm-space-2xs) var(--itsm-space-xs);
  border-radius: var(--itsm-radius-sm);
  font-size: var(--itsm-font-size-md);
  color: var(--itsm-colour-text-primary);
  cursor: pointer;
}
.itsm-Combobox__option[data-active="true"] { background: var(--itsm-colour-surface-selected); }
.itsm-Combobox__option[aria-selected="true"] { font-weight: var(--itsm-font-weight-semibold); }
.itsm-Combobox__meta { font-size: var(--itsm-font-size-xs); color: var(--itsm-colour-text-muted); }
.itsm-Combobox__status { padding: var(--itsm-space-xs); font-size: var(--itsm-font-size-sm); color: var(--itsm-colour-text-muted); }
`,
);
