import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isViewId, viewById, type SearchParams } from '../../../../inbox/views.js';
import { InboxRoute } from './InboxRoute.js';

/**
 * `/inbox/[view]` — My work, Unassigned, Due soon, Waiting on others, All
 * open, Recently resolved (SPEC §5.3, §6.2).
 *
 * The list and the ticket beside it (`?t=INC-000123`), with every filter in
 * the query string (`inbox/views.ts` reads it). After this first render the
 * browser does the rest: filters, paging, selection and live updates change
 * the URL without asking the server to render the page again (D12).
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
  return <InboxRoute viewRef={{ kind: 'view', id }} params={await searchParams} />;
}
