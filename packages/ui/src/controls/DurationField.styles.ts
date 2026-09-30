import { css, layer } from '../styles/css.js';

/**
 * `DurationField`: the shared field box with, at its end, the reading of what
 * was typed ("1 h 30 min") as a quiet chip while the text is not yet in that
 * form, and the "Business hours" note when the duration is counted in them.
 * The error under the field is the field error (`FormField.styles.ts`).
 */
export const durationFieldStyles = layer(
  'components',
  css`
.itsm-DurationField {
  display: flex;
  flex-direction: column;
  gap: calc(var(--itsm-space-2xs) + var(--itsm-space-3xs));
  min-inline-size: 0;
}

/* The chip and the note sit in the field's suffix slot, which is a flex row. */
.itsm-DurationField .itsm-InputGroup__suffix {
  gap: var(--itsm-space-2xs);
}

.itsm-DurationField__chip {
  display: inline-flex;
  align-items: center;
  padding: 0 var(--itsm-space-xs);
  border-radius: var(--itsm-radius-pill);
  background-color: var(--itsm-colour-fill-secondary);
  color: var(--itsm-colour-text-secondary);
  font-size: var(--itsm-text-footnote-size);
  line-height: calc(var(--itsm-text-footnote-line) + var(--itsm-space-2xs));
  font-weight: var(--itsm-font-weight-medium);
  font-variant-numeric: tabular-nums;
  animation: itsm-fade-in var(--itsm-duration-fast) var(--itsm-easing-entrance);
}

.itsm-DurationField__business {
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  color: var(--itsm-colour-text-muted);
}
`,
);
