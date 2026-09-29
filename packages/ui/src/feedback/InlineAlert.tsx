import type { ReactNode } from 'react';
import type { IconName, Tone } from '../types.js';
import { cx } from '../web/cx.js';

export interface InlineAlertProps {
  readonly tone: Tone;
  readonly children: ReactNode;
  readonly icon?: IconName;
  readonly className?: string;
}

/**
 * A compact notice inside a field or a card. Server-safe.
 *
 * Stub (SPEC §4.5): renders its text; the feedback package adds the icon and
 * tone styling.
 */
export function InlineAlert({ tone, children, className }: InlineAlertProps): ReactNode {
  return (
    <div className={cx('itsm-InlineAlert', className)} data-tone={tone}>
      {children}
    </div>
  );
}
