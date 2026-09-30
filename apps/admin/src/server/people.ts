import 'server-only';
import { cache } from 'react';
import type { Admin, UserQuery, UserRow } from '@itsm/sdk';
import type { PersonRef } from '../components/PersonCell.js';

/**
 * Names for the ids a page is about to print (F8; B §2.2 "Names instead of
 * IDs").
 *
 * A page gathers every person id it shows — assignees, requesters, whoever
 * changed a rule — and asks once:
 *
 * ```ts
 * const people = await resolvePeople(api, rows.flatMap((row) => [row.assigneeId, row.requesterId]));
 * // people.get(id) → { id, name: 'Ada Lovelace', email } or { id, name: null } ("Unknown person")
 * ```
 *
 * One request for the lot (`GET /users?ids=…`, A3; the SDK splits more than
 * 200 into several), never one per row. Within a request the answers are
 * remembered (`cache()`), so the page, a drawer and the layout asking about
 * the same person cost one lookup. If the directory refuses the `ids` form —
 * an API without A3 — it falls back to the first 200 people, which covers a
 * small desk and says "Unknown person" honestly for the rest. A person the
 * directory cannot name is `name: null`, which `PersonCell` shows as "Unknown
 * person" with a short id, never as a blank.
 */

/** Something shaped like a person id: the directory is asked about nothing else. */
const ID_SHAPE = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

export type ListUsers = (query: UserQuery) => Promise<readonly UserRow[]>;

function toRef(id: string, row: UserRow | undefined): PersonRef {
  if (!row) return { id, name: null };
  return { id, name: row.displayName || row.email, email: row.email, ...(row.isExternal ? { external: true } : {}) };
}

/** Ask the directory for exactly these people; the first 200 when it will not answer by id; nobody when it will not answer at all. */
export async function lookupPeople(listUsers: ListUsers, ids: readonly string[]): Promise<Map<string, UserRow>> {
  const found = new Map<string, UserRow>();
  if (ids.length === 0) return found;
  try {
    for (const row of await listUsers({ ids, limit: Math.min(200, ids.length) })) found.set(row.id, row);
    return found;
  } catch {
    try {
      for (const row of await listUsers({ limit: 200 })) found.set(row.id, row);
    } catch {
      // Nobody can be named; every id reads "Unknown person".
    }
    return found;
  }
}

/**
 * A resolver over a `users` call, remembering what it has been told. Pure and
 * framework-free; `resolvePeople` below gives each request its own.
 */
export function createPeopleResolver(listUsers: ListUsers): (ids: readonly (string | null | undefined)[]) => Promise<Map<string, PersonRef>> {
  const known = new Map<string, Promise<PersonRef>>();
  return async (ids) => {
    const wanted = [...new Set(ids.filter((id): id is string => typeof id === 'string' && ID_SHAPE.test(id)))];
    const missing = wanted.filter((id) => !known.has(id));
    if (missing.length > 0) {
      const batch = lookupPeople(listUsers, missing);
      for (const id of missing) known.set(id, batch.then((rows) => toRef(id, rows.get(id))));
    }
    const entries = await Promise.all(wanted.map(async (id) => [id, await known.get(id)!] as const));
    return new Map(entries);
  };
}

/** One resolver per request and per API client (`cache()` lasts for one server request). */
const resolverFor = cache((api: Admin) => createPeopleResolver((query) => api.tenant.users(query)));

export function resolvePeople(api: Admin, ids: readonly (string | null | undefined)[]): Promise<Map<string, PersonRef>> {
  return resolverFor(api)(ids);
}

/** The person for one id from a resolved map, for a serialisable row: the ref, or null when there was no id. */
export function personFrom(people: ReadonlyMap<string, PersonRef>, id: string | null | undefined): PersonRef | null {
  if (!id) return null;
  return people.get(id) ?? { id, name: null };
}
