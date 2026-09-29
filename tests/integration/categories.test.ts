import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { transaction, withContext } from '@itsm/platform';
import { closeHarness, contextFor, createTestTenant, deleteTestTenant, request, type TestTenant } from '../support/harness.js';

/**
 * `GET /categories` (WA2): the tree a ticket's category comes from.
 *
 * Nothing maintains categories through the API, so the rows are written
 * directly, one of each kind the reader has to tell apart: active, retired,
 * deleted, this organisation's and another's.
 */

let tenant: TestTenant;
const ids = {
  active: randomUUID(),
  child: randomUUID(),
  retired: randomUUID(),
  deleted: randomUUID(),
  ownOrg: randomUUID(),
  otherOrg: randomUUID(),
};

interface Category {
  id: string;
  key: string;
  name: string;
  path: string;
  parentId: string | null;
  orgId: string | null;
  defaultGroupId: string | null;
  isActive: boolean;
}

beforeAll(async () => {
  tenant = await createTestTenant('categories');
  const row = (id: string, key: string, path: string, extra: Record<string, unknown> = {}) => ({
    id,
    tenantId: tenant.id,
    key,
    name: path.split(' / ').at(-1)!,
    path,
    ...extra,
  });
  const ctx = contextFor(tenant.id);
  await withContext(ctx, () =>
    transaction(ctx, (tx) =>
      tx.category.createMany({
        data: [
          row(ids.active, 'hardware', 'Hardware', { defaultGroupId: tenant.teamId }),
          row(ids.child, 'hardware-printing', 'Hardware / Printing', { parentId: ids.active }),
          row(ids.retired, 'fax', 'Fax', { isActive: false }),
          row(ids.deleted, 'telex', 'Telex', { deletedAt: new Date() }),
          row(ids.ownOrg, 'local-kit', 'Local kit', { orgId: tenant.orgId }),
          // An organisation this tenant's people do not belong to.
          row(ids.otherOrg, 'elsewhere', 'Elsewhere', { orgId: randomUUID() }),
        ],
      }),
    ),
  );
}, 120_000);

afterAll(async () => {
  await deleteTestTenant('categories');
  await closeHarness();
});

async function categories(persona: string, query = ''): Promise<Category[]> {
  const response = await request<{ data: Category[] }>(`/api/v1/categories${query}`, { token: tenant.people[persona]!.token });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return response.body.data;
}

describe('what an agent may pick from', () => {
  it('lists active categories in path order, with what a picker needs', async () => {
    const rows = await categories('agent');
    expect(rows.map((row) => row.path)).toEqual(['Hardware', 'Hardware / Printing', 'Local kit']);
    expect(rows[0]).toEqual({
      id: ids.active,
      key: 'hardware',
      name: 'Hardware',
      path: 'Hardware',
      parentId: null,
      orgId: null,
      defaultGroupId: tenant.teamId,
      isActive: true,
    });
    expect(rows[1]).toMatchObject({ id: ids.child, parentId: ids.active, name: 'Printing' });
  });

  it('adds retired ones when asked, so an older ticket can still be named', async () => {
    const rows = await categories('agent', '?includeInactive=true');
    expect(rows.find((row) => row.id === ids.retired)).toMatchObject({ isActive: false });
    // Deleted is gone either way.
    expect(rows.some((row) => row.id === ids.deleted)).toBe(false);
  });

  it('reads includeInactive=false as false', async () => {
    const rows = await categories('agent', '?includeInactive=false');
    expect(rows.some((row) => row.id === ids.retired)).toBe(false);
  });

  it('refuses parameters it does not know, and booleans it would have to guess', async () => {
    const token = tenant.people.agent!.token;
    expect((await request('/api/v1/categories?includeInactive=yes', { token })).status).toBe(422);
    expect((await request('/api/v1/categories?parent=x', { token })).status).toBe(422);
  });
});

describe('organisation scope', () => {
  it('keeps another organisation\'s categories from a reader without tenant-wide access', async () => {
    for (const persona of ['agent', 'requester']) {
      const rows = await categories(persona);
      expect(rows.some((row) => row.id === ids.otherOrg), persona).toBe(false);
      expect(rows.some((row) => row.id === ids.ownOrg), persona).toBe(true);
    }
  });

  it('shows every organisation\'s to a reader with tenant-wide access', async () => {
    const rows = await categories('admin');
    expect(rows.some((row) => row.id === ids.otherOrg)).toBe(true);
  });
});

describe('the gate', () => {
  it('needs a signed-in caller', async () => {
    expect((await request('/api/v1/categories')).status).toBe(401);
  });
});
