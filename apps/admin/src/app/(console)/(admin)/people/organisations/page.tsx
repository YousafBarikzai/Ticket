import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { OrganisationsView } from '../../../../../components/people/OrganisationsView.js';
import { organisationOptions, organisationTree } from '../../../../../components/people/presentation.js';
import { Forbidden } from '../../../../../components/Forbidden.js';
import { isPending, mayOpen } from '../../../../../navigation.js';
import { holds } from '../../../../../permissions.js';
import { read } from '../../../../../server/read.js';
import { pageAccess } from '../../../../../server/session.js';
import { peopleHeader, teamsFor } from '../data.js';
import '../../../../../components/people/people.css';

export const metadata: Metadata = { title: 'Organisations · People' };
export const dynamic = 'force-dynamic';

/**
 * People › Organisations (SPEC §6.1 `/people/organisations`): the
 * organisation structure as a nested list, with the teams each holds, and
 * *New organisation* (`?new=1`, `&parent=<id>` for one inside another) for
 * people with `tenant.org.manage` — the permission `POST /organisations`
 * checks.
 */
export default async function OrganisationsPage(): Promise<ReactNode> {
  const access = await pageAccess('/people/organisations');
  if (!access.allowed) return <Forbidden route="/people/organisations" />;
  const { me, api } = access;

  const [orgs, teams] = await Promise.all([read(() => api.tenant.organisations()), teamsFor(api)]);

  const teamCounts: Record<string, number> | null = teams.ok ? {} : null;
  if (teams.ok && teamCounts) for (const team of teams.value) teamCounts[team.orgId] = (teamCounts[team.orgId] ?? 0) + 1;

  return (
    <OrganisationsView
      header={peopleHeader(me, 'tenant.org.manage')}
      tree={orgs.ok ? organisationTree(orgs.value) : []}
      teamCounts={teamCounts}
      {...(orgs.ok ? {} : { problem: orgs.problem })}
      canManage={holds(me, 'tenant.org.manage')}
      options={orgs.ok ? organisationOptions(orgs.value) : []}
      takenCodes={orgs.ok ? orgs.value.map((org) => org.code) : []}
      {...(!isPending('/people/teams') && mayOpen(me, '/people/teams') ? { teamsHref: '/people/teams' } : {})}
    />
  );
}
