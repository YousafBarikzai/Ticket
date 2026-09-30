'use client';

import {
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  type FocusEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from 'react';
import { ApiError, type Ticket } from '@itsm/sdk';
import { announce, Badge, Button, Icon, Kbd, SegmentedControl, Textarea, cx, notify } from '@itsm/ui';
import { SplitButton, type MenuItemSpec } from '@itsm/ui/overlays';
import { api } from '../client/api.js';
import { newIdempotencyKey, sendComment } from '../client/outbox.js';
import { replyChannelLine } from '../inbox/presentation.js';
import { INBOX_REGIONS } from '../inbox/views.js';
import { transitionsFrom } from '../queue/transitions.js';

/**
 * Replying on a ticket (SPEC §6.2, F20).
 *
 * **Reply or internal note is the load-bearing choice on this screen.** An
 * internal note sent to a requester by accident is the mistake that costs a
 * service desk a customer, so it is stated three times over: the mode
 * control says which it is, the label, placeholder and Send button say what
 * will happen ("Reply to requester" versus "Add internal note"), and the
 * composer is tinted with a lock when it is internal. None of those alone is
 * enough — an agent typing at speed reads the button, a screen-reader user
 * hears the mode, and a person glancing back at a half-written draft sees
 * the tint.
 *
 * **Nothing a person writes is lost.** Text is kept per ticket and per mode
 * on this device (`itsm-wb-draft:<id>`, a second after the last key and at
 * once when the ticket is left, so `j`/`k` through the list never drops a
 * sentence), restored with "Draft restored", and cleared only once the
 * service — or the outbox — has it. A refusal keeps the text and says so.
 *
 * **One press, the whole intent.** Send's menu offers "Reply and resolve"
 * and its neighbours: the comment goes first (with one idempotency key per
 * intent, reused on a retry of the same text), then the status change. A
 * conflict on the change never sends the comment twice — the workspace
 * offers "Retry status change" alone.
 *
 * **Offline, it still sends.** The outbox holds the comment and sends it
 * when the connection is back; the conversation shows it as "Queued".
 * Status changes are refused offline (they depend on the ticket's state, so
 * replaying them later could be wrong).
 */

export type ComposerMode = 'reply' | 'note';

export interface ComposerHandle {
  /** Opens the composer in a mode, caret in the box (`r`, `n`, Reply/Note elsewhere). */
  open(mode?: ComposerMode): void;
  /** Adds text to a mode's box without losing what is there (an AI draft, an article link). */
  insert(text: string, options?: { readonly mode?: ComposerMode; readonly suggestionId?: string }): void;
  /** What a mode's box holds now: Resolve… starts from the reply. */
  text(mode?: ComposerMode): string;
  /** Empties a mode's box (its text was sent some other way, e.g. by Resolve…). */
  clear(mode: ComposerMode): void;
  /** Opens Send's menu (`mod+shift+Enter`). */
  openSendOptions(): void;
}

export interface ComposerProps {
  readonly ticket: Pick<Ticket, 'id' | 'number' | 'status' | 'sourceChannel'>;
  /** The requester's name, for "Reply to Ada…". */
  readonly requesterName?: string | null;
  /** May reply publicly (`ticket.comment.public`). */
  readonly canReply?: boolean;
  /** May add internal notes on this ticket: the mode is absent without it. */
  readonly canNote?: boolean;
  /** May move the ticket: Send's menu offers "Reply and resolve" and the rest only then. */
  readonly canMove?: boolean;
  /** False while the browser is offline: the comment still queues; status changes are refused. */
  readonly online?: boolean;
  /** A state gate for the whole composer ("You no longer have access to this ticket"). */
  readonly disabledReason?: string;
  /** The comment reached the service. */
  readonly onSent?: (sent: { readonly internal: boolean }) => void;
  /** The comment went into the outbox: the conversation shows it as queued. */
  readonly onQueued?: (queued: { readonly internal: boolean; readonly body: string }) => void;
  /** The status change after a comment; resolves `false` when it did not happen (the workspace explains why). */
  readonly onMove?: (to: string, options: { readonly reason?: string }) => Promise<boolean>;
  /** A write came back 401. */
  readonly onSessionEnded?: () => void;
  /** Told whenever a box's text changes: the workspace holds live updates back while someone is writing. */
  readonly onTextChange?: (mode: ComposerMode, text: string) => void;
  readonly handle?: Ref<ComposerHandle>;
}

/* ------------------------------------------------------------- Drafts */

export const DRAFT_PREFIX = 'itsm-wb-draft:';
/** How long after the last key a draft is written (SPEC §6.2). */
export const DRAFT_DEBOUNCE_MS = 1000;

export function draftKey(ticketId: string): string {
  return `${DRAFT_PREFIX}${ticketId}`;
}

export interface StoredDraft {
  readonly reply: string;
  readonly note: string;
  readonly mode: ComposerMode;
}

export function readDraft(ticketId: string): StoredDraft | null {
  try {
    const raw = window.localStorage.getItem(draftKey(ticketId));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<StoredDraft> | null;
    if (!value || typeof value !== 'object') return null;
    const reply = typeof value.reply === 'string' ? value.reply : '';
    const note = typeof value.note === 'string' ? value.note : '';
    if (!reply && !note) return null;
    return { reply, note, mode: value.mode === 'note' ? 'note' : 'reply' };
  } catch {
    return null;
  }
}

export function writeDraft(ticketId: string, draft: StoredDraft): void {
  try {
    if (!draft.reply.trim() && !draft.note.trim()) window.localStorage.removeItem(draftKey(ticketId));
    else window.localStorage.setItem(draftKey(ticketId), JSON.stringify(draft));
  } catch {
    // Private browsing, a full disk: the text is still on screen; only the copy is lost.
  }
}

/* ----------------------------------------------------------- Sending */

interface SendOption {
  readonly id: string;
  readonly label: string;
  readonly to?: string;
}

/**
 * What Send's menu offers from this state, in this mode: only moves the
 * state machine allows, so the menu never promises what the service
 * refuses. "Reply and keep open" resumes a waiting ticket (a reply is the
 * agent's move, so it is no longer waiting on them).
 */
export function sendOptions(mode: ComposerMode, status: string): readonly SendOption[] {
  const allowed = new Set(transitionsFrom(status));
  if (mode === 'note') {
    return allowed.has('pending_third_party') && status !== 'pending_third_party'
      ? [{ id: 'note-wait-supplier', label: 'Note and wait on supplier', to: 'pending_third_party' }]
      : [];
  }
  const options: SendOption[] = [];
  if (allowed.has('pending_requester') && status !== 'pending_requester') {
    options.push({ id: 'reply-wait', label: 'Reply and wait for requester', to: 'pending_requester' });
  }
  if (allowed.has('resolved')) options.push({ id: 'reply-resolve', label: 'Reply and resolve', to: 'resolved' });
  if (status.startsWith('pending_') && allowed.has('in_progress')) {
    options.push({ id: 'reply-open', label: 'Reply and keep open', to: 'in_progress' });
  }
  return options;
}

/** Why a comment did not send, with the promise that matters: the text is still here. */
export function sendFailure(failure: unknown, internal: boolean): string {
  const what = internal ? 'an internal note' : 'a reply';
  if (failure instanceof ApiError) {
    switch (failure.status) {
      case 401:
        return 'Your session ended. Your text is still here — sign in again to send it.';
      case 403:
        return `You can’t add ${what} on this ticket. Your text is still here.`;
      case 404:
        return 'This ticket no longer exists, or it’s outside your teams. Your text is still here.';
      case 422:
        return `${failure.problem?.detail ?? 'The service refused it.'} Your text is still here.`;
      case 429:
        return 'Too many messages at once. Your text is still here — try again in a moment.';
      default:
        break;
    }
  }
  return 'That didn’t send. Your text is still here — try again.';
}

function firstName(name: string | null | undefined): string | null {
  const trimmed = name?.trim();
  if (!trimmed || trimmed.startsWith('Unknown person')) return null;
  return trimmed.split(/\s+/)[0] ?? null;
}

/* ------------------------------------------------------------ The form */

export function Composer({
  ticket,
  requesterName,
  canReply = true,
  canNote = true,
  canMove = false,
  online = true,
  disabledReason,
  onSent,
  onQueued,
  onMove,
  onSessionEnded,
  onTextChange,
  handle,
}: ComposerProps): ReactNode {
  const fieldId = useId();
  const [mode, setMode] = useState<ComposerMode>(canReply ? 'reply' : 'note');
  const [texts, setTexts] = useState<Record<ComposerMode, string>>({ reply: '', note: '' });
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const rootRef = useRef<HTMLElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  /** The last attempt, so a retry of the same text carries the same idempotency key. */
  const intent = useRef<{ key: string; body: string; internal: boolean } | null>(null);
  /** Text an AI draft put in, for recording what became of it at send. */
  const inserted = useRef<{ suggestionId: string; text: string } | null>(null);
  /** Nothing is written back before the stored draft has been read. */
  const loaded = useRef(false);
  const latest = useRef({ texts, mode });
  latest.current = { texts, mode };

  const effectiveMode: ComposerMode = mode === 'note' && !canNote ? 'reply' : mode === 'reply' && !canReply ? 'note' : mode;
  const internal = effectiveMode === 'note';
  const text = texts[effectiveMode];
  const blocked = disabledReason !== undefined || (!canReply && !canNote);

  /* The stored draft: read once, written a second after the last change and at once on the way out. */
  useEffect(() => {
    const draft = readDraft(ticket.id);
    loaded.current = true;
    if (!draft) return;
    setTexts({ reply: canReply ? draft.reply : '', note: canNote ? draft.note : '' });
    const restoredMode = draft.mode === 'note' && canNote ? 'note' : canReply ? 'reply' : 'note';
    setMode(restoredMode);
    if ((restoredMode === 'note' ? draft.note : draft.reply).trim()) {
      setRestored(true);
      setExpanded(true);
    }
    // Once per ticket: the rights do not change the stored text.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticket.id]);

  useEffect(() => {
    if (!loaded.current) return;
    const timer = setTimeout(() => writeDraft(ticket.id, { ...texts, mode }), DRAFT_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [texts, mode, ticket.id]);

  useEffect(
    () => () => {
      if (loaded.current) writeDraft(ticket.id, { ...latest.current.texts, mode: latest.current.mode });
    },
    [ticket.id],
  );

  const setText = useCallback(
    (which: ComposerMode, value: string) => {
      setTexts((current) => (current[which] === value ? current : { ...current, [which]: value }));
      onTextChange?.(which, value);
    },
    [onTextChange],
  );

  const focusField = useCallback(() => {
    requestAnimationFrame(() => {
      const field = textareaRef.current;
      if (!field) return;
      field.focus();
      const end = field.value.length;
      field.setSelectionRange?.(end, end);
    });
  }, []);

  useImperativeHandle(
    handle,
    (): ComposerHandle => ({
      open(next) {
        if (next === 'note' && canNote) setMode('note');
        else if (next === 'reply' && canReply) setMode('reply');
        setExpanded(true);
        focusField();
      },
      insert(value, options = {}) {
        const target = options.mode ?? (canReply ? 'reply' : 'note');
        const now = latest.current.texts[target];
        const next = now.trim() ? `${now.trimEnd()}\n\n${value}` : value;
        setText(target, next);
        setMode(target);
        setExpanded(true);
        if (options.suggestionId) inserted.current = { suggestionId: options.suggestionId, text: value.trim() };
        focusField();
      },
      text(which) {
        return latest.current.texts[which ?? latest.current.mode];
      },
      clear(which) {
        setText(which, '');
        writeDraft(ticket.id, { ...latest.current.texts, [which]: '', mode: latest.current.mode });
      },
      openSendOptions() {
        setExpanded(true);
        const now = latest.current;
        if (now.texts[now.mode].trim()) setMenuOpen(true);
      },
    }),
    [canNote, canReply, focusField, setText, ticket.id],
  );

  /** What became of an AI draft, told once, when it was sent (or thrown away). */
  const recordOutcome = (sentBody: string | null): void => {
    const draft = inserted.current;
    if (!draft) return;
    inserted.current = null;
    const outcome = sentBody === null ? 'rejected' : sentBody.includes(draft.text) ? 'accepted' : 'edited';
    void api.decideSuggestion(draft.suggestionId, outcome).catch(() => undefined);
  };

  async function send(then?: string): Promise<void> {
    const body = text.trim();
    if (!body || busy || blocked) return;
    const same = intent.current && intent.current.body === body && intent.current.internal === internal;
    const key = same ? intent.current!.key : newIdempotencyKey();
    setBusy(true);
    setError(null);
    try {
      const result = await sendComment({ ticket: ticket.number, body, internal, idempotencyKey: key });
      intent.current = null;
      setText(effectiveMode, '');
      writeDraft(ticket.id, { ...latest.current.texts, [effectiveMode]: '', mode: latest.current.mode });
      setRestored(false);
      recordOutcome(body);
      if (result.status === 'queued') {
        onQueued?.({ internal, body });
        notify('Queued · sends when you’re back online', {
          tone: 'info',
          ...(then ? { description: 'The status wasn’t changed: that needs a connection.' } : {}),
        });
        return;
      }
      onSent?.({ internal });
      announce(internal ? 'Internal note added' : 'Reply sent');
      if (then && onMove) await onMove(then, then === 'resolved' ? { reason: body } : {});
    } catch (failure) {
      intent.current = { key, body, internal };
      if (failure instanceof ApiError && failure.status === 401) onSessionEnded?.();
      setError(sendFailure(failure, internal));
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(event: FormEvent): void {
    event.preventDefault();
    void send();
  }

  /** Collapses back to one line when focus leaves an empty composer. */
  function onBlur(event: FocusEvent<HTMLElement>): void {
    const next = event.relatedTarget as Node | null;
    if (next && event.currentTarget.contains(next)) return;
    if (menuOpen) return;
    if (!latest.current.texts.reply.trim() && !latest.current.texts.note.trim() && !error) setExpanded(false);
  }

  function onFieldKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    const mod = event.metaKey || event.ctrlKey;
    if (event.key !== 'Enter' || !mod || event.altKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    // mod+Enter sends; mod+shift+Enter opens Send's menu (SPEC §5.6).
    if (event.shiftKey) {
      if (options.length > 0 && !empty) setMenuOpen(true);
      return;
    }
    event.currentTarget.form?.requestSubmit();
  }

  const discardDraft = (): void => {
    setTexts({ reply: '', note: '' });
    writeDraft(ticket.id, { reply: '', note: '', mode });
    setRestored(false);
    recordOutcome(null);
    onTextChange?.('reply', '');
    onTextChange?.('note', '');
    focusField();
  };

  const who = firstName(requesterName);
  const label = internal ? 'Internal note' : 'Reply to the requester';
  // At rest the line says who a reply goes to; open, it also says who will read it.
  const opener = internal ? 'Add an internal note…' : who ? `Reply to ${who}…` : 'Write a reply…';
  const placeholder = expanded ? `${opener} ${internal ? 'Only agents will see this.' : 'The requester will receive this.'}` : opener;
  const sendLabel = internal ? 'Add internal note' : 'Reply to requester';
  const options = canMove ? sendOptions(effectiveMode, ticket.status) : [];
  const moveGate = online ? undefined : 'Needs a connection';
  const empty = text.trim().length === 0;

  const items: MenuItemSpec[] = options.map((option) => ({
    id: option.id,
    label: option.label,
    ...(moveGate ? { disabled: true, disabledReason: moveGate } : {}),
    onSelect: () => void send(option.to),
  }));

  const modes = [
    ...(canReply ? [{ value: 'reply', label: 'Reply', icon: 'reply' as const }] : []),
    ...(canNote ? [{ value: 'note', label: 'Internal note', icon: 'lock' as const }] : []),
  ];

  return (
    <section
      ref={rootRef}
      id={INBOX_REGIONS.reply}
      className="app-Composer"
      aria-label={internal ? 'Internal note' : 'Reply'}
      tabIndex={-1}
      data-internal={internal ? '' : undefined}
      data-expanded={expanded ? '' : undefined}
      onFocus={(event) => {
        // The skip link lands on the section; the person wants the box.
        if (event.target === event.currentTarget) focusField();
      }}
    >
      <form className="app-Composer__form" onSubmit={onSubmit} onBlur={onBlur} data-internal={internal ? 'true' : 'false'} aria-busy={busy || undefined}>
        <div className="app-Composer__top">
          {modes.length > 1 ? (
            <SegmentedControl
              label="Message type"
              mode="value"
              size="sm"
              options={modes}
              value={effectiveMode}
              onValueChange={(value) => {
                setMode(value as ComposerMode);
                setError(null);
                setExpanded(true);
              }}
            />
          ) : null}
          <p className="app-Composer__channel">
            {internal ? (
              <>
                <Icon name="lock" size="xs" />
                Only agents will see this.
              </>
            ) : (
              <>
                <Icon name={ticket.sourceChannel === 'email' ? 'mail' : 'globe'} size="xs" />
                {replyChannelLine(ticket.sourceChannel)}
              </>
            )}
          </p>
        </div>

        <label className="app-Composer__label" htmlFor={fieldId}>
          {label}
        </label>

        <div className="app-Composer__line">
          {internal && !expanded ? (
            <Badge tone="warning" icon="lock" size="sm" className="app-Composer__mode">
              Note
            </Badge>
          ) : null}
          <Textarea
            ref={textareaRef}
            id={fieldId}
            className="app-Composer__field"
            autoGrow
            rows={expanded ? 3 : 1}
            maxRows={16}
            value={text}
            disabled={blocked}
            onChange={(event) => {
              setText(effectiveMode, event.target.value);
              if (error) setError(null);
            }}
            onFocus={() => setExpanded(true)}
            onKeyDown={onFieldKeyDown}
            placeholder={placeholder}
            aria-keyshortcuts="Meta+Enter Control+Enter"
            aria-describedby={cx(error ? `${fieldId}-error` : undefined, blocked && disabledReason ? `${fieldId}-gate` : undefined) || undefined}
          />
        </div>

        {restored && !empty ? (
          <p className="app-Composer__restored">
            <Icon name="history" size="xs" />
            Draft restored
            <Button variant="ghost" size="sm" onClick={discardDraft}>
              Discard
            </Button>
          </p>
        ) : null}
        {!online ? (
          <p className="app-Composer__hint">
            <Icon name="wifi-off" size="xs" />
            You’re offline. {internal ? 'Notes' : 'Replies'} are queued and sent when you’re back; status changes need a connection.
          </p>
        ) : null}
        {blocked && disabledReason ? (
          <p className="app-Composer__hint" id={`${fieldId}-gate`}>
            {disabledReason}
          </p>
        ) : null}
        {error ? (
          <p className="app-Composer__error" id={`${fieldId}-error`} role="alert">
            <Icon name="circle-alert" size="xs" />
            {error}
          </p>
        ) : null}

        {expanded ? (
          <div className="app-Composer__bar">
            <span className="app-Composer__keys" aria-hidden="true">
              <Kbd keys="mod+enter" size="sm" /> to send
            </span>
            {options.length > 0 ? (
              <SplitButton
                type="submit"
                variant="primary"
                size="md"
                className="app-Composer__send"
                primary={{ id: 'send', label: sendLabel, disabled: empty || blocked }}
                items={items}
                loading={busy}
                loadingLabel="Sending…"
                menuDisabled={empty || blocked}
                menuOpen={menuOpen}
                onMenuOpenChange={setMenuOpen}
              />
            ) : (
              <Button type="submit" variant="primary" className="app-Composer__send" loading={busy} loadingLabel="Sending…" disabled={empty || blocked}>
                {sendLabel}
              </Button>
            )}
          </div>
        ) : null}
      </form>
    </section>
  );
}
