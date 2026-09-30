import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isUuid, type SearchParams } from '../../../../../inbox/views.js';
import { currentTeams } from '../../../../../server/session.js';
import { InboxRoute } from '../../[view]/InboxRoute.js';

/**
 * `/inbox/team/[teamId]` — one team's open work (SPEC §5.3, §6.2): the same
 * inbox as a view, titled with the team's name (A6), or "Team" when this API
 * cannot say.
 */

export const dynamic = 'force-dynamic';

async function teamName(teamId: string): Promise<string | undefined> {
  const teams = await currentTeams();
  return teams?.find((team) => team.id.toLowerCase() === teamId.toLowerCase())?.name;
}

export async function generateMetadata({ params }: { params: Promise<{ teamId: string }> }): Promise<Metadata> {
  const { teamId } = await params;
  return { title: isUuid(teamId) ? ((await teamName(teamId)) ?? 'Team') : 'Not found' };
}

export default async function TeamInboxPage({
  params,
  searchParams,
}: {
  params: Promise<{ teamId: string }>;
  searchParams: Promise<SearchParams>;
}): Promise<ReactNode> {
  const { teamId } = await params;
  if (!isUuid(teamId)) notFound();
  const name = await teamName(teamId);
  return <InboxRoute viewRef={{ kind: 'team', teamId: teamId.toLowerCase(), ...(name ? { name } : {}) }} params={await searchParams} />;
}
