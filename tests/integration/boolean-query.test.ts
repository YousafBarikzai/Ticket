import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeHarness, createTestTenant, deleteTestTenant, request, type TestTenant } from '../support/harness.js';

/**
 * Boolean query parameters (Q1).
 *
 * `z.coerce.boolean()` read every non-empty string as true, so `?open=false`
 * returned the open records only — the opposite of what was asked, and the
 * same answer as `?open=true`. Each list below is asked all four ways against
 * one open and one finished record, because the bug was only visible by
 * comparing answers: every response on its own looked plausible.
 */

let tenant: TestTenant;

beforeAll(async () => {
  tenant = await createTestTenant('boolean-query');
}, 120_000);

afterAll(async () => {
  await deleteTestTenant('boolean-query');
  await closeHarness();
});

const asLead = () => tenant.people.lead!.token;
const asAgent = () => tenant.people.agent!.token;

interface Case {
  path: string;
  /** Creates one record that stays open and one that is finished; returns their numbers. */
  seed: () => Promise<{ open: string; finished: string }>;
}

async function ok<T>(response: Promise<{ status: number; body: T }>, status = 200): Promise<T> {
  const settled = await response;
  expect(settled.status, JSON.stringify(settled.body)).toBe(status);
  return settled.body;
}

const CASES: Record<string, Case> = {
  'major incidents': {
    path: '/api/v1/major-incidents',
    seed: async () => {
      const declare = (title: string) =>
        ok(
          request<{ number: string }>('/api/v1/major-incidents', {
            method: 'POST',
            token: asLead(),
            body: { title, severity: 'SEV3', commanderId: tenant.people.lead!.id },
          }),
          201,
        );
      const open = await declare('Still going on');
      const finished = await declare('A false alarm');
      await ok(
        request(`/api/v1/major-incidents/${finished.number}/transition`, {
          method: 'POST',
          token: asLead(),
          body: { to: 'stood_down', note: 'Not a major incident after all.' },
        }),
      );
      return { open: open.number, finished: finished.number };
    },
  },
  problems: {
    path: '/api/v1/problems',
    seed: async () => {
      const raise = (title: string) =>
        ok(request<{ number: string }>('/api/v1/problems', { method: 'POST', token: asAgent(), body: { title } }), 201);
      const open = await raise('Exports time out on Mondays');
      const finished = await raise('Login page flickers');
      await ok(
        request(`/api/v1/problems/${finished.number}/transition`, {
          method: 'POST',
          token: asLead(),
          body: { to: 'closed', note: 'Could not reproduce.' },
        }),
      );
      return { open: open.number, finished: finished.number };
    },
  },
  changes: {
    path: '/api/v1/changes',
    seed: async () => {
      const raise = (title: string) =>
        ok(
          request<{ number: string }>('/api/v1/changes', {
            method: 'POST',
            token: asAgent(),
            body: { title, kind: 'normal', backoutPlan: 'Restore the snapshot.' },
          }),
          201,
        );
      const open = await raise('Upgrade the database');
      const finished = await raise('Replace the core switch');
      await ok(
        request(`/api/v1/changes/${finished.number}/transition`, {
          method: 'POST',
          token: asAgent(),
          body: { to: 'cancelled' },
        }),
      );
      return { open: open.number, finished: finished.number };
    },
  },
};

describe.each(Object.entries(CASES))('%s', (_name, { path, seed }) => {
  let numbers: { open: string; finished: string };

  const listed = async (query: string): Promise<string[]> => {
    const body = await ok(request<{ data: { number: string }[] }>(`${path}${query}`, { token: tenant.people.admin!.token }));
    return body.data.map((row) => row.number);
  };

  beforeAll(async () => {
    numbers = await seed();
  }, 60_000);

  it('reads open=true as open only', async () => {
    const rows = await listed('?open=true');
    expect(rows).toContain(numbers.open);
    expect(rows).not.toContain(numbers.finished);
  });

  it('reads open=false as false, not as true', async () => {
    // The regression: this used to be the same answer as `open=true`.
    const rows = await listed('?open=false');
    expect(rows).toContain(numbers.open);
    expect(rows).toContain(numbers.finished);
  });

  it('treats a missing parameter the same as false', async () => {
    expect((await listed('')).sort()).toEqual((await listed('?open=false')).sort());
  });

  it('refuses a spelling it would otherwise have to guess at', async () => {
    for (const value of ['yes', '1', '']) {
      const response = await request(`${path}?open=${value}`, { token: tenant.people.admin!.token });
      expect(response.status, `open=${value}`).toBe(422);
    }
  });
});
