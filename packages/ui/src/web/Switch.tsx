'use client';

import type { ReactNode } from 'react';
import { cx } from './cx.js';
import { useIds } from '../a11y/ids.js';

export interface SwitchProps {
  readonly label: ReactNode;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly description?: ReactNode;
  readonly disabled?: boolean;
  readonly labelHidden?: boolean;
  readonly className?: string;
}

/**
 * A `role="switch"` button.
 *
 * A switch takes effect immediately; a checkbox is submitted with a form. That
 * difference is why this is not `Checkbox` with different styling — the user is
 * told "on/off", not "ticked", and there is no Save button to look for.
 */
export function Switch({ label, checked, onChange, description, disabled = false, labelHidden = false, className }: SwitchProps): ReactNode {
  const ids = useIds('itsm-switch', ['label', 'description'] as const);

  return (
    <div className={cx('itsm-Choice', className)} aria-disabled={disabled || undefined}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={ids.label}
        aria-describedby={description ? ids.description : undefined}
        aria-disabled={disabled || undefined}
        className="itsm-Switch itsm-Choice__control"
        onClick={() => {
          if (!disabled) onChange(!checked);
        }}
      >
        <span className="itsm-Switch__thumb" aria-hidden="true" />
      </button>
      <span>
        <span className={cx('itsm-Choice__label', labelHidden && 'itsm-visually-hidden')} id={ids.label}>
          {label}
        </span>
        {description ? (
          <span className="itsm-Choice__description" id={ids.description} style={{ display: 'block' }}>
            {description}
          </span>
        ) : null}
      </span>
    </div>
  );
}
