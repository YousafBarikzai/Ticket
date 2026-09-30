import { describe, expect, it, vi } from 'vitest';
import type { UserQuery, UserRow } from '@itsm/sdk';

// The module guards itself against client bundles; the resolver in it is pure.
vi.mock('server-only', () => ({}));

const { createPeopleResolver, lookupPeople, personFrom } = await import('../server/people.js');
const { shortId } = await import('../components/PersonCell.js');

/**
 * Names instead of UUIDs (F8): one directory request per page, however many
 * rows; an honest "Unknown person" for anyone it cannot name.
 */

const ADA = 'a0000000-0000-4000-8000-000000000001';
const BO = 'b0000000-0000-4000-8000-000000000002';
const GONE = 'c0000000-0000-4000-8000-000000000003';

function user(id: string, displayName: string, extra: Partial<UserRow> = {}): UserRow {
  return { id, email: `${displayName.toLowerCase()}@acme.test`, displayName, status: 'active', primaryOrgId: null, isExternal: false, ...extra };
}

const directory = [user(ADA, 'Ada'), user(BO, 'Bo', { isExternal: true })];

function byIds(): { calls: UserQuery[]; listUsers: (query: UserQuery) => Promise<UserRow[]> } {
  const calls: UserQuery[] = [];
  return {
    calls,
    listUsers: async (query) => {
      calls.push(query);
      return directory.filter((row) => query.ids?.includes(row.id));
    },
  };
}

describe('resolving people', () => {
  it('asks once for every id on the page, without repeats', async () => {
    const { calls, listUsers } = byIds();
    const resolve = createPeopleResolver(listUsers);
    const people = await resolve([ADA, BO, ADA, null, undefined, '']);
    expect(calls).toEqual([{ ids: [ADA, BO], limit: 2 }]);
    expect(people.get(ADA)).toEqual({ id: ADA, name: 'Ada', email: 'ada@acme.test' });
    expect(people.get(BO)).toEqual({ id: BO, name: 'Bo', email: 'bo@acme.test', external: true });
  });

  it('remembers what it was told, and asks only about the new ones', async () => {
    const { calls, listUsers } = byIds();
    const resolve = createPeopleResolver(listUsers);
    await resolve([ADA]);
    await resolve([ADA, BO]);
    expect(calls).toEqual([
      { ids: [ADA], limit: 1 },
      { ids: [BO], limit: 1 },
    ]);
  });

  it('says it does not know someone rather than printing a blank', async () => {
    const { listUsers } = byIds();
    const people = await createPeopleResolver(listUsers)([GONE]);
    expect(people.get(GONE)).toEqual({ id: GONE, name: null });
    expect(personFrom(people, GONE)).toEqual({ id: GONE, name: null });
    expect(personFrom(people, null)).toBeNull();
    expect(shortId(GONE)).toBe('c0000000');
  });

  it('never asks the directory about something that is not an id', async () => {
    const { calls, listUsers } = byIds();
    const people = await createPeopleResolver(listUsers)(['system', 'me', 'none']);
    expect(calls).toEqual([]);
    expect(people.size).toBe(0);
  });

  it('falls back to the first 200 people when the directory will not answer by id', async () => {
    const calls: UserQuery[] = [];
    const found = await lookupPeople(async (query) => {
      calls.push(query);
      if (query.ids) throw new Error('400: unknown parameter ids');
      return directory;
    }, [ADA, GONE]);
    expect(calls).toEqual([{ ids: [ADA, GONE], limit: 2 }, { limit: 200 }]);
    expect(found.get(ADA)?.displayName).toBe('Ada');
    expect(found.has(GONE)).toBe(false);
  });

  it('names nobody, rather than failing the page, when the directory is down', async () => {
    const resolve = createPeopleResolver(async () => {
      throw new Error('503');
    });
    const people = await resolve([ADA]);
    expect(people.get(ADA)).toEqual({ id: ADA, name: null });
  });

  it('uses the email when a person has no display name', async () => {
    const people = await createPeopleResolver(async () => [user(ADA, '', { email: 'ada@acme.test' })])([ADA]);
    expect(people.get(ADA)?.name).toBe('ada@acme.test');
  });
});
