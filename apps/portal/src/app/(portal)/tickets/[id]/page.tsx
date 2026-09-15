import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { ApiError, type TimelineEntry } from '@itsm/sdk';
import { Badge, EmptyState, Timeline, type TimelineEvent } from '@itsm/ui';
import { TicketReply } from '../../../../components/TicketReply.js';
import { apiFor, requireSession } from '../../../../server/session.js';
import { raisedAgo, requesterState, typeLabel } from '../../../../tickets/presentation.js';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return { title: (await params).id };
}

/**
 * One ticket, as the person who raised it sees it.
 *
 * The history is filtered by the API, not here: `includesInternal` comes back
 * false for a requester and the internal notes are simply absent. A portal
 * that received them and hid them in the browser would be one `view-source`
 * away from a serious problem — so the filtering is in MOD-04 and this page
 * renders whatever it was given.
 *
 * Events are not shown at all. "status.changed", "sla.timer.paused" and
 * "rule.applied" are the desk's own record of its work; to a requester they
 * are noise that makes the two replies that matter harder to find. What
 * changed is said in one sentence at the top instead.
 */
export default async function TicketPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactNode> {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const justRaised = query.raised === '1';
  const session = await requireSession();

  const api = apiFor(session);

  let timeline: Awaited<ReturnType<typeof api.timeline>>;
  try {
    timeline = await api.timeline(id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    return (
      <EmptyState
        tone="error"
        title="This ticket could not be loaded"
        description={error instanceof ApiError ? error.message : 'The service could not be reached.'}
      />
    );
  }

  // Who is reading, so their own messages read as theirs. Allowed to fail:
  // the page is still correct without it, every message simply reads as the
  // desk's.
  const me = await api.me().catch(() => null);
  const readerId = me?.actor.id ?? null;

  const ticket = timeline.ticket;
  const state = requesterState(ticket.status);
  const conversation = timeline.entries.filter((entry) => entry.kind === 'comment');

  return (
    <article className="itsm-Page itsm-Ticket">
      {/*
        Announced once, for somebody who has just been redirected here from the
        form and needs to know the thing they typed actually arrived.
      */}
      {justRaised ? (
        <p className="itsm-Ticket__raised" role="status">
          Thanks — we have it. Your reference is {ticket.number}.
        </p>
      ) : null}

      <p className="itsm-Ticket__number">
        {typeLabel(ticket.type)} · {ticket.number} · raised{' '}
        <time dateTime={ticket.createdAt} title={ticket.createdAt}>
          {raisedAgo(ticket.createdAt)}
        </time>
      </p>
      <h1 className="itsm-Page__heading">{ticket.title}</h1>

      <p className="itsm-Ticket__state">
        <Badge intent={state.intent} srPrefix="Status">
          {state.label}
        </Badge>
        <span>{state.detail}</span>
      </p>

      {ticket.description ? <p className="itsm-Ticket__description">{ticket.description}</p> : null}

      <h2 className="itsm-Ticket__historyHeading">What has happened</h2>
      <Timeline
        label="Conversation"
        events={conversation.map((entry) => toEvent(entry, readerId))}
        emptyMessage="Nobody has replied yet. We will let you know when they do."
      />

      <TicketReply
        ticketNumber={ticket.number}
        version={ticket.version}
        status={ticket.status}
        canReopen={ticket.status === 'resolved'}
      />
    </article>
  );
}

/**
 * Two authors, not many: "You" and "The service desk".
 *
 * A requester does not need to know which of four agents replied, and an
 * individual's name attached to bad news invites a reply addressed to a person
 * rather than to the ticket — which is how a thread ends up in one agent's
 * inbox while they are on leave.
 */
function toEvent(entry: TimelineEntry, readerId: string | null): TimelineEvent {
  // Only comments reach here, but the type is a union and narrowing it in one
  // place is cheaper than asserting at the call site.
  if (entry.kind !== 'comment') return { id: entry.id, timestamp: entry.at, title: 'Update' };

  const mine = readerId !== null && entry.authorId === readerId;
  return {
    id: entry.id,
    timestamp: entry.at,
    title: mine ? 'You' : 'The service desk',
    body: entry.body,
    ...(mine ? {} : { intent: 'info' as const }),
  };
}
