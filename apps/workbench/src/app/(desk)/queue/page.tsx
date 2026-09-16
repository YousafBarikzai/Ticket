import type { ReactNode } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { ApiError } from '@itsm/sdk';
import { EmptyState } from '@itsm/ui';
import { QueueTable } from '../../../components/QueueTable.js';
import { queueHref, queueViewFrom, type SearchParams } from '../../../queue/view.js';
import { apiFor, requireSession } from '../../../server/session.js';

export const metadata: Metadata = { title: 'Queue' };

/** Rendered per request: a queue is the one screen where a cached page is a wrong page. */
export const dynamic = 'force-dynamic';

export default async function QueuePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<ReactNode> {
  const view = queueViewFrom(await searchParams);
  const session = await requireSession();

  const api = apiFor(session);

  // Started before the tickets are awaited, so the two requests overlap: both
  // are needed for the first paint and neither depends on the other.
  //
  // `/me` failing is not a reason to fail the page. It only costs the live
  // updates, and a queue that renders is worth more than a queue that streams.
  const identity = api.me().catch(() => null);

  let tickets: Awaited<ReturnType<ReturnType<typeof apiFor>['tickets']>>;
  try {
    tickets = await api.tickets(view.filter);
  } catch (error) {
    // A queue that cannot load says why. The alternative — a blank table — is
    // read as "no tickets", which during an incident is the worst possible lie.
    const detail =
      error instanceof ApiError
        ? error.status === 403
          ? 'Your account cannot read tickets. Ask an administrator for the agent role.'
          : error.message
        : 'The API could not be reached.';
    return <EmptyState tone="error" title="This queue could not be loaded" description={detail} />;
  }

  // The person's own activity, and each of their teams' queues. A person in no
  // team watches only themselves, which is exactly right for a requester-shaped
  // account that reached this screen.
  const me = await identity;
  const watch = [
    ...(me?.actor.id ? [`user:${me.actor.id}`] : []),
    ...(me?.teamIds ?? []).map((id) => `group:${id}`),
  ];

  const chips: { label: string; href: string; current: boolean }[] = [
    { label: 'All open', href: queueHref(view, { assignee: '' }), current: view.assignee === '' },
    { label: 'Assigned to me', href: queueHref(view, { assignee: 'me' }), current: view.assignee === 'me' },
    { label: 'Unassigned', href: queueHref(view, { assignee: 'none' }), current: view.assignee === 'none' },
  ];

  return (
    <div className="itsm-Queue">
      <header className="itsm-Queue__head">
        <h1 className="itsm-Queue__heading">{view.title}</h1>
        <p className="itsm-Queue__lede">{view.description}</p>
        {/*
          Links rather than buttons: each view has a URL, so these can be
          opened in a new tab, bookmarked and sent to a colleague. `aria-current`
          says which one you are on without relying on the styling.
        */}
        <nav className="itsm-Queue__chips" aria-label="Queue views">
          {chips.map((chip) => (
            <Link key={chip.label} href={chip.href} aria-current={chip.current ? 'page' : undefined}>
              {chip.label}
            </Link>
          ))}
        </nav>
      </header>

      <QueueTable
        watch={watch}
        tickets={tickets.data}
        caption={`${view.title} — ${tickets.data.length} ticket${tickets.data.length === 1 ? '' : 's'}`}
        emptyTitle={view.assignee === 'me' ? 'Nothing is assigned to you' : 'Nothing here'}
        emptyDescription={
          view.assignee === 'me'
            ? 'When something is assigned to you it will appear here.'
            : 'No open ticket matches this view.'
        }
      />

      {tickets.nextCursor ? (
        <p className="itsm-Queue__more">
          <Link href={queueHref(view, { cursor: tickets.nextCursor })}>Next 50</Link>
        </p>
      ) : null}
    </div>
  );
}
