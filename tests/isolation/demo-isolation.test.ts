import Redis from 'ioredis';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SYSTEM_PERMISSIONS, createContext, resetConfig, transaction, withContext } from '@itsm/platform';
import { closeHarness, createTestTenant, deleteTestTenant, getApp, request, type TestTenant } from '../support/harness.js';
import { createDemoFixture, type DemoFixture } from '../support/demo-fixture.js';
import { scanKeys } from '../support/redis-keys.js';

/**
 * The shared demo cannot reach a real tenant (A3 §11.2 row 27; SPEC v3 §4.4).
 *
 * Release-blocking. A scripted demo visit — the three personas, every way a
 * record can be named (by id, by number, through search, the audit log and
 * the event stream's topics), reads and writes — is pointed at a standard
 * tenant built by the same harness as the tenant isolation suite. Every
 * attempt must answer 404 or 401, never 200 with the other tenant's data,
 * and afterwards the standard tenant's rows must be exactly as they were.
 * The reverse direction — a real session reaching into the demo — is
 * refused by the same interlock and asserted at the end.
 *
 * Ticket numbers are deliberately allowed to coincide (both tenants number
 * from the same start): a number the demo resolves must resolve to the
 * demo's own ticket, which is the leak a test with different-looking data
 * would miss.
 */

const APP = 'it-demo-isolation';
const STANDARD_SLUG = 'demoiso-std';

let demo: DemoFixture;
let standard: TestTenant;
let redis: Redis;
let tokens: Record<'employee' | 'agent' | 'admin', string>;
let before: Counts;

interface Counts {
  tickets: number;
  comments: number;
  audit: number;
  users: number;
  memberships: number;
  ticketVersions: number[];
}

async function countsOf(tenantId: string, ticketIds: readonly string[]): Promise<Counts> {
  const ctx = createContext({ tenantId, actor: { type: 'system', id: null }, permissions: SYSTEM_PERMISSIONS });
  return withContext(ctx, () =>
    transaction(ctx, async (tx) => ({
      tickets: await tx.ticket.count(),
      comments: await tx.ticketComment.count(),
      audit: await tx.auditEvent.count(),
      users: await tx.user.count(),
      memberships: await tx.teamMembership.count(),
      ticketVersions: (await tx.ticket.findMany({ where: { id: { in: [...ticketIds] } }, select: { id: true, version: true }, orderBy: { id: 'asc' } })).map(
        (row) => row.version,
      ),
    })),
  );
}

const DENIED = [401, 403, 404];

beforeAll(async () => {
  vi.stubEnv('DEMO_MODE', 'on');
  vi.stubEnv('DEMO_TENANT_SLUG', 'demo');
  resetConfig();
  redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', { family: 0 });
  standard = await createTestTenant(STANDARD_SLUG);
  demo = await createDemoFixture({ slug: 'demo-it-isolation', appName: APP, generation: 3, redis });
  tokens = {
    employee: await demo.mintTestToken('employee'),
    agent: await demo.mintTestToken('agent'),
    admin: await demo.mintTestToken('admin'),
  };
  await getApp();
  before = await countsOf(standard.id, standard.ticketIds);
}, 180_000);

afterAll(async () => {
  await demo?.dispose();
  await deleteTestTenant(STANDARD_SLUG);
  expect(await scanKeys(redis, `bff:${APP}:*`)).toEqual([]);
  await redis.quit();
  await closeHarness();
  vi.unstubAllEnvs();
  resetConfig();
});

describe('a demo session reading a real tenant', () => {
  it('never reads another tenant’s ticket by id', async () => {
    for (const token of Object.values(tokens)) {
      for (const id of standard.ticketIds) {
        const response = await request(`/api/v1/tickets/${id}`, { token });
        expect(response.status, id).toBe(404);
        const timeline = await request(`/api/v1/tickets/${id}/timeline`, { token });
        expect(DENIED).toContain(timeline.status);
      }
    }
  });

  it('resolves a shared ticket number to the demo’s own ticket, never the other tenant’s', async () => {
    for (const number of standard.ticketNumbers) {
      const response = await request<{ id?: string }>(`/api/v1/tickets/${number}`, { token: tokens.admin });
      if (response.status === 200) {
        expect(demo.ticketIds).toContain(response.body.id);
      } else {
        expect(response.status).toBe(404);
      }
      expect(standard.ticketIds).not.toContain(response.body.id);
    }
  });

  it('lists only the demo’s own tickets, users and audit rows', async () => {
    const tickets = await request<{ data: { id: string }[] }>('/api/v1/tickets?limit=200', { token: tokens.admin });
    expect(tickets.status).toBe(200);
    for (const id of standard.ticketIds) expect(tickets.body.data.map((ticket) => ticket.id)).not.toContain(id);

    const users = await request<{ data: { id: string }[] }>('/api/v1/users?limit=200', { token: tokens.admin });
    expect(users.status).toBe(200);
    for (const person of Object.values(standard.people)) expect(users.body.data.map((user) => user.id)).not.toContain(person.id);

    const byIds = await request<{ data: { id: string }[] }>(`/api/v1/users?ids=${standard.people.admin!.id},${standard.people.agent!.id}`, { token: tokens.admin });
    expect(byIds.status).toBe(200);
    expect(byIds.body.data).toEqual([]);

    const audit = await request<{ data: { targetId: string | null }[] }>('/api/v1/audit-events?limit=200', { token: tokens.admin });
    expect(audit.status).toBe(200);
    const targets = audit.body.data.map((row) => row.targetId);
    for (const id of [...standard.ticketIds, standard.id, ...Object.values(standard.people).map((person) => person.id)]) expect(targets).not.toContain(id);

    const filtered = await request<{ data: unknown[] }>(`/api/v1/audit-events?targetId=${standard.ticketIds[0]}`, { token: tokens.admin });
    expect(filtered.status).toBe(200);
    expect(filtered.body.data).toEqual([]);
  });

  it('finds nothing of another tenant through search', async () => {
    for (const token of Object.values(tokens)) {
      for (const q of ['VPN', 'Printer', 'Switch']) {
        const response = await request<{ data: { entityId: string }[] }>(`/api/v1/search?q=${q}&limit=100`, { token });
        expect(response.status).toBe(200);
        for (const id of standard.ticketIds) expect(response.body.data.map((hit) => hit.entityId)).not.toContain(id);
      }
    }
  });

  it('cannot watch another tenant’s ticket, queue or person on the event stream', async () => {
    const topics = [`ticket:${standard.ticketIds[0]}`, `group:${standard.teamId}`, `user:${standard.people.admin!.id}`];
    for (const token of Object.values(tokens)) {
      for (const topic of topics) {
        // Refused before any stream opens, so the request returns; a stream
        // that opened would hold it, so that is a failure with a name.
        const response = await Promise.race([
          request(`/api/v1/events/stream?topics=${encodeURIComponent(topic)}`, { token, headers: { accept: 'text/event-stream' } }),
          new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error(`a stream opened for ${topic}`)), 5_000)),
        ]);
        expect(DENIED, `${topic}`).toContain(response.status);
      }
    }
  });
});

describe('a demo session writing to a real tenant', () => {
  it('cannot comment on, change, assign or watch another tenant’s ticket', async () => {
    const id = standard.ticketIds[0]!;
    const attempts: { path: string; method: 'POST' | 'PATCH'; body: unknown }[] = [
      { path: `/api/v1/tickets/${id}/comments`, method: 'POST', body: { body: 'written from the demo', visibility: 'public' } },
      { path: `/api/v1/tickets/${id}`, method: 'PATCH', body: { title: 'renamed from the demo' } },
      { path: `/api/v1/tickets/${id}/assign`, method: 'POST', body: { method: 'manual' } },
      { path: `/api/v1/tickets/${id}/watchers`, method: 'POST', body: { userId: demo.personas.agent.userId } },
      { path: `/api/v1/tickets/${id}/transitions`, method: 'POST', body: { to: 'resolved' } },
    ];
    for (const token of Object.values(tokens)) {
      for (const attempt of attempts) {
        const response = await request(attempt.path, { method: attempt.method, token, body: attempt.body, headers: { 'if-match': '1' } });
        expect(DENIED, `${attempt.method} ${attempt.path}`).toContain(response.status);
      }
    }
  });

  it('cannot add a team member or deactivate a user of another tenant', async () => {
    const response = await request(`/api/v1/teams/${standard.teamId}/members`, {
      method: 'POST',
      token: tokens.admin,
      body: { userId: demo.personas.agent.userId, isLead: false },
    });
    expect(DENIED).toContain(response.status);
    const deactivate = await request(`/api/v1/users/${standard.people.spare!.id}/deactivate`, { method: 'POST', token: tokens.admin, body: {} });
    expect(DENIED).toContain(deactivate.status);
  });

  it('writes into the demo land in the demo', async () => {
    const created = await request<{ id: string }>('/api/v1/tickets', {
      method: 'POST',
      token: tokens.employee,
      body: { type: 'incident', title: 'Raised during the isolation visit', sourceChannel: 'portal' },
    });
    expect(created.status).toBe(201);
    const ctx = createContext({ tenantId: demo.tenantId, actor: { type: 'system', id: null }, permissions: SYSTEM_PERMISSIONS });
    const owner = await withContext(ctx, () => transaction(ctx, (tx) => tx.ticket.findFirst({ where: { id: created.body.id }, select: { tenantId: true } })));
    expect(owner?.tenantId).toBe(demo.tenantId);
  });

  it('leaves the real tenant’s rows exactly as they were after the whole visit', async () => {
    expect(await countsOf(standard.id, standard.ticketIds)).toEqual(before);
  });
});

describe('a real session reaching into the demo', () => {
  it('is refused at the door, whatever it asks for', async () => {
    // A real token always names its own tenant; the interlock is what stops
    // one minted for the demo tenant by a compromised issuer.
    const { signDevelopmentToken } = await import('../../apps/api/src/auth/verify.js');
    const intruder = signDevelopmentToken({ sub: standard.people.admin!.id, itsm_user_id: standard.people.admin!.id, tenant_id: demo.tenantId });
    for (const path of ['/api/v1/me', '/api/v1/tickets', `/api/v1/tickets/${demo.ticketIds[0]}`, '/api/v1/audit-events']) {
      const response = await request(path, { token: intruder });
      expect(response.status, path).toBe(401);
    }
    // And the real tenant's own sessions see none of the demo.
    for (const id of demo.ticketIds) {
      expect((await request(`/api/v1/tickets/${id}`, { token: standard.people.admin!.token })).status).toBe(404);
    }
  });
});
