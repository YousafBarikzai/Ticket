import type { ElementType, ReactNode } from 'react';
import { cx } from './cx.js';

export interface VisuallyHiddenProps {
  readonly children: ReactNode;
  /** `span` by default; use `div` inside block contexts where a span would be invalid. */
  readonly as?: ElementType;
  /** For `aria-describedby` and `aria-labelledby` targets. */
  readonly id?: string;
  readonly className?: string;
}

/**
 * Text for assistive technology only. Not `display: none` and not
 * `visibility: hidden`, either of which would remove it from the accessibility
 * tree along with the screen.
 *
 * Server-safe: no directive and no hooks, so a server component can label an
 * icon-only link or a count without shipping JavaScript for it.
 */
export function VisuallyHidden({ children, as: Component = 'span', id, className }: VisuallyHiddenProps): ReactNode {
  return (
    <Component id={id} className={cx('itsm-visually-hidden', className)}>
      {children}
    </Component>
  );
}
