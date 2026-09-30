'use client';

import { useCallback, useMemo, useState, type HTMLAttributes, type ReactNode, type Ref } from 'react';
import { useStableId } from '../a11y/ids.js';
import { channelInfo, channelPhrase } from '../display/channel.js';
import { dayHeading, dayKey } from '../display/dates.js';
import { FileChip, type FileChipProps } from '../display/FileChip.js';
import { toneFromIntent } from '../display/tone.js';
import { formatDateTime } from '../format/format.js';
import { RelativeTime } from '../format/RelativeTime.js';
import { Icon } from '../icons/Icon.js';
import { useOptionalItsm } from '../provider/ItsmProvider.js';
import { useNow } from '../provider/clock.js';
import type { IntentName } from '../tokens/tokens.js';
import type { IconName, Tone } from '../types.js';
import { Avatar } from './Avatar.js';
import { Badge } from './Badge.js';
import { cx } from './cx.js';

export type TimelineKind = 'comment' | 'event' | 'task' | 'approval' | 'attachment' | 'description';

export interface TimelineActor {
  readonly name: string;
  readonly kind?: 'person' | 'system' | 'ai' | 'channel';
  readonly initials?: string;
}

export interface TimelineEvent {
  readonly id: string;
  /** What happened, e.g. "changed the priority to P2"; for a message, a label such as "Reply". */
  readonly title: ReactNode;
  /** ISO-8601 instant. */
  readonly timestamp: string;
  /** Who did it: a name, or a name with a kind (a person, the system, the AI, a channel). */
  readonly actor?: string | TimelineActor;
  /** A message's text, or an event's detail. */
  readonly body?: ReactNode;
  /** @deprecated Use `tone` (SPEC §4.11). */
  readonly intent?: IntentName;
  /** Tints a thread entry's marker. Conversation bubbles ignore it: a message is never coloured by status. */
  readonly tone?: Tone;
  /**
   * `internal` notes are visible to agents only. They are tinted *and*
   * labelled, because a colour alone would not tell a colour-blind agent that
   * the requester cannot see what they are about to write (SC 1.4.1).
   */
  readonly visibility?: 'public' | 'internal';
  readonly meta?: ReactNode;
  /** What sort of entry; a message when there is a `body` and no kind. */
  readonly kind?: TimelineKind;
  /** A change's old and new values ("New" → "In progress"). */
  readonly from?: string;
  readonly to?: string;
  readonly attachments?: readonly FileChipProps[];
  /** How it arrived: "email", "portal". Shown as a glyph and a word, and spoken in the entry's name. */
  readonly channel?: string;
  /** Who wrote a message, for the conversation variant's sides and surfaces. */
  readonly author?: 'requester' | 'agent' | 'system';
  /** Written by the person reading: shown as "You". */
  readonly mine?: boolean;
}

export type TimelineFilter = 'all' | 'messages' | 'notes' | 'activity';

export interface TimelineProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  readonly events: readonly TimelineEvent[];
  /** Names the list, e.g. "Ticket history". */
  readonly label: string;
  /** @deprecated The provider's locale is used; this is the fallback outside one. */
  readonly locale?: string;
  /** Shown when nothing is left to show (after `filter`). */
  readonly emptyMessage?: string;
  /**
   * `thread` (default): a rail of entries with markers. `conversation`:
   * messages as bubbles, events as quiet centred lines between them.
   */
  readonly variant?: 'thread' | 'conversation';
  /**
   * In the conversation variant, whose side is whose. `requester` (the
   * portal): your messages on the end side on `surface.bubble`, the service
   * desk's on the start side on raised. `agent` (default; the workbench): the
   * requester on the start side on raised, agents' replies on the end side on
   * sunken, internal notes on the warning tint.
   */
  readonly perspective?: 'requester' | 'agent';
  /** Folds runs of system events by one actor, each within this many minutes of the last, into "3 updates by Jo". */
  readonly collapseSystem?: { readonly withinMinutes: number };
  readonly filter?: TimelineFilter;
  /** `day` puts entries under day headings in the reader's time zone. */
  readonly groupBy?: 'day' | 'none';
  /** The first entry the reader has not seen: "New since your last visit" is placed before it. */
  readonly newSinceId?: string;
  /** The id of that heading, for a skip link elsewhere on the page. Derived when not given. */
  readonly newSinceTargetId?: string;
  /** Sorts by time. Without it, entries keep the order they were given in. */
  readonly order?: 'oldest' | 'newest';
  /** The level of the day and "new" headings. 3 by default. */
  readonly headingLevel?: 2 | 3 | 4;
  readonly className?: string;
  readonly ref?: Ref<HTMLDivElement>;
}

/* -------------------------------------------------------------------------
 * The model: entries grouped into days, runs and the "new" marker
 * ---------------------------------------------------------------------- */

export type TimelineRow =
  | { readonly type: 'entry'; readonly event: TimelineEvent; readonly continued: boolean }
  | {
      readonly type: 'run';
      readonly key: string;
      /** The run's position among all runs, for its list's id. */
      readonly ordinal: number;
      readonly events: readonly TimelineEvent[];
      readonly actor: string | undefined;
    }
  | { readonly type: 'new' };

export interface TimelineGroup {
  /** `YYYY-MM-DD` in the reader's zone when grouped by day; `all` otherwise. */
  readonly key: string;
  /** The first entry's timestamp, which the day heading is written from. */
  readonly first: string;
  readonly rows: readonly TimelineRow[];
}

/** An entry's kind: a message when it has a body and says nothing else. */
export function timelineKind(event: TimelineEvent): TimelineKind {
  if (event.kind) return event.kind;
  return event.body !== undefined && event.body !== null && event.body !== false ? 'comment' : 'event';
}

function isMessage(event: TimelineEvent): boolean {
  const kind = timelineKind(event);
  return kind === 'comment' || kind === 'description';
}

function isInternal(event: TimelineEvent): boolean {
  return event.visibility === 'internal';
}

function hasBody(event: TimelineEvent): boolean {
  return event.body !== undefined && event.body !== null && event.body !== false;
}

function actorOf(event: TimelineEvent): TimelineActor | undefined {
  if (event.actor === undefined) return undefined;
  return typeof event.actor === 'string' ? { name: event.actor } : event.actor;
}

/** The name shown and spoken for an entry's author: "You" for the reader's own. */
function displayName(event: TimelineEvent): string | undefined {
  if (event.mine) return 'You';
  return actorOf(event)?.name;
}

/** Whether an entry passes a filter: messages are public messages, notes internal ones, activity the rest. */
export function matchesTimelineFilter(event: TimelineEvent, filter: TimelineFilter): boolean {
  switch (filter) {
    case 'messages':
      return isMessage(event) && !isInternal(event);
    case 'notes':
      return isMessage(event) && isInternal(event);
    case 'activity':
      return !isMessage(event);
    default:
      return true;
  }
}

function time(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** Messages from one author within this many minutes read as one burst: the name is shown once. */
const CONTINUATION_MINUTES = 5;

function sameAuthor(a: TimelineEvent, b: TimelineEvent): boolean {
  return (
    isMessage(a) &&
    isMessage(b) &&
    Boolean(a.mine) === Boolean(b.mine) &&
    displayName(a) === displayName(b) &&
    a.author === b.author &&
    isInternal(a) === isInternal(b) &&
    a.channel === b.channel &&
    timelineKind(b) !== 'description' &&
    Math.abs(time(b.timestamp) - time(a.timestamp)) <= CONTINUATION_MINUTES * 60_000
  );
}

export interface BuildTimelineOptions {
  readonly filter?: TimelineFilter;
  readonly order?: 'oldest' | 'newest' | undefined;
  readonly groupBy?: 'day' | 'none';
  readonly timeZone?: string;
  readonly newSinceId?: string | undefined;
  /** Fold runs of system events within this many minutes; no folding when undefined. */
  readonly collapseMinutes?: number | undefined;
  /** Mark consecutive messages from one author as continuations (the conversation variant). */
  readonly continuations?: boolean;
}

/**
 * Filters, orders and groups the entries: into days, then within a day into
 * runs of system events and the "new" marker. Pure, so the grouping rules are
 * tested without rendering.
 *
 * A run never crosses a day boundary, the "new" marker or a message: it is
 * "3 updates by Jo" only while Jo's automatic changes follow one another
 * uninterrupted, each within `collapseMinutes` of the one before. A run of
 * one is an ordinary entry.
 */
export function buildTimeline(events: readonly TimelineEvent[], options: BuildTimelineOptions = {}): TimelineGroup[] {
  const { filter = 'all', order, groupBy = 'none', timeZone = 'UTC', newSinceId, collapseMinutes, continuations = false } = options;
  let list = events.filter((event) => matchesTimelineFilter(event, filter));
  if (order) {
    list = [...list].sort((a, b) => time(a.timestamp) - time(b.timestamp));
    if (order === 'newest') list.reverse();
  }

  const days: { key: string; first: string; events: TimelineEvent[] }[] = [];
  for (const event of list) {
    const key = groupBy === 'day' ? (dayKey(event.timestamp, timeZone) ?? 'unknown') : 'all';
    const last = days[days.length - 1];
    if (last && last.key === key) last.events.push(event);
    else days.push({ key, first: event.timestamp, events: [event] });
  }

  let ordinal = 0;
  return days.map((day) => {
    const rows: TimelineRow[] = [];
    let run: TimelineEvent[] = [];
    const flush = (): void => {
      if (run.length >= 2) {
        rows.push({ type: 'run', key: run[0]!.id, ordinal: ordinal++, events: run, actor: displayName(run[0]!) });
      } else if (run.length === 1) {
        rows.push({ type: 'entry', event: run[0]!, continued: false });
      }
      run = [];
    };
    let previous: TimelineEvent | undefined;
    for (const event of day.events) {
      if (newSinceId !== undefined && event.id === newSinceId) {
        flush();
        rows.push({ type: 'new' });
        previous = undefined;
      }
      if (collapseMinutes !== undefined && timelineKind(event) === 'event') {
        const tail = run[run.length - 1];
        const joins =
          tail !== undefined &&
          displayName(tail) === displayName(event) &&
          Math.abs(time(event.timestamp) - time(tail.timestamp)) <= collapseMinutes * 60_000;
        if (!joins) flush();
        run.push(event);
        previous = undefined;
      } else {
        flush();
        rows.push({ type: 'entry', event, continued: continuations && previous !== undefined && sameAuthor(previous, event) });
        previous = event;
      }
    }
    flush();
    return { key: day.key, first: day.first, rows };
  });
}

/* -------------------------------------------------------------------------
 * Presentation helpers
 * ---------------------------------------------------------------------- */

const kindIcon: Readonly<Record<TimelineKind, IconName>> = {
  comment: 'message-square',
  description: 'file',
  event: 'history',
  task: 'circle-check',
  approval: 'approvals',
  attachment: 'paperclip',
};

function markerIcon(event: TimelineEvent): IconName {
  const actor = actorOf(event);
  if (isInternal(event)) return 'lock';
  if (actor?.kind === 'ai') return 'sparkles';
  if (actor?.kind === 'system') return 'bot';
  if (actor?.kind === 'channel' && event.channel) return channelInfo(event.channel).icon;
  return kindIcon[timelineKind(event)];
}

function toneOf(event: TimelineEvent): Tone | undefined {
  return event.tone ?? (event.intent ? toneFromIntent(event.intent) : undefined);
}

/** A title that only repeats the internal-note badge ("Internal note") is not shown twice. */
function titleRepeatsBadge(event: TimelineEvent): boolean {
  return isInternal(event) && typeof event.title === 'string' && event.title.trim().toLowerCase() === 'internal note';
}

/** "Ada, by email, 09:14" — the entry's accessible name (X-68). */
function entryName(event: TimelineEvent, when: string): string {
  const name = displayName(event) ?? (typeof event.title === 'string' && event.title.trim() ? event.title.trim() : 'Update');
  const parts = [name];
  if (timelineKind(event) === 'description') parts.push('original request');
  if (isInternal(event)) parts.push('internal note');
  if (event.channel) parts.push(channelPhrase(event.channel));
  parts.push(when);
  return parts.join(', ');
}

function Change({ from, to }: { readonly from: string | undefined; readonly to: string | undefined }): ReactNode {
  if (!from && !to) return null;
  return (
    <span className="itsm-Timeline__change">
      {from ? (
        <>
          <span className="itsm-visually-hidden">from </span>
          <span className="itsm-Timeline__value">{from}</span>
        </>
      ) : null}
      {from && to ? <Icon name="arrow-right" size="xs" className="itsm-Timeline__arrow" directional /> : null}
      {to ? (
        <>
          <span className="itsm-visually-hidden">{from ? ' to ' : 'to '}</span>
          <span className="itsm-Timeline__value">{to}</span>
        </>
      ) : null}
    </span>
  );
}

function Channel({ channel }: { readonly channel: string }): ReactNode {
  const info = channelInfo(channel);
  return (
    <span className="itsm-Timeline__channel">
      <Icon name={info.icon} size="xs" />
      {info.label}
    </span>
  );
}

function InternalBadge(): ReactNode {
  return (
    <Badge tone="warning" icon="lock" size="sm" className="itsm-Timeline__internal">
      Internal note
    </Badge>
  );
}

function Attachments({ files }: { readonly files: readonly FileChipProps[] | undefined }): ReactNode {
  if (!files || files.length === 0) return null;
  return (
    <ul className="itsm-Timeline__attachments" aria-label="Attachments">
      {files.map((file, index) => (
        <li key={`${file.name}-${index}`}>
          <FileChip {...file} />
        </li>
      ))}
    </ul>
  );
}

function Dot({ separator = true }: { readonly separator?: boolean }): ReactNode {
  return separator ? (
    <span className="itsm-Timeline__dot" aria-hidden="true">
      ·
    </span>
  ) : null;
}

/* -------------------------------------------------------------------------
 * The component
 * ---------------------------------------------------------------------- */

const emptyByFilter: Readonly<Record<TimelineFilter, string>> = {
  all: 'Nothing has happened yet',
  messages: 'No messages yet',
  notes: 'No internal notes yet',
  activity: 'No activity yet',
};

/**
 * A ticket's history, or its conversation.
 *
 * Each entry is an `<article>` named the way a person would introduce it —
 * "Ada, by email, 09:14"; "Sam, internal note, 10:02" — so moving by article
 * in a screen reader reads like turning pages in the thread (X-68). Internal
 * notes carry the words "Internal note" and a lock as well as the warning
 * tint, so the three signals never depend on one another.
 *
 * Times are `RelativeTime`: the server renders the absolute time in the
 * reader's zone and the browser switches to "3 min ago" after hydration, so
 * the HTML and the first client render agree (the old timeline computed
 * "ago" during render and differed from its own server HTML). Day headings
 * work the same way: a date with its year from the server, "Today" once the
 * clock is known.
 *
 * `conversation` draws messages as bubbles, sided by `perspective`, and never
 * in blue — blue means "interactive" in this product, and a reply bubble in
 * the selection colour would look selected (X-73). Consecutive messages from
 * one author a few minutes apart drop the repeated name and avatar, as a
 * messaging app does; their article names keep it. Events sit between
 * messages as quiet centred lines.
 *
 * `collapseSystem` folds runs of automatic events into a disclosure button
 * ("3 updates by Jo", `aria-expanded`), and `newSinceId` places a "New since
 * your last visit" heading — a skip-link target — before the first unseen
 * entry, with a "Jump to what's new" link at the top when it is further down.
 */
export function Timeline({
  events,
  label,
  locale: localeProp,
  emptyMessage,
  variant = 'thread',
  perspective = 'agent',
  collapseSystem,
  filter = 'all',
  groupBy = 'none',
  newSinceId,
  newSinceTargetId,
  order,
  headingLevel = 3,
  className,
  ref,
  ...rest
}: TimelineProps): ReactNode {
  const itsm = useOptionalItsm();
  const locale = itsm?.locale ?? localeProp ?? 'en-GB';
  const timeZone = itsm?.timeZone ?? 'UTC';
  const now = useNow();
  const baseId = useStableId('itsm-timeline');
  const newId = newSinceTargetId ?? `${baseId}-new`;
  const [openRuns, setOpenRuns] = useState<ReadonlySet<string>>(() => new Set());
  const conversation = variant === 'conversation';
  const Heading = `h${headingLevel}` as 'h2' | 'h3' | 'h4';

  // The number, not the object: callers write `collapseSystem={{ withinMinutes: 10 }}` inline.
  const collapseMinutes = collapseSystem ? Math.max(0, collapseSystem.withinMinutes) : undefined;
  const groups = useMemo(
    () => buildTimeline(events, { filter, order, groupBy, timeZone, newSinceId, collapseMinutes, continuations: conversation }),
    [events, filter, order, groupBy, timeZone, newSinceId, collapseMinutes, conversation],
  );

  const toggleRun = useCallback((key: string) => {
    setOpenRuns((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const spokenTime = (event: TimelineEvent): string =>
    formatDateTime(event.timestamp, { locale, timeZone, style: groupBy === 'day' ? 'time' : 'datetime' });

  const visibleTime = (event: TimelineEvent, className: string): ReactNode =>
    conversation && groupBy === 'day' ? (
      <RelativeTime date={event.timestamp} mode="absolute" absoluteStyle="time" className={className} />
    ) : (
      <RelativeTime date={event.timestamp} className={className} />
    );

  /* A thread entry: marker on the rail, a meta line, then the body. */
  const threadEntry = (event: TimelineEvent): ReactNode => {
    const actor = actorOf(event);
    const name = displayName(event);
    const internal = isInternal(event);
    const person = actor !== undefined && (actor.kind ?? 'person') === 'person' && isMessage(event);
    return (
      <li key={event.id} className="itsm-Timeline__item" data-kind={timelineKind(event)} data-internal={internal ? '' : undefined}>
        <article className="itsm-Timeline__entry" aria-label={entryName(event, spokenTime(event))} suppressHydrationWarning>
          <span className="itsm-Timeline__marker" aria-hidden="true">
            {person && actor ? (
              <Avatar name={actor.name} {...(actor.initials ? { initials: actor.initials } : {})} size="sm" decorative />
            ) : (
              <span className="itsm-Timeline__glyph" data-tone={internal ? 'warning' : toneOf(event)}>
                <Icon name={markerIcon(event)} size={12} />
              </span>
            )}
          </span>
          <div className="itsm-Timeline__content">
            <p className="itsm-Timeline__meta">
              {name ? <span className="itsm-Timeline__actor">{name}</span> : null}
              {titleRepeatsBadge(event) ? null : <span className="itsm-Timeline__title">{event.title}</span>}
              <Change from={event.from} to={event.to} />
              {internal ? <InternalBadge /> : null}
              {event.channel ? <Channel channel={event.channel} /> : null}
              {visibleTime(event, 'itsm-Timeline__time')}
              {event.meta ? <span className="itsm-Timeline__extra">{event.meta}</span> : null}
            </p>
            {hasBody(event) ? (
              <div className={cx('itsm-Timeline__body', internal && 'itsm-Timeline__body--internal')}>{event.body}</div>
            ) : null}
            <Attachments files={event.attachments} />
          </div>
        </article>
      </li>
    );
  };

  /* A conversation message: a bubble on its author's side. */
  const message = (event: TimelineEvent, continued: boolean): ReactNode => {
    const actor = actorOf(event);
    const name = displayName(event) ?? (typeof event.title === 'string' ? event.title : undefined);
    const internal = isInternal(event);
    let side: 'start' | 'end';
    let surface: 'bubble' | 'raised' | 'sunken' | 'internal';
    if (perspective === 'requester') {
      side = event.mine ? 'end' : 'start';
      surface = event.mine ? 'bubble' : 'raised';
    } else {
      const fromRequester = event.author === 'requester' || (!event.mine && event.author === undefined && !internal);
      side = fromRequester ? 'start' : 'end';
      surface = internal ? 'internal' : fromRequester ? 'raised' : 'sunken';
    }
    const content = hasBody(event) ? event.body : event.title;
    return (
      <li
        key={event.id}
        className="itsm-Timeline__item"
        data-kind={timelineKind(event)}
        data-side={side}
        data-internal={internal ? '' : undefined}
        data-continued={continued ? '' : undefined}
      >
        <article className="itsm-Timeline__message" aria-label={entryName(event, spokenTime(event))} suppressHydrationWarning>
          {side === 'start' ? (
            <span className="itsm-Timeline__avatar" aria-hidden="true">
              {continued || !name ? null : (
                <Avatar
                  name={name}
                  {...(actor?.initials ? { initials: actor.initials } : {})}
                  {...(actor?.kind === 'ai' || actor?.kind === 'system' ? { kind: actor.kind } : {})}
                  size="sm"
                  decorative
                />
              )}
            </span>
          ) : null}
          <div className="itsm-Timeline__stack">
            {continued ? null : (
              <p className="itsm-Timeline__sender">
                {name ? <span className="itsm-Timeline__actor">{name}</span> : null}
                {timelineKind(event) === 'description' ? (
                  <>
                    <Dot separator={Boolean(name)} />
                    <span>Original request</span>
                  </>
                ) : null}
                {internal ? <InternalBadge /> : null}
                {event.channel ? (
                  <>
                    <Dot />
                    <Channel channel={event.channel} />
                  </>
                ) : null}
                <Dot />
                {visibleTime(event, 'itsm-Timeline__time')}
              </p>
            )}
            <div className="itsm-Timeline__bubble" data-surface={surface}>
              {content}
            </div>
            <Attachments files={event.attachments} />
            {event.meta ? <p className="itsm-Timeline__extra">{event.meta}</p> : null}
          </div>
        </article>
      </li>
    );
  };

  /* A conversation event: a quiet centred line between the messages. */
  const notice = (event: TimelineEvent): ReactNode => {
    const name = displayName(event);
    return (
      <li key={event.id} className="itsm-Timeline__item" data-kind={timelineKind(event)} data-side="center">
        <article className="itsm-Timeline__notice" aria-label={entryName(event, spokenTime(event))} suppressHydrationWarning>
          <Icon name={markerIcon(event)} size="xs" className="itsm-Timeline__noticeIcon" />
          <span className="itsm-Timeline__noticeText">
            {name ? <span className="itsm-Timeline__actor">{name}</span> : null}
            {name ? ' ' : null}
            <span className="itsm-Timeline__title">{event.title}</span>
            {event.from || event.to ? ' ' : null}
            <Change from={event.from} to={event.to} />
            {hasBody(event) ? <span className="itsm-Timeline__noticeDetail">{event.body}</span> : null}
          </span>
          <Dot />
          {visibleTime(event, 'itsm-Timeline__time')}
        </article>
      </li>
    );
  };

  const entry = (event: TimelineEvent, continued: boolean): ReactNode => {
    if (!conversation) return threadEntry(event);
    return isMessage(event) ? message(event, continued) : notice(event);
  };

  const renderRow = (row: TimelineRow, index: number): ReactNode => {
    if (row.type === 'entry') return entry(row.event, row.continued);
    if (row.type === 'new') {
      return (
        <li key={`new-${index}`} className="itsm-Timeline__new">
          <Heading id={newId} tabIndex={-1} className="itsm-Timeline__newHeading">
            New since your last visit
          </Heading>
        </li>
      );
    }
    const open = openRuns.has(row.key);
    const listId = `${baseId}-run-${row.ordinal}`;
    const last = row.events[row.events.length - 1]!;
    return (
      <li key={`run-${row.key}`} className="itsm-Timeline__item itsm-Timeline__run" data-side={conversation ? 'center' : undefined}>
        <div className="itsm-Timeline__runHeader">
          {conversation ? null : (
            <span className="itsm-Timeline__marker" aria-hidden="true">
              <span className="itsm-Timeline__glyph">
                <Icon name="history" size={12} />
              </span>
            </span>
          )}
          <button
            type="button"
            className="itsm-Timeline__runToggle"
            aria-expanded={open}
            aria-controls={listId}
            onClick={() => toggleRun(row.key)}
          >
            <Icon name="chevron-right" size="xs" className="itsm-Timeline__runChevron" directional />
            {`${row.events.length} updates${row.actor ? ` by ${row.actor}` : ''}`}
          </button>
          <Dot />
          {visibleTime(last, 'itsm-Timeline__time')}
        </div>
        <ol id={listId} className="itsm-Timeline__runList" hidden={!open}>
          {row.events.map((event) => entry(event, false))}
        </ol>
      </li>
    );
  };

  const hasRows = groups.some((group) => group.rows.length > 0);
  if (!hasRows) {
    return (
      <div {...rest} ref={ref} className={cx('itsm-Timeline', className)} data-variant={variant}>
        <p className="itsm-Timeline__empty">{emptyMessage ?? emptyByFilter[filter]}</p>
      </div>
    );
  }

  const firstRow = groups[0]?.rows[0];
  const showJump = newSinceId !== undefined && groups.some((group) => group.rows.some((row) => row.type === 'new')) && firstRow?.type !== 'new';

  return (
    <div {...rest} ref={ref} className={cx('itsm-Timeline', className)} data-variant={variant} data-grouped={groupBy === 'day' ? '' : undefined}>
      {showJump ? (
        <a className="itsm-Timeline__jump" href={`#${newId}`}>
          <Icon name="arrow-down" size="xs" />
          Jump to what’s new
        </a>
      ) : null}
      {groupBy === 'day' ? (
        <ol className="itsm-Timeline__list" aria-label={label}>
          {groups.map((group) => (
            <li key={group.key} className="itsm-Timeline__day">
              <Heading className="itsm-Timeline__dayHeading" suppressHydrationWarning>
                {dayHeading(group.first, now, locale, timeZone)}
              </Heading>
              <ol className="itsm-Timeline__entries">{group.rows.map(renderRow)}</ol>
            </li>
          ))}
        </ol>
      ) : (
        <ol className="itsm-Timeline__list itsm-Timeline__entries" aria-label={label}>
          {groups.flatMap((group) => group.rows).map(renderRow)}
        </ol>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Deprecated
 * ---------------------------------------------------------------------- */

const UNITS: readonly (readonly [Intl.RelativeTimeFormatUnit, number])[] = [
  ['year', 31_536_000_000],
  ['month', 2_592_000_000],
  ['week', 604_800_000],
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
];

/**
 * "3 hours ago".
 *
 * @deprecated Render `RelativeTime`, which agrees with its own server HTML
 * and moves on with the shared clock, or call `formatRelative` from
 * `@itsm/ui/format`. Kept for existing callers until the release after this
 * one.
 */
export function relativeTime(timestamp: string, locale: string, now: number = Date.now()): string {
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const delta = new Date(timestamp).getTime() - now;
  for (const [unit, ms] of UNITS) {
    if (Math.abs(delta) >= ms) return formatter.format(Math.round(delta / ms), unit);
  }
  return formatter.format(Math.round(delta / 1000), 'second');
}
