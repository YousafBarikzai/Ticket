import { useEffect, useRef, type ComponentPropsWithRef, type ReactNode } from 'react';
import { cx } from './cx.js';

export interface TextareaProps extends ComponentPropsWithRef<'textarea'> {
  /** Grows with the content up to `maxRows`, so long comments do not hide in a scroll box. */
  readonly autoGrow?: boolean;
  readonly maxRows?: number;
}

export function Textarea({ autoGrow = false, maxRows = 12, rows = 4, className, value, onChange, ...rest }: TextareaProps): ReactNode {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (!autoGrow || !element) return;
    // Reset first: the scroll height of a grown box never shrinks on its own.
    element.style.height = 'auto';
    const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight) || 20;
    element.style.height = `${Math.min(element.scrollHeight, lineHeight * maxRows)}px`;
  }, [autoGrow, maxRows, value]);

  return (
    <textarea
      {...rest}
      ref={ref}
      rows={rows}
      value={value}
      onChange={onChange}
      className={cx('itsm-Textarea', className)}
    />
  );
}
