import { css, layer, mq } from '../styles/css.js';

/**
 * `FormField`: the label, hint, error and character count around a control.
 * `RadioGroup` and `CheckboxGroup` use the same label, hint and error parts
 * for their group label.
 *
 * Type follows the ramp: labels are `subheadline` (13/18, 500), hints and
 * errors `footnote` (12/16). The inline layout switches on the field's own
 * width (a container query), so the same field reads right in a sheet, a
 * card and a full-width settings page.
 */
export const formFieldStyles = layer(
  'components',
  css`
.itsm-Field {
  display: flex;
  flex-direction: column;
  gap: calc(var(--itsm-space-2xs) + var(--itsm-space-3xs));
  min-inline-size: 0;
  margin-block-end: var(--itsm-space-md);
}

.itsm-Field__label {
  font-size: var(--itsm-text-subheadline-size);
  line-height: var(--itsm-text-subheadline-line);
  font-weight: var(--itsm-text-subheadline-weight);
  letter-spacing: var(--itsm-text-subheadline-tracking);
  color: var(--itsm-colour-text-primary);
}

.itsm-Field__required {
  margin-inline-start: var(--itsm-space-3xs);
  color: var(--itsm-colour-danger-subtleText);
}

.itsm-Field__optional {
  font-weight: var(--itsm-font-weight-regular);
  color: var(--itsm-colour-text-muted);
}

.itsm-Field__hint {
  margin-block-start: calc(-1 * var(--itsm-space-3xs));
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  color: var(--itsm-colour-text-muted);
}

.itsm-Field__footer {
  display: flex;
  align-items: flex-start;
  gap: var(--itsm-space-sm);
}

.itsm-Field__error {
  display: inline-flex;
  align-items: flex-start;
  gap: var(--itsm-space-2xs);
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  font-weight: var(--itsm-font-weight-medium);
  color: var(--itsm-colour-danger-subtleText);
}

.itsm-Field__errorIcon {
  flex: none;
  margin-block-start: calc((var(--itsm-text-footnote-line) - var(--itsm-icon-xs)) / 2);
}

/* The character count, end-aligned under the control. */

.itsm-Count {
  display: inline-flex;
  align-items: center;
  gap: var(--itsm-space-3xs);
  margin-inline-start: auto;
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  font-variant-numeric: tabular-nums;
  color: var(--itsm-colour-text-muted);
  white-space: nowrap;
}
.itsm-Count[data-state="near"] {
  color: var(--itsm-colour-warning-subtleText);
}
.itsm-Count[data-state="over"] {
  font-weight: var(--itsm-font-weight-medium);
  color: var(--itsm-colour-danger-subtleText);
}
.itsm-Count__icon {
  flex: none;
}

/* Inline: the label beside the control once the field is wide enough. */

.itsm-Field--inline {
  container-type: inline-size;
}

.itsm-Field__grid,
.itsm-Field__head,
.itsm-Field__body {
  display: flex;
  flex-direction: column;
  gap: calc(var(--itsm-space-2xs) + var(--itsm-space-3xs));
  min-inline-size: 0;
}

@container (min-width: 36rem) {
  .itsm-Field__grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
    column-gap: var(--itsm-space-lg);
    align-items: start;
  }
  .itsm-Field__head {
    gap: var(--itsm-space-3xs);
    padding-block-start: calc((var(--itsm-control-height-md) - var(--itsm-text-subheadline-line)) / 2);
  }
  .itsm-Field__head .itsm-Field__hint {
    margin-block-start: 0;
  }
}

${mq.forcedColors} {
  .itsm-Field__error,
  .itsm-Count[data-state="over"] {
    color: CanvasText;
  }
}
`,
);
