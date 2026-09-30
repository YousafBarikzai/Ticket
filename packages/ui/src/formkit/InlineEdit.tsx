'use client';

import {
  createContext,
  lazy,
  Suspense,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { announce } from '../a11y/announcer.js';
import { joinIds, useIds } from '../a11y/ids.js';
import { Spinner } from '../feedback/Spinner.js';
import { Icon } from '../icons/Icon.js';
import { displayIsoDate, formatIsoDate, parseLocaleDate } from '../overlays/calendar-dates.js';
import type { ComboboxOption, ComboboxSingleProps } from '../web/Combobox.js';
import type { DatePickerProps } from '../web/DatePicker.js';
import type { PersonOption, PersonPickerProps } from '../overlays/PersonPicker.js';
import { useOptionalItsm } from '../provider/ItsmProvider.js';
import { defaultMessages } from '../provider/messages.js';
import { AnchoredBubble } from '../web/AnchoredBubble.js';
import { Button } from '../web/Button.js';
import { cx } from '../web/cx.js';
import { IconButton } from '../web/IconButton.js';
import { Input } from '../web/Input.js';
import { Select } from '../web/Select.js';
import { Textarea } from '../web/Textarea.js';

export interface InlineEditOption {
  readonly value: string;
  readonly label: string;
}

/** What a save resolves to: nothing on success, a message, or someone else's newer value. */
export type InlineEditResult = void | { readonly error: string } | { readonly conflict: { readonly theirs: string; readonly by?: string } };

export interface InlineEditProps {
  readonly label: string;
  readonly value: string;
  /** How the value reads at rest, when not the raw string (a status pill, a person). */
  readonly display?: ReactNode;
  readonly editor?: 'text' | 'textarea' | 'select' | 'combobox' | 'date' | 'person';
  readonly options?: readonly InlineEditOption[];
  /** Client only: options for the `combobox` and `person` editors. */
  readonly loadOptions?: (query: string, signal: AbortSignal) => Promise<readonly InlineEditOption[]>;
  /** Client only. Applied optimistically and rolled back on failure. */
  readonly onSave: (next: string) => Promise<InlineEditResult>;
  readonly validate?: (value: string) => string | null;
  /** Shown instead of the pencil when the person may not edit. */
  readonly readOnlyReason?: string;
  readonly placeholder?: string;
  /**
   * Client only. After a conflict is settled: `theirs` when the person kept
   * the other change (nothing is saved; refresh your copy), `mine` just
   * before their own value is saved again through `onSave`.
   */
  readonly onConflictResolved?: (choice: 'theirs' | 'mine', theirs: string) => void;
  /** Client only. Told when the editor opens and closes — to pause live updates of the row, say. */
  readonly onEditingChange?: (editing: boolean) => void;
  readonly className?: string;
}

type Status =
  | { readonly kind: 'idle' }
  | { readonly kind: 'saving' }
  | { readonly kind: 'saved' }
  | { readonly kind: 'error'; readonly message: string; readonly attempt: string }
  | { readonly kind: 'conflict'; readonly mine: string; readonly theirs: string; readonly by?: string };

/* -------------------------------------------------------------------------
 * The editors that live in the overlays: loaded when first wanted
 * ---------------------------------------------------------------------- */

/** How a lazily loaded editor that failed to arrive tells its `InlineEdit`. */
const UnavailableContext = createContext<() => void>(() => undefined);

/**
 * A chunk that failed to arrive (offline, a deploy in between) stands in as
 * this: it tells the `InlineEdit` around it, which closes the edit with a
 * message rather than letting a Suspense boundary throw the page away.
 */
function Unavailable(): ReactNode {
  const report = useContext(UnavailableContext);
  useEffect(() => report(), [report]);
  return null;
}

const loadCombobox = () => import('../web/Combobox.js');
const loadDatePicker = () => import('../web/DatePicker.js');
const loadPersonPicker = () => import('../overlays/PersonPicker.js');

const LazyCombobox = lazy(() =>
  loadCombobox().then(
    (module) => ({ default: module.Combobox as unknown as ComponentType<ComboboxSingleProps<unknown>> }),
    () => ({ default: Unavailable as unknown as ComponentType<ComboboxSingleProps<unknown>> }),
  ),
);
const LazyDatePicker = lazy(() =>
  loadDatePicker().then(
    (module) => ({ default: module.DatePicker }),
    () => ({ default: Unavailable as unknown as ComponentType<DatePickerProps> }),
  ),
);
const LazyPersonPicker = lazy(() =>
  loadPersonPicker().then(
    (module) => ({ default: module.PersonPicker }),
    () => ({ default: Unavailable as unknown as ComponentType<PersonPickerProps> }),
  ),
);

/** Starts the download on intent (pointer over, focus), so the editor opens without a wait. */
function preload(editor: NonNullable<InlineEditProps['editor']>): void {
  const load = editor === 'combobox' ? loadCombobox : editor === 'date' ? loadDatePicker : editor === 'person' ? loadPersonPicker : null;
  if (load) void load().catch(() => undefined);
}

/**
 * Focuses the editor's control once a lazily loaded editor has mounted —
 * the one moment `InlineEdit` itself does not render, since only the
 * Suspense boundary inside it resolves.
 */
function FocusOnMount({ within, onFocused }: { readonly within: RefObject<HTMLElement | null>; readonly onFocused: () => void }): null {
  // Once, when the editor arrives; later renders must not pull focus back
  // from the Save and Cancel buttons.
  useEffect(() => {
    const control = within.current?.querySelector<HTMLElement>('input:not([type="hidden"]), select, textarea');
    if (!control) return;
    control.focus();
    onFocused();
  }, []);
  return null;
}

/**
 * What shows while an editor is being fetched: the value in a box shaped
 * like the field, not focusable (focus waits for the real control, so it is
 * never dropped when the stand-in is swapped out), with the wait spoken.
 */
function EditorPending({ text, loading }: { readonly text: string; readonly loading: string }): ReactNode {
  return (
    <div className="itsm-InlineEdit__pending">
      <span aria-hidden="true">{text}</span>
      <Spinner size="sm" className="itsm-InlineEdit__pendingSpinner" aria-hidden="true" />
      <span className="itsm-visually-hidden" role="status">
        {loading}
      </span>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * The reason a value cannot be edited, shown on request
 * ---------------------------------------------------------------------- */

const REASON_MS = 4000;
const HOVER_DELAY_MS = 500;
const SAVED_MS = 2000;

/**
 * The read-only value's reason, the way `Button` shows a `disabledReason`
 * (X-80): on hover after a moment, on keyboard focus, and pinned for four
 * seconds (and said aloud) by a click or tap. Escape and blur put it away.
 */
function useReason(reason: string | undefined): {
  readonly open: boolean;
  readonly handlers: {
    onClick(): void;
    onPointerEnter(event: PointerEvent<HTMLElement>): void;
    onPointerLeave(): void;
    onFocus(event: { currentTarget: HTMLElement }): void;
    onBlur(): void;
  };
} {
  const [mode, setMode] = useState<'hover' | 'focus' | 'pinned' | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const clear = (): void => {
    if (timer.current !== undefined) clearTimeout(timer.current);
    timer.current = undefined;
  };
  useEffect(() => clear, []);
  useEffect(() => {
    if (mode === null) return;
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') {
        clear();
        setMode(null);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [mode]);

  return {
    open: reason !== undefined && mode !== null,
    handlers: {
      onClick() {
        if (!reason) return;
        clear();
        setMode('pinned');
        timer.current = setTimeout(() => setMode(null), REASON_MS);
        announce(reason, { politeness: 'polite' });
      },
      onPointerEnter(event) {
        if (!reason || event.pointerType === 'touch' || mode !== null) return;
        clear();
        timer.current = setTimeout(() => setMode((current) => current ?? 'hover'), HOVER_DELAY_MS);
      },
      onPointerLeave() {
        if (mode === 'pinned' || mode === 'focus') return;
        clear();
        setMode(null);
      },
      onFocus(event) {
        let keyboard = false;
        try {
          keyboard = event.currentTarget.matches(':focus-visible');
        } catch {
          keyboard = false;
        }
        if (reason && keyboard) setMode((current) => current ?? 'focus');
      },
      onBlur() {
        clear();
        setMode(null);
      },
    },
  };
}

/* -------------------------------------------------------------------------
 * InlineEdit
 * ---------------------------------------------------------------------- */

const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** Focus left the editor for somewhere that is still part of it: a calendar or a list the editor opened. */
function insideFloatingLayer(element: Element | null): boolean {
  return element?.closest('[data-radix-popper-content-wrapper], [data-itsm-inline-edit-layer]') != null;
}

/** Said when `onSave` throws instead of resolving. */
const FALLBACK_ERROR = "Couldn't save that. Try again.";
const UNAVAILABLE_ERROR = "Couldn't open the editor. Check your connection and try again.";

/**
 * A value that becomes its own editor (SPEC §4.4): the ticket title, a
 * property in the inspector, a setting's name.
 *
 * **At rest** it is a button showing the value, named "Edit Priority, P2" —
 * the visible value is in the name, so voice control can say it — with a
 * pencil that appears on hover and focus and is always there on a touch
 * screen, where there is no hover (X-95).
 *
 * **Editing** opens with Enter, Space or a click. Enter saves a single line
 * (⌘/Ctrl+Enter a text area, whose Enter is a new line); Escape cancels and
 * gives focus back to the value; leaving the field saves, as renaming a file
 * does. A choice from a list or a calendar saves at once. Arrowing through a
 * closed native select only moves the choice — some platforms report every
 * arrow as a change, and a save per keypress would be a save nobody meant.
 *
 * **Saving** is optimistic: the new value shows at once with a spinner, then
 * a tick and a polite "Saved". A failure puts the old value back with the
 * reason under it, said at once; opening the editor again brings back what
 * they had typed. A conflict — somebody else changed it first — is settled
 * right there: "Jo changed this to P1 · Use theirs · Keep mine", with focus
 * on the choice (X-§1.3). Versions (`If-Match`) stay the caller's to send.
 *
 * `readOnlyReason` shows the value with a lock instead of the pencil; the
 * button stays reachable and explains itself instead of doing nothing.
 *
 * The combobox, date and person editors live in the overlays; they are
 * fetched when the pointer or focus arrives, never with the page.
 */
export function InlineEdit({
  label,
  value,
  display,
  editor = 'text',
  options,
  loadOptions,
  onSave,
  validate,
  readOnlyReason,
  placeholder,
  onConflictResolved,
  onEditingChange,
  className,
}: InlineEditProps): ReactNode {
  const itsm = useOptionalItsm();
  const messages = itsm?.messages ?? defaultMessages;
  const locale = itsm?.locale ?? 'en-GB';
  const ids = useIds('itsm-inline-edit', ['editor', 'error', 'problem', 'conflict', 'reason'] as const);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  /** What to show instead of `value` until the parent's value moves: an optimistic save, or their change after a conflict. */
  const [override, setOverride] = useState<string | null>(null);
  /** Labels learnt from options chosen in a searching editor, so the new value reads as a name, not an id. */
  const [learnt, setLearnt] = useState<Readonly<Record<string, string>>>({});

  const rootRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const theirsRef = useRef<HTMLButtonElement | null>(null);
  const focusNext = useRef<'trigger' | 'editor' | 'conflict' | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const editingRef = useRef(editing);
  editingRef.current = editing;
  /** Set by a keypress on a closed select, so the change it causes only moves the choice. */
  const keyboardChoice = useRef(false);
  const live = useRef(true);
  const sequence = useRef(0);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  // The parent's value moved (their save landed, a refresh, someone else):
  // it is the truth again, whatever this component was showing. Before
  // paint, so a stale optimistic value is never drawn beside the new one.
  const seenValue = useRef(value);
  useBrowserLayoutEffect(() => {
    if (seenValue.current === value) return;
    seenValue.current = value;
    setOverride(null);
  }, [value]);

  // The tick after a save fades back to the pencil.
  useEffect(() => {
    if (status.kind !== 'saved') return;
    const timer = setTimeout(() => setStatus((current) => (current.kind === 'saved' ? { kind: 'idle' } : current)), SAVED_MS);
    return () => clearTimeout(timer);
  }, [status]);

  // Focus goes where the last step said, once the element exists.
  useBrowserLayoutEffect(() => {
    const target = focusNext.current;
    if (target === 'trigger' && !editing && triggerRef.current) {
      focusNext.current = null;
      triggerRef.current.focus();
    } else if (target === 'conflict' && theirsRef.current) {
      focusNext.current = null;
      theirsRef.current.focus();
    } else if (target === 'editor' && editing) {
      const control = editorRef.current?.querySelector<HTMLElement>('input:not([type="hidden"]), select, textarea');
      if (!control) return;
      focusNext.current = null;
      control.focus();
      if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) {
        // The caret at the end: they are more often adding to a value than replacing it.
        const end = control.value.length;
        try {
          control.setSelectionRange(end, end);
        } catch {
          // Inputs of some types (date, number) have no selection; the caret is where the browser put it.
        }
      }
    }
  });

  const labelFor = (candidate: string): string => {
    if (candidate === '') return '';
    const option = options?.find((entry) => entry.value === candidate);
    if (option) return option.label;
    const known = learnt[candidate];
    if (known) return known;
    if (editor === 'date') return displayIsoDate(candidate, locale) || candidate;
    return candidate;
  };

  const shown = override ?? value;
  const saving = status.kind === 'saving';

  const setEditingState = (next: boolean): void => {
    setEditing(next);
    onEditingChange?.(next);
  };

  const startEditing = (): void => {
    if (saving || readOnlyReason) return;
    setDraft(status.kind === 'error' ? status.attempt : shown);
    setEditorError(null);
    if (status.kind !== 'idle') setStatus({ kind: 'idle' });
    focusNext.current = 'editor';
    setEditingState(true);
  };

  const cancel = (returnFocus: boolean): void => {
    setEditorError(null);
    if (returnFocus) focusNext.current = 'trigger';
    setEditingState(false);
  };

  const save = async (next: string): Promise<void> => {
    const run = ++sequence.current;
    setOverride(next);
    setStatus({ kind: 'saving' });
    let result: InlineEditResult;
    try {
      result = await onSave(next);
    } catch {
      result = { error: FALLBACK_ERROR };
    }
    // A later save (or unmount) supersedes this answer.
    if (!live.current || run !== sequence.current) return;

    if (result && 'conflict' in result && result.conflict) {
      const { theirs, by } = result.conflict;
      setOverride(theirs);
      setStatus({ kind: 'conflict', mine: next, theirs, ...(by ? { by } : {}) });
      announce(`${by ?? 'Someone else'} changed ${label} to ${labelFor(theirs) || messages.notSet} before you. Use theirs, or keep yours.`, {
        politeness: 'assertive',
      });
      // Only if they are still here: someone who has moved on is told, not pulled back.
      const active = document.activeElement;
      if (!active || active === document.body || rootRef.current?.contains(active)) focusNext.current = 'conflict';
      return;
    }
    if (result && 'error' in result && result.error) {
      setOverride(null);
      setStatus({ kind: 'error', message: result.error, attempt: next });
      announce(result.error, { politeness: 'assertive' });
      return;
    }
    setStatus({ kind: 'saved' });
    announce(messages.saved, { politeness: 'polite' });
  };

  /**
   * A date editor's answer, read from what is in its box: the picker reports
   * a typed date only once it is complete, so a Save pressed straight after
   * typing "14/3" must read the text itself. `null` when the text is not a
   * date.
   */
  const typedDate = (fallback: string): string | null => {
    const input = editorRef.current?.querySelector<HTMLInputElement>('input:not([type="hidden"])');
    if (!input) return fallback;
    const text = input.value.trim();
    if (text === '') return '';
    const parsed = parseLocaleDate(text, locale);
    return parsed ? formatIsoDate(parsed) : null;
  };

  /** Ends an edit with this value: nothing to do if unchanged, a message if invalid, a save otherwise. */
  const commit = (proposed: string, returnFocus: boolean): void => {
    if (!editingRef.current) return;
    const next = editor === 'date' ? typedDate(proposed) : proposed;
    if (next === null) {
      setEditorError('Enter a real date, or clear the box');
      return;
    }
    if (next === shown) {
      cancel(returnFocus);
      return;
    }
    const problem = validate?.(next) ?? null;
    if (problem) {
      setEditorError(problem);
      return;
    }
    setEditorError(null);
    if (returnFocus) focusNext.current = 'trigger';
    setEditingState(false);
    void save(next);
  };

  const editorUnavailable = (): void => {
    if (!live.current || !editingRef.current) return;
    focusNext.current = 'trigger';
    setEditingState(false);
    setStatus({ kind: 'error', message: UNAVAILABLE_ERROR, attempt: draftRef.current });
  };
  const editorFocused = (): void => {
    if (focusNext.current === 'editor') focusNext.current = null;
  };

  const acceptTheirs = (theirs: string): void => {
    setStatus({ kind: 'idle' });
    setOverride(theirs);
    focusNext.current = 'trigger';
    onConflictResolved?.('theirs', theirs);
  };

  const keepMine = (mine: string, theirs: string): void => {
    onConflictResolved?.('mine', theirs);
    focusNext.current = 'trigger';
    void save(mine);
  };

  /* ---------------------------------------------------------------- rest */

  const reason = readOnlyReason && readOnlyReason.trim() !== '' ? readOnlyReason : undefined;
  const bubble = useReason(reason);

  const emptyText = placeholder ?? messages.notSet;
  const restContent: ReactNode =
    override === null && display !== undefined && display !== null && display !== false ? display : labelFor(shown) || null;
  const empty = restContent === null;

  const problemNode =
    status.kind === 'error' ? (
      <p className="itsm-InlineEdit__message" data-tone="danger" id={ids.problem}>
        <Icon name="circle-alert" size="xs" className="itsm-InlineEdit__messageIcon" />
        <span>{status.message}</span>
      </p>
    ) : null;

  const conflictNode =
    status.kind === 'conflict' ? (
      <div className="itsm-InlineEdit__conflict" id={ids.conflict}>
        <Icon name="triangle-alert" size="sm" className="itsm-InlineEdit__conflictIcon" />
        <p className="itsm-InlineEdit__conflictText">
          {status.by ?? 'Someone else'} changed this to <strong>{labelFor(status.theirs) || messages.notSet}</strong>
        </p>
        <div className="itsm-InlineEdit__conflictActions">
          <Button ref={theirsRef} size="sm" variant="secondary" onClick={() => acceptTheirs(status.theirs)}>
            Use theirs
          </Button>
          <Button size="sm" variant="tinted" onClick={() => keepMine(status.mine, status.theirs)}>
            Keep mine
          </Button>
        </div>
      </div>
    ) : null;

  if (!editing) {
    const adornment = saving ? (
      <Spinner size="sm" />
    ) : status.kind === 'saved' ? (
      <Icon name="check" size="sm" />
    ) : reason ? (
      <Icon name="lock" size="sm" />
    ) : (
      <Icon name="pencil" size="sm" />
    );

    return (
      <div ref={rootRef} className={cx('itsm-InlineEdit', className)} data-state={reason ? 'readonly' : 'rest'} data-status={status.kind}>
        <button
          ref={triggerRef}
          type="button"
          className="itsm-InlineEdit__trigger"
          aria-disabled={reason ? true : undefined}
          aria-busy={saving || undefined}
          aria-describedby={joinIds(reason && ids.reason, status.kind === 'error' && ids.problem, status.kind === 'conflict' && ids.conflict)}
          onClick={reason ? bubble.handlers.onClick : startEditing}
          onPointerEnter={(event) => {
            if (reason) bubble.handlers.onPointerEnter(event);
            else preload(editor);
          }}
          onPointerLeave={reason ? bubble.handlers.onPointerLeave : undefined}
          onFocus={(event) => {
            if (reason) bubble.handlers.onFocus(event);
            else preload(editor);
          }}
          onBlur={reason ? bubble.handlers.onBlur : undefined}
        >
          <span className="itsm-visually-hidden">{reason ? `${label}, ` : `Edit ${label}, `}</span>
          <span className="itsm-InlineEdit__value" data-empty={empty ? '' : undefined}>
            {empty ? emptyText : restContent}
          </span>
          <span className="itsm-InlineEdit__adornment" aria-hidden="true">
            {adornment}
          </span>
          {saving ? <span className="itsm-visually-hidden">{`, ${messages.saving}`}</span> : null}
        </button>
        {reason ? (
          <>
            <span id={ids.reason} hidden>
              {reason}
            </span>
            <AnchoredBubble anchorRef={triggerRef} open={bubble.open} tone="note" side="top">
              {reason}
            </AnchoredBubble>
          </>
        ) : null}
        {problemNode}
        {conflictNode}
      </div>
    );
  }

  /* ------------------------------------------------------------- editing */

  const describedBy = joinIds(editorError && ids.error);
  const invalid = editorError ? (true as const) : undefined;
  const common = { id: ids.editor, 'aria-label': label, 'aria-describedby': describedBy, 'aria-invalid': invalid };
  const current = { value: draft, label: labelFor(draft) };
  const withButtons = editor === 'text' || editor === 'textarea' || editor === 'date';

  const choose = (option: InlineEditOption | null): void => {
    if (option) setLearnt((known) => (known[option.value] === option.label ? known : { ...known, [option.value]: option.label }));
    const next = option?.value ?? '';
    setDraft(next);
    draftRef.current = next;
    commit(next, true);
  };

  const searchOptions = async (query: string, signal: AbortSignal): Promise<readonly InlineEditOption[]> => {
    if (loadOptions) return loadOptions(query, signal);
    const needle = query.trim().toLowerCase();
    return (options ?? []).filter((option) => option.label.toLowerCase().includes(needle));
  };

  let control: ReactNode;
  switch (editor) {
    case 'textarea':
      control = (
        <Textarea
          {...common}
          autoGrow
          rows={2}
          value={draft}
          placeholder={placeholder}
          submitShortcut="mod+enter"
          submitHint="to save"
          onSubmitShortcut={() => commit(draftRef.current, true)}
          onChange={(event) => setDraft(event.target.value)}
        />
      );
      break;

    case 'select':
      control = (
        <Select
          {...common}
          value={draft}
          options={options ?? []}
          // An empty value needs an option to show it, or the first real one looks chosen.
          {...(placeholder || draft === '' ? { placeholder: placeholder ?? messages.notSet } : {})}
          onKeyDown={(event) => {
            keyboardChoice.current = event.key !== 'Enter' && event.key !== 'Tab' && event.key !== 'Escape';
          }}
          onChange={(event) => {
            const next = event.target.value;
            setDraft(next);
            draftRef.current = next;
            // A pick from the list (pointer, or the phone's picker) is the answer;
            // an arrow on the closed control is only a step towards one.
            if (!keyboardChoice.current) commit(next, true);
            keyboardChoice.current = false;
          }}
        />
      );
      break;

    case 'combobox':
      control = (
        <Suspense fallback={<EditorPending text={current.label} loading={messages.loading} />}>
          <LazyCombobox
            {...common}
            clearable={false}
            placeholder={placeholder}
            value={current.value === '' ? null : { value: current.value, label: current.label }}
            {...(loadOptions ? { loadOptions: searchOptions as (q: string, s: AbortSignal) => Promise<readonly ComboboxOption<unknown>[]> } : { options: options ?? [] })}
            onChange={(option) => choose(option ? { value: option.value, label: option.label } : null)}
          />
          <FocusOnMount within={editorRef} onFocused={editorFocused} />
        </Suspense>
      );
      break;

    case 'person':
      control = (
        <Suspense fallback={<EditorPending text={current.label} loading={messages.loading} />}>
          <LazyPersonPicker
            {...common}
            placeholder={placeholder}
            value={current.value === '' ? null : ({ id: current.value, name: current.label } satisfies PersonOption)}
            loadPeople={async (query, signal) =>
              (await searchOptions(query, signal)).map((option) => ({ id: option.value, name: option.label }))
            }
            onChange={(person) => {
              const one = Array.isArray(person) ? (person[0] ?? null) : (person as PersonOption | null);
              choose(one ? { value: one.id, label: one.name } : null);
            }}
          />
          <FocusOnMount within={editorRef} onFocused={editorFocused} />
        </Suspense>
      );
      break;

    case 'date':
      control = (
        <Suspense fallback={<EditorPending text={current.label} loading={messages.loading} />}>
          <LazyDatePicker
            {...common}
            locale={locale}
            value={draft === '' ? null : draft}
            onChange={(next) => {
              const text = next ?? '';
              setDraft(text);
              draftRef.current = text;
              // A day picked in the calendar is the answer; a date being typed is not yet.
              if (insideFloatingLayer(document.activeElement)) commit(text, true);
            }}
          />
          <FocusOnMount within={editorRef} onFocused={editorFocused} />
        </Suspense>
      );
      break;

    case 'text':
    default:
      control = (
        <Input {...common} value={draft} placeholder={placeholder} autoComplete="off" onChange={(event) => setDraft(event.target.value)} />
      );
      break;
  }

  return (
    <div
      ref={rootRef}
      className={cx('itsm-InlineEdit', className)}
      data-state="editing"
      data-editor={editor}
      onKeyDownCapture={(event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== 'Escape' || event.nativeEvent.isComposing) return;
        const target = event.target as Element;
        // From a calendar or list in a portal, or a list that is open: theirs to close first.
        if (!rootRef.current?.contains(target) || target.getAttribute('aria-expanded') === 'true') return;
        event.preventDefault();
        event.stopPropagation();
        cancel(true);
      }}
      onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
        if (event.defaultPrevented || event.key !== 'Enter' || event.nativeEvent.isComposing) return;
        const target = event.target as Element;
        if (!rootRef.current?.contains(target) || target instanceof HTMLButtonElement) return;
        if (target instanceof HTMLTextAreaElement) return;
        event.preventDefault();
        commit(draftRef.current, true);
      }}
      onBlur={() => {
        // Wait for focus to land: it may be moving to Save or Cancel, or into
        // the calendar or list the editor opened.
        setTimeout(() => {
          if (!live.current || !editingRef.current) return;
          const active = document.activeElement;
          if (active && (rootRef.current?.contains(active) || insideFloatingLayer(active))) return;
          commit(draftRef.current, false);
        }, 0);
      }}
    >
      <div ref={editorRef} className="itsm-InlineEdit__editor">
        <div className="itsm-InlineEdit__control">
          <UnavailableContext value={editorUnavailable}>{control}</UnavailableContext>
        </div>
        {withButtons ? (
          <div className="itsm-InlineEdit__actions">
            <IconButton
              icon="check"
              label={`Save ${label}`}
              size="sm"
              variant="tinted"
              // Keeps focus in the field, so pressing it is not first a blur that saves.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => commit(draftRef.current, true)}
            />
            <IconButton
              icon="x"
              label={messages.cancel}
              size="sm"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => cancel(true)}
            />
          </div>
        ) : null}
      </div>
      {editorError ? (
        <p className="itsm-InlineEdit__message" data-tone="danger" id={ids.error}>
          <Icon name="circle-alert" size="xs" className="itsm-InlineEdit__messageIcon" />
          <span>{editorError}</span>
        </p>
      ) : null}
    </div>
  );
}
