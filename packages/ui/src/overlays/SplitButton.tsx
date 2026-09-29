'use client';

import type { ReactNode } from 'react';
import type { ActionSpec, ButtonVariant, Size } from '../types.js';
import { cx } from '../web/cx.js';
import type { MenuItemSpec } from './Menu.js';

export interface SplitButtonProps {
  readonly primary: ActionSpec;
  /** Behind the chevron, labelled "More options for {label}". */
  readonly items: readonly MenuItemSpec[];
  readonly variant?: ButtonVariant;
  readonly size?: Size;
  /** Client only. */
  readonly onPrimary?: () => void;
  /** The main segment may be its form's only submit button; the chevron is always `type=button`. */
  readonly type?: 'button' | 'submit';
  readonly className?: string;
}

/**
 * One main action with its variants beside it: "Send · Send and resolve".
 *
 * Stub (SPEC §4.3): renders the main segment; the overlays package adds the
 * chevron menu.
 */
export function SplitButton({ primary, variant = 'primary', size = 'md', onPrimary, type = 'button', className }: SplitButtonProps): ReactNode {
  return (
    <span className={cx('itsm-SplitButton', className)} data-variant={variant} data-size={size}>
      <button type={type} disabled={primary.disabled} onClick={onPrimary}>
        {primary.label}
      </button>
    </span>
  );
}
