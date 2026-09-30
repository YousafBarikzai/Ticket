'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type FormEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { submitOrQueue, useOutbox, type OutboxItem } from '@itsm/pwa';
import { queueable } from '@itsm/sdk';
import {
  Button,
  DraftNotice,
  FileChip,
  FormField,
  Textarea,
  Timeline,
  announce,
  describeProblem,
  useDraft,
  type Problem,
  type TimelineEvent,
} from '@itsm/ui';
import { reportSessionEnded } from '../client/useAction.js';
import { OPEN_COMPOSER, useIntentKey } from './hooks.js';
import type { ConversationEntry } from './model.js';
import { sendMessage } from './resolution.js';
import { RetryBanner } from './RetryBanner.js';

/**
 * The conversation on a request (SPEC §6.3): what they told us first, then
 * every public message in time order under day headings — theirs as "You"
 * on the end side, ours as "Service desk" on the start side, never in blue
 * (X-73) — and the composer.
 *
 * The composer is "Add a message", ⌘↩ to send. It rests as a single line
 * when the card above already asks for something (Reply, Is it fixed?), and
 * opens when asked: Reply, `#reply` in the address, or a press on it. What
 * is typed is kept on this device every few seconds, so a lost session or a
 * closed tab does not lose it.
 *
 * Sending shows the message at once as "Sending…", then the page redraws
 * from the server with the real one. Offline — no answer at all — it goes
 * to the outbox with its key and stays in the conversation as "Will send
 * when you're back online", across reloads, until it has gone. A refusal
 * gives the words back with an accurate reason (a 422 is about the
 * message, not about the request having changed), and Send again carries the
 * same key, so a message the service did take is never posted twice.
 *
 * A reply from the desk that arrives while the page is open is said once,
 * politely: "New reply from the service desk".
 */

export interface ConversationAttachment {
  readonly id: string;
  readonly name: string;
  readonly size: number;
  readonly mime: string;
}

export interface ConversationProps {
  readonly number: string;
  readonly readerId: string | null;
  readonly entries: readonly ConversationEntry[];
  readonly attachments: readonly ConversationAttachment[];
  /** `collapsed` while the hero card asks for something; `hidden` on a finished request or without permission to write. */
  readonly composer: 'open' | 'collapsed' | 'hidden';
  /** Send is the page's primary action when the hero card has none. */
  readonly sendIsPrimary: boolean;
  /** The request is finished: say why there is no composer. */
  readonly finished: boolean;
  /** The timeline could not be read: say so, and offer Retry, rather than an empty conversation. */
  readonly unavailable: boolean;
}

interface Pending {
  readonly id: string;
  readonly body: string;
  readonly at: string;
  /** `sending` until the server answers; `sent` until the page has redrawn with the real message. */
  readonly state: 'sending' | 'sent';
}

const DESK = { name: 'Service desk', initials: 'SD' } as const;

function Words({ body }: { readonly body: string }): ReactNode {
  return <span className="app-Conversation__words">{body}</span>;
}

function eventOf(entry: ConversationEntry): TimelineEvent {
  return {
    id: entry.id,
    timestamp: entry.at,
    title: entry.mine ? 'You' : DESK.name,
    kind: entry.kind,
    mine: entry.mine,
    author: entry.mine ? 'requester' : 'agent',
    ...(entry.mine ? {} : { actor: DESK }),
    body: <Words body={entry.body} />,
  };
}

/** The outbox items that are messages on this request and have not gone yet. */
function waitingFor(items: readonly OutboxItem[], path: string): OutboxItem[] {
  return items.filter((item) => item.action === 'add-comment' && item.path === path && item.status !== 'sent');
}

function bodyOf(item: OutboxItem): string {
  const body = item.body as { body?: unknown } | null;
  return typeof body?.body === 'string' ? body.body : '';
}

/** What went wrong with a message, in a sentence that keeps their words. */
function messageFailure(problem: Problem): string {
  switch (problem.status) {
    case 401:
      return 'Your session ended. Your message is still here — sign in again, then send it.';
    case 403:
      return 'You can’t add messages to this request any more.';
    case 404:
      return 'This request isn’t available any more.';
    case 422:
      return problem.fieldErrors?.body ?? problem.detail ?? 'The service couldn’t take that message. Check it and try again.';
    default:
      return `${describeProblem(problem).title}. Your message is still here — try again.`;
  }
}

export function Conversation({ number, readerId, entries, attachments, composer, sendIsPrimary, finished, unavailable }: ConversationProps): ReactNode {
  const router = useRouter();
  const outbox = useOutbox();
  const [pending, setPending] = useState<readonly Pending[]>([]);
  const [refreshing, startRefresh] = useTransition();
  const path = `/api/proxy${queueable.comment(number, '').path}`;

  // A new reply from the desk is news; one of theirs, or the page's first draw, is not.
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    const ids = new Set(entries.map((entry) => entry.id));
    if (seen.current) {
      const fresh = entries.filter((entry) => !seen.current!.has(entry.id));
      if (fresh.some((entry) => !entry.mine)) announce('New reply from the service desk');
    }
    seen.current = ids;
  }, [entries]);

  // A sent message is shown by the server's copy once the page has redrawn.
  useEffect(() => {
    if (refreshing) return;
    setPending((current) => (current.some((message) => message.state === 'sent') ? current.filter((message) => message.state !== 'sent') : current));
  }, [refreshing, entries]);

  const events = useMemo<TimelineEvent[]>(() => {
    const shown = entries.map(eventOf);
    for (const message of pending) {
      shown.push({
        id: message.id,
        timestamp: message.at,
        title: 'You',
        kind: 'comment',
        mine: true,
        author: 'requester',
        body: <Words body={message.body} />,
        meta: message.state === 'sending' ? 'Sending…' : 'Sent',
      });
    }
    for (const item of waitingFor(outbox.items, path)) {
      const trouble = item.status === 'conflict' || item.status === 'failed';
      shown.push({
        id: `outbox-${item.id}`,
        timestamp: new Date(item.queuedAt).toISOString(),
        title: 'You',
        kind: 'comment',
        mine: true,
        author: 'requester',
        body: <Words body={bodyOf(item)} />,
        meta: trouble ? 'Didn’t send — see the connection status at the top of the page' : 'Will send when you’re back online',
      });
    }
    return shown;
  }, [entries, pending, outbox.items, path]);

  /** A message has an answer: sent (redraw, and the server's copy replaces it), queued (the outbox shows it) or refused. */
  const settled = useCallback(
    (id: string, outcome: 'sent' | 'queued' | 'failed') => {
      if (outcome === 'sent') {
        setPending((current) => current.map((message) => (message.id === id ? { ...message, state: 'sent' } : message)));
        startRefresh(() => router.refresh());
        return;
      }
      setPending((current) => current.filter((message) => message.id !== id));
      if (outcome === 'queued') void outbox.refresh();
    },
    [outbox, router],
  );

  return (
    <section className="app-Conversation" aria-labelledby="conversation-title">
      <h2 id="conversation-title" className="app-Request__sectionTitle">
        Conversation
      </h2>
      {unavailable ? (
        <RetryBanner what="the conversation" />
      ) : (
        <Timeline
          className="app-Conversation__timeline"
          label="Conversation"
          variant="conversation"
          perspective="requester"
          groupBy="day"
          order="oldest"
          events={events}
          emptyMessage="No messages yet. We’ll tell you here when there’s news."
        />
      )}
      {attachments.length > 0 ? (
        <div className="app-Conversation__files">
          <h3 className="app-Conversation__filesTitle">Files</h3>
          <ul className="app-Conversation__fileList">
            {attachments.map((file) => (
              <li key={file.id}>
                <FileChip name={file.name} size={file.size} mime={file.mime} state="unavailable" />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {composer === 'hidden' ? (
        finished ? (
          <p className="app-Conversation__closed">This request is finished, so a message here won’t reach anyone. If it’s happening again, report it again.</p>
        ) : null
      ) : (
        <Composer number={number} readerId={readerId} resting={composer} sendIsPrimary={sendIsPrimary} onSending={setPending} onSettled={settled} />
      )}
    </section>
  );
}

/* ------------------------------------------------------------ The composer */

interface ComposerProps {
  readonly number: string;
  readonly readerId: string | null;
  readonly resting: 'open' | 'collapsed';
  readonly sendIsPrimary: boolean;
  readonly onSending: (update: (current: readonly Pending[]) => readonly Pending[]) => void;
  readonly onSettled: (id: string, outcome: 'sent' | 'queued' | 'failed') => void;
}

function Composer({ number, readerId, resting, sendIsPrimary, onSending, onSettled }: ComposerProps): ReactNode {
  const [open, setOpen] = useState(resting === 'open');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [queuedNote, setQueuedNote] = useState(false);
  const [sending, setSending] = useState(false);
  const busy = useRef(false);
  const field = useRef<HTMLTextAreaElement | null>(null);
  const root = useRef<HTMLDivElement | null>(null);
  const focusOnOpen = useRef(false);
  const { keyFor, settle } = useIntentKey();

  const draft = useDraft<string>({
    key: readerId ? `itsm-draft:reply:${readerId}:${number}` : null,
    value: text,
    isEmpty: (value) => value.trim() === '',
    onRestore: (value) => {
      setText(value);
      setOpen(true);
    },
  });

  const expand = useCallback(() => {
    focusOnOpen.current = true;
    setOpen(true);
    // Already open: focus now.
    if (field.current) {
      focusOnOpen.current = false;
      field.current.focus();
      root.current?.scrollIntoView?.({ block: 'nearest' });
    }
  }, []);

  useEffect(() => {
    if (!open || !focusOnOpen.current) return;
    focusOnOpen.current = false;
    field.current?.focus();
    root.current?.scrollIntoView?.({ block: 'nearest' });
  }, [open]);

  // Reply in the card above, or a link that ends in `#reply` (Home's Reply).
  useEffect(() => {
    const onAsk = (): void => expand();
    window.addEventListener(OPEN_COMPOSER, onAsk);
    if (window.location.hash === '#reply') expand();
    const onHash = (): void => {
      if (window.location.hash === '#reply') expand();
    };
    window.addEventListener('hashchange', onHash);
    return () => {
      window.removeEventListener(OPEN_COMPOSER, onAsk);
      window.removeEventListener('hashchange', onHash);
    };
  }, [expand]);

  const send = async (event?: FormEvent): Promise<void> => {
    event?.preventDefault();
    if (busy.current) return;
    const body = text.trim();
    if (!body) {
      setError('Write a message first.');
      field.current?.focus();
      return;
    }
    busy.current = true;
    setSending(true);
    setError(null);
    setQueuedNote(false);
    const id = `sending-${Date.now()}`;
    onSending((current) => [...current, { id, body, at: new Date().toISOString(), state: 'sending' }]);
    setText('');
    try {
      const result = await sendMessage(submitOrQueue, number, body, keyFor(body));
      if (result.ok) {
        settle();
        draft.clear();
        onSettled(id, result.queued ? 'queued' : 'sent');
        if (result.queued) {
          setQueuedNote(true);
          announce('Saved on this device. It will send when you’re back online.');
        } else {
          announce('Message sent');
        }
        return;
      }
      onSettled(id, 'failed');
      setText(body);
      if (result.problem.status === 401) {
        draft.flush();
        reportSessionEnded('action');
      }
      setError(messageFailure(result.problem));
      field.current?.focus();
    } finally {
      busy.current = false;
      setSending(false);
    }
  };

  return (
    <div ref={root} id="reply" className="app-Composer" data-open={open ? '' : undefined}>
      {open ? (
        <form className="app-Composer__form" noValidate onSubmit={send}>
          <DraftNotice
            notice={draft.notice}
            onDiscard={() => {
              draft.discard();
              setText('');
            }}
            onDismiss={draft.dismissNotice}
          />
          <FormField label="Add a message" error={error ?? undefined}>
            {(control) => (
              <Textarea
                {...control}
                ref={field}
                autoGrow
                rows={3}
                value={text}
                placeholder="Write to the service desk…"
                submitShortcut="mod+enter"
                submitHint="to send"
                onChange={(change) => {
                  setText(change.target.value);
                  if (error) setError(null);
                }}
              />
            )}
          </FormField>
          <div className="app-Composer__actions">
            {queuedNote ? (
              <p className="app-Composer__note" role="status">
                Saved on this device. It will send when you’re back online.
              </p>
            ) : null}
            <Button type="submit" variant={sendIsPrimary ? 'primary' : 'tinted'} iconStart="send" loading={sending} loadingLabel="Sending">
              Send
            </Button>
          </div>
        </form>
      ) : (
        <button type="button" className="app-Composer__rest" onClick={expand}>
          <span className="app-Composer__restLabel">Add a message…</span>
        </button>
      )}
    </div>
  );
}
