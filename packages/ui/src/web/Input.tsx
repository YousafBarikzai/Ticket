'use client';

import { useRef, useState, type ComponentPropsWithRef, type InputEvent, type ReactNode, type Ref } from 'react';
import { Icon } from '../icons/Icon.js';
import { useOptionalItsm } from '../provider/ItsmProvider.js';
import { defaultMessages } from '../provider/messages.js';
import type { IconName, Size } from '../types.js';
import { cx } from './cx.js';
import { mergeFieldProps, useFieldControl } from './FormField.js';
import { IconSlot } from './IconSlot.js';
import { useMergedRefs } from './refs.js';

export interface InputProps extends Omit<ComponentPropsWithRef<'input'>, 'size' | 'prefix' | 'type'> {
  /** Reserved for text-like inputs: checkboxes, radios and switches have their own components. */
  readonly type?: 'text' | 'email' | 'url' | 'tel' | 'search' | 'number' | 'password' | 'date' | 'time' | 'datetime-local';
  readonly size?: Size;
  /** A leading icon (registry name) or node, inside the box. Decorative: the field's label names it. */
  readonly prefix?: ReactNode | IconName;
  /** Trailing text or node inside the box — a unit ("min", "%"), a status. */
  readonly suffix?: ReactNode;
  /** A "Clear" button inside the box once there is text. */
  readonly clearable?: boolean;
  /** The clear button's name. Default the provider's "Clear". */
  readonly clearLabel?: string;
  /** Called after the clear button emptied the field (the ordinary `onChange` has already fired). */
  readonly onClear?: () => void;
  /** Marks the field invalid when it is not inside a `FormField` with an `error`. */
  readonly invalid?: boolean;
}

/**
 * A single-line text field.
 *
 * Inside a `FormField` it takes the field's id, description and
 * invalid/required state from context, so the render prop is optional.
 *
 * Bare (no prefix, suffix or clear button) it is one `input.itsm-Input`, as
 * it always was. With any of them it becomes a box (`.itsm-InputGroup`,
 * which also takes `className`) holding the input and its adornments; the box
 * draws the border and the focus ring, and the input inside is unstyled.
 *
 * Number spinners are hidden (too small to hit, and invisible to most
 * people): a number that is stepped is a `NumberField`.
 */
export function Input({
  type = 'text',
  size = 'md',
  prefix,
  suffix,
  clearable = false,
  clearLabel,
  onClear,
  invalid,
  className,
  ref,
  onInput,
  ...rest
}: InputProps): ReactNode {
  const field = useFieldControl();
  const messages = useOptionalItsm()?.messages ?? defaultMessages;
  const own = useRef<HTMLInputElement | null>(null);
  const mergedRef = useMergedRefs<HTMLInputElement>(ref as Ref<HTMLInputElement> | undefined, own);
  const props = mergeFieldProps(field, { ...rest, ...(invalid ? { 'aria-invalid': true as const } : {}) });

  // Whether there is text, for the clear button: the value when controlled,
  // what has been typed when not.
  const controlled = rest.value !== undefined;
  const [typed, setTyped] = useState(() => String(rest.defaultValue ?? '').length > 0);
  const hasText = controlled ? String(rest.value ?? '').length > 0 : typed;

  const handleInput = (event: InputEvent<HTMLInputElement>): void => {
    if (!controlled) setTyped(event.currentTarget.value.length > 0);
    onInput?.(event);
  };

  const hasPrefix = prefix !== undefined && prefix !== null && prefix !== false;
  const hasSuffix = suffix !== undefined && suffix !== null && suffix !== false;
  // Once boxed, always boxed: moving the input in or out of the box would
  // remount it and throw away focus and the caret mid-typing. A field whose
  // adornment comes and goes should pass one from the start (an empty
  // fragment is fine; an empty suffix takes no room).
  const boxed = useRef(false);
  if (hasPrefix || hasSuffix || clearable) boxed.current = true;
  if (!boxed.current) {
    return (
      <input
        {...props}
        ref={mergedRef}
        type={type}
        className={cx('itsm-Input', size !== 'md' && `itsm-Input--${size}`, className)}
        onInput={handleInput}
      />
    );
  }

  const clear = (): void => {
    const input = own.current;
    if (!input) return;
    // Through the prototype's setter and a real `input` event, so React's
    // `onChange` fires for a controlled field exactly as if it were typed.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, '');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
    onClear?.();
  };

  return (
    <span
      className={cx('itsm-InputGroup', size !== 'md' && `itsm-InputGroup--${size}`, className)}
      data-disabled={props.disabled ? '' : undefined}
      data-readonly={props.readOnly ? '' : undefined}
      data-invalid={props['aria-invalid'] === true || props['aria-invalid'] === 'true' ? '' : undefined}
      onPointerDown={(event) => {
        // A press on the box's padding or its icon (which lets the pointer
        // through) puts the caret in the field, as it would in a plain input.
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        own.current?.focus();
      }}
    >
      {hasPrefix ? (
        <span className="itsm-InputGroup__prefix">
          <IconSlot icon={prefix} size="sm" />
        </span>
      ) : null}
      <input {...props} ref={mergedRef} type={type} className="itsm-InputGroup__input" onInput={handleInput} />
      {clearable && hasText && !props.disabled && !props.readOnly ? (
        <button type="button" className="itsm-InputGroup__clear" aria-label={clearLabel ?? messages.clear} onClick={clear}>
          <Icon name="x" size="xs" />
        </button>
      ) : null}
      {hasSuffix ? <span className="itsm-InputGroup__suffix">{suffix}</span> : null}
    </span>
  );
}
