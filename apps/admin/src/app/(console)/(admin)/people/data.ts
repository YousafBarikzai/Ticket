import 'server-only';
import type { Admin, Me, OrganisationRow, RoleRow, TeamListRow } from '@itsm/sdk';
import { tabsFor } from '../../../../navigation.js';
import { holds, holdsAny, viewOnlyFor } from '../../../../permissions.js';
import { read, type Read } from '../../../../server/read.js';
import type { PeopleAbilities, PeopleHeader } from '../../../../components/people/types.js';

/**
 * What the People tabs share (SPEC §6.1 `/people/**`): the header this
 * person sees, what they may do, and the directories more than one tab
 * reads. Each read is its own `read()`, so a tab that loses the organisation
 * list still shows its people and says which part it could not load.
 */

export const ORG_READ = ['identity.org.read', 'identity.org.manage'] as const;

export function peopleAbilities(me: Me): PeopleAbilities {
  return {
    manage: holds(me, 'identity.user.manage'),
    readRoles: holds(me, 'identity.role.read'),
    grant: holds(me, 'identity.role.manage') && holds(me, 'identity.role.read'),
    manageTeams: holds(me, 'identity.org.manage'),
    manageOrganisations: holds(me, 'tenant.org.manage'),
    readAvailability: holdsAny(me, ['workload.read', 'workload.manage']),
  };
}

/** Words for write permissions the shared catalogue does not name ("Manage tenant org" otherwise). */
const WRITE_WORDS: Readonly<Record<string, string>> = { 'tenant.org.manage': 'Manage organisations' };

/** The header: the tabs this person may open, and *View only* for the write the tab's changes need. */
export function peopleHeader(me: Me, write: string): PeopleHeader {
  const viewOnly = viewOnlyFor(me, 'People', write);
  const words = WRITE_WORDS[write];
  return { tabs: tabsFor(me, 'people'), ...(viewOnly ? { viewOnly: words ? { ...viewOnly, permission: words } : viewOnly } : {}) };
}

/** The organisation structure, when this person may read it (`GET /organisations` needs `identity.org.read`). */
export async function organisationsFor(me: Me, api: Admin): Promise<Read<OrganisationRow[]> | null> {
  return holdsAny(me, ORG_READ) ? read(() => api.tenant.organisations()) : null;
}

export async function rolesFor(me: Me, api: Admin): Promise<Read<RoleRow[]> | null> {
  return holds(me, 'identity.role.read') ? read(() => api.tenant.roles()) : null;
}

/** The team directory: anyone who works the desk may read it; others get a 403 and no team features. */
export async function teamsFor(api: Admin): Promise<Read<TeamListRow[]>> {
  return read(() => api.tenant.teams());
}

/** Organisation names by id, from whatever the page could read. */
export function orgNamesOf(orgs: Read<OrganisationRow[]> | null, me: Me): Map<string, string> {
  const names = new Map<string, string>();
  // The person's own organisations come with `/me`, readable even without the directory.
  for (const org of me.organisations) names.set(org.id, org.name);
  if (orgs?.ok) for (const org of orgs.value) names.set(org.id, org.name);
  return names;
}

/** `?open=<kind>:<uuid>` → the uuid, or null. */
export function drawerId(value: string | string[] | undefined, kind: string): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw?.startsWith(`${kind}:`)) return null;
  const id = raw.slice(kind.length + 1);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : null;
}
