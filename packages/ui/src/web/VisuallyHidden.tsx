import type { ElementType, ReactNode } from 'react';

export interface VisuallyHiddenProps {
  readonly children: ReactNode;
  /** `span` by default; use `div` inside block contexts where a span would be invalid. */
  readonly as?: ElementType;
}

/**
 * Text for assistive technology only. Not `display: none` and not
 * `visibility: hidden`, either of which would remove it from the accessibility
 * tree along with the screen.
 */
export function VisuallyHidden({ children, as: Component = 'span' }: VisuallyHiddenProps): ReactNode {
  return <Component className="itsm-visually-hidden">{children}</Component>;
}
