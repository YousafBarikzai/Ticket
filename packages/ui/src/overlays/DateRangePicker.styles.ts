import { css, layer } from '../styles/css.js';

/**
 * `DateRangePicker`: two date fields in one `.itsm-InputGroup` box, split
 * by an en dash in `text.muted`, with the calendar button at the end. The
 * popover, presets and grid are `DatePicker`'s (web/DatePicker styles); the
 * range band and its ends are drawn there too. Each field is wide enough for
 * a medium-style date ("14 Mar 2026") and no wider, so the pair reads as one
 * value.
 */
export const dateRangePickerStyles = layer(
  'components',
  css`
.itsm-DateRangePicker { padding-inline-end: var(--itsm-space-2xs); }
.itsm-DateRangePicker__input {
  flex: 1 1 7.5rem;
  min-inline-size: 6.5rem;
}
.itsm-DateRangePicker__dash {
  flex: none;
  color: var(--itsm-colour-text-muted);
}
.itsm-DateRangePicker__calendar {
  display: flex;
  flex-direction: column;
  gap: var(--itsm-space-xs);
}
`,
);
