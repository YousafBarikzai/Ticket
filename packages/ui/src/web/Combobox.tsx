'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from './cx.js';
import { announce } from '../a11y/announcer.js';
import { useStableId } from '../a11y/ids.js';
import { scrollIntoViewIfPossible } from '../a11y/motion.js';

export interface ComboboxOption<T = unknown> {
  readonly value: string;
  readonly label: string;
  /** Secondary line, e.g. a user's e-mail address or a service's owning team. */
  readonly description?: string;
  readonly disabled?: boolean;
  /** The caller's own object, returned untouched on selection. */
  readonly data?: T;
}

export interface ComboboxProps<T = unknown> {
  readonly value: ComboboxOption<T> | null;
  readonly onChange: (option: ComboboxOption<T> | null) => void;
  /** Static options. Filtered here, case-insensitively, on label and description. */
  readonly options?: readonly ComboboxOption<T>[];
  /**
   * Asynchronous options — the user picker, the CI search, the knowledge
   * lookup. Injected rather than fetched here so the package never learns
   * about the SDK or about tenancy.
   */
  readonly loadOptions?: (query: string, signal: AbortSignal) => Promise<readonly ComboboxOption<T>[]>;
  readonly id?: string;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  readonly required?: boolean;
  readonly clearable?: boolean;
  readonly minQueryLength?: number;
  readonly debounceMs?: number;
  readonly emptyMessage?: string;
  readonly loadingMessage?: string;
  readonly className?: string;
  readonly 'aria-label'?: string;
  readonly 'aria-labelledby'?: string;
  readonly 'aria-describedby'?: string;
  readonly 'aria-invalid'?: true;
}

/**
 * A WAI-ARIA 1.2 combobox: an editable text field that owns a listbox popup.
 *
 * `aria-activedescendant` moves the virtual cursor while DOM focus stays in the
 * input, which is what lets the user keep typing while arrowing through
 * results. The listbox is never focused itself.
 */
export function Combobox<T = unknown>({
  value,
  onChange,
  options,
  loadOptions,
  id,
  placeholder,
  disabled = false,
  required = false,
  clearable = true,
  minQueryLength = 0,
  debounceMs = 200,
  emptyMessage = 'No matches',
  loadingMessage = 'Searching…',
  className,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
}: ComboboxProps<T>): ReactNode {
  const generatedId = useStableId('itsm-combobox');
  const inputId = id ?? generatedId;
  const listboxId = `${generatedId}-listbox`;
  const statusId = `${generatedId}-status`;

  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState<readonly ComboboxOption<T>[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  const items = useMemo(() => {
    if (loadOptions) return loaded;
    const all = options ?? [];
    const needle = query.trim().toLowerCase();
    if (!needle) return all;
    return all.filter(
      (option) =>
        option.label.toLowerCase().includes(needle) || (option.description?.toLowerCase().includes(needle) ?? false),
    );
  }, [loadOptions, loaded, options, query]);

  // Asynchronous options: debounced, and every in-flight request is aborted by
  // the next one so a slow reply cannot overwrite a newer, faster one.
  useEffect(() => {
    if (!loadOptions || !open) return;
    if (query.trim().length < minQueryLength) {
      setLoaded([]);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(() => {
      loadOptions(query.trim(), controller.signal)
        .then((result) => {
          if (controller.signal.aborted) return;
          setLoaded(result);
          setActiveIndex(result.length > 0 ? 0 : -1);
        })
        .catch(() => {
          if (!controller.signal.aborted) setLoaded([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, debounceMs);

    return () => {
      controller.abort();
      clearTimeout(timer);
      setLoading(false);
    };
  }, [loadOptions, open, query, minQueryLength, debounceMs]);

  // The result count is a change away from the user's focus, so it is spoken.
  useEffect(() => {
    if (!open || loading) return;
    announce(items.length === 0 ? emptyMessage : `${items.length} result${items.length === 1 ? '' : 's'} available`);
  }, [open, loading, items.length, emptyMessage]);

  const displayValue = open ? query : (value?.label ?? '');

  const close = useCallback((restoreText: boolean) => {
    setOpen(false);
    setActiveIndex(-1);
    if (restoreText) setQuery('');
  }, []);

  const select = useCallback(
    (option: ComboboxOption<T> | undefined) => {
      if (!option || option.disabled) return;
      onChange(option);
      close(true);
      announce(`${option.label} selected`);
    },
    [onChange, close],
  );

  const move = useCallback(
    (delta: number) => {
      if (items.length === 0) return;
      setActiveIndex((current) => {
        let next = current;
        for (let attempt = 0; attempt < items.length; attempt += 1) {
          next = (next + delta + items.length) % items.length;
          if (!items[next]?.disabled) return next;
        }
        return current;
      });
    },
    [items],
  );

  // Keep the active option in view without smooth scrolling, which fights the
  // keyboard when a key is held down.
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    scrollIntoViewIfPossible(listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`));
  }, [open, activeIndex]);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (!open) {
          setOpen(true);
          setActiveIndex(0);
        } else move(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (open) move(-1);
        break;
      case 'Home':
        if (open) {
          event.preventDefault();
          setActiveIndex(0);
        }
        break;
      case 'End':
        if (open) {
          event.preventDefault();
          setActiveIndex(items.length - 1);
        }
        break;
      case 'Enter':
        if (open && activeIndex >= 0) {
          // Only swallow Enter when it means "take this option"; otherwise the
          // surrounding form must still be able to submit.
          event.preventDefault();
          select(items[activeIndex]);
        }
        break;
      case 'Escape':
        if (open) {
          event.preventDefault();
          event.stopPropagation();
          close(true);
        } else if (clearable && value) {
          onChange(null);
        }
        break;
      case 'Tab':
        if (open) close(true);
        break;
      default:
        break;
    }
  };

  const activeId = open && activeIndex >= 0 && items[activeIndex] ? `${listboxId}-o${activeIndex}` : undefined;

  return (
    <div
      className={cx('itsm-Combobox', className)}
      onBlur={(event) => {
        // A click on an option is a blur of the input; only close when focus
        // has actually left the whole widget.
        if (!event.currentTarget.contains(event.relatedTarget)) close(true);
      }}
    >
      <input
        ref={inputRef}
        id={inputId}
        className="itsm-Input"
        type="text"
        role="combobox"
        autoComplete="off"
        spellCheck={false}
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid}
        aria-required={required || undefined}
        aria-busy={loading || undefined}
        disabled={disabled}
        placeholder={placeholder}
        value={displayValue}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          setActiveIndex(0);
        }}
        onFocus={() => setQuery(value?.label ?? '')}
        onClick={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      <ul
        ref={listRef}
        id={listboxId}
        role="listbox"
        className="itsm-Combobox__list"
        aria-label={ariaLabel ?? 'Suggestions'}
        hidden={!open}
      >
        {loading ? (
          <li className="itsm-Combobox__status" id={statusId} role="presentation">
            {loadingMessage}
          </li>
        ) : null}
        {!loading && items.length === 0 ? (
          <li className="itsm-Combobox__status" role="presentation">
            {emptyMessage}
          </li>
        ) : null}
        {items.map((option, index) => (
          <li
            key={option.value}
            id={`${listboxId}-o${index}`}
            role="option"
            data-index={index}
            data-active={index === activeIndex}
            aria-selected={option.value === value?.value}
            aria-disabled={option.disabled || undefined}
            className="itsm-Combobox__option"
            // Mouse down would blur the input before the click landed.
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => setActiveIndex(index)}
            onClick={() => select(option)}
          >
            <span>{option.label}</span>
            {option.description ? <span className="itsm-Combobox__meta"> — {option.description}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
