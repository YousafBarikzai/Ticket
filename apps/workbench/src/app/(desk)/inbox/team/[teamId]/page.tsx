import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { inboxViewFrom, isUuid, type SearchParams } from '../../../../../inbox/views.js';
import { currentTeams } from '../../../../../server/session.js';
import { TransitionalInbox } from '../../TransitionalInbox.js';

/**
 * `/inbox/team/[teamId]` — a team's open work (SPEC §5.3, §6.2).
 *
 * Stub → WP23: the transitional list, titled with the team's name (A6) or
 * "Team" when the teams route cannot say.
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
  return (
    <TransitionalInbox
      view={inboxViewFrom({ kind: 'team', teamId, ...(name ? { name } : {}) }, await searchParams)}
    />
  );
}
