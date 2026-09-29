import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId, transaction, withContext } from '@itsm/platform';
import { closeHarness, contextFor, createTestTenant, deleteTestTenant, request, type TestTenant } from '../support/harness.js';

/**
 * `GET /users?ids=` and `isExternal` (A3).
 *
 * The consoles show people by name beside tickets, audit rows and history,
 * and until now resolved them one `GET /users/:id` at a time or not at all.
 * `ids` resolves a page of them in one call, under exactly the scope the
 * directory already has; `isExternal` lets the People page say which are
 * contractors or suppliers instead of calling everyone "Internal".
 */

let tenant: TestTenant;
let otherTenant: TestTenant;
let otherOrgId: string;
let outsider: { id: string };
let contractor: { id: string };
let leaver: { id: string };
const bulkIds: string[] = [];

interface UserRow {
  id: string;
  email: string;
  displayName: string;
  status: string;
  primaryOrgId: string | null;
  isExternal: boolean;
}

const asAdmin = () => tenant.people.admin!.token;

async function lookup(ids: string[], token = asAdmin(), extra = ''): Promise<UserRow[]> {
  const response = await request<{ data: UserRow[] }>(`/api/v1/users?ids=${ids.join(',')}${extra}`, { token });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return response.body.data;
}

const idsOf = (rows: UserRow[]) => rows.map((row) => row.id).sort();

beforeAll(async () => {
  tenant = await createTestTenant('users-ids');
  otherTenant = await createTestTenant('users-ids-other');

  // An organisation outside the one every harness person belongs to, and
  // somebody in it: visible to an administrator, not to an agent whose
  // directory is their own organisations.
  const org = await request<{ id: string }>('/api/v1/organisations', {
    method: 'POST',
    token: asAdmin(),
    body: { name: 'Subsidiary', code: 'SUB' },
  });
  expect(org.status).toBe(201);
  otherOrgId = org.body.id;

  const create = async (body: Record<string, unknown>) => {
    const response = await request<{ id: string }>('/api/v1/users', { method: 'POST', token: asAdmin(), body });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return response.body;
  };
  outsider = await create({ email: 'olu.outsider@users-ids.test', displayName: 'Olu Outsider', primaryOrgId: otherOrgId });
  contractor = await create({ email: 'cal.contractor@users-ids.test', displayName: 'Cal Contractor', primaryOrgId: tenant.orgId, isExternal: true });
  leaver = await create({ email: 'lee.leaver@users-ids.test', displayName: 'Lee Leaver', primaryOrgId: tenant.orgId });
  expect((await request(`/api/v1/users/${leaver.id}/deactivate`, { method: 'POST', token: asAdmin(), body: {} })).status).toBe(200);

  // Enough people that a lookup capped at the directory's default page of
  // fifty would visibly come back short.
  const ctx = contextFor(tenant.id);
  await withContext(ctx, () =>
    transaction(ctx, async (tx) => {
      const rows = Array.from({ length: 60 }, (_, index) => {
        const id = newId();
        bulkIds.push(id);
        return {
          id,
          tenantId: tenant.id,
          email: `bulk-${index}@users-ids.test`,
          displayName: `Bulk Person ${String(index).padStart(2, '0')}`,
          primaryOrgId: tenant.orgId,
        };
      });
      await tx.user.createMany({ data: rows });
    }),
  );
}, 240_000);

afterAll(async () => {
  await deleteTestTenant('users-ids');
  await deleteTestTenant('users-ids-other');
  await closeHarness();
});

describe('isExternal', () => {
  it('is on every row of the directory, and true only for the external person', async () => {
    const response = await request<{ data: UserRow[] }>('/api/v1/users?limit=200', { token: asAdmin() });
    expect(response.status).toBe(200);
    for (const row of response.body.data) expect(typeof row.isExternal, row.email).toBe('boolean');
    expect(response.body.data.filter((row) => row.isExternal).map((row) => row.id)).toEqual([contractor.id]);
  });

  it('is on a single person too', async () => {
    const one = await request<UserRow>(`/api/v1/users/${contractor.id}`, { token: asAdmin() });
    expect(one.status).toBe(200);
    expect(one.body).toMatchObject({ id: contractor.id, displayName: 'Cal Contractor', isExternal: true });
  });
});

describe('looking people up by id', () => {
  it('returns exactly the people asked for', async () => {
    const rows = await lookup([tenant.people.agent!.id, contractor.id]);
    expect(idsOf(rows)).toEqual([tenant.people.agent!.id, contractor.id].sort());
    expect(rows.find((row) => row.id === contractor.id)).toMatchObject({ displayName: 'Cal Contractor', isExternal: true });
  });

  it('includes a deactivated person, whose name history still needs', async () => {
    expect(await lookup([leaver.id])).toEqual([expect.objectContaining({ id: leaver.id, displayName: 'Lee Leaver', status: 'inactive' })]);
  });

  it('answers for every id asked about, not the first fifty', async () => {
    expect(idsOf(await lookup(bulkIds))).toEqual([...bulkIds].sort());
  });

  it('still honours an explicit limit', async () => {
    expect(await lookup(bulkIds, asAdmin(), '&limit=5')).toHaveLength(5);
  });

  it('drops repeats and leaves out ids that are nobody', async () => {
    const rows = await lookup([contractor.id, contractor.id, randomUUID()]);
    expect(idsOf(rows)).toEqual([contractor.id]);
  });

  it('combines with the other filters', async () => {
    expect(idsOf(await lookup([contractor.id, leaver.id], asAdmin(), '&status=active'))).toEqual([contractor.id]);
    expect(idsOf(await lookup([contractor.id, leaver.id], asAdmin(), '&q=leaver'))).toEqual([leaver.id]);
  });

  it('never reaches into another tenant', async () => {
    expect(await lookup([otherTenant.people.agent!.id, otherTenant.people.admin!.id])).toEqual([]);
  });

  it('refuses more than two hundred ids, or anything that is not an id', async () => {
    const tooMany = Array.from({ length: 201 }, () => randomUUID());
    expect((await request(`/api/v1/users?ids=${tooMany.join(',')}`, { token: asAdmin() })).status).toBe(422);
    expect((await request('/api/v1/users?ids=not-an-id', { token: asAdmin() })).status).toBe(422);
    expect((await request('/api/v1/users?ids=', { token: asAdmin() })).status).toBe(422);
  });
});

describe('the caller’s scope still applies', () => {
  it('shows an agent the people in their organisations and not the rest', async () => {
    const rows = await lookup([tenant.people.requester!.id, contractor.id, outsider.id], tenant.people.agent!.token);
    expect(idsOf(rows)).toEqual([tenant.people.requester!.id, contractor.id].sort());
  });

  it('shows the administrator everybody asked about', async () => {
    expect(idsOf(await lookup([contractor.id, outsider.id]))).toEqual([contractor.id, outsider.id].sort());
  });

  it('shows a requester only themselves', async () => {
    const rows = await lookup([tenant.people.requester!.id, tenant.people.agent!.id, contractor.id], tenant.people.requester!.token);
    expect(idsOf(rows)).toEqual([tenant.people.requester!.id]);
  });

  it('does not widen when a search is added', async () => {
    // The regression: the search's `OR` replaced the scope's, so an agent who
    // typed a name saw matching people from every organisation.
    const response = await request<{ data: UserRow[] }>('/api/v1/users?q=outsider', { token: tenant.people.agent!.token });
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);
    const admin = await request<{ data: UserRow[] }>('/api/v1/users?q=outsider', { token: asAdmin() });
    expect(idsOf(admin.body.data)).toEqual([outsider.id]);
  });
});
