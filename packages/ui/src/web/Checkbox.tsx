'use client';

import { useEffect, useRef, type ComponentPropsWithRef, type MouseEvent, type ReactNode, type Ref } from 'react';
import { joinIds, useIds } from '../a11y/ids.js';
import { cx } from './cx.js';
import { useMergedRefs } from './refs.js';

export interface CheckboxProps extends Omit<ComponentPropsWithRef<'input'>, 'type' | 'children'> {
  readonly label: ReactNode;
  readonly description?: ReactNode;
  /** The "some of the children are selected" state of a tree or a table header. */
  readonly indeterminate?: boolean;
  /**
   * Keeps the label for assistive technology but not on screen — a row
   * checkbox in a table, whose row says what it selects.
   */
  readonly labelHidden?: boolean;
}

/**
 * A checkbox: the native input, restyled.
 *
 * `appearance: none` gives the box the product's shape — the accent fill and
 * a tick that draws itself in 150 ms — while the element stays a real
 * checkbox: native keyboard, form submission, `:checked`/`:indeterminate`
 * for the styles, and every assistive technology's own understanding of it.
 * Under forced colours the platform's checkbox comes back (`appearance:
 * auto`), because a drawn one would lose its fill there.
 *
 * The box is 18 px, and a press anywhere in the 26 px square around it
 * toggles it too, so the target stays comfortable in a compact table row
 * without the box looking any bigger (WCAG 2.5.8).
 */
export function Checkbox({ label, description, indeterminate = false, labelHidden = false, className, id, ref, ...rest }: CheckboxProps): ReactNode {
  const ids = useIds('itsm-checkbox', ['input', 'description'] as const);
  const inputId = id ?? ids.input;
  const own = useRef<HTMLInputElement | null>(null);
  const mergedRef = useMergedRefs<HTMLInputElement>(ref as Ref<HTMLInputElement> | undefined, own);
  const hasDescription = description !== undefined && description !== null && description !== false && description !== '';

  useEffect(() => {
    // `indeterminate` exists only as a DOM property; there is no attribute for it.
    if (own.current) own.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <div className={cx('itsm-Choice', 'itsm-Checkbox', className)} data-disabled={rest.disabled ? '' : undefined}>
      <span
        className="itsm-Checkbox__box"
        onClick={(event: MouseEvent<HTMLSpanElement>) => {
          // The ring of hit area round the box: forward the press to the input.
          if (event.target === event.currentTarget) own.current?.click();
        }}
      >
        <input
          {...rest}
          ref={mergedRef}
          id={inputId}
          type="checkbox"
          className="itsm-Checkbox__input itsm-Choice__control"
          aria-describedby={joinIds(hasDescription && ids.description, rest['aria-describedby'])}
        />
        <svg className="itsm-Checkbox__mark" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
          <path className="itsm-Checkbox__tick" d="M4.75 9.4 7.6 12.25 13.25 6" pathLength={1} />
          <path className="itsm-Checkbox__dash" d="M5.25 9h7.5" pathLength={1} />
        </svg>
      </span>
      <span className={cx('itsm-Choice__text', labelHidden && !hasDescription && 'itsm-Choice__text--hidden')}>
        <label className={cx('itsm-Choice__label', labelHidden && 'itsm-visually-hidden')} htmlFor={inputId}>
          {label}
        </label>
        {hasDescription ? (
          <span className="itsm-Choice__description" id={ids.description}>
            {description}
          </span>
        ) : null}
      </span>
    </div>
  );
}
