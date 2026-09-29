import type { ReactNode } from 'react';
import { cx } from '../web/cx.js';

export interface ProseProps {
  readonly children: ReactNode;
  readonly size?: 'md' | 'lg';
  readonly className?: string;
}

/**
 * Long-form reading typography — knowledge articles, descriptions — at a
 * measure people can read (17/28, 68ch). Server-safe. `RichText` renders
 * inside it.
 *
 * Stub (SPEC §4.6): the wrapper; the display package styles it.
 */
export function Prose({ children, size = 'md', className }: ProseProps): ReactNode {
  return (
    <div className={cx('itsm-Prose', className)} data-size={size}>
      {children}
    </div>
  );
}
