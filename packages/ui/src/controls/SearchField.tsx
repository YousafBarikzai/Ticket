'use client';

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import { useStableId } from '../a11y/ids.js';
import { useHotkey } from '../a11y/hotkeys.js';
import { ariaKeyShortcuts } from '../a11y/keys.js';
import { Spinner } from '../feedback/Spinner.js';
import { Icon } from '../icons/Icon.js';
import { useOptionalItsm } from '../provider/ItsmProvider.js';
import { defaultMessages } from '../provider/messages.js';
import type { Size } from '../types.js';
import { cx } from '../web/cx.js';
import { Kbd } from '../web/Kbd.js';
import { useMergedRefs } from '../web/refs.js';

export interface SearchFieldProps {
  readonly value: string;
  /** Client only. Debounced by `debounceMs`; flushed at once by Enter, Escape and the clear button. */
  readonly onValueChange: (value: string) => void;
  /** 200 ms for type-ahead everywhere; 300 for the portal's knowledge suggestions. */
  readonly debounceMs?: number;
  readonly onSubmit?: (value: string) => void;
  readonly label: string;
  readonly labelHidden?: boolean;
  readonly placeholder?: string;
  /** Shown as a key cap while the field is empty, and bound as a hotkey (`/`). */
  readonly shortcut?: string;
  /**
   * Binds the shortcut even where the application has single-key shortcuts
   * off — the portal's `/` on Home and Knowledge (SPEC D14). The person's own
   * switch still wins.
   */
  readonly shortcutEssential?: boolean;
  readonly loading?: boolean;
  readonly size?: Size;
  /** Default true: a "Clear search" button once there is text. */
  readonly clearable?: boolean;
  readonly id?: string;
  readonly name?: string;
  readonly autoFocus?: boolean;
  readonly ref?: Ref<HTMLInputElement>;
  readonly className?: string;
}

/**
 * A search landmark (`role="search"`) wrapping an `input type=search` with a leading
 * icon, a trailing clear button and a spinner while results load.
 *
 * It keeps its own text and reports it debounced, so a list refetches when
 * typing pauses rather than on every key; a change of `value` from outside (a
 * link that sets `?q=`, "Clear filters") replaces the text. Enter reports at
 * once and submits; Escape clears the text first and, when there is none,
 * lets the key through to whatever is around the field (a sheet, the palette).
 *
 * Drawn filled rather than bordered, the way search fields are across Apple's
 * platforms: it is found by its magnifier and its label, and gains the
 * field's border and ring when focused. In the high-contrast themes it keeps
 * a border throughout.
 */
export function SearchField({
  value,
  onValueChange,
  debounceMs = 200,
  onSubmit,
  label,
  labelHidden = false,
  placeholder,
  shortcut,
  shortcutEssential = false,
  loading = false,
  size = 'md',
  clearable = true,
  id,
  name,
  autoFocus,
  ref,
  className,
}: SearchFieldProps): ReactNode {
  const messages = useOptionalItsm()?.messages ?? defaultMessages;
  const inputId = useStableId('itsm-search');
  const labelId = `${inputId}-label`;
  const controlId = id ?? inputId;
  const own = useRef<HTMLInputElement | null>(null);
  const mergedRef = useMergedRefs<HTMLInputElement>(ref, own);
  const [text, setText] = useState(value);
  const [focused, setFocused] = useState(false);
  /** What this field last reported, to tell its own echo from a change made elsewhere. */
  const reported = useRef(value);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef(onValueChange);
  latest.current = onValueChange;

  const cancel = (): void => {
    if (timer.current !== undefined) clearTimeout(timer.current);
    timer.current = undefined;
  };

  useEffect(() => cancel, []);

  useEffect(() => {
    if (value === reported.current) return;
    // Changed from outside: the new value wins over anything half-typed.
    cancel();
    reported.current = value;
    setText(value);
  }, [value]);

  const report = (next: string): void => {
    cancel();
    if (next === reported.current) return;
    reported.current = next;
    latest.current(next);
  };

  const schedule = (next: string): void => {
    cancel();
    timer.current = setTimeout(() => report(next), debounceMs);
  };

  useHotkey({
    keys: shortcut ?? '',
    enabled: shortcut !== undefined && shortcut !== '',
    essential: shortcutEssential,
    description: label,
    group: 'Search',
    handler: () => {
      own.current?.focus();
      own.current?.select();
    },
  });

  const clear = (): void => {
    setText('');
    report('');
    own.current?.focus();
  };

  const showKbd = shortcut !== undefined && shortcut !== '' && text === '' && !focused;
  const showClear = clearable && text !== '';

  return (
    // `role="search"` on a div rather than the `<search>` element: the same
    // landmark to assistive technology, including in engines that predate the
    // element (where `<search>` would be an unknown tag with no role at all).
    // Named by its label, so a page with two searches has two distinguishable landmarks.
    <div
      role="search"
      aria-labelledby={labelId}
      className={cx('itsm-SearchField', size !== 'md' && `itsm-SearchField--${size}`, className)}
      aria-busy={loading || undefined}
    >
      <label id={labelId} className={cx('itsm-SearchField__label', labelHidden && 'itsm-visually-hidden')} htmlFor={controlId}>
        {label}
      </label>
      <span
        className="itsm-SearchField__box"
        onPointerDown={(event) => {
          // A press on the padding or the magnifier (which lets the pointer through) puts the caret in the field.
          if (event.target !== event.currentTarget) return;
          event.preventDefault();
          own.current?.focus();
        }}
      >
        <Icon name="search" size="sm" className="itsm-SearchField__icon" />
        <input
          ref={mergedRef}
          id={controlId}
          name={name}
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          spellCheck={false}
          autoFocus={autoFocus}
          className="itsm-SearchField__input"
          placeholder={placeholder}
          value={text}
          aria-keyshortcuts={shortcut ? ariaKeyShortcuts(shortcut) : undefined}
          onChange={(event) => {
            const next = event.currentTarget.value;
            setText(next);
            schedule(next);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === 'Enter') {
              event.preventDefault();
              report(text);
              onSubmit?.(text);
              return;
            }
            if (event.key === 'Escape' && text !== '') {
              // Handled here: the sheet or palette around the field keeps its Escape for the next press.
              event.preventDefault();
              event.stopPropagation();
              clear();
            }
          }}
        />
        {loading ? <Spinner size="sm" className="itsm-SearchField__spinner" /> : null}
        {showClear ? (
          <button type="button" className="itsm-SearchField__clear" aria-label={messages.clearSearch} onClick={clear}>
            <Icon name="x" size="xs" />
          </button>
        ) : null}
        {showKbd ? <Kbd keys={shortcut} size="sm" aria-hidden className="itsm-SearchField__kbd" /> : null}
      </span>
    </div>
  );
}
