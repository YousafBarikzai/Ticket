import type { ReactNode } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { ApiError, type Ticket } from '@itsm/sdk';
import { Badge, EmptyState } from '@itsm/ui';
import { apiFor, requireSession } from '../../../server/session.js';
import { needsYou, raisedAgo, requesterState, typeLabel } from '../../../tickets/presentation.js';

export const metadata: Metadata = { title: 'My tickets' };
export const dynamic = 'force-dynamic';

/**
 * Everything this person has raised.
 *
 * Open first and closed after, rather than one list sorted by date: a portal's
 * job is to answer "what is happening with my thing", and a ticket closed
 * three months ago is not an answer. `?all=1` shows the lot, because "where is
 * that request from last quarter" is a real question too.
 *
 * No table. On a phone a five-column table is a horizontal scroll, and this is
 * the screen most likely to be opened on one.
 */
export default async function MyTicketsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactNode> {
  const showAll = (await searchParams).all === '1';
  const session = await requireSession();

  let tickets: readonly Ticket[];
  try {
    const page = await apiFor(session).myTickets(
      showAll ? { limit: 100 } : { statusCategory: 'new,open,pending,resolved', limit: 100 },
    );
    tickets = page.data;
  } catch (error) {
    return (
      <EmptyState
        tone="error"
        title="Your tickets could not be loaded"
        description={error instanceof ApiError ? error.message : 'The service could not be reached.'}
      />
    );
  }

  if (tickets.length === 0) {
    return (
      <EmptyState
        title={showAll ? 'You have never raised anything' : 'Nothing open'}
        description={showAll ? 'When you report something it will appear here.' : 'Nothing of yours is with us.'}
        action={<Link href="/report">Report an issue</Link>}
        {...(showAll ? {} : { secondaryAction: <Link href="/tickets?all=1">Show everything, including closed</Link> })}
      />
    );
  }

  return (
    <div className="itsm-Page">
      <h1 className="itsm-Page__heading">My tickets</h1>

      <ul className="itsm-Tickets">
        {tickets.map((ticket) => {
          const state = requesterState(ticket.status);
          return (
            <li key={ticket.id} className="itsm-Tickets__row" data-needs-you={needsYou(ticket.status) ? 'true' : 'false'}>
              <Link className="itsm-Tickets__title" href={`/tickets/${ticket.number}`}>
                {ticket.title}
              </Link>
              <p className="itsm-Tickets__meta">
                <Badge intent={state.intent} srPrefix="Status">
                  {state.label}
                </Badge>
                <span>{typeLabel(ticket.type)}</span>
                <span className="itsm-Tickets__number">{ticket.number}</span>
                <time dateTime={ticket.createdAt} title={ticket.createdAt}>
                  {raisedAgo(ticket.createdAt)}
                </time>
              </p>
              {/* The sentence that says whose move it is. */}
              <p className="itsm-Tickets__detail">{state.detail}</p>
            </li>
          );
        })}
      </ul>

      <p className="itsm-Page__footnote">
        {showAll ? (
          <Link href="/tickets">Show only what is still open</Link>
        ) : (
          <Link href="/tickets?all=1">Show everything, including closed</Link>
        )}
      </p>
    </div>
  );
}
