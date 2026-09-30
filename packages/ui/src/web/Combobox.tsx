'use client';

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type Ref,
} from 'react';
import { announce } from '../a11y/announcer.js';
import { Spinner } from '../feedback/Spinner.js';
import { scrollIntoViewIfPossible } from '../a11y/motion.js';
import { Icon } from '../icons/Icon.js';
import { defaultMessages } from '../provider/messages.js';
import { useOptionalItsm } from '../provider/ItsmProvider.js';
import type { IconName, Size } from '../types.js';
import { Avatar, type PresenceStatus } from './Avatar.js';
import { cx } from './cx.js';
import { mergeFieldProps, useFieldControl } from './FormField.js';
import { useEscapeBeforeLayer, usePopoverLayer } from './popover-layer.js';
import { useMergedRefs } from './refs.js';

export interface ComboboxOption<T = unknown> {
  readonly value: string;
  readonly label: string;
  /** Secondary line, e.g. a user's e-mail address or a service's owning team. */
  readonly description?: string;
  readonly disabled?: boolean;
  /** The caller's own object, returned untouched on selection. */
  readonly data?: T;
  /** Options sharing a group are listed together under this heading, in order of first appearance. */
  readonly group?: string;
  readonly icon?: IconName;
  /** A person or team: drawn as an avatar, with presence spoken after the name. */
  readonly avatar?: { readonly name: string; readonly initials?: string; readonly status?: PresenceStatus; readonly statusLabel?: string };
  /** Set on the option `creatable` makes from what was typed. */
  readonly created?: true;
}

export interface ComboboxOptionState {
  readonly active: boolean;
  readonly selected: boolean;
}

interface ComboboxBaseProps<T> {
  /** Static options. Filtered here, case-insensitively, on label and description. */
  readonly options?: readonly ComboboxOption<T>[];
  /**
   * Asynchronous options — the user picker, the CI search, the knowledge
   * lookup. Injected rather than fetched here so the package never learns
   * about the SDK or about tenancy.
   */
  readonly loadOptions?: (query: string, signal: AbortSignal) => Promise<readonly ComboboxOption<T>[]>;
  /** Shown before the matches whatever is typed, when their label matches ("Assign to me", "Unassigned"). */
  readonly pinnedOptions?: readonly ComboboxOption<T>[];
  /** Offers what was typed as a new option ("Create “Printers”") when nothing matches it exactly. */
  readonly creatable?: { readonly label: (query: string) => string };
  /** Client only. Draws an option's content; the option's semantics stay the component's. */
  readonly renderOption?: (option: ComboboxOption<T>, state: ComboboxOptionState) => ReactNode;
  readonly id?: string;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  readonly required?: boolean;
  /** A clear button while there is a value, and Escape on a closed field clears it. Default true. */
  readonly clearable?: boolean;
  readonly minQueryLength?: number;
  readonly debounceMs?: number;
  readonly emptyMessage?: string;
  readonly loadingMessage?: string;
  readonly size?: Size;
  readonly className?: string;
  readonly ref?: Ref<HTMLInputElement>;
  readonly 'aria-label'?: string;
  readonly 'aria-labelledby'?: string;
  readonly 'aria-describedby'?: string;
  readonly 'aria-invalid'?: true;
}

export interface ComboboxSingleProps<T = unknown> extends ComboboxBaseProps<T> {
  readonly multiple?: false;
  readonly value: ComboboxOption<T> | null;
  readonly onChange: (option: ComboboxOption<T> | null) => void;
}

export interface ComboboxMultipleProps<T = unknown> extends ComboboxBaseProps<T> {
  /** Chips in the field; Backspace in an empty field removes the last one. */
  readonly multiple: true;
  readonly value: readonly ComboboxOption<T>[];
  readonly onChange: (options: ComboboxOption<T>[]) => void;
}

export type ComboboxProps<T = unknown> = ComboboxSingleProps<T> | ComboboxMultipleProps<T>;

function matches(option: ComboboxOption<unknown>, needle: string): boolean {
  return option.label.toLowerCase().includes(needle) || (option.description?.toLowerCase().includes(needle) ?? false);
}

/** Options in display order — ungrouped first, then each group where it first appears — with their headings. */
function arrange<T>(items: readonly ComboboxOption<T>[]): { readonly flat: ComboboxOption<T>[]; readonly sections: { readonly group: string | null; readonly options: ComboboxOption<T>[] }[] } {
  const order: (string | null)[] = [];
  const byGroup = new Map<string | null, ComboboxOption<T>[]>();
  for (const option of items) {
    const key = option.group ?? null;
    if (!byGroup.has(key)) {
      byGroup.set(key, []);
      if (key === null) order.unshift(key);
      else order.push(key);
    }
    byGroup.get(key)!.push(option);
  }
  const sections = order.map((group) => ({ group, options: byGroup.get(group)! }));
  return { flat: sections.flatMap((section) => section.options), sections };
}

/**
 * A WAI-ARIA 1.2 combobox: an editable text field that owns a listbox popup.
 *
 * `aria-activedescendant` moves the virtual cursor while DOM focus stays in
 * the input, which is what lets the person keep typing while arrowing through
 * results; the listbox is never focused itself.
 *
 * The list floats on the Radix popover, anchored to the field: portalled so
 * no card or table clips it, flipped when there is no room below, and part
 * of the overlay layer stack — so inside a dialog, Escape closes the list
 * first and the dialog second (SPEC §4.3). The popover arrives after the
 * field (`popover-layer.ts`): it is fetched when the field takes focus or
 * the pointer reaches it, so a form that merely contains a combobox does not
 * carry the popover library in its first load. Until it lands the list is
 * kept, hidden, beside the input, so the field's ARIA references always
 * resolve and nothing typed is lost.
 *
 * - `multiple` puts the choices in the field as chips; each chip has its own
 *   remove button, and Backspace in the empty field removes the last one.
 * - `creatable` offers what was typed as a new option; `pinnedOptions` stay
 *   at the top; options with a `group` are listed under their heading.
 * - Options can carry an icon or an avatar, or be drawn by `renderOption`.
 * - Asynchronous options are debounced (200 ms) and every request is aborted
 *   by the next, so a slow reply cannot overwrite a newer one. The count of
 *   results is announced; a spinner shows while loading.
 */
export function Combobox<T = unknown>(props: ComboboxProps<T>): ReactNode {
  const {
    options,
    loadOptions,
    pinnedOptions,
    creatable,
    renderOption,
    id,
    placeholder,
    disabled = false,
    required = false,
    clearable = true,
    minQueryLength = 0,
    debounceMs = 200,
    emptyMessage = 'No matches',
    loadingMessage = 'Searching…',
    size = 'md',
    className,
    ref,
    'aria-label': ariaLabel,
    'aria-labelledby': ariaLabelledBy,
    'aria-describedby': ariaDescribedBy,
    'aria-invalid': ariaInvalid,
  } = props;
  const multiple = props.multiple === true;
  const selected: readonly ComboboxOption<T>[] = props.multiple ? props.value : props.value ? [props.value] : [];
  const single = props.multiple ? null : props.value;

  const messages = useOptionalItsm()?.messages ?? defaultMessages;
  const field = useFieldControl();
  const wired = mergeFieldProps(field, { id, 'aria-describedby': ariaDescribedBy, 'aria-invalid': ariaInvalid, required });
  const generatedId = useId();
  const inputId = wired.id ?? `${generatedId}-input`;
  const listboxId = `${generatedId}-listbox`;

  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState<readonly ComboboxOption<T>[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const mergedRef = useMergedRefs<HTMLInputElement>(ref, inputRef);
  const fieldRef = useRef<HTMLDivElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);
  const showing = open && !disabled;
  const { layer, preload } = usePopoverLayer(showing);

  // What to search for. The chosen option's own label, put in the field when
  // it takes focus, is not a search: until the person types, every option
  // (and every pinned one) is on offer.
  const search = !multiple && single && query === single.label ? '' : query.trim();
  const needle = search.toLowerCase();
  // A count, not the array: callers often build `pinnedOptions` inline, and a
  // new array every render must not restart the search.
  const pinnedCount = pinnedOptions?.length ?? 0;
  const tooShort = search.length < minQueryLength;

  const { flat: items, sections } = useMemo(() => {
    const pinned = (pinnedOptions ?? []).filter((option) => !needle || matches(option, needle));
    const found = loadOptions ? loaded : (options ?? []).filter((option) => !needle || matches(option, needle));
    const all = [...pinned, ...found];
    if (creatable && search && !all.some((option) => option.label.toLowerCase() === needle)) {
      all.push({ value: search, label: search, created: true });
    }
    return arrange(all);
  }, [pinnedOptions, loadOptions, loaded, options, needle, search, creatable]);

  // Asynchronous options: debounced, and every in-flight request is aborted by
  // the next one so a slow reply cannot overwrite a newer, faster one.
  useEffect(() => {
    if (!loadOptions || !open) return;
    if (tooShort) {
      setLoaded([]);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(() => {
      loadOptions(search, controller.signal)
        .then((result) => {
          if (controller.signal.aborted) return;
          setLoaded(result);
          setActiveIndex(result.length > 0 || pinnedCount > 0 ? 0 : -1);
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
  }, [loadOptions, open, search, tooShort, debounceMs, pinnedCount]);

  // The result count is a change away from the person's focus, so it is spoken.
  useEffect(() => {
    if (!open || loading) return;
    if (tooShort && loadOptions) return;
    announce(items.length === 0 ? emptyMessage : `${items.length} result${items.length === 1 ? '' : 's'} available`);
  }, [open, loading, items.length, emptyMessage, tooShort, loadOptions]);

  // Keep the active option in view without smooth scrolling, which fights the
  // keyboard when a key is held down.
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    scrollIntoViewIfPossible(popupRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`));
  }, [open, activeIndex]);

  const close = useCallback((restoreText: boolean) => {
    setOpen(false);
    setActiveIndex(-1);
    if (restoreText) setQuery('');
  }, []);

  const isSelected = (option: ComboboxOption<T>): boolean => selected.some((chosen) => chosen.value === option.value);

  const choose = (option: ComboboxOption<T> | undefined): void => {
    if (!option || option.disabled) return;
    if (props.multiple) {
      const already = isSelected(option);
      props.onChange(already ? selected.filter((chosen) => chosen.value !== option.value) : [...selected, option]);
      setQuery('');
      announce(`${option.label} ${already ? 'removed' : 'added'}`);
      inputRef.current?.focus();
      return;
    }
    props.onChange(option);
    close(true);
    announce(`${option.label} selected`);
  };

  const remove = (option: ComboboxOption<T>): void => {
    if (!props.multiple) return;
    props.onChange(selected.filter((chosen) => chosen.value !== option.value));
    announce(`${option.label} removed`);
    inputRef.current?.focus();
  };

  const clear = (): void => {
    if (props.multiple) props.onChange([]);
    else props.onChange(null);
    setQuery('');
    inputRef.current?.focus();
    announce(messages.clear);
  };

  const move = (delta: number): void => {
    if (items.length === 0) return;
    setActiveIndex((current) => {
      let next = current;
      for (let attempt = 0; attempt < items.length; attempt += 1) {
        next = (next + delta + items.length) % items.length;
        if (!items[next]?.disabled) return next;
      }
      return current;
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    // Escape while the list is open is the list's (a Radix layer, which
    // listens first and marks the event handled).
    if (event.defaultPrevented) return;
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
          choose(items[activeIndex]);
        }
        break;
      case 'Escape':
        if (open) {
          event.preventDefault();
          close(true);
        } else if (clearable && selected.length > 0 && !multiple) {
          event.preventDefault();
          clear();
        }
        break;
      case 'Backspace':
        if (multiple && query === '' && selected.length > 0) {
          event.preventDefault();
          remove(selected[selected.length - 1]!);
        }
        break;
      case 'Tab':
        if (open) close(true);
        break;
      default:
        break;
    }
  };

  const onBlur = (event: FocusEvent<HTMLInputElement>): void => {
    const next = event.relatedTarget as Node | null;
    if (next && (fieldRef.current?.contains(next) || popupRef.current?.contains(next))) return;
    close(true);
  };

  const withinField = (target: EventTarget | null): boolean => target instanceof Node && (fieldRef.current?.contains(target) ?? false);

  // The list is wanted and its layer is still on its way: Escape is still the list's.
  useEscapeBeforeLayer(showing && !layer, (target) => target === inputRef.current, () => close(true));

  const activeId = open && activeIndex >= 0 && items[activeIndex] ? `${listboxId}-o${activeIndex}` : undefined;
  const displayValue = multiple ? query : open ? query : (single?.label ?? '');
  const showClear = clearable && !disabled && (selected.length > 0 || (multiple && query !== ''));
  const status = loading ? loadingMessage : tooShort && loadOptions ? `Type at least ${minQueryLength} character${minQueryLength === 1 ? '' : 's'}` : items.length === 0 ? emptyMessage : null;

  let index = -1;
  const optionNode = (option: ComboboxOption<T>): ReactNode => {
    index += 1;
    const at = index;
    const chosen = isSelected(option);
    const active = at === activeIndex;
    return (
      <div
        key={`${option.created ? 'new:' : ''}${option.value}`}
        id={`${listboxId}-o${at}`}
        role="option"
        data-index={at}
        data-active={active}
        aria-selected={chosen}
        aria-disabled={option.disabled || undefined}
        className={cx('itsm-Combobox__option', option.created && 'itsm-Combobox__option--create')}
        // A press would blur the input before the click landed.
        onPointerDown={(event: PointerEvent<HTMLDivElement>) => event.preventDefault()}
        onMouseDown={(event) => event.preventDefault()}
        onPointerMove={() => {
          if (!active) setActiveIndex(at);
        }}
        onClick={() => choose(option)}
      >
        {renderOption ? (
          renderOption(option, { active, selected: chosen })
        ) : (
          <>
            {option.created ? (
              <Icon name="plus" size="sm" className="itsm-Combobox__lead" />
            ) : option.avatar ? (
              <Avatar name={option.avatar.name} initials={option.avatar.initials} status={option.avatar.status} size="sm" decorative className="itsm-Combobox__lead" />
            ) : option.icon ? (
              <Icon name={option.icon} size="sm" className="itsm-Combobox__lead" />
            ) : null}
            <span className="itsm-Combobox__text">
              <span className="itsm-Combobox__label">
                {option.created && creatable ? creatable.label(option.label) : option.label}
                {option.avatar?.statusLabel ? <span className="itsm-visually-hidden">, {option.avatar.statusLabel}</span> : null}
              </span>
              {option.description ? <span className="itsm-Combobox__meta">{option.description}</span> : null}
            </span>
            {chosen ? <Icon name="check" size="sm" className="itsm-Combobox__check" /> : null}
          </>
        )}
      </div>
    );
  };

  const listbox = (
    <>
      <div id={listboxId} role="listbox" aria-label={ariaLabel ?? 'Suggestions'} aria-multiselectable={multiple || undefined} className="itsm-Combobox__list">
        {sections.map((section) =>
          section.group === null ? (
            section.options.map(optionNode)
          ) : (
            <div key={`group:${section.group}`} role="group" aria-label={section.group} className="itsm-Combobox__group">
              <div className="itsm-Combobox__groupLabel" aria-hidden="true">
                {section.group}
              </div>
              {section.options.map(optionNode)}
            </div>
          ),
        )}
      </div>
      {status ? <div className="itsm-Combobox__status">{status}</div> : null}
    </>
  );

  return (
    <>
      <div
        ref={fieldRef}
        className={cx('itsm-InputGroup', 'itsm-Combobox', size !== 'md' && `itsm-InputGroup--${size}`, multiple && 'itsm-Combobox--multiple', className)}
        data-disabled={disabled ? '' : undefined}
        data-invalid={wired['aria-invalid'] ? '' : undefined}
        onPointerEnter={(event) => {
          if (event.pointerType !== 'touch') preload();
        }}
        onPointerDown={(event) => {
          // A press on the field's padding puts the caret in the input, as a plain field would.
          if (event.target !== event.currentTarget) return;
          event.preventDefault();
          inputRef.current?.focus();
        }}
      >
        {multiple
          ? selected.map((option) => (
              <span key={option.value} className="itsm-Combobox__chip">
                <span className="itsm-Combobox__chipLabel">{option.label}</span>
                {!disabled ? (
                  <button
                    type="button"
                    className="itsm-Combobox__chipRemove"
                    aria-label={`${messages.remove} ${option.label}`}
                    onClick={() => remove(option)}
                  >
                    <Icon name="x" size="xs" />
                  </button>
                ) : null}
              </span>
            ))
          : null}
        <input
          ref={mergedRef}
          id={inputId}
          className="itsm-InputGroup__input itsm-Combobox__input"
          type="text"
          role="combobox"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          aria-expanded={open}
          aria-controls={open ? listboxId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
          aria-describedby={wired['aria-describedby']}
          aria-invalid={wired['aria-invalid']}
          aria-required={wired.required || undefined}
          aria-busy={loading || undefined}
          disabled={disabled}
          placeholder={multiple && selected.length > 0 ? undefined : placeholder}
          value={displayValue}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            setActiveIndex(0);
          }}
          onFocus={() => {
            preload();
            if (!multiple) setQuery(single?.label ?? '');
          }}
          onClick={() => setOpen(true)}
          onKeyDown={onKeyDown}
          onBlur={onBlur}
        />
        {loading ? <Spinner size="sm" className="itsm-Combobox__spinner" /> : null}
        {showClear ? (
          <button
            type="button"
            className="itsm-InputGroup__clear"
            aria-label={messages.clear}
            onPointerDown={(event) => event.preventDefault()}
            onClick={clear}
          >
            <Icon name="x" size="xs" />
          </button>
        ) : null}
        {/* The list before the popover has arrived: in the document, so the
            input's ARIA references resolve, but not shown. */}
        {showing && !layer ? <div hidden>{listbox}</div> : null}
      </div>
      {layer ? (
        <layer.PopoverLayer
          open={showing}
          onOpenChange={(next) => {
            if (!next) close(true);
          }}
          anchorRef={fieldRef}
          ref={popupRef}
          role={undefined}
          side="bottom"
          align="start"
          sideOffset={4}
          collisionPadding={8}
          className="itsm-Combobox__popup"
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onPointerDownOutside={(event) => {
            if (withinField(event.target)) event.preventDefault();
          }}
          onFocusOutside={(event) => {
            if (withinField(event.target)) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            if (withinField(event.target)) event.preventDefault();
          }}
        >
          {listbox}
        </layer.PopoverLayer>
      ) : null}
    </>
  );
}
