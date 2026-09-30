import { css, layer } from '../styles/css.js';

/**
 * `ShortcutsDialog`: the switches first, on a sunken inset group (the
 * settings pattern), then every shortcut by group — sentence-case
 * `subheadline` headings, rows of `callout` descriptions with key caps at the
 * end, hairlines between. A single-key shortcut that is switched off reads in
 * `text.muted` with "· Off", so the list stays honest about what the keys do
 * right now.
 */
export const shortcutsDialogStyles = layer(
  'components',
  css`
.itsm-ShortcutsDialog__settings {
  display: flex;
  flex-direction: column;
  gap: var(--itsm-space-sm);
  margin-block-end: var(--itsm-space-lg);
  padding: var(--itsm-space-sm) var(--itsm-space-md);
  border-radius: var(--itsm-radius-lg);
  background: var(--itsm-colour-surface-sunken);
}
.itsm-ShortcutsDialog__groups {
  display: flex;
  flex-direction: column;
  gap: var(--itsm-space-lg);
}
.itsm-ShortcutsDialog__groupTitle {
  margin: 0 0 var(--itsm-space-2xs);
  color: var(--itsm-colour-text-secondary);
  font-size: var(--itsm-text-subheadline-size);
  line-height: var(--itsm-text-subheadline-line);
  font-weight: var(--itsm-text-subheadline-weight);
}
.itsm-ShortcutsDialog__list {
  margin: 0;
  padding: 0;
  list-style: none;
}
.itsm-ShortcutsDialog__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--itsm-space-md);
  min-block-size: var(--itsm-nav-item-height);
  padding-block: var(--itsm-space-2xs);
  border-block-end: var(--itsm-hairline) solid var(--itsm-colour-border-subtle);
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
}
.itsm-ShortcutsDialog__row:last-child {
  border-block-end: 0;
}
.itsm-ShortcutsDialog__row[data-off] .itsm-ShortcutsDialog__action,
.itsm-ShortcutsDialog__row[data-off] .itsm-ShortcutsDialog__keys {
  color: var(--itsm-colour-text-muted);
}
.itsm-ShortcutsDialog__offNote {
  color: var(--itsm-colour-text-muted);
  font-size: var(--itsm-text-footnote-size);
}
.itsm-ShortcutsDialog__keys {
  flex: none;
}
.itsm-ShortcutsDialog__empty {
  margin: 0;
  color: var(--itsm-colour-text-secondary);
}
`,
);
