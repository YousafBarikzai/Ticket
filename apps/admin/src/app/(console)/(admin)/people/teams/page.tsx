import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import type { TeamMemberRow } from '@itsm/sdk';
import { TeamsView } from '../../../../../components/people/TeamsView.js';
import { organisationOptions, teamRow } from '../../../../../components/people/presentation.js';
import { Forbidden } from '../../../../../components/Forbidden.js';
import { isPending, mayOpen } from '../../../../../navigation.js';
import { holds } from '../../../../../permissions.js';
import { read } from '../../../../../server/read.js';
import { pageAccess } from '../../../../../server/session.js';
import { orgNamesOf, organisationsFor, peopleHeader, teamsFor } from '../data.js';
import '../../../../../components/people/people.css';

export const metadata: Metadata = { title: 'Teams · People' };
export const dynamic = 'force-dynamic';

/**
 * Up to this many teams, the page reads every team's members (one request
 * each) so the list can name the leads and a drawer opens with its people.
 * Above it the column is left out and each drawer reads its own team.
 */
const READ_MEMBERS_UP_TO = 60;

/**
 * People › Teams (SPEC §6.1 `/people/teams`, A6): the team directory, who
 * leads each team, members in a drawer (`?open=team:<id>`), *Add member* and
 * *New team* (`?new=1`) for people who manage teams (`identity.org.manage`).
 */
export default async function TeamsPage(): Promise<ReactNode> {
  const access = await pageAccess('/people/teams');
  if (!access.allowed) return <Forbidden route="/people/teams" />;
  const { me, api } = access;

  const [teams, orgs] = await Promise.all([teamsFor(api), organisationsFor(me, api)]);
  const orgNames = orgNamesOf(orgs, me);

  const members: Record<string, readonly TeamMemberRow[]> = {};
  if (teams.ok && teams.value.length <= READ_MEMBERS_UP_TO) {
    const lists = await Promise.all(teams.value.map((team) => read(() => api.tenant.teamMembers(team.id))));
    teams.value.forEach((team, index) => {
      const list = lists[index];
      if (list?.ok) members[team.id] = list.value;
    });
  }

  const rows = teams.ok
    ? teams.value.map((team) => {
        const list = members[team.id];
        return teamRow(team, orgNames, list ? list.filter((member) => member.isLead).map((member) => member.displayName) : null);
      })
    : [];

  return (
    <TeamsView
      header={peopleHeader(me, 'identity.org.manage')}
      rows={rows}
      members={members}
      {...(teams.ok ? {} : { problem: teams.problem })}
      canManage={holds(me, 'identity.org.manage')}
      organisations={orgs?.ok ? organisationOptions(orgs.value) : null}
      {...(!isPending('/people') && mayOpen(me, '/people') ? { peopleHref: '/people' } : {})}
    />
  );
}
