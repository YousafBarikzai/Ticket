import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { transaction, withContext } from '@itsm/platform';
import { ticketService } from '@itsm/module-ticket';
import { closeHarness, contextFor, createTestTenant, deleteTestTenant, request, type TestTenant } from '../support/harness.js';

/**
 * `GET /tickets/count` (WA1): a view's badge.
 *
 * The one property that matters is that the badge and the list agree, for
 * every reader and every filter: a badge that says 4 over a list of 3 is the
 * kind of wrong nobody reports and everybody stops trusting. So every case
 * here is asked of both routes with the same query string and compared.
 */

let tenant: TestTenant;

beforeAll(async () => {
  tenant = await createTestTenant('ticket-count');
  // A few more, in both teams and states, so the filters have something to
  // tell apart. The harness has already raised three.
  const raise = async (title: string, groupId: string, then: string[] = []) => {
    const created = await request<{ number: string }>('/api/v1/tickets', {
      method: 'POST',
      token: tenant.people.admin!.token,
      body: { type: 'incident', title, sourceChannel: 'api', requesterId: tenant.people.requester!.id, groupId },
    });
    expect(created.status).toBe(201);
    for (const to of then) {
      await request(`/api/v1/tickets/${created.body.number}/transitions`, { method: 'POST', token: tenant.people.admin!.token, body: { to } });
    }
    return created.body.number;
  };
  const mine = await raise('Mouse is sticky', tenant.teamId, ['in_progress']);
  await request(`/api/v1/tickets/${mine}/assign`, { method: 'POST', token: tenant.people.agent!.token, body: { assigneeId: tenant.people.agent!.id } });
  await raise('Keyboard is sticky', tenant.teamId, ['pending_requester']);
  await raise('Router reboots itself', tenant.otherTeamId, ['in_progress', 'resolved']);
}, 120_000);

afterAll(async () => {
  await deleteTestTenant('ticket-count');
  await closeHarness();
});

type Persona = 'requester' | 'otherRequester' | 'agent' | 'otherAgent' | 'lead' | 'admin';

async function both(persona: Persona, query: string): Promise<{ listed: number; count: number; capped: boolean }> {
  const token = tenant.people[persona]!.token;
  const list = await request<{ data: unknown[]; nextCursor: string | null }>(`/api/v1/tickets?limit=200${query ? `&${query}` : ''}`, { token });
  expect(list.status).toBe(200);
  // One page is the whole list here; a second page would make the comparison meaningless.
  expect(list.body.nextCursor).toBeNull();

  const counted = await request<{ count: number; capped: boolean }>(`/api/v1/tickets/count${query ? `?${query}` : ''}`, { token });
  expect(counted.status, JSON.stringify(counted.body)).toBe(200);
  return { listed: list.body.data.length, count: counted.body.count, capped: counted.body.capped };
}

describe('the count matches the list', () => {
  const personas: Persona[] = ['requester', 'otherRequester', 'agent', 'otherAgent', 'lead', 'admin'];
  const queries = [
    '',
    'filter[statusCategory]=open,paused',
    'filter[statusCategory]=resolved',
    'filter[assignee]=me',
    'filter[assignee]=none&filter[statusCategory]=open',
    'filter[status]=pending_requester,pending_third_party,pending_approval',
    'q=sticky',
  ];

  it.each(personas)('for %s, on every view', async (persona) => {
    for (const query of queries) {
      const { listed, count, capped } = await both(persona, query);
      expect({ query, count, capped }).toEqual({ query, count: listed, capped: false });
    }
  });

  it('for a team view, which scope narrows further', async () => {
    for (const persona of ['agent', 'otherAgent', 'admin'] as const) {
      const { listed, count } = await both(persona, `filter[group]=${tenant.teamId}`);
      expect(count).toBe(listed);
    }
    // The other team's agent sees none of the primary team's queue.
    expect((await both('otherAgent', `filter[group]=${tenant.teamId}`)).count).toBe(0);
  });

  it('counts only what each person may see', async () => {
    const everything = (await both('admin', '')).count;
    const requesterOwn = (await both('requester', '')).count;
    expect(requesterOwn).toBeGreaterThan(0);
    expect(requesterOwn).toBeLessThan(everything);
  });
});

describe('the route', () => {
  it('ignores paging and sorting, so a list query can be sent unchanged', async () => {
    const token = tenant.people.admin!.token;
    const plain = await request<{ count: number }>('/api/v1/tickets/count', { token });
    const paged = await request<{ count: number }>('/api/v1/tickets/count?limit=1&sort=dueAt&cursor=anything', { token });
    expect(paged.status).toBe(200);
    expect(paged.body.count).toBe(plain.body.count);
  });

  it('is not mistaken for a ticket called "count"', async () => {
    const response = await request<{ count?: number; capped?: boolean }>('/api/v1/tickets/count', { token: tenant.people.agent!.token });
    expect(response.status).toBe(200);
    expect(Object.keys(response.body).sort()).toEqual(['capped', 'count']);
  });

  it('checks the filters as the list does', async () => {
    const response = await request('/api/v1/tickets/count?filter[group]=not-a-uuid', { token: tenant.people.admin!.token });
    expect(response.status).toBe(422);
  });

  it('needs a signed-in caller', async () => {
    expect((await request('/api/v1/tickets/count')).status).toBe(401);
  });
});

describe('the cap', () => {
  // A thousand tickets would make this suite slow to prove a comparison; the
  // cap is a parameter of the service, so it is proved at a size that fits.
  const ctx = () => contextFor(tenant.id);

  it('stops at the cap and says so', async () => {
    const counted = await withContext(ctx(), () => ticketService.countTicketsUpTo(ctx(), {}, 2));
    expect(counted).toEqual({ count: 2, capped: true });
  });

  it('is exact below the cap, and at it', async () => {
    const total = await withContext(ctx(), () => ticketService.countTickets(ctx(), {}));
    expect(await withContext(ctx(), () => ticketService.countTicketsUpTo(ctx(), {}, total))).toEqual({ count: total, capped: false });
    expect(await withContext(ctx(), () => ticketService.countTicketsUpTo(ctx(), {}, total + 5))).toEqual({ count: total, capped: false });
    expect(await withContext(ctx(), () => ticketService.countTicketsUpTo(ctx(), {}, total - 1))).toEqual({ count: total - 1, capped: true });
  });

  it('stops reading at the cap rather than counting everything and clamping', async () => {
    // The point of the cap is the cost, not the number: the count runs with a
    // LIMIT, so it reads at most cap + 1 rows however many tickets match.
    const counted = await withContext(ctx(), () => transaction(ctx(), (tx) => ticketService.repo.countTickets(tx, {}, undefined, 1)));
    expect(counted).toBe(1);
  });

  it('defaults to a thousand', () => {
    expect(ticketService.COUNT_CAP).toBe(1000);
  });
});
