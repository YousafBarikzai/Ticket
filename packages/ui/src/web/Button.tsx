'use client';

import type { ComponentPropsWithRef, MouseEvent, ReactNode } from 'react';
import { cx } from './cx.js';
import { VisuallyHidden } from './VisuallyHidden.js';

export type ButtonVariant = 'primary' | 'secondary' | 'subtle' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends Omit<ComponentPropsWithRef<'button'>, 'type'> {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  /** Shows a spinner, marks the button busy and swallows clicks without removing focus. */
  readonly loading?: boolean;
  /** What the spinner means, for screen readers. */
  readonly loadingLabel?: string;
  readonly iconStart?: ReactNode;
  readonly iconEnd?: ReactNode;
  readonly fullWidth?: boolean;
  /** Defaults to `button`: a button inside a form that submits by accident is a classic data-loss bug. */
  readonly type?: 'button' | 'submit' | 'reset';
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  loadingLabel = 'Loading',
  iconStart,
  iconEnd,
  fullWidth = false,
  type = 'button',
  className,
  children,
  onClick,
  disabled,
  style,
  ...rest
}: ButtonProps): ReactNode {
  // A button that disappears from the tab order the moment it starts working
  // strands the keyboard user: `aria-disabled` keeps it focusable and the
  // handler guard keeps it inert. `disabled` is still honoured when the caller
  // means "this action is unavailable", which is a different statement.
  const inert = loading;

  return (
    <button
      {...rest}
      type={type}
      disabled={disabled}
      aria-disabled={inert || disabled ? true : undefined}
      aria-busy={loading || undefined}
      className={cx(`itsm-Button itsm-Button--${variant} itsm-Button--${size}`, className)}
      style={fullWidth ? { inlineSize: '100%', ...style } : style}
      onClick={(event: MouseEvent<HTMLButtonElement>) => {
        if (inert) {
          event.preventDefault();
          return;
        }
        onClick?.(event);
      }}
    >
      {loading ? <span className="itsm-Button__spinner" aria-hidden="true" /> : iconStart}
      {children}
      {loading ? <VisuallyHidden>{loadingLabel}</VisuallyHidden> : iconEnd}
    </button>
  );
}
