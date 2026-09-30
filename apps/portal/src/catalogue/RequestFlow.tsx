'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { SubmitResult } from '@itsm/sdk';
import { Banner, Button, DraftNotice, DraftStatus, Icon, useDraft } from '@itsm/ui';
import { FormRenderer, submissionValues, withDefaults, type FormDefinition, type FormErrors, type FormValue, type FormValues, type UiElement, type UserOption } from '@itsm/ui/forms';
import { useFullScreenFlow } from '@itsm/ui/shell';
import { api } from '../client/api.js';
import { toastProblem, useAction } from '../client/useAction.js';

/**
 * Asking for something from the catalogue (SPEC §6.3 `/catalogue/[key]`,
 * §4.4, §6.4 "Request a service").
 *
 * The long form with its errors under the button becomes a short sequence:
 * the form's own sections are the steps ("Step 2 of 3 · Access details"),
 * each checked before the next with the contract's own validation, then a
 * review of every answer with an Edit per group, then one button that says
 * what it does ("Request System access"). All of that is `FormRenderer` in
 * steps mode; this component owns what is around it:
 *
 * - **A draft on this device** (`itsm-draft:form:<formKey>@<version>`),
 *   written every five seconds and when the page is hidden, restored with
 *   "Draft restored · Discard". A draft for another version of the form is
 *   thrown away, with a note: its questions may have changed meaning.
 * - **One idempotency key per intent.** Minted on the first press and sent
 *   again while the answers are the same — a retry after a lost reply is the
 *   same request, never a second one — and a new one once they change.
 *   Only the answers to questions the person can see are sent
 *   (`submissionValues`, the rule the API applies), in a fixed order, so the
 *   same answers are always the same body.
 * - **The outcome on this page** (F38): "Requested · REQ-000046", and when
 *   the request needs a decision first, "Sent for approval. Nothing starts
 *   until it's approved." Focus moves to it; Track it opens the request.
 * - **Offline**, sending waits ("Requests can't be sent offline…"), and the
 *   answers are written to the device at once.
 * - **A person question** offers the requester only ("You"): the directory
 *   is not theirs to search (PA5 is out of scope), and the question says so.
 */

export interface RequestFlowProps {
  readonly item: { readonly key: string; readonly name: string };
  /** The service it sits under, when the catalogue said. */
  readonly service: { readonly name: string; readonly key: string | null } | null;
  /** Null for an item that takes no answers: a request that is only a button. */
  readonly form: FormDefinition | null;
  readonly me: { readonly id: string | null; readonly name: string | null; readonly locale: string };
}

/* ------------------------------------------------------------------ Rules */

export const DRAFT_PREFIX = 'itsm-draft:form:';

/** Where a form's draft lives: one per form and version. */
export function draftKeyFor(form: Pick<FormDefinition, 'key' | 'version'>): string {
  return `${DRAFT_PREFIX}${form.key}@${form.version}`;
}

/** Drafts of this form written against another version of it, which cannot be poured into this one. */
export function staleDraftKeys(form: Pick<FormDefinition, 'key' | 'version'>, keys: readonly string[]): string[] {
  const prefix = `${DRAFT_PREFIX}${form.key}@`;
  const current = draftKeyFor(form);
  return keys.filter((key) => key.startsWith(prefix) && key !== current);
}

export const SELF_ONLY_HINT = 'You can only choose yourself here. Name anyone else in the details.';

/**
 * The form as a requester answers it. A person question can offer only the
 * requester — the portal cannot search the directory (PA5) — so it opens on
 * "You" without asking for letters first, and says why no one else is there.
 */
export function forRequester(definition: FormDefinition): FormDefinition {
  const adapt = (element: UiElement): UiElement => {
    if (element.kind === 'section') return { ...element, elements: element.elements.map(adapt) };
    if (element.kind === 'field' && element.control === 'user') {
      return { ...element, minQueryLength: 0, placeholder: 'Choose yourself', help: element.help ? `${element.help} ${SELF_ONLY_HINT}` : SELF_ONLY_HINT };
    }
    return element;
  };
  return { ...definition, ui: { ...definition.ui, elements: definition.ui.elements.map(adapt) } };
}

/** The answers to send: only questions the person can see, non-empty, in a fixed order (the API hashes the body with the key). */
export function answersToSend(definition: FormDefinition | null, values: FormValues): FormValues {
  if (!definition) return {};
  const visible = submissionValues(definition, values);
  const out: Record<string, FormValue> = {};
  for (const key of Object.keys(visible).sort()) out[key] = visible[key]!;
  return out;
}

function mintKey(): string {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `portal-request-${random}`;
}

/**
 * One idempotency key per intent: the same answers keep their key (a retry is
 * the same request); different answers are a new request with a new key.
 */
export function intentKeys(mint: () => string = mintKey): (answers: FormValues) => string {
  let last: { readonly body: string; readonly key: string } | null = null;
  return (answers) => {
    const body = JSON.stringify(answers);
    if (last?.body !== body) last = { body, key: mint() };
    return last.key;
  };
}

/** What the page says once the request is in. */
export function outcomeOf(result: Pick<SubmitResult, 'ticketNumber' | 'approvalId'>): { readonly title: string; readonly body: string } {
  return result.approvalId
    ? { title: `Requested · ${result.ticketNumber}`, body: 'Sent for approval. Nothing starts until it’s approved.' }
    : { title: `Requested · ${result.ticketNumber}`, body: 'We’ve got it. The team will pick it up from here.' };
}

export const OFFLINE_REASON = 'Requests can’t be sent offline. Your answers are saved on this device.';

const NO_ERRORS: FormErrors = Object.freeze({});

/* ------------------------------------------------------------ Local state */

function subscribeOnline(change: () => void): () => void {
  window.addEventListener('online', change);
  window.addEventListener('offline', change);
  return () => {
    window.removeEventListener('online', change);
    window.removeEventListener('offline', change);
  };
}

/** `navigator.onLine`, followed; true on the server. */
function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}

/** The keys in `localStorage`, or none where it cannot be read (a private window, blocked storage). */
function storedKeys(): string[] {
  try {
    const store = window.localStorage;
    return Array.from({ length: store.length }, (_, index) => store.key(index)).filter((key): key is string => key !== null);
  } catch {
    return [];
  }
}

function forget(keys: readonly string[]): void {
  for (const key of keys) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // A draft that cannot be removed cannot be read either.
    }
  }
}

/* -------------------------------------------------------------- Component */

export function RequestFlow({ item, service, form, me }: RequestFlowProps): ReactNode {
  const online = useOnline();
  const definition = useMemo(() => (form ? forRequester(form) : null), [form]);
  const initial = useMemo(() => (definition ? withDefaults(definition) : {}), [definition]);

  const [values, setValues] = useState<FormValues>(initial);
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS);
  const [done, setDone] = useState<SubmitResult | null>(null);
  const [gone, setGone] = useState(false);
  const [staleNote, setStaleNote] = useState(false);
  /** Bumped to start the form again from its first step (a discarded draft). */
  const [epoch, setEpoch] = useState(0);

  useFullScreenFlow(done === null);

  const draft = useDraft<FormValues>({
    key: form ? draftKeyFor(form) : null,
    version: form ? String(form.version) : undefined,
    value: values,
    onRestore: (restored) => {
      setValues({ ...initial, ...restored });
      setEpoch((count) => count + 1);
    },
  });

  // A draft written against another version of this form: dropped, and said so once.
  useEffect(() => {
    if (!form) return;
    const stale = staleDraftKeys(form, storedKeys());
    if (stale.length === 0) return;
    forget(stale);
    setStaleNote(true);
  }, [form]);

  // Gone offline: whatever is typed is written to the device now, as the page promises.
  useEffect(() => {
    if (!online) draft.flush();
  }, [online, draft]);

  /* ---- Sending ---- */

  const keyFor = useMemo(() => intentKeys(), []);
  const sending = useRef(false);
  const action = useAction((itemKey: string, answers: FormValues, idempotencyKey: string) => api.submitRequest(itemKey, answers, { idempotencyKey }), {
    refresh: false,
    toastErrors: false,
  });

  const sendRef = useRef<() => Promise<void>>(async () => undefined);
  const send = useCallback(async (): Promise<void> => {
    // One press is one call, however quickly it is repeated.
    if (sending.current) return;
    sending.current = true;
    setGone(false);
    setErrors(NO_ERRORS);
    const answers = answersToSend(definition, values);
    const key = keyFor(answers);
    draft.flush();
    const result = await action.run(item.key, answers, key);
    sending.current = false;
    if (result.ok) {
      draft.clear();
      setDone(result.value);
      return;
    }
    const { problem } = result;
    if (problem.status === 422) {
      setErrors(
        problem.fieldErrors && Object.keys(problem.fieldErrors).length > 0
          ? { ...problem.fieldErrors }
          : { _form: 'Something in this form needs another look, and we couldn’t tell which answer. Check them and send it again.' },
      );
    } else if (problem.status === 404) {
      setGone(true);
    } else if (problem.status !== 401) {
      // 401 is the frame's (it asks the person to sign in again; the draft is kept).
      // Try again sends what is in the form then: the same answers keep the same key.
      toastProblem(problem, () => void sendRef.current());
    }
  }, [action, definition, draft, item.key, keyFor, values]);
  sendRef.current = send;

  const loadSelf = useCallback(
    async (query: string): Promise<readonly UserOption[]> => {
      if (!me.id) return [];
      const words = query.trim().toLocaleLowerCase('en-GB');
      const matches = !words || 'you'.startsWith(words) || (me.name ?? '').toLocaleLowerCase('en-GB').includes(words);
      return matches ? [{ id: me.id, name: 'You', ...(me.name ? { detail: me.name } : {}) }] : [];
    },
    [me.id, me.name],
  );
  const selfLabels = useMemo<Readonly<Record<string, string>>>(() => (me.id ? { [me.id]: 'You' } : {}), [me.id]);

  const offlineReason = online ? undefined : OFFLINE_REASON;
  const submitLabel = `Request ${item.name}`;

  return (
    <div className="app-ServiceRequest__layout">
      <div className="app-ServiceRequest__main">
        {done ? (
          <Outcome result={done} />
        ) : (
          <>
            {gone ? (
              <Banner
                tone="danger"
                variant="subtle"
                title="This isn’t available to you any more"
                action={
                  <Button size="sm" variant="secondary" href="/catalogue">
                    Back to Services
                  </Button>
                }
              >
                It may have been withdrawn while you were filling it in. Your answers are kept on this device.
              </Banner>
            ) : null}
            <DraftNotice
              notice={draft.notice ?? (staleNote ? 'outdated' : null)}
              onDiscard={() => {
                draft.discard();
                setValues(initial);
                setErrors(NO_ERRORS);
                setEpoch((count) => count + 1);
              }}
              onDismiss={() => {
                draft.dismissNotice();
                setStaleNote(false);
              }}
            />
            <div className="app-ServiceRequest__card">
              {definition ? (
                <FormRenderer
                  key={epoch}
                  mode="steps"
                  headingLevel={2}
                  definition={definition}
                  values={values}
                  onChange={setValues}
                  errors={errors}
                  loadUsers={loadSelf}
                  userLabels={selfLabels}
                  locale={me.locale}
                  title={item.name}
                  submitLabel={submitLabel}
                  submitting={action.pending}
                  {...(offlineReason ? { submitDisabledReason: offlineReason } : {})}
                  onSubmit={() => void send()}
                />
              ) : (
                <section className="app-ServiceRequest__plain" aria-labelledby="request-plain-title">
                  <h2 id="request-plain-title" className="app-ServiceRequest__plainTitle">
                    Nothing to fill in
                  </h2>
                  <p className="app-ServiceRequest__quiet">Send it and we’ll take it from there.</p>
                  <Button variant="primary" loading={action.pending} {...(offlineReason ? { disabledReason: offlineReason } : {})} onClick={() => void send()}>
                    {submitLabel}
                  </Button>
                </section>
              )}
            </div>
          </>
        )}
      </div>

      <aside className="app-ServiceRequest__rail" aria-labelledby="request-rail-title">
        <div className="app-ServiceRequest__summary">
          <p className="app-ServiceRequest__railItem">{item.name}</p>
          {service ? <p className="app-ServiceRequest__railService">{service.name}</p> : null}
          <h2 id="request-rail-title" className="app-ServiceRequest__railTitle">
            What happens next
          </h2>
          <ol className="app-ServiceRequest__next">
            <li>{done ? 'Your request is in.' : 'You send your request.'}</li>
            <li>If it needs an approval, we ask for it first. Nothing starts until it’s given.</li>
            <li>The team picks it up. You can follow it, and reply, in My requests.</li>
          </ol>
          {done ? null : <DraftStatus savedAt={draft.savedAt} className="app-ServiceRequest__draft" />}
        </div>
      </aside>
    </div>
  );
}

/** "Requested · REQ-000046", with focus on it, and the two ways on. */
function Outcome({ result }: { readonly result: SubmitResult }): ReactNode {
  const heading = useRef<HTMLHeadingElement | null>(null);
  const copy = outcomeOf(result);

  useEffect(() => {
    heading.current?.focus();
  }, []);

  return (
    <section className="app-ServiceDone" aria-labelledby="request-done-title">
      <span className="app-ServiceDone__mark" data-tone={result.approvalId ? 'neutral' : 'success'} aria-hidden="true">
        <Icon name={result.approvalId ? 'approvals' : 'check'} size="lg" />
      </span>
      <h2 id="request-done-title" ref={heading} tabIndex={-1} className="app-ServiceDone__title">
        Requested · <span className="app-ServiceDone__number">{result.ticketNumber}</span>
      </h2>
      <p className="app-ServiceDone__body">{copy.body}</p>
      <div className="app-ServiceDone__actions">
        <Button variant="primary" href={`/tickets/${encodeURIComponent(result.ticketNumber)}`}>
          Track it
        </Button>
        <Button variant="secondary" href="/catalogue">
          Request something else
        </Button>
      </div>
    </section>
  );
}
