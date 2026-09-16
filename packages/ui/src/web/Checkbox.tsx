'use client';

import { useEffect, useRef, type ComponentPropsWithRef, type ReactNode } from 'react';
import { cx } from './cx.js';
import { joinIds, useIds } from '../a11y/ids.js';

export interface CheckboxProps extends Omit<ComponentPropsWithRef<'input'>, 'type' | 'children'> {
  readonly label: ReactNode;
  readonly description?: ReactNode;
  /** The "some of the children are selected" state of a tree or a table header. */
  readonly indeterminate?: boolean;
}

/**
 * A native checkbox with our own label layout.
 *
 * The input itself is not restyled away: `appearance: none` on a checkbox
 * loses the Windows high-contrast rendering that users of that mode rely on.
 */
export function Checkbox({ label, description, indeterminate = false, className, id, ...rest }: CheckboxProps): ReactNode {
  const ids = useIds('itsm-checkbox', ['input', 'description'] as const);
  const inputId = id ?? ids.input;
  const ref = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    // `indeterminate` exists only as a DOM property; there is no attribute for it.
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <div className={cx('itsm-Choice', className)} aria-disabled={rest.disabled || undefined}>
      <input
        {...rest}
        ref={ref}
        id={inputId}
        type="checkbox"
        className="itsm-Choice__control"
        aria-describedby={joinIds(description && ids.description, rest['aria-describedby'])}
      />
      <span>
        <label className="itsm-Choice__label" htmlFor={inputId}>
          {label}
        </label>
        {description ? (
          <span className="itsm-Choice__description" id={ids.description} style={{ display: 'block' }}>
            {description}
          </span>
        ) : null}
      </span>
    </div>
  );
}
