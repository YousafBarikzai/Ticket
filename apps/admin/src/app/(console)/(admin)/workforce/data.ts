import 'server-only';
import type { Admin, Me } from '@itsm/sdk';
import { tabsFor } from '../../../../navigation.js';
import { viewOnlyFor } from '../../../../permissions.js';
import { read } from '../../../../server/read.js';
import type { WorkforceHeader } from '../../../../components/workforce/types.js';

/**
 * What the Workforce pages share: the header this person sees and the team
 * names (A6) that turn team ids into words — allowed to fail, in which case
 * team columns are hidden rather than showing ids.
 */

export function workforceHeader(me: Me, write?: string | readonly string[]): WorkforceHeader {
  const viewOnly = write ? viewOnlyFor(me, 'Workforce', write) : undefined;
  return { tabs: tabsFor(me, 'workforce'), ...(viewOnly ? { viewOnly } : {}) };
}

export async function teamNames(api: Admin): Promise<Map<string, string> | null> {
  const teams = await read(() => api.tenant.teams());
  return teams.ok ? new Map(teams.value.map((team) => [team.id, team.name])) : null;
}
