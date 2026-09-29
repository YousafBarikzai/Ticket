import { css, layer } from '../styles/css.js';

/**
 * `DatePicker`.
 */
export const datePickerStyles = layer(
  'components',
  css`
.itsm-DatePicker { position: relative; display: flex; gap: var(--itsm-space-2xs); align-items: center; }
.itsm-DatePicker__panel {
  position: absolute;
  inset-block-start: calc(100% + var(--itsm-space-3xs));
  inset-inline-start: 0;
  z-index: var(--itsm-z-dropdown);
  padding: var(--itsm-space-sm);
  background: var(--itsm-colour-surface-overlay);
  border: var(--itsm-border-hair) solid var(--itsm-colour-border-subtle);
  border-radius: var(--itsm-radius-md);
  box-shadow: var(--itsm-elevation-lg);
}
.itsm-DatePicker__header { display: flex; align-items: center; justify-content: space-between; gap: var(--itsm-space-xs); margin-block-end: var(--itsm-space-xs); }
.itsm-DatePicker__month { font-weight: var(--itsm-font-weight-semibold); font-size: var(--itsm-font-size-sm); color: var(--itsm-colour-text-primary); }
.itsm-DatePicker__grid { border-collapse: collapse; }
.itsm-DatePicker__grid th {
  font-size: var(--itsm-font-size-2xs);
  font-weight: var(--itsm-font-weight-medium);
  color: var(--itsm-colour-text-muted);
  padding: var(--itsm-space-3xs);
}
.itsm-DatePicker__day {
  inline-size: 2rem;
  block-size: 2rem;
  border: var(--itsm-border-hair) solid transparent;
  border-radius: var(--itsm-radius-sm);
  background: transparent;
  color: var(--itsm-colour-text-primary);
  font-size: var(--itsm-font-size-sm);
  cursor: pointer;
}
.itsm-DatePicker__day:hover:not(:disabled) { background: var(--itsm-colour-surface-hover); }
.itsm-DatePicker__day[aria-selected="true"] { background: var(--itsm-colour-brand-solid); color: var(--itsm-colour-brand-solidText); }
.itsm-DatePicker__day[data-today="true"] { border-color: var(--itsm-colour-brand-border); font-weight: var(--itsm-font-weight-semibold); }
.itsm-DatePicker__day:disabled { color: var(--itsm-colour-text-disabled); cursor: not-allowed; }
.itsm-DatePicker__day[data-outside="true"] { color: var(--itsm-colour-text-muted); }
`,
);
