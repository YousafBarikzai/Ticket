import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId, transaction, withContext } from '@itsm/platform';
import { SYSTEM_ROLES } from '@itsm/module-identity';
import { closeHarness, contextFor, createTestTenant, deleteTestTenant, request, type TestTenant } from '../support/harness.js';

/**
 * `GET /roles` and `GET /users/:id/role-assignments` (A5).
 *
 * A role could be granted by key and revoked by assignment id, but neither
 * the roles nor anybody's assignments could be read — so the console could
 * not offer a role picker, show what a role allows, or take a role away.
 */

let tenant: TestTenant;
const asAdmin = () => tenant.people.admin!.token;

interface Role {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: { key: string; scope: string }[];
}

interface Assignment {
  id: string;
  roleKey: string;
  roleName: string;
  scopeType: string | null;
  scopeId: string | null;
  validFrom: string;
  validTo: string | null;
  viaScim: boolean;
}

async function roles(token = asAdmin()) {
  return request<{ data: Role[] }>('/api/v1/roles', { token });
}

async function assignments(userId: string, token = asAdmin()) {
  return request<{ data: Assignment[] }>(`/api/v1/users/${userId}/role-assignments`, { token });
}

beforeAll(async () => {
  tenant = await createTestTenant('roles');
  // A tenant's own role, which sorts after the system roles.
  const ctx = contextFor(tenant.id);
  await withContext(ctx, () =>
    transaction(ctx, async (tx) => {
      const id = newId();
      await tx.role.create({ data: { id, tenantId: tenant.id, key: 'auditor', name: 'Auditor', description: 'Reads the audit trail.' } });
      await tx.rolePermission.create({ data: { id: newId(), tenantId: tenant.id, roleId: id, permissionKey: 'audit.read', scope: 'any' } });
    }),
  );
}, 120_000);

afterAll(async () => {
  await deleteTestTenant('roles');
  await closeHarness();
});

describe('GET /roles', () => {
  it('lists the system roles in the seed’s order, then the tenant’s own', async () => {
    const response = await roles();
    expect(response.status).toBe(200);
    expect(response.body.data.map((role) => role.key)).toEqual([...SYSTEM_ROLES.map((role) => role.key), 'auditor']);
    expect(response.body.data.at(-1)).toMatchObject({ name: 'Auditor', isSystem: false, permissions: [{ key: 'audit.read', scope: 'any' }] });
  });

  it('says exactly what each system role grants', async () => {
    const byKey = new Map((await roles()).body.data.map((role) => [role.key, role]));
    for (const seeded of SYSTEM_ROLES) {
      const role = byKey.get(seeded.key)!;
      expect(role).toMatchObject({ name: seeded.name, description: seeded.description, isSystem: true });
      const expected = seeded.permissions
        .map((permission) => ({ key: permission.key, scope: permission.scope }))
        .sort((a, b) => a.key.localeCompare(b.key) || a.scope.localeCompare(b.scope));
      expect(role.permissions).toEqual(expected);
    }
  });

  it('needs identity.role.read', async () => {
    for (const persona of ['requester', 'agent', 'lead', 'otherAgent'] as const) {
      expect((await roles(tenant.people[persona]!.token)).status, persona).toBe(403);
    }
  });
});

describe('GET /users/:id/role-assignments', () => {
  it('lists a person’s assignments with the ids a revoke takes', async () => {
    const response = await assignments(tenant.people.agent!.id);
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([
      expect.objectContaining({ roleKey: 'agent', roleName: 'Service desk agent', scopeType: null, scopeId: null, validTo: null, viaScim: false }),
    ]);
  });

  it('round-trips with grant and revoke', async () => {
    const spare = tenant.people.spare!.id;
    const granted = await request<{ id: string }>('/api/v1/role-assignments', {
      method: 'POST',
      token: asAdmin(),
      body: { userId: spare, roleKey: 'team_lead', scopeType: 'organisation', scopeId: tenant.orgId },
    });
    expect(granted.status).toBe(201);

    const listed = (await assignments(spare)).body.data;
    expect(listed.map((row) => row.roleKey).sort()).toEqual(['requester', 'team_lead']);
    const lead = listed.find((row) => row.roleKey === 'team_lead')!;
    expect(lead).toMatchObject({ id: granted.body.id, scopeType: 'organisation', scopeId: tenant.orgId });
    expect(Date.parse(lead.validFrom)).not.toBeNaN();

    expect((await request(`/api/v1/role-assignments/${lead.id}`, { method: 'DELETE', token: asAdmin() })).status).toBe(204);
    expect((await assignments(spare)).body.data.map((row) => row.roleKey)).toEqual(['requester']);
  });

  it('404s for nobody and refuses what is not an id', async () => {
    expect((await assignments(randomUUID())).status).toBe(404);
    expect((await request('/api/v1/users/not-an-id/role-assignments', { token: asAdmin() })).status).toBe(422);
  });

  it('needs identity.role.read, even for your own', async () => {
    for (const persona of ['requester', 'agent', 'lead', 'otherAgent'] as const) {
      const self = tenant.people[persona]!;
      expect((await assignments(self.id, self.token)).status, persona).toBe(403);
    }
  });
});
