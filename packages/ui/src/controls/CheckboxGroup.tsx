'use client';

import type { ReactNode } from 'react';
import { joinIds, useIds } from '../a11y/ids.js';
import { Icon } from '../icons/Icon.js';
import { Checkbox } from '../web/Checkbox.js';
import { cx } from '../web/cx.js';

export interface CheckboxGroupOption {
  readonly value: string;
  readonly label: string;
  readonly description?: string;
  readonly disabled?: boolean;
}

export interface CheckboxGroupProps {
  /** The `legend`. */
  readonly label: string;
  readonly options: readonly CheckboxGroupOption[];
  readonly value: readonly string[];
  /** Client only. Receives the new selection in the options' order. */
  readonly onChange: (value: string[]) => void;
  readonly orientation?: 'vertical' | 'horizontal';
  readonly hint?: string;
  readonly error?: string;
  /** At least one must be ticked: marked on the legend, checked by the caller. */
  readonly required?: boolean;
  /** Disables every option (a `fieldset` attribute). */
  readonly disabled?: boolean;
  readonly labelHidden?: boolean;
  readonly name?: string;
  readonly className?: string;
}

/**
 * Several related checkboxes answering one question, as a `fieldset` whose
 * `legend` is the question — which is what makes a screen reader say the
 * question before the first box ("Channels, group, Email, checkbox").
 *
 * Every option is visible and a Tab stop, and it behaves the same on a phone,
 * which is why a multiple choice with a handful of answers is this rather
 * than a multi-select list. The hint and the error describe the group, the
 * error with an icon.
 */
export function CheckboxGroup({
  label,
  options,
  value,
  onChange,
  orientation = 'vertical',
  hint,
  error,
  required = false,
  disabled = false,
  labelHidden = false,
  name,
  className,
}: CheckboxGroupProps): ReactNode {
  const ids = useIds('itsm-checkboxgroup', ['hint', 'error'] as const);
  const selected = new Set(value);

  return (
    <fieldset
      className={cx('itsm-CheckboxGroup', className)}
      data-orientation={orientation}
      disabled={disabled || undefined}
      aria-describedby={joinIds(hint && ids.hint, error && ids.error)}
    >
      <legend className={cx('itsm-Field__label', 'itsm-CheckboxGroup__legend', labelHidden && 'itsm-visually-hidden')}>
        {label}
        {required ? (
          <span className="itsm-Field__required" aria-hidden="true">
            *
          </span>
        ) : null}
      </legend>
      {hint ? (
        <span className="itsm-Field__hint itsm-CheckboxGroup__hint" id={ids.hint}>
          {hint}
        </span>
      ) : null}
      <div className="itsm-CheckboxGroup__options">
        {options.map((option) => (
          <Checkbox
            key={option.value}
            label={option.label}
            description={option.description}
            name={name}
            value={option.value}
            disabled={disabled || option.disabled}
            checked={selected.has(option.value)}
            aria-invalid={error ? true : undefined}
            onChange={(event) => {
              const checked = event.currentTarget.checked;
              // Kept in the options' order, whatever order they were ticked in.
              onChange(options.filter((entry) => (entry.value === option.value ? checked : selected.has(entry.value))).map((entry) => entry.value));
            }}
          />
        ))}
      </div>
      {error ? (
        <span className="itsm-Field__error itsm-CheckboxGroup__error" id={ids.error}>
          <Icon name="circle-alert" size="xs" className="itsm-Field__errorIcon" />
          <span>{error}</span>
        </span>
      ) : null}
    </fieldset>
  );
}
