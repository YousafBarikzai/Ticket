import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { HydrationBoundary, QueryClient, dehydrate } from '@tanstack/react-query';
import { ApiError } from '@itsm/sdk';
import { directoryKeys, toTeams, type TicketBundle } from '../../../../client/desk-ticket.js';
import { deskKeys } from '../../../../client/query-client.js';
import { apiFor, currentMe, currentTeams, loginHref, requireSession } from '../../../../server/session.js';
import { TicketWorkspace } from '../../../../workspace/TicketWorkspace.js';
import { gateTicket, loadTicketBundle } from './bundle.js';

/**
 * `/tickets/[id]` — the ticket workspace as a page (SPEC §6.2, D16): the
 * same component as the inbox's detail pane, full width, with the title as
 * the page's `h1`.
 *
 * A hard load renders the ticket on the server and seeds the client's query
 * cache with it (and with the team names), so the page paints with the
 * conversation and the client takes over from there: live updates, writes
 * and the composer all work against that cache. When the bundle cannot be
 * read here (the API unwell), nothing is seeded and the workspace loads it
 * itself, with its own error and Retry.
 */
export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  try {
    const ticket = await gateTicket(id);
    return { title: `${ticket.number} · ${ticket.title}` };
  } catch {
    return { title: id };
  }
}

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }): Promise<ReactNode> {
  const { id } = await params;
  const session = await requireSession();
  const [me, teams] = await Promise.all([currentMe(), currentTeams()]);

  let bundle: TicketBundle | null = null;
  try {
    bundle = await loadTicketBundle(apiFor(session), id, me);
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 401) redirect(await loginHref());
      if (error.status === 403 || error.status === 404) notFound();
    }
  }

  const number = bundle?.ticket.number ?? id;
  const client = new QueryClient();
  if (bundle) client.setQueryData(deskKeys.ticket(number), bundle);
  if (teams) client.setQueryData(directoryKeys.teams(), toTeams(teams));

  return (
    <HydrationBoundary state={dehydrate(client)}>
      <TicketWorkspace key={number} ticketId={number} mode="page" />
    </HydrationBoundary>
  );
}
