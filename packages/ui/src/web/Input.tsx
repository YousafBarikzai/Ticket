import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cx } from './cx.js';

export interface InputProps extends ComponentPropsWithRef<'input'> {
  /** Reserved for text-like inputs: checkboxes, radios and switches have their own components. */
  readonly type?: 'text' | 'email' | 'url' | 'tel' | 'search' | 'number' | 'password' | 'date' | 'time' | 'datetime-local';
}

export function Input({ type = 'text', className, ...rest }: InputProps): ReactNode {
  return <input {...rest} type={type} className={cx('itsm-Input', className)} />;
}
