import { css, layer } from '../styles/css.js';

/**
 * `TimeField`: the shared field box, as wide as a time needs rather than the
 * whole column, in tabular figures so "11:11" and "08:00" line up in a list
 * of shifts. The platform's picker button takes the text colour.
 */
export const timeFieldStyles = layer(
  'components',
  css`
.itsm-TimeField {
  inline-size: auto;
  min-inline-size: calc(var(--itsm-space-4xl) + var(--itsm-space-xl));
  font-variant-numeric: tabular-nums;
}

.itsm-TimeField::-webkit-calendar-picker-indicator {
  color: var(--itsm-colour-text-secondary);
  cursor: pointer;
}

.itsm-TimeField::-webkit-datetime-edit-fields-wrapper {
  padding: 0;
}
`,
);
