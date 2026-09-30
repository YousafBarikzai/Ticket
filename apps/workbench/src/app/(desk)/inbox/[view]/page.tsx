import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { inboxViewFrom, isViewId, viewById, type SearchParams } from '../../../../inbox/views.js';
import { TransitionalInbox } from '../TransitionalInbox.js';

/**
 * `/inbox/[view]` — My work, Unassigned, Due soon, Waiting on others, All
 * open, Recently resolved (SPEC §5.3, §6.2).
 *
 * Stub → WP23: renders the transitional list until the three-pane inbox
 * (`InboxPage`, `TicketList`, the detail pane) replaces it. The contract WP23
 * keeps: the view registry in `inbox/views.ts`, `?t=` for the selection, and
 * the filter parameters it parses.
 */

/** Rendered per request: an inbox is the one screen where a cached page is a wrong page. */
export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ view: string }> }): Promise<Metadata> {
  const { view } = await params;
  return { title: isViewId(view) ? viewById(view).label : 'Not found' };
}

export default async function InboxViewPage({
  params,
  searchParams,
}: {
  params: Promise<{ view: string }>;
  searchParams: Promise<SearchParams>;
}): Promise<ReactNode> {
  const { view: id } = await params;
  if (!isViewId(id)) notFound();
  return <TransitionalInbox view={inboxViewFrom({ kind: 'view', id }, await searchParams)} />;
}
