import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cx } from './cx.js';
import type { ButtonSize } from './Button.js';

export interface IconButtonProps extends Omit<ComponentPropsWithRef<'button'>, 'children' | 'type' | 'aria-label'> {
  /**
   * Required, and there is no `children` escape hatch: an icon-only control
   * with no accessible name is the single most common WCAG 4.1.2 failure, so
   * the type system asks for the name rather than a linter catching it later.
   */
  readonly label: string;
  readonly icon: ReactNode;
  readonly size?: ButtonSize;
  readonly type?: 'button' | 'submit' | 'reset';
}

export function IconButton({ label, icon, size = 'md', type = 'button', className, ...rest }: IconButtonProps): ReactNode {
  return (
    <button {...rest} type={type} aria-label={label} className={cx(`itsm-IconButton itsm-IconButton--${size}`, className)}>
      <span aria-hidden="true">{icon}</span>
    </button>
  );
}
