import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { PeopleView } from '../../../../components/people/PeopleView.js';
import {
  PEOPLE_SCOPES,
  cappedCaption,
  organisationOptions,
  peopleScopeHref,
  personRow,
  readPeopleQuery,
  usersQuery,
  type PersonRowView,
} from '../../../../components/people/presentation.js';
import { Forbidden } from '../../../../components/Forbidden.js';
import { isPending, mayOpen } from '../../../../navigation.js';
import { read } from '../../../../server/read.js';
import { pageAccess } from '../../../../server/session.js';
import { drawerId, orgNamesOf, organisationsFor, peopleAbilities, peopleHeader, rolesFor, teamsFor } from './data.js';
import '../../../../components/people/people.css';

export const metadata: Metadata = { title: 'People' };
export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * People (SPEC §6.1 `/people`, B §3.16, F31): the directory, its roles and
 * teams, and the two writes that matter most on it — adding someone and
 * taking their access away.
 *
 * The query string is the state: `q`, `status` (Active by default),
 * `open=person:<id>` for the drawer and `new=1` for *Add person*. The API
 * answers at most 200 people per call and has no total; a full page says so
 * (it used to stop at 50 without a word).
 *
 * Organisation names, roles and teams are each read for themselves and may
 * fail alone: without the organisation list the column goes, without roles
 * the drawer shows no roles section — never an id in place of a name.
 */
export default async function PeoplePage({ searchParams }: { searchParams: Promise<SearchParams> }): Promise<ReactNode> {
  const access = await pageAccess('/people');
  if (!access.allowed) return <Forbidden route="/people" />;
  const { me, api } = access;

  const params = await searchParams;
  const query = readPeopleQuery(params);
  const openId = drawerId(params.open, 'person');
  const abilities = peopleAbilities(me);

  const [users, orgs, roles, teams] = await Promise.all([
    read(() => api.tenant.users(usersQuery(query))),
    organisationsFor(me, api),
    rolesFor(me, api),
    teamsFor(api),
  ]);

  const orgNames = orgNamesOf(orgs, me);
  const meId = me.actor.id;
  const rows: PersonRowView[] = users.ok ? users.value.map((user) => personRow(user, orgNames, meId)) : [];

  // A pasted link to someone outside this list (another scope, past the first 200).
  let initialPerson: PersonRowView | undefined;
  if (openId && !rows.some((row) => row.id === openId)) {
    const one = await read(() => api.tenant.user(openId));
    if (one.ok) initialPerson = personRow(one.value, orgNames, meId);
  }

  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) if (typeof value === 'string') search.set(name, value);

  return (
    <PeopleView
      header={peopleHeader(me, 'identity.user.manage')}
      rows={rows}
      query={query}
      scopes={PEOPLE_SCOPES.map((scope) => ({ ...scope, href: peopleScopeHref('/people', search, scope.value) }))}
      caption={users.ok ? cappedCaption(rows.length, query) : null}
      {...(users.ok ? {} : { problem: users.problem })}
      abilities={abilities}
      meId={meId}
      roles={roles?.ok ? roles.value : null}
      teams={teams.ok ? teams.value.map((team) => ({ id: team.id, name: team.name, orgId: team.orgId })) : null}
      organisations={orgs?.ok ? organisationOptions(orgs.value) : null}
      orgNames={Object.fromEntries(orgNames)}
      {...(!isPending('/workforce') && mayOpen(me, '/workforce') ? { workforceHref: '/workforce' } : {})}
      {...(initialPerson ? { initialPerson } : {})}
    />
  );
}
