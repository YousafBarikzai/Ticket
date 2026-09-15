import type { ReactNode } from 'react';
import { cx } from './cx.js';
import { joinIds, useIds } from '../a11y/ids.js';
import { useRovingTabIndex } from '../a11y/roving-tabindex.js';

export interface RadioOption<T extends string = string> {
  readonly value: T;
  readonly label: ReactNode;
  readonly description?: ReactNode;
  readonly disabled?: boolean;
}

export interface RadioGroupProps<T extends string = string> {
  readonly label: ReactNode;
  readonly options: readonly RadioOption<T>[];
  readonly value: T | null;
  readonly onChange: (value: T) => void;
  readonly hint?: ReactNode;
  readonly error?: string;
  readonly required?: boolean;
  readonly orientation?: 'vertical' | 'horizontal';
  readonly labelHidden?: boolean;
  readonly className?: string;
}

/**
 * An ARIA radio group over `div`s rather than `input[type=radio]`.
 *
 * Native radios cannot carry a description per option without nesting invalid
 * markup, and their arrow-key behaviour cannot be made to skip disabled options
 * the way the APG asks. The trade is that we owe the group real keyboard
 * support: one tab stop, arrows to move, selection following focus, Home/End
 * to the ends — which is what `useRovingTabIndex` provides and what
 * `__tests__/roving-tabindex.test.ts` proves.
 */
export function RadioGroup<T extends string = string>({
  label,
  options,
  value,
  onChange,
  hint,
  error,
  required = false,
  orientation = 'vertical',
  labelHidden = false,
  className,
}: RadioGroupProps<T>): ReactNode {
  const ids = useIds('itsm-radiogroup', ['label', 'hint', 'error'] as const);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const firstEnabled = options.findIndex((option) => !option.disabled);

  const roving = useRovingTabIndex({
    count: options.length,
    orientation: orientation === 'vertical' ? 'vertical' : 'horizontal',
    loop: true,
    // With nothing selected the group's single tab stop is the first enabled
    // option, per the APG.
    defaultIndex: selectedIndex >= 0 ? selectedIndex : Math.max(firstEnabled, 0),
    isDisabled: (index) => options[index]?.disabled === true,
    onMove: (index) => {
      const option = options[index];
      // Selection follows focus in a radio group: arrowing to an option picks it.
      if (option && !option.disabled) onChange(option.value);
    },
  });

  return (
    <div className={cx('itsm-Field', className)}>
      <span className={cx('itsm-Field__label', labelHidden && 'itsm-visually-hidden')} id={ids.label}>
        {label}
        {required ? (
          <span className="itsm-Field__required" aria-hidden="true">
            *
          </span>
        ) : null}
      </span>
      {hint ? (
        <span className="itsm-Field__hint" id={ids.hint}>
          {hint}
        </span>
      ) : null}
      <div
        role="radiogroup"
        aria-labelledby={ids.label}
        aria-describedby={joinIds(hint && ids.hint, error && ids.error)}
        aria-required={required || undefined}
        aria-invalid={error ? true : undefined}
        aria-orientation={orientation}
        style={{
          display: 'flex',
          flexDirection: orientation === 'vertical' ? 'column' : 'row',
          gap: orientation === 'vertical' ? 'var(--itsm-space-2xs)' : 'var(--itsm-space-md)',
          flexWrap: 'wrap',
        }}
      >
        {options.map((option, index) => {
          const checked = option.value === value;
          const itemProps = roving.getItemProps(index);
          const descriptionId = option.description ? `${ids.label}-d${index}` : undefined;
          return (
            <div
              key={option.value}
              role="radio"
              aria-checked={checked}
              aria-disabled={option.disabled || undefined}
              aria-describedby={descriptionId}
              className="itsm-Choice"
              tabIndex={itemProps.tabIndex}
              ref={itemProps.ref}
              onKeyDown={(event) => {
                if (event.key === ' ' || event.key === 'Enter') {
                  event.preventDefault();
                  if (!option.disabled) onChange(option.value);
                  return;
                }
                itemProps.onKeyDown(event);
              }}
              onFocus={itemProps.onFocus}
              onClick={() => {
                if (option.disabled) return;
                onChange(option.value);
                roving.setActiveIndex(index);
              }}
            >
              <span className="itsm-Radio itsm-Choice__control" data-checked={checked} aria-hidden="true" />
              <span>
                <span className="itsm-Choice__label">{option.label}</span>
                {option.description ? (
                  <span className="itsm-Choice__description" id={descriptionId} style={{ display: 'block' }}>
                    {option.description}
                  </span>
                ) : null}
              </span>
            </div>
          );
        })}
      </div>
      {error ? (
        <span className="itsm-Field__error" id={ids.error}>
          <span aria-hidden="true">⚠</span>
          {error}
        </span>
      ) : null}
    </div>
  );
}
