'use client';

import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentPropsWithRef,
  type InputEvent,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from 'react';
import { useStableId } from '../a11y/ids.js';
import { ariaKeyShortcuts } from '../a11y/keys.js';
import { cx } from './cx.js';
import { CharacterCount, mergeFieldProps, useFieldControl } from './FormField.js';
import { Kbd } from './Kbd.js';
import { useMergedRefs } from './refs.js';

export interface TextareaProps extends ComponentPropsWithRef<'textarea'> {
  /** Grows with the content up to `maxRows`, so long comments do not hide in a scroll box. */
  readonly autoGrow?: boolean;
  readonly maxRows?: number;
  /** A character count under the box ("120/280"), spoken near the limit. */
  readonly counter?: { readonly max: number };
  /**
   * ⌘↩ (Ctrl+Enter elsewhere) submits the form the textarea is in — or calls
   * `onSubmitShortcut` — and a hint says so under the box. The hint is never
   * put inside the submit button, where it would become part of its name.
   */
  readonly submitShortcut?: 'mod+enter';
  /** Called by the submit shortcut instead of submitting the surrounding form. */
  readonly onSubmitShortcut?: () => void;
  /** The words after the key caps in the hint. Default "to submit". */
  readonly submitHint?: string;
  /** Marks the box invalid when it is not inside a `FormField` with an `error`. */
  readonly invalid?: boolean;
}

/**
 * A multi-line text field.
 *
 * The caller's `ref` reaches the element (merged with the one the textarea
 * keeps to grow itself) — the old version replaced it and every caller's ref
 * stayed `null` (07 §5.3).
 */
export function Textarea({
  autoGrow = false,
  maxRows = 12,
  rows = 4,
  counter,
  submitShortcut,
  onSubmitShortcut,
  submitHint = 'to submit',
  invalid,
  className,
  value,
  onChange,
  onInput,
  onKeyDown,
  ref,
  ...rest
}: TextareaProps): ReactNode {
  const own = useRef<HTMLTextAreaElement | null>(null);
  const mergedRef = useMergedRefs<HTMLTextAreaElement>(ref as Ref<HTMLTextAreaElement> | undefined, own);
  const field = useFieldControl();
  const countId = useStableId('itsm-textarea-count');

  const controlled = value !== undefined;
  const [typedLength, setTypedLength] = useState(() => String(rest.defaultValue ?? '').length);
  const length = controlled ? String(value ?? '').length : typedLength;

  const grow = useCallback(() => {
    const element = own.current;
    if (!autoGrow || !element) return;
    const style = getComputedStyle(element);
    const lineHeight = Number.parseFloat(style.lineHeight) || 22;
    const chrome =
      (Number.parseFloat(style.paddingTop) || 0) +
      (Number.parseFloat(style.paddingBottom) || 0) +
      (Number.parseFloat(style.borderTopWidth) || 0) +
      (Number.parseFloat(style.borderBottomWidth) || 0);
    const borders = (Number.parseFloat(style.borderTopWidth) || 0) + (Number.parseFloat(style.borderBottomWidth) || 0);
    const limit = lineHeight * maxRows + chrome;
    // Reset first: the scroll height of a grown box never shrinks on its own.
    element.style.height = 'auto';
    const wanted = element.scrollHeight + borders;
    element.style.height = `${Math.min(wanted, limit)}px`;
    element.style.overflowY = wanted > limit ? 'auto' : 'hidden';
  }, [autoGrow, maxRows]);

  // Before paint, so a restored draft never shows a frame at the wrong height.
  useLayoutEffect(() => {
    grow();
  }, [grow, value]);

  const props = mergeFieldProps(field, {
    ...rest,
    ...(invalid ? { 'aria-invalid': true as const } : {}),
    'aria-describedby': [rest['aria-describedby'], counter ? countId : undefined].filter(Boolean).join(' ') || undefined,
  });

  const textarea = (
    <textarea
      {...props}
      ref={mergedRef}
      rows={rows}
      value={value}
      onChange={onChange}
      aria-keyshortcuts={submitShortcut ? ariaKeyShortcuts(submitShortcut) : rest['aria-keyshortcuts']}
      className={cx('itsm-Textarea', autoGrow && 'itsm-Textarea--autoGrow', className)}
      onInput={(event: InputEvent<HTMLTextAreaElement>) => {
        if (!controlled) setTypedLength(event.currentTarget.value.length);
        grow();
        onInput?.(event);
      }}
      onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
        onKeyDown?.(event);
        if (event.defaultPrevented || !submitShortcut) return;
        const mod = event.metaKey || event.ctrlKey;
        if (event.key !== 'Enter' || !mod || event.shiftKey || event.altKey || event.nativeEvent.isComposing) return;
        event.preventDefault();
        if (onSubmitShortcut) onSubmitShortcut();
        else event.currentTarget.form?.requestSubmit();
      }}
    />
  );

  if (!counter && !submitShortcut) return textarea;

  return (
    <div className="itsm-TextareaField">
      {textarea}
      <div className="itsm-TextareaField__footer">
        {submitShortcut ? (
          <span className="itsm-TextareaField__hint">
            <Kbd keys={submitShortcut} size="sm" /> {submitHint}
          </span>
        ) : null}
        {counter ? <CharacterCount id={countId} length={length} max={counter.max} /> : null}
      </div>
    </div>
  );
}
