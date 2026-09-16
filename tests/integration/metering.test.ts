import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { transaction, withContext } from '@itsm/platform';
import { planService, usageService } from '@itsm/module-tenancy';
import { closeHarness, contextFor, createTestTenant, deleteTestTenant, drainEvents, request, type TestTenant } from '../support/harness.js';

/**
 * Plans, limits and metering (MOD-21).
 *
 * The unit tests prove the arithmetic. This proves the loop that matters
 * commercially and the one that matters operationally: a figure that moves
 * as work lands and can be rebuilt from the rows beneath it, a warning that
 * arrives once, a refusal that names the plan and stops only the act that
 * grows the meter — and a desk that can still finish the work it already
 * has while refused.
 */

let tenant: TestTenant;

beforeAll(async () => {
  tenant = await createTestTenant('metering');
}, 120_000);

afterAll(async () => {
  await deleteTestTenant('metering');
  await closeHarness();
});

const asAdmin = () => tenant.people.admin!.token;
const asAgent = () => tenant.people.agent!.token;
const asRequester = () => tenant.people.requester!.token;

function ctx() {
  return contextFor(tenant.id);
}

async function read<T>(fn: (tx: Parameters<Parameters<typeof transaction>[1]>[0]) => Promise<T>): Promise<T> {
  const context = ctx();
  return withContext(context, () => transaction(context, fn));
}

interface Usage {
  plan: { key: string; name: string } | null;
  meters: { meter: string; value: number; display: string; state: string; soft: number | null; hard: number | null; period: string }[];
}

async function usage(): Promise<Usage> {
  const response = await request<Usage>('/api/v1/usage', { token: asAdmin() });
  expect(response.status).toBe(200);
  return response.body;
}

async function meter(name: string) {
  return (await usage()).meters.find((row) => row.meter === name)!;
}

/** Puts the tenant on a plan with exactly these lines, and clears the cached verdicts. */
async function plan(key: string, limits: { meter: string; soft?: number | null; hard?: number | null }[]) {
  const context = ctx();
  await withContext(context, async () => {
    await planService.savePlan(context, { key, name: key, limits } as never);
    await planService.assignPlan(context, tenant.id, key);
  });
}

async function raiseTicket(title: string, token = asRequester()) {
  return request<{ id: string; number: string; detail?: string }>('/api/v1/tickets', {
    method: 'POST',
    token,
    body: { type: 'incident', title, priority: 'P3' },
  });
}

describe('a tenant with no plan', () => {
  it('has meters and no limits, and refuses nothing', async () => {
    const before = await usage();
    expect(before.plan).toBeNull();
    expect(before.meters.map((row) => row.meter).sort()).toEqual(['agents', 'api_calls', 'storage', 'tickets']);
    expect(before.meters.every((row) => row.hard === null && row.state === 'ok')).toBe(true);
    expect((await raiseTicket('No plan, no limit')).status).toBe(201);
  });

  it('is nobody else\'s business', async () => {
    expect((await request('/api/v1/usage', { token: asAgent() })).status).toBe(403);
  });
});

describe('what the meters count', () => {
  it('counts the people who work the desk, not the people who ask', async () => {
    const context = ctx();
    await withContext(context, () => usageService.recompute(context));
    // The harness makes an administrator, a lead and two agents; the three
    // requesters are not agents however many of them there are.
    expect((await meter('agents')).value).toBe(4);
  });

  it('counts a ticket as it is raised, and the month it belongs to', async () => {
    const context = ctx();
    await withContext(context, () => usageService.recompute(context));
    const before = await meter('tickets');
    expect(before.period).toMatch(/^\d{4}-\d{2}$/);

    const raised = await raiseTicket('Counted when raised');
    expect(raised.status).toBe(201);
    await drainEvents(tenant.id);
    expect((await meter('tickets')).value).toBe(before.value + 1);
  });

  it('does not count history a migration brought in', async () => {
    const before = (await meter('tickets')).value;
    const { ticketService } = await import('@itsm/module-ticket');
    const context = ctx();
    await withContext(context, () =>
      ticketService.importTicket(context, {
        title: 'Raised in 2021, somewhere else',
        status: 'closed',
        externalRef: 'LEGACY-0001',
        createdAt: new Date('2021-04-08T09:15:00Z'),
        closedAt: new Date('2021-04-09T09:15:00Z'),
      }),
    );
    await drainEvents(tenant.id);
    // A desk that moved in on the first of the month must not spend its
    // month's allowance on its own history (ADR-0038).
    expect((await meter('tickets')).value).toBe(before);
  });

  it('rebuilds every figure it can from the rows beneath it, and says which it cannot', async () => {
    const context = ctx();
    // Tamper with a figure the way an accumulation bug would.
    await withContext(context, () =>
      transaction(context, (tx) => tx.usageMeter.updateMany({ where: { meter: 'tickets' }, data: { value: 999n } })),
    );
    const result = await withContext(context, () => usageService.recompute(context));
    expect(result.corrected).toBeGreaterThan(0);
    expect((await meter('tickets')).value).toBeLessThan(999);

    // `api_calls` has no row anywhere that remembers a request, so it is not
    // rebuilt — and `measure` says so rather than returning a wrong figure.
    const measured = await read((tx) => usageService.measure(context, tx, 'api_calls'));
    expect(measured).toBeNull();
  });
});

describe('the warning', () => {
  it('arrives once, and tells the administrators', async () => {
    const current = (await meter('tickets')).value;
    await plan('warn-test', [{ meter: 'tickets', soft: current + 1, hard: current + 3 }]);

    const raised = await raiseTicket('The one that crosses the warning');
    expect(raised.status).toBe(201);
    await drainEvents(tenant.id);

    const warned = await meter('tickets');
    expect(warned.state).toBe('warned');
    const notification = await read((tx) =>
      tx.notification.findFirst({ where: { recipientId: tenant.people.admin!.id, templateKey: 'usage.limit.warned' }, orderBy: { createdAt: 'desc' } }),
    );
    expect(notification).not.toBeNull();

    // The nightly rebuild finds the same figure. It must not say so again.
    const context = ctx();
    await withContext(context, () => usageService.recompute(context));
    await drainEvents(tenant.id);
    const events = await read((tx) => tx.outboxEvent.count({ where: { type: 'usage.limit.reached' } }));
    expect(events).toBe(1);
  });
});

describe('the refusal', () => {
  it('stops the act that grows the meter, and names the plan', async () => {
    const current = (await meter('tickets')).value;
    await plan('tiny', [{ meter: 'tickets', soft: current, hard: current }]);

    const refused = await raiseTicket('One too many');
    expect(refused.status).toBe(402);
    expect(refused.body.detail).toContain('tiny');
    expect(refused.body.detail).toMatch(/larger plan/);
    // The reassurance is part of the contract: what is here keeps working.
    expect(refused.body.detail).toMatch(/keeps working/);
  });

  it('never stops the desk finishing the work it already has', async () => {
    const existing = await request<{ data: { id: string }[] }>('/api/v1/tickets?limit=1', { token: asAgent() });
    expect(existing.status).toBe(200);
    const ticketId = tenant.ticketIds[0]!;

    expect((await request(`/api/v1/tickets/${ticketId}`, { token: asAgent() })).status).toBe(200);
    const commented = await request(`/api/v1/tickets/${ticketId}/comments`, { method: 'POST', token: asAgent(), body: { body: 'Still working, still refused a new one.' } });
    expect(commented.status).toBe(201);
    const moved = await request(`/api/v1/tickets/${ticketId}/transitions`, { method: 'POST', token: asAgent(), body: { to: 'in_progress', reason: 'limit test' } });
    expect([200, 201]).toContain(moved.status);
  });

  it('lifts within a minute of a larger plan', async () => {
    const current = (await meter('tickets')).value;
    await plan('roomier', [{ meter: 'tickets', soft: current + 100, hard: current + 200 }]);
    const allowed = await raiseTicket('Allowed again');
    expect(allowed.status, JSON.stringify(allowed.body)).toBe(201);
  });

  it('refuses the role that would make one agent too many, and never the requester', async () => {
    const current = (await meter('agents')).value;
    await plan('two-agents', [{ meter: 'agents', soft: current, hard: current }]);

    const promoted = await request<{ detail: string }>('/api/v1/role-assignments', {
      method: 'POST',
      token: asAdmin(),
      body: { userId: tenant.people.spare!.id, roleKey: 'agent' },
    });
    expect(promoted.status).toBe(402);
    expect(promoted.body.detail).toContain('two-agents');

    // A requester is not an agent, so adding one is never refused: a desk
    // that cannot take on a customer because of a licence is not a desk.
    const stillFine = await request('/api/v1/role-assignments', {
      method: 'POST',
      token: asAdmin(),
      body: { userId: tenant.people.spare!.id, roleKey: 'requester' },
    });
    expect(stillFine.status).toBe(201);
  });
});

describe('the tenant\'s own warning threshold', () => {
  beforeAll(async () => {
    await plan('roomy', [{ meter: 'tickets', soft: 900, hard: 1000 }]);
  });

  it('can be brought forward, and is refused above the hard line', async () => {
    const brought = await request<{ soft: number; hard: number }>('/api/v1/usage/limits/tickets', { method: 'PUT', token: asAdmin(), body: { soft: 100 } });
    expect(brought.status).toBe(200);
    expect(brought.body.soft).toBe(100);
    expect(brought.body.hard).toBe(1000);
    expect((await meter('tickets')).soft).toBe(100);

    const refused = await request<{ detail: string }>('/api/v1/usage/limits/tickets', { method: 'PUT', token: asAdmin(), body: { soft: 5000 } });
    expect(refused.status).toBe(422);
    // A warning nobody can reach before the refusal is a warning that does
    // not exist, so the platform says so rather than storing it.
    expect(refused.body.detail).toMatch(/never arrive/);
  });

  it('is nobody below an administrator\'s to set, and the hard line is nobody\'s', async () => {
    expect((await request('/api/v1/usage/limits/tickets', { method: 'PUT', token: asAgent(), body: { soft: 1 } })).status).toBe(403);
    // There is no route that takes a hard limit at all: the plan holds it.
    const reset = await request('/api/v1/usage/limits/tickets', { method: 'PUT', token: asAdmin(), body: { soft: null } });
    expect(reset.status).toBe(200);
    expect((await meter('tickets')).soft).toBe(900);
  });
});

describe('API calls', () => {
  // Read from the database rather than through `/api/v1/usage`: reading the
  // meter over HTTP is itself an API call, and a test whose act of
  // measuring changes the figure cannot prove anything about it.
  async function counted(): Promise<number> {
    const row = await read((tx) => tx.usageMeter.findFirst({ where: { meter: 'api_calls' } }));
    return Number(row?.value ?? 0n);
  }

  it('are counted in the cache and written down in batches, and never twice', async () => {
    const context = ctx();
    const before = await counted();
    for (let i = 0; i < 3; i += 1) expect((await request('/api/v1/me', { token: asAdmin() })).status).toBe(200);

    // Nothing is written until the flush: a counter per request would make
    // throughput a function of how closely the API is metered.
    expect(await counted()).toBe(before);

    const flushed = await withContext(context, () => usageService.flushApiCalls((tenantId) => (tenantId === tenant.id ? context : null)));
    expect(flushed).toBeGreaterThanOrEqual(3);
    // Exactly what was taken out of the buffer, and not a call more: the
    // flush subtracts what it read rather than clearing the key, so a
    // request that arrived mid-flush is still owed rather than lost.
    expect(await counted()).toBe(before + flushed);

    const again = await withContext(context, () => usageService.flushApiCalls((tenantId) => (tenantId === tenant.id ? context : null)));
    expect(await counted()).toBe(before + flushed + again);
  });

  it('keeps each tenant\'s buffer under its own key', async () => {
    // A single global key holding a field per tenant cannot be dropped when
    // a tenant is purged, and is one careless read away from crossing the
    // boundary. The isolation suite refuses it; this names why.
    await request('/api/v1/me', { token: asAdmin() });
    expect(await usageService.tenantsAwaitingFlush()).toContain(tenant.id);
  });
});

describe('plans', () => {
  it('refuse a warning line above their own hard limit', async () => {
    const context = ctx();
    await expect(
      withContext(context, () => planService.savePlan(context, { key: 'nonsense', name: 'Nonsense', limits: [{ meter: 'agents', soft: 100, hard: 5 }] } as never)),
    ).rejects.toThrow(/warn first/);
  });

  it('replace their limits whole, so a line dropped is a line removed', async () => {
    const context = ctx();
    await withContext(context, () =>
      planService.savePlan(context, { key: 'shrinking', name: 'Shrinking', limits: [{ meter: 'agents', soft: 1, hard: 2 }, { meter: 'tickets', soft: 3, hard: 4 }] } as never),
    );
    const trimmed = await withContext(context, () => planService.savePlan(context, { key: 'shrinking', name: 'Shrinking', limits: [{ meter: 'agents', soft: 1, hard: 2 }] } as never));
    expect(trimmed.limits).toHaveLength(1);
    expect(trimmed.limits[0]!.meter).toBe('agents');
  });
});
