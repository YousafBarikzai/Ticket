import 'server-only';
import { workbench, type Me } from '@itsm/sdk';
import type { Session } from '@itsm/bff';
import { bff } from '../bff.js';
import { settle } from '../home/settle.js';

/**
 * What the directory says about the signed-in person beyond `/me` (SPEC
 * §6.3 `/profile`, F40): their email address, and their teams by name.
 *
 * `/me` carries team ids only; the team directory answers anyone who works
 * the desk and refuses a requester (who is in no team anyway). Either read
 * failing leaves its line out — a count of teams, or an id, is never shown
 * in place of a name.
 */

export interface DirectoryEntry {
  readonly email: string | null;
  /** Team names, alphabetical; null when they could not be read (or there are none to read). */
  readonly teams: readonly string[] | null;
}

export async function readDirectoryEntry(session: Session, me: Me): Promise<DirectoryEntry> {
  const client = workbench(bff.clientFor(session));
  const actorId = me.actor.id;
  const [person, teams] = await Promise.all([
    actorId ? settle(client.user(actorId)) : Promise.resolve(null),
    me.teamIds.length > 0 ? settle(client.teams()) : Promise.resolve(null),
  ]);
  const mine = new Set(me.teamIds);
  const names = teams?.ok
    ? teams.value
        .filter((team) => mine.has(team.id))
        .map((team) => team.name.trim())
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b))
    : null;
  return {
    email: person?.ok ? person.value.email.trim() || null : null,
    teams: names && names.length > 0 ? names : null,
  };
}
