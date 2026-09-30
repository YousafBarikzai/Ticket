'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type Ref,
  type SyntheticEvent,
} from 'react';
import { useStableId } from '../a11y/ids.js';
import { useHotkey } from '../a11y/hotkeys.js';
import { cx } from '../web/cx.js';
import { useMergedRefs } from '../web/refs.js';
import { DraftNotice, DraftStatus } from './Draft.js';
import { useDraft } from './drafts.js';
import { FormContext, FormFieldErrorsContext, useFormContext, type FormContextValue } from './form-context.js';
import {
  constraintFailures,
  controlFor,
  entriesKey,
  isFormEntries,
  readEntries,
  revealDetails,
  writeEntries,
  type FormEntries,
} from './form-data.js';
import { FormErrorSummary } from './FormErrorSummary.js';
import { useLeaveGuard } from './leave-guard.js';
import { useStuck } from './sticky.js';

/** What a failed submit hands back: messages per field, or one for the whole form. */
export interface FormSubmitResult {
  readonly fieldErrors?: Record<string, string>;
  readonly message?: string;
}

export interface FormAutosave {
  /** The draft's storage key, unique to the thing being edited. */
  readonly key: string;
  /** Default 5000. */
  readonly intervalMs?: number;
  /** Changes when the form's shape does, so an old draft is not restored into new fields. */
  readonly version?: string;
}

/** The form as its children may want to know it — for a submit button's spinner, say. */
export interface FormState {
  readonly submitting: boolean;
  /** Whether the values differ from the ones the form started with (or last saved). */
  readonly dirty: boolean;
  /** The last failed submit's messages, by field name, less the ones fixed since. */
  readonly errors: Readonly<Record<string, string>>;
}

export interface FormProps {
  /** Client only. Resolves to nothing on success; a rejection is reported as a failure of the whole form. */
  readonly onSubmit: (data: FormData) => Promise<void | FormSubmitResult>;
  /** The fields and a `FormActions`; or, from a client parent, a function of the form's state. */
  readonly children: ReactNode | ((state: FormState) => ReactNode);
  /** Keeps the `FormActions` visible at the bottom of the view while a long form scrolls. */
  readonly stickyActions?: boolean;
  /** Asks before leaving with unsaved changes. */
  readonly dirtyGuard?: boolean;
  readonly autosave?: FormAutosave;
  /** mod+S submits. */
  readonly saveShortcut?: boolean;
  /** The error summary's title. Default "There is a problem". */
  readonly errorTitle?: string;
  readonly id?: string;
  readonly 'aria-label'?: string;
  readonly 'aria-labelledby'?: string;
  readonly className?: string;
  readonly ref?: Ref<HTMLFormElement>;
}

interface SummaryItem {
  /** The name the error was reported under (a server's field key, a control's name). */
  readonly name: string;
  /** The id of the control it is about, or `''` when no control on the page answers to the name. */
  readonly fieldId: string;
  readonly message: string;
}

interface Failure {
  /** Counts failed attempts, so each one moves focus to the summary. */
  readonly attempt: number;
  readonly items: readonly SummaryItem[];
  readonly message?: string;
}

/** Said when `onSubmit` throws instead of resolving: the person's work is not lost, and they can try again. */
const FALLBACK_MESSAGE = "That didn't save. Your changes are still here, so you can try again.";

function sanitiseId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-');
}

/** Gives a control an id so a summary link can reach it — one it already has, else one made from the form's. */
function idFor(control: HTMLElement, formId: string, name: string): string {
  if (!control.id) control.id = `${formId}-${sanitiseId(name)}`;
  return control.id;
}

/** Items in the order the fields appear on the page, with any the page cannot show at the end. */
function inDocumentOrder(items: readonly (SummaryItem & { readonly element: HTMLElement | null })[]): SummaryItem[] {
  return [...items]
    .sort((a, b) => {
      if (!a.element || !b.element) return a.element ? -1 : b.element ? 1 : 0;
      return a.element.compareDocumentPosition(b.element) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    })
    .map(({ name, fieldId, message }) => ({ name, fieldId, message }));
}

const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * A form that knows how it failed (SPEC §4.4).
 *
 * - **Submitting.** The browser's constraint checks run first — `required`,
 *   `type="email"`, `minLength` — and their failures are reported in the
 *   product's words, the same sentences catalogue validation uses. Then
 *   `onSubmit` receives the `FormData`; the form is `aria-busy` meanwhile
 *   and a second submit is ignored.
 * - **Failing.** `fieldErrors` (a 422's, say) are mapped onto their fields
 *   by name: each `FormField` shows its message under the control, and a
 *   `FormErrorSummary` at the top lists them all as links and takes focus.
 *   A field's message goes as soon as that field is edited. `message` is a
 *   sentence for the whole form, shown in the summary.
 * - **Drafts** (`autosave`). The values are kept on this device every few
 *   seconds and put back when the form is opened again — "Draft restored ·
 *   Discard" — with "Draft saved · 12:04" beside the actions. Passwords, file
 *   inputs and anything under `data-itsm-draft="off"` are never stored. A
 *   successful submit forgets the draft.
 * - **Leaving** (`dirtyGuard`) asks first; **mod+S** (`saveShortcut`)
 *   submits from anywhere on the page.
 *
 * Validation stays the caller's where it has to be the server's: the form
 * never invents rules, it reports the ones the controls and the API state.
 */
export function Form({
  onSubmit,
  children,
  stickyActions = false,
  dirtyGuard = false,
  autosave,
  saveShortcut = false,
  errorTitle,
  id,
  className,
  ref,
  ...aria
}: FormProps): ReactNode {
  const formId = useStableId('itsm-form');
  const own = useRef<HTMLFormElement | null>(null);
  const mergedRef = useMergedRefs<HTMLFormElement>(ref, own);

  const [submitting, setSubmitting] = useState(false);
  const busy = useRef(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const attempts = useRef(0);
  const [dirty, setDirty] = useState(false);
  const [actionsCount, setActionsCount] = useState(0);
  const live = useRef(true);

  /** The values the form started with (or last saved), to tell whether anything changed. */
  const pristine = useRef<string | null>(null);
  /** The same, as a draft would store them: "Discard" puts these back. */
  const pristineDraft = useRef<FormEntries>([]);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const refreshDirty = useCallback(() => {
    const form = own.current;
    if (!form || pristine.current === null) return;
    setDirty(entriesKey(readEntries(form, 'all')) !== pristine.current);
  }, []);

  const rememberPristine = useCallback(() => {
    const form = own.current;
    if (!form) return;
    pristine.current = entriesKey(readEntries(form, 'all'));
    pristineDraft.current = readEntries(form, 'draft');
  }, []);

  // Before the draft is restored (a passive effect, which runs after this).
  useBrowserLayoutEffect(() => {
    rememberPristine();
  }, [rememberPristine]);

  const draft = useDraft<FormEntries>({
    key: autosave?.key,
    version: autosave?.version,
    intervalMs: autosave?.intervalMs,
    getValue: () => (own.current ? readEntries(own.current, 'draft') : []),
    isEmpty: (entries) => entriesKey(entries) === entriesKey(pristineDraft.current),
    onRestore: (entries) => {
      const form = own.current;
      if (!form || !isFormEntries(entries)) return;
      writeEntries(form, entries);
      refreshDirty();
    },
  });

  const discardDraft = (): void => {
    draft.discard();
    const form = own.current;
    if (form) writeEntries(form, pristineDraft.current);
    refreshDirty();
  };

  /** Something was typed, ticked or chosen: the draft is due, and that field's old error is answered. */
  const onEdit = (event: SyntheticEvent<HTMLFormElement>): void => {
    refreshDirty();
    draft.touch();
    const target = event.target;
    if (!(target instanceof HTMLElement) || !failure) return;
    const name = target.getAttribute('name');
    const remaining = failure.items.filter((item) => !((target.id && item.fieldId === target.id) || (name && item.name === name)));
    if (remaining.length === failure.items.length) return;
    setFailure(remaining.length === 0 && !failure.message ? null : { ...failure, items: remaining });
  };

  /** Shows a failed attempt: the summary (focused) and each message under its field. */
  const fail = (entries: readonly { readonly name: string; readonly message: string; readonly element: HTMLElement | null }[], message: string | undefined): void => {
    const items = entries
      .filter((entry) => typeof entry.message === 'string' && entry.message.trim() !== '')
      .map((entry) => ({ ...entry, fieldId: entry.element ? idFor(entry.element, formId, entry.name) : '' }));
    // A field with a problem inside a closed section is opened, so the
    // message under it can be seen and its summary link can reach it.
    for (const { element } of items) revealDetails(element);
    attempts.current += 1;
    setFailure({ attempt: attempts.current, items: inDocumentOrder(items), ...(message ? { message } : {}) });
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (busy.current) return;
    const form = event.currentTarget;

    const broken = constraintFailures(form);
    if (broken.length > 0) {
      fail(
        broken.map(({ element, message }, index) => ({ name: element.name || element.id || `field-${index + 1}`, message, element })),
        undefined,
      );
      return;
    }

    const submitter = (event.nativeEvent as SubmitEvent).submitter ?? null;
    let data: FormData;
    try {
      data = new FormData(form, submitter);
    } catch {
      // An engine without the submitter argument still sends the fields.
      data = new FormData(form);
    }

    busy.current = true;
    setSubmitting(true);
    let result: void | FormSubmitResult;
    try {
      result = await onSubmit(data);
    } catch {
      result = { message: FALLBACK_MESSAGE };
    }
    busy.current = false;
    const fieldErrors = Object.entries(result?.fieldErrors ?? {});
    const failed = fieldErrors.length > 0 || Boolean(result?.message);
    // Sent: the draft goes even if the form has gone too (the caller moved
    // on inside `onSubmit`), or a request already made would come back as a
    // draft the next time the form opens.
    if (!failed) draft.clear();
    if (!live.current) return;
    setSubmitting(false);

    if (failed) {
      fail(
        fieldErrors.map(([name, text]) => ({ name, message: text, element: controlFor(form, name) })),
        result?.message,
      );
      return;
    }
    setFailure(null);
    rememberPristine();
    setDirty(false);
  };

  useHotkey({
    keys: 'mod+s',
    description: 'Save',
    group: 'Forms',
    allowInFields: true,
    enabled: saveShortcut,
    handler: () => {
      const form = own.current;
      if (!form) return;
      // A dialog over the page has the person's attention; its own form, if
      // it has one, is the one to save.
      const active = form.ownerDocument.activeElement;
      const dialog = active?.closest('[role="dialog"], [role="alertdialog"]');
      if (dialog && !dialog.contains(form)) return;
      form.requestSubmit();
    },
  });

  const guard = useLeaveGuard(dirtyGuard && dirty && !submitting, Boolean(autosave));

  const errorsById = useMemo<Readonly<Record<string, string>>>(() => {
    const out: Record<string, string> = {};
    for (const item of failure?.items ?? []) if (item.fieldId) out[item.fieldId] = item.message;
    return out;
  }, [failure]);

  const errorsByName = useMemo<Readonly<Record<string, string>>>(() => {
    const out: Record<string, string> = {};
    for (const item of failure?.items ?? []) out[item.name] = item.message;
    return out;
  }, [failure]);

  const registerActions = useCallback(() => {
    setActionsCount((count) => count + 1);
    return () => setActionsCount((count) => count - 1);
  }, []);

  const context = useMemo<FormContextValue>(
    () => ({ submitting, dirty, stickyActions, autosave: Boolean(autosave), savedAt: draft.savedAt, registerActions }),
    [submitting, dirty, stickyActions, autosave, draft.savedAt, registerActions],
  );

  const state: FormState = { submitting, dirty, errors: errorsByName };

  return (
    <form
      {...aria}
      ref={mergedRef}
      id={id}
      className={cx('itsm-Form', className)}
      noValidate
      aria-busy={submitting || undefined}
      onSubmit={(event) => void handleSubmit(event)}
      // React's change event is every keystroke, tick and choice, bubbled.
      onChange={onEdit}
    >
      <FormContext value={context}>
        <FormFieldErrorsContext value={errorsById}>
          {failure ? (
            <FormErrorSummary
              errors={failure.items.map(({ fieldId, message }) => ({ fieldId, message }))}
              description={failure.message}
              focusKey={failure.attempt}
              {...(errorTitle ? { title: errorTitle } : {})}
            />
          ) : null}
          {autosave ? <DraftNotice notice={draft.notice} onDiscard={discardDraft} onDismiss={draft.dismissNotice} /> : null}
          {typeof children === 'function' ? children(state) : children}
          {autosave && actionsCount === 0 ? <DraftStatus savedAt={draft.savedAt} className="itsm-Form__status" /> : null}
        </FormFieldErrorsContext>
      </FormContext>
      {guard}
    </form>
  );
}

export interface FormActionsProps {
  /** The buttons, primary last: it sits at the end of the row, where the eye finishes. */
  readonly children: ReactNode;
  readonly className?: string;
}

/**
 * The row of buttons at the foot of a `Form`, with the draft's "Draft saved ·
 * 12:04" at its start when the form keeps one.
 *
 * With `Form stickyActions` it stays in view at the bottom while a long form
 * scrolls beneath it, above a docked tab bar and the home indicator; it grows
 * an opaque background and a hairline edge only while it is actually floating
 * over fields, so at the end of a short form it is just a row of buttons.
 */
export function FormActions({ children, className }: FormActionsProps): ReactNode {
  const form = useFormContext();
  const sticky = form?.stickyActions ?? false;
  const { sentinelRef, stuck } = useStuck(sticky);
  const register = form?.registerActions;

  useBrowserLayoutEffect(() => register?.(), [register]);

  return (
    <>
      <div className={cx('itsm-Form__actions', className)} data-sticky={sticky ? '' : undefined} data-stuck={stuck ? '' : undefined}>
        {form?.autosave ? <DraftStatus savedAt={form.savedAt} className="itsm-Form__status" /> : null}
        <div className="itsm-Form__buttons">{children}</div>
      </div>
      {sticky ? <div ref={sentinelRef} className="itsm-Form__sentinel" aria-hidden="true" /> : null}
    </>
  );
}

/**
 * The surrounding form's state — `submitting` for a submit button's spinner,
 * `dirty` for a "Save" that means something — for a component rendered
 * inside a `Form`. Outside one it reports an idle, clean form.
 */
export function useFormState(): Pick<FormState, 'submitting' | 'dirty'> {
  const form = useFormContext();
  return { submitting: form?.submitting ?? false, dirty: form?.dirty ?? false };
}
