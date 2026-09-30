'use client';

import type { ReactNode } from 'react';
import { joinIds, useIds } from '../a11y/ids.js';
import { useRovingTabIndex } from '../a11y/roving-tabindex.js';
import { Icon } from '../icons/Icon.js';
import type { IconName } from '../types.js';
import { cx } from './cx.js';
import { IconSlot } from './IconSlot.js';

export interface RadioOption<T extends string = string> {
  readonly value: T;
  readonly label: ReactNode;
  readonly description?: ReactNode;
  readonly disabled?: boolean;
  /** Shown on the card in the `cards` variant. */
  readonly icon?: IconName | ReactNode;
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
  /**
   * `list` (default): a radio and its label per row. `cards`: large
   * selectable cards with an icon, a title and a description — for a choice
   * that deserves the explanation (field visibility, the portal's urgency).
   */
  readonly variant?: 'list' | 'cards';
  /** Cards per row once the group is wide enough (a container query); one per row when narrow. */
  readonly columns?: 1 | 2 | 3;
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
 *
 * Selection follows focus, so this is for choices without side effects. A
 * choice that saves, navigates or asks for confirmation is a
 * `SegmentedControl` in `commit` or `nav` mode (X-61).
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
  variant = 'list',
  columns = 1,
  className,
}: RadioGroupProps<T>): ReactNode {
  const ids = useIds('itsm-radiogroup', ['label', 'hint', 'error'] as const);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const firstEnabled = options.findIndex((option) => !option.disabled);
  const cards = variant === 'cards';

  const roving = useRovingTabIndex({
    count: options.length,
    // A grid of cards answers every arrow; a list answers the arrows along it.
    orientation: cards ? 'both' : orientation === 'vertical' ? 'vertical' : 'horizontal',
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
    <div className={cx('itsm-Field', 'itsm-RadioGroup', cards && 'itsm-RadioGroup--cards', className)}>
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
        className="itsm-RadioGroup__options"
        aria-labelledby={ids.label}
        aria-describedby={joinIds(hint && ids.hint, error && ids.error)}
        aria-required={required || undefined}
        aria-invalid={error ? true : undefined}
        aria-orientation={cards ? undefined : orientation}
        data-orientation={cards ? undefined : orientation}
        data-columns={cards ? columns : undefined}
      >
        {options.map((option, index) => {
          const checked = option.value === value;
          const itemProps = roving.getItemProps(index);
          const descriptionId = option.description ? `${ids.label}-d${index}` : undefined;
          const text = (
            <span className="itsm-Choice__text">
              <span className="itsm-Choice__label">{option.label}</span>
              {option.description ? (
                <span className="itsm-Choice__description" id={descriptionId}>
                  {option.description}
                </span>
              ) : null}
            </span>
          );
          const radio = <span className="itsm-Radio itsm-Choice__control" data-checked={checked} aria-hidden="true" />;
          return (
            <div
              key={option.value}
              role="radio"
              aria-checked={checked}
              aria-disabled={option.disabled || undefined}
              aria-describedby={descriptionId}
              className={cx('itsm-Choice', 'itsm-RadioGroup__option', cards && 'itsm-RadioGroup__card')}
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
              {cards ? (
                <>
                  {option.icon ? (
                    <span className="itsm-RadioGroup__cardIcon" aria-hidden="true">
                      <IconSlot icon={option.icon} size="lg" />
                    </span>
                  ) : null}
                  {text}
                  {radio}
                </>
              ) : (
                <>
                  {radio}
                  {text}
                </>
              )}
            </div>
          );
        })}
      </div>
      {error ? (
        <span className="itsm-Field__error" id={ids.error}>
          <Icon name="circle-alert" size="xs" className="itsm-Field__errorIcon" />
          <span>{error}</span>
        </span>
      ) : null}
    </div>
  );
}
