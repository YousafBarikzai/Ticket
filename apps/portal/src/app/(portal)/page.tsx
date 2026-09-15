import type { ReactNode } from 'react';
import Link from 'next/link';
import { Badge, Card } from '@itsm/ui';
import { apiFor, requireSession } from '../../server/session.js';
import { needsYou, raisedAgo, requesterState } from '../../tickets/presentation.js';

export const dynamic = 'force-dynamic';

/**
 * The home page.
 *
 * Ordered by what a person came here to do, not by what the platform has:
 * report something, ask for something, then — and only then — the tickets that
 * are waiting on *them*. A portal that opens on a list of everything you have
 * ever raised buries the one row that needs an answer today.
 *
 * Everything below the two actions fails softly. A requester whose approvals
 * module is unavailable should still be able to report an issue, which is the
 * thing they are here for.
 */

async function orNull<T>(work: Promise<T>): Promise<T | null> {
  try {
    return await work;
  } catch {
    return null;
  }
}

export default async function HomePage(): Promise<ReactNode> {
  const session = await requireSession();
  const api = apiFor(session);

  const [mine, approvals] = await Promise.all([
    orNull(api.myTickets({ statusCategory: 'new,open,pending', limit: 20 })),
    orNull(api.approvals()),
  ]);

  const tickets = mine?.data ?? [];
  const yours = tickets.filter((ticket) => needsYou(ticket.status));
  const waiting = approvals?.data ?? [];

  return (
    <div className="itsm-Home">
      <h1 className="itsm-Home__heading">How can we help?</h1>

      <div className="itsm-Home__actions">
        <Card title="Something is broken" subtitle="Report an issue and we will pick it up.">
          <Link className="itsm-Home__cta" href="/report">
            Report an issue
          </Link>
        </Card>
        <Card title="I need something" subtitle="Software, access, hardware, a change.">
          <Link className="itsm-Home__cta" href="/catalogue">
            Request something
          </Link>
        </Card>
      </div>

      {/*
        First, because it is the only thing on this page that is somebody's to
        act on. Announced as a region rather than styled as an alert: it is
        news, not an emergency.
      */}
      {yours.length > 0 ? (
        <section className="itsm-Home__waiting" aria-label="Waiting for you">
          <h2>We are waiting on you</h2>
          <ul>
            {yours.map((ticket) => (
              <li key={ticket.id}>
                <Link href={`/tickets/${ticket.number}`}>{ticket.title}</Link>
                <span className="itsm-Home__meta">{requesterState(ticket.status).detail}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {waiting.length > 0 ? (
        <section className="itsm-Home__waiting" aria-label="Approvals">
          <h2>
            Approvals <Badge intent="warning">{waiting.length}</Badge>
          </h2>
          <p>
            <Link href="/approvals">Somebody is waiting on your decision</Link>
          </p>
        </section>
      ) : null}

      <section className="itsm-Home__recent" aria-label="Your open tickets">
        <h2>Your open tickets</h2>
        {tickets.length === 0 ? (
          <p className="itsm-Home__empty">Nothing open. That is the goal.</p>
        ) : (
          <ul>
            {tickets.slice(0, 8).map((ticket) => {
              const state = requesterState(ticket.status);
              return (
                <li key={ticket.id}>
                  <Link href={`/tickets/${ticket.number}`}>{ticket.title}</Link>
                  <Badge intent={state.intent} srPrefix="Status">
                    {state.label}
                  </Badge>
                  <time className="itsm-Home__meta" dateTime={ticket.createdAt} title={ticket.createdAt}>
                    {raisedAgo(ticket.createdAt)}
                  </time>
                </li>
              );
            })}
          </ul>
        )}
        {tickets.length > 8 ? (
          <p>
            <Link href="/tickets">See all of your tickets</Link>
          </p>
        ) : null}
      </section>
    </div>
  );
}
