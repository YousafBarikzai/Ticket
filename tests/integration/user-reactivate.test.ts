import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { transaction, withContext } from '@itsm/platform';
import { closeHarness, contextFor, createTestTenant, deleteTestTenant, request, type TestTenant } from '../support/harness.js';

/**
 * `POST /users/:id/reactivate` (A4).
 *
 * The service could bring a person back (SCIM did, when a provider set them
 * active again) but nothing on the API could, so deactivating somebody from
 * the console by mistake had no undo short of the identity provider.
 */

let tenant: TestTenant;
const asAdmin = () => tenant.people.admin!.token;
let person: { id: string };

interface UserRow {
  id: string;
  status: string;
}

const reactivate = (id: string, token = asAdmin(), body: unknown = {}) =>
  request<UserRow>(`/api/v1/users/${id}/reactivate`, { method: 'POST', token, body });

async function auditFor(id: string): Promise<{ action: string; reason: string | null }[]> {
  const ctx = contextFor(tenant.id);
  return withContext(ctx, () =>
    transaction(ctx, async (tx) => {
      const rows = await tx.auditEvent.findMany({ where: { targetType: 'user', targetId: id }, orderBy: { seq: 'asc' } });
      return rows.map((row) => ({ action: row.action, reason: row.reason }));
    }),
  );
}

async function teamsOf(id: string): Promise<string[]> {
  const ctx = contextFor(tenant.id);
  return withContext(ctx, () =>
    transaction(ctx, async (tx) => (await tx.teamMembership.findMany({ where: { userId: id } })).map((row) => row.teamId)),
  );
}

beforeAll(async () => {
  tenant = await createTestTenant('user-reactivate');
  const created = await request<{ id: string }>('/api/v1/users', {
    method: 'POST',
    token: asAdmin(),
    body: { email: 'rae.returner@user-reactivate.test', displayName: 'Rae Returner', primaryOrgId: tenant.orgId },
  });
  expect(created.status).toBe(201);
  person = created.body;
  expect((await request('/api/v1/role-assignments', { method: 'POST', token: asAdmin(), body: { userId: person.id, roleKey: 'agent' } })).status).toBe(201);
  expect((await request(`/api/v1/teams/${tenant.teamId}/members`, { method: 'POST', token: asAdmin(), body: { userId: person.id } })).status).toBe(201);

  const deactivated = await request<UserRow>(`/api/v1/users/${person.id}/deactivate`, {
    method: 'POST',
    token: asAdmin(),
    body: { reason: 'Left the company' },
  });
  expect(deactivated.body.status).toBe('inactive');
}, 120_000);

afterAll(async () => {
  await deleteTestTenant('user-reactivate');
  await closeHarness();
});

describe('who may reactivate', () => {
  it('refuses anybody without identity.user.manage', async () => {
    for (const persona of ['requester', 'agent', 'lead', 'otherAgent'] as const) {
      expect((await reactivate(person.id, tenant.people[persona]!.token)).status, persona).toBe(403);
    }
    const still = await request<UserRow>(`/api/v1/users/${person.id}`, { token: asAdmin() });
    expect(still.body.status).toBe('inactive');
  });
});

describe('reactivating', () => {
  it('brings the person back, audited with the reason given', async () => {
    const response = await reactivate(person.id, asAdmin(), { reason: 'Deactivated the wrong Rae' });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ id: person.id, status: 'active' });

    const read = await request<UserRow>(`/api/v1/users/${person.id}`, { token: asAdmin() });
    expect(read.body.status).toBe('active');
    expect(await auditFor(person.id)).toEqual(
      expect.arrayContaining([
        { action: 'user.deactivated', reason: 'Left the company' },
        { action: 'user.reactivated', reason: 'Deactivated the wrong Rae' },
      ]),
    );
  });

  it('does not give back the roles deactivation took away', async () => {
    // Whoever brings a person back decides what they may do.
    const assignments = await request<{ data: unknown[] }>(`/api/v1/users/${person.id}/role-assignments`, { token: asAdmin() });
    expect(assignments.status).toBe(200);
    expect(assignments.body.data).toEqual([]);
  });

  it('leaves them in the teams they were in', async () => {
    expect(await teamsOf(person.id)).toEqual([tenant.teamId]);
  });

  it('is idempotent: somebody already active comes back as they are, with nothing audited', async () => {
    const again = await reactivate(person.id);
    expect(again.status).toBe(200);
    expect(again.body).toEqual({ id: person.id, status: 'active' });
    expect((await auditFor(person.id)).filter((row) => row.action === 'user.reactivated')).toHaveLength(1);
  });

  it('404s for nobody, and refuses what is not an id or a body it does not know', async () => {
    expect((await reactivate(randomUUID())).status).toBe(404);
    expect((await reactivate('not-an-id')).status).toBe(422);
    expect((await reactivate(person.id, asAdmin(), { reason: 'x', status: 'active' })).status).toBe(422);
  });
});
