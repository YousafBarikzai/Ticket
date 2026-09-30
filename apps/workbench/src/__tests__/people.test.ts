import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Names for ids (F8): one batched lookup per request, and a refusal to give
 * names never takes a screen down.
 */

type UserRow = { id: string; displayName: string; email: string | null };
const calls: unknown[] = [];
let answer: () => Promise<UserRow[]> = async () => [];

vi.mock('server-only', () => ({}));
vi.mock('../server/session.js', () => ({
  currentSession: async () => ({ id: 'session' }),
  // A plain function rather than a spy: the refusal below must reach the
  // code under test as a rejected promise and nothing else.
  apiFor: () => ({
    users: (query: unknown) => {
      calls.push(query);
      return answer();
    },
  }),
}));

const { peopleKey, resolvePeople, toPersonName } = await import('../server/people.js');

const ADA = '66666666-7777-4888-9999-000000000000';
const JO = '11111111-2222-4333-8444-555555555555';

beforeEach(() => {
  calls.length = 0;
  answer = async () => [];
});

describe('resolving people', () => {
  it('asks once for the real ids, each once, in a stable order', async () => {
    answer = async () => [
      { id: ADA, displayName: 'Ada Lovelace', email: 'ada@example.com' },
      { id: JO, displayName: '', email: 'jo@example.com' },
    ];
    const people = await resolvePeople([JO, ADA, null, undefined, 'not-an-id', ADA.toUpperCase()]);
    expect(calls).toEqual([{ ids: [JO, ADA].sort() }]);
    expect(people).toEqual({
      [ADA]: { name: 'Ada Lovelace', initials: 'AL' },
      [JO]: { name: 'jo@example.com', initials: 'J' },
    });
  });

  it('asks nothing when there is nobody to name', async () => {
    expect(await resolvePeople([null, 'system'])).toEqual({});
    expect(calls).toEqual([]);
  });

  it('returns no names, rather than failing, when the directory refuses', async () => {
    answer = () => Promise.reject(Object.assign(new Error('forbidden'), { status: 403 }));
    expect(await resolvePeople([ADA])).toEqual({});
    expect(calls).toHaveLength(1);
  });

  it('keys a lookup by its ids, whatever order they came in', () => {
    expect(peopleKey([ADA, JO])).toBe(peopleKey([JO, ADA, JO]));
    expect(toPersonName({ displayName: '  ', email: null })).toBeNull();
  });
});
