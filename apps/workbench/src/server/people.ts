import 'server-only';
import { cache } from 'react';
import { initials } from '@itsm/ui';
import type { PeopleMap, PersonName } from '../inbox/presentation.js';
import { currentSession, apiFor } from './session.js';

/**
 * Names for ids (F8).
 *
 * Tickets, timelines and events carry user ids; a screen must show people.
 * One batched call per request — `GET /users?ids=` (A3), which the SDK splits
 * into chunks of 200 — and `cache()` so a page and its layout share it. An id
 * the reader may not resolve (a requester in another organisation, or an
 * agent without `identity.user.read`) is simply absent from the map; the
 * screen then says "Unknown person" with a short id, via `personName()`,
 * rather than printing a UUID or nothing.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The ids worth asking about: real UUIDs, each once, in a stable order (so `cache()` can match the call). */
export function peopleKey(ids: readonly (string | null | undefined)[]): string {
  return [...new Set(ids.filter((id): id is string => typeof id === 'string' && UUID.test(id)).map((id) => id.toLowerCase()))]
    .sort()
    .join(',');
}

export function toPersonName(user: { displayName?: string | null; email?: string | null }): PersonName | null {
  const name = user.displayName?.trim() || user.email?.trim() || '';
  return name ? { name, initials: initials(name) } : null;
}

const resolveKey = cache(async (key: string): Promise<PeopleMap> => {
  if (!key) return {};
  const session = await currentSession();
  if (!session) return {};
  try {
    const users = await apiFor(session).users({ ids: key.split(',') });
    const people: Record<string, PersonName> = {};
    for (const user of users) {
      const person = toPersonName(user);
      if (person) people[user.id.toLowerCase()] = person;
    }
    return people;
  } catch {
    // Names are a courtesy on every screen that uses them; a refusal to give
    // them must not take the screen down.
    return {};
  }
});

/** A `{ id: { name, initials } }` map for the ids given; unknown ids are left out. */
export async function resolvePeople(ids: readonly (string | null | undefined)[]): Promise<PeopleMap> {
  return resolveKey(peopleKey(ids));
}
