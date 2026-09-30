'use client';

import { useId, useMemo, useState, type ReactNode, type Ref } from 'react';
import type { Ticket, TimelineAttachment, TimelineEventEntry } from '@itsm/sdk';
import {
  Avatar,
  Badge,
  Button,
  Icon,
  RelativeTime,
  SegmentedControl,
  Timeline,
  channelInfo,
  type FileChipProps,
  type TimelineActor,
  type TimelineEvent,
  type TimelineFilter,
} from '@itsm/ui';
import type { TicketBundle } from '../client/desk-ticket.js';
import { eventType } from '../client/mutations.js';
import { describeEvent, personName, type PeopleMap } from '../inbox/presentation.js';
import { INBOX_REGIONS } from '../inbox/views.js';

/**
 * The conversation (SPEC §6.2, F22): the original request first, then what
 * was said and what happened, oldest to newest, like a thread in Messages.
 *
 * Whose words are whose is never left to colour alone: the requester's
 * messages sit on the start side on the raised surface, the desk's public
 * replies on the end side on the sunken one, and internal notes carry the
 * word "Internal note", a lock and the warning tint — three signals, so an
 * agent never mistakes a note for something the requester has read.
 *
 * Changes to the ticket read as sentences ("Jo moved it from New to In
 * progress", the reason quoted) between the messages, and a burst of
 * automatic ones by one actor folds into "3 updates by Jo". Days have their
 * headings, "New since your last visit" marks where the reader left off,
 * and a long history shows its latest part with the rest one press away.
 */

/* ------------------------------------------------------------ The model */

/** Channels worth naming on a message: how it arrived. An agent's reply from the desk (`api`) says nothing. */
const QUIET_CHANNELS = new Set(['api', 'system', '']);

/** Channels a requester writes from when the message has no author (an e-mail from an unknown address). */
const INBOUND_CHANNELS = new Set(['email', 'portal', 'slack', 'teams', 'whatsapp', 'voice', 'phone', 'mobile']);

function eventActor(entry: TimelineEventEntry, people: PeopleMap, me: string | null): TimelineActor {
  if (entry.actorType === 'ai') return { name: 'AI triage', kind: 'ai' };
  if (entry.actorType === 'workflow' || entry.actorType === 'rule') return { name: 'An automation', kind: 'system' };
  if (!entry.actorId || entry.actorType === 'system' || entry.actorType === 'service') return { name: 'The system', kind: 'system' };
  const id = entry.actorId.toLowerCase();
  const person = people[id];
  return { name: personName(id, people, me), kind: 'person', ...(person ? { initials: person.initials } : {}) };
}

/** An event with the catalogue's type spelling and lower-case ids, as `describeEvent` reads it. */
function normalised(entry: TimelineEventEntry): TimelineEventEntry {
  const payload = { ...(entry.payload ?? {}) };
  if (typeof payload.assigneeId === 'string') payload.assigneeId = payload.assigneeId.toLowerCase();
  return { ...entry, type: eventType(entry.type), actorId: entry.actorId?.toLowerCase() ?? null, payload };
}

function Message({ text }: { readonly text: string }): ReactNode {
  return <p className="app-Message">{text}</p>;
}

function fileChip(attachment: TimelineAttachment): FileChipProps {
  // Files cannot be opened until attachments can be downloaded (AT1): the
  // chip says so rather than being a link to nothing.
  return { name: attachment.filename, size: attachment.size, mime: attachment.mime, state: 'unavailable' };
}

/** Files land on the message they came with: the nearest comment within two minutes. */
const ATTACH_WITHIN_MS = 2 * 60_000;

export interface ConversationModel {
  readonly events: readonly TimelineEvent[];
  /** Ids of messages written by someone other than the reader, in order: for "Ada replied" and "new since". */
  readonly othersMessages: readonly { readonly id: string; readonly at: string; readonly name: string; readonly internal: boolean }[];
}

/**
 * The history as the conversation shows it. Pure, so what a ticket's
 * history reads like is tested with a list of entries, not a page.
 */
export function conversationModel(
  bundle: Pick<TicketBundle, 'ticket' | 'entries' | 'attachments' | 'people'>,
  me: string | null,
): ConversationModel {
  const { ticket, entries, attachments, people } = bundle;
  const requester = ticket.requesterId?.toLowerCase() ?? null;
  const events: TimelineEvent[] = [];
  const othersMessages: { id: string; at: string; name: string; internal: boolean }[] = [];
  const comments: { index: number; at: number }[] = [];

  for (const entry of entries) {
    if (entry.kind === 'comment') {
      const author = entry.authorId?.toLowerCase() ?? null;
      const mine = author !== null && author === me;
      const internal = entry.visibility === 'internal';
      const fromRequester = author !== null ? author === requester && !internal : !internal && INBOUND_CHANNELS.has(entry.channel);
      const name = mine ? 'You' : author ? personName(author, people, me) : fromRequester && requester ? personName(requester, people, me) : 'Someone';
      const person = author ? people[author] : undefined;
      comments.push({ index: events.length, at: Date.parse(entry.at) });
      events.push({
        id: entry.id,
        kind: 'comment',
        timestamp: entry.at,
        title: internal ? 'Internal note' : fromRequester ? 'Message' : 'Reply',
        actor: { name, kind: 'person', ...(person ? { initials: person.initials } : {}) },
        mine,
        author: fromRequester ? 'requester' : 'agent',
        visibility: entry.visibility,
        ...(QUIET_CHANNELS.has(entry.channel) ? {} : { channel: entry.channel }),
        body: <Message text={entry.body} />,
      });
      if (!mine) othersMessages.push({ id: entry.id, at: entry.at, name, internal });
      continue;
    }
    if (entry.kind === 'task') {
      const done = entry.status === 'done' || entry.status === 'completed';
      events.push({
        id: entry.id,
        kind: 'task',
        timestamp: entry.at,
        title: `Task: ${entry.title}`,
        body: done ? 'Done' : undefined,
        tone: done ? 'success' : undefined,
      });
      continue;
    }
    const event = normalised(entry);
    const line = describeEvent(event, people, me);
    if (!line) continue;
    const actor = eventActor(event, people, me);
    const prefix = `${actor.name} `;
    const title = line.text.startsWith(prefix) ? line.text.slice(prefix.length) : line.text;
    events.push({
      id: entry.id,
      kind: 'event',
      timestamp: entry.at,
      ...(line.text.startsWith(prefix) ? { actor } : {}),
      title,
      ...(line.detail ? { body: line.detail } : {}),
    });
  }

  // Attachments: onto the nearest comment in time, or a line of their own.
  const loose: TimelineAttachment[] = [];
  const onto = new Map<number, FileChipProps[]>();
  for (const attachment of attachments) {
    const at = Date.parse(attachment.createdAt);
    let best: { index: number; gap: number } | null = null;
    for (const comment of comments) {
      const gap = Math.abs(comment.at - at);
      if (gap <= ATTACH_WITHIN_MS && (!best || gap < best.gap)) best = { index: comment.index, gap };
    }
    if (best) onto.set(best.index, [...(onto.get(best.index) ?? []), fileChip(attachment)]);
    else loose.push(attachment);
  }
  for (const [index, files] of onto) events[index] = { ...events[index]!, attachments: files };
  for (const attachment of loose) {
    events.push({
      id: `attachment-${attachment.id}`,
      kind: 'attachment',
      timestamp: attachment.createdAt,
      title: `${attachment.filename} was attached`,
      attachments: [fileChip(attachment)],
    });
  }
  events.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  return { events, othersMessages };
}

/**
 * Where "New since your last visit" goes: the first message someone else
 * wrote after the reader last had this ticket open. Nothing on a first
 * visit — everything would be new, which says nothing.
 */
export function newSinceId(model: ConversationModel, lastVisit: string | null): string | null {
  if (!lastVisit) return null;
  const since = Date.parse(lastVisit);
  if (Number.isNaN(since)) return null;
  return model.othersMessages.find((message) => Date.parse(message.at) > since)?.id ?? null;
}

/** A history longer than this shows its latest part first. */
export const COLLAPSE_OVER = 14;
/** How much of it: the last few entries, or from "new since" when that is further back. */
export const KEEP_LAST = 8;

/** How many of the oldest entries a long history hides until asked. */
export function hiddenCount(events: readonly TimelineEvent[], newSince: string | null, expanded: boolean): number {
  if (expanded || events.length <= COLLAPSE_OVER) return 0;
  let hidden = events.length - KEEP_LAST;
  if (newSince) {
    const index = events.findIndex((event) => event.id === newSince);
    if (index >= 0) hidden = Math.min(hidden, index);
  }
  return Math.max(0, hidden);
}

/* ------------------------------------------------------ Original request */

/** A description longer than this reads as a paragraph and folds to three lines. */
const LONG_DESCRIPTION = 280;

function OriginalRequest({ ticket, people, me }: { readonly ticket: Ticket; readonly people: PeopleMap; readonly me: string | null }): ReactNode {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const requester = ticket.requesterId?.toLowerCase() ?? null;
  const name = requester ? personName(requester, people, me) : 'Not recorded';
  const person = requester ? people[requester] : undefined;
  const text = ticket.description?.trim() ?? '';
  const long = text.length > LONG_DESCRIPTION || text.split('\n').length > 3;
  const channel = channelInfo(ticket.sourceChannel);

  return (
    <article className="app-Original" aria-labelledby={`${bodyId}-title`}>
      <header className="app-Original__head">
        <Avatar name={name} {...(person ? { initials: person.initials } : {})} size="sm" decorative />
        <p className="app-Original__who" id={`${bodyId}-title`}>
          <span className="app-Original__name">{name}</span>
          <span className="app-Original__meta">
            <span>Original request</span>
            <span aria-hidden="true"> · </span>
            <span className="app-Original__channel">
              <Icon name={channel.icon} size="xs" />
              {channel.label}
            </span>
            <span aria-hidden="true"> · </span>
            <RelativeTime date={ticket.createdAt} />
          </span>
        </p>
      </header>
      {text ? (
        <>
          <p id={bodyId} className="app-Original__body" data-folded={long && !open ? '' : undefined}>
            {text}
          </p>
          {long ? (
            <button type="button" className="app-Original__more" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen((now) => !now)}>
              {open ? 'Show less' : 'Show all'}
            </button>
          ) : null}
        </>
      ) : (
        <p className="app-Original__body app-Original__body--empty">No description was given.</p>
      )}
    </article>
  );
}

/* ------------------------------------------------------- Queued messages */

export interface QueuedMessage {
  readonly id: string;
  readonly body: string;
  readonly internal: boolean;
  readonly state: 'waiting' | 'failed';
  readonly problem?: string | null;
}

function Queued({ items, onRetry, onDiscard }: { readonly items: readonly QueuedMessage[]; readonly onRetry: (id: string) => void; readonly onDiscard: (id: string) => void }): ReactNode {
  if (items.length === 0) return null;
  return (
    <ol className="app-Queued" aria-label="Not sent yet">
      {items.map((item) => (
        <li key={item.id} className="app-Queued__item" data-internal={item.internal ? '' : undefined} data-state={item.state}>
          <article className="app-Queued__bubble" aria-label={`You, ${item.internal ? 'internal note, ' : ''}${item.state === 'failed' ? 'not sent' : 'queued'}`}>
            {item.internal ? (
              <Badge tone="warning" icon="lock" size="sm">
                Internal note
              </Badge>
            ) : null}
            <p className="app-Message">{item.body}</p>
          </article>
          {item.state === 'waiting' ? (
            <p className="app-Queued__status">
              <Icon name="clock" size="xs" />
              Queued · sends when you’re back online
            </p>
          ) : (
            <div className="app-Queued__status app-Queued__status--failed">
              <Icon name="circle-alert" size="xs" />
              <span>Couldn’t send{item.problem ? ` · ${item.problem}` : ''}</span>
              <Button size="sm" variant="ghost" onClick={() => onRetry(item.id)}>
                Retry
              </Button>
              <Button size="sm" variant="ghost" onClick={() => onDiscard(item.id)}>
                Discard
              </Button>
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}

/* --------------------------------------------------------------- The view */

export interface ConversationProps {
  readonly bundle: TicketBundle;
  readonly model: ConversationModel;
  readonly me: string | null;
  readonly newSince: string | null;
  readonly queued?: readonly QueuedMessage[];
  readonly onRetryQueued?: (id: string) => void;
  readonly onDiscardQueued?: (id: string) => void;
  /** The scroller, for the workspace's "new reply · Show" and scroll position. */
  readonly ref?: Ref<HTMLElement>;
  readonly onScroll?: () => void;
  /** The day headings' level: 3 under the pane's `h2` title, 2 under the page's `h1`. */
  readonly headingLevel?: 2 | 3;
}

const FILTER_EMPTY: Readonly<Record<TimelineFilter, string>> = {
  all: 'No replies or changes yet',
  messages: 'No messages yet',
  notes: 'No internal notes yet',
  activity: 'No changes yet',
};

export function Conversation({ bundle, model, me, newSince, queued = [], onRetryQueued, onDiscardQueued, ref, onScroll, headingLevel = 3 }: ConversationProps): ReactNode {
  const [filter, setFilter] = useState<TimelineFilter>('all');
  const [expanded, setExpanded] = useState(false);
  const newHeadingId = `${INBOX_REGIONS.conversation}-new`;

  const options = useMemo(
    () => [
      { value: 'all', label: 'All' },
      { value: 'messages', label: 'Messages' },
      ...(bundle.includesInternal ? [{ value: 'notes', label: 'Notes' }] : []),
      ...(bundle.includesEvents ? [{ value: 'activity', label: 'Activity' }] : []),
    ],
    [bundle.includesInternal, bundle.includesEvents],
  );

  const hidden = filter === 'all' ? hiddenCount(model.events, newSince, expanded) : 0;
  const shown = hidden > 0 ? model.events.slice(hidden) : model.events;

  return (
    <section
      ref={ref}
      id={INBOX_REGIONS.conversation}
      className="app-Conversation"
      aria-label="Conversation"
      tabIndex={-1}
      onScroll={onScroll}
    >
      <div className="app-Conversation__inner">
        <OriginalRequest ticket={bundle.ticket} people={bundle.people} me={me} />

        {options.length > 2 || model.events.length > 0 ? (
          <div className="app-Conversation__filter">
            <SegmentedControl
              label="Show"
              mode="value"
              size="sm"
              options={options}
              value={filter}
              onValueChange={(value) => setFilter(value as TimelineFilter)}
            />
            {!bundle.includesInternal ? (
              // Said out loud rather than inferred from an empty thread: an
              // agent who cannot see internal notes is reading a different
              // ticket from the one their colleague is describing.
              <span className="app-Conversation__hiddenNotes">
                <Icon name="eye-off" size="xs" />
                Internal notes are hidden from you
              </span>
            ) : null}
          </div>
        ) : null}

        {hidden > 0 ? (
          <button type="button" className="app-Conversation__earlier" onClick={() => setExpanded(true)}>
            <Icon name="chevron-up" size="xs" />
            {`Show ${hidden} earlier ${hidden === 1 ? 'update' : 'updates'}`}
          </button>
        ) : null}

        <Timeline
          label={`Conversation on ${bundle.ticket.number}`}
          events={shown}
          variant="conversation"
          perspective="agent"
          groupBy="day"
          order="oldest"
          collapseSystem={{ withinMinutes: 10 }}
          filter={filter}
          {...(newSince ? { newSinceId: newSince, newSinceTargetId: newHeadingId } : {})}
          emptyMessage={FILTER_EMPTY[filter]}
          headingLevel={headingLevel}
        />

        <Queued items={queued} onRetry={(id) => onRetryQueued?.(id)} onDiscard={(id) => onDiscardQueued?.(id)} />
      </div>
    </section>
  );
}
