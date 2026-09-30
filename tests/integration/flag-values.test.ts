import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeHarness, createTestTenant, deleteTestTenant, request, type TestTenant } from '../support/harness.js';

/**
 * `GET /feature-flags` with the tenant's values (A1).
 *
 * The list used to be the manifests' declarations only, so the features page
 * could show a flag's default and nothing about whether the tenant had turned
 * it off: a switch that could be flipped but never read back. Each flag now
 * carries `tenantValue` (the tenant's override, or null) and `value` (what the
 * tenant gets).
 */

let tenant: TestTenant;
const asAdmin = () => tenant.people.admin!.token;

interface Flag {
  key: string;
  module: string;
  default: boolean;
  owner: string;
  expires: string;
  description: string | null;
  tenantValue: boolean | null;
  value: boolean;
}

async function flags(token = asAdmin()): Promise<Flag[]> {
  const response = await request<{ data: Flag[] }>('/api/v1/feature-flags', { token });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return response.body.data;
}

async function flag(key: string): Promise<Flag> {
  const found = (await flags()).find((row) => row.key === key);
  expect(found, `${key} is declared`).toBeDefined();
  return found!;
}

const setFlag = (key: string, body: Record<string, unknown>) =>
  request<{ key: string; value: boolean }>(`/api/v1/feature-flags/${key}`, { method: 'PUT', token: asAdmin(), body });

beforeAll(async () => {
  tenant = await createTestTenant('flag-values');
}, 120_000);

afterAll(async () => {
  await deleteTestTenant('flag-values');
  await closeHarness();
});

describe('before anything is overridden', () => {
  it('lists every declared flag at its default, with no tenant value', async () => {
    const rows = await flags();
    expect(rows.map((row) => row.key)).toEqual(expect.arrayContaining(['ai.enabled', 'rules.engine.enabled', 'ticket.customFields']));
    for (const row of rows) {
      expect(row.tenantValue, row.key).toBeNull();
      expect(row.value, row.key).toBe(row.default);
      // The declaration is still all there, for the page's title, owner and expiry.
      expect(typeof row.owner).toBe('string');
      expect(typeof row.expires).toBe('string');
    }
  });
});

describe('after the tenant overrides a flag', () => {
  it('shows a switch turned off as off, whatever the default', async () => {
    expect((await flag('ai.enabled')).default).toBe(true);
    expect((await setFlag('ai.enabled', { value: false, reason: 'Pausing AI while we review it' })).status).toBe(200);
    expect(await flag('ai.enabled')).toMatchObject({ default: true, tenantValue: false, value: false });
  });

  it('shows it turned back on as on, and still as an override', async () => {
    expect((await setFlag('ai.enabled', { value: true })).status).toBe(200);
    // Equal to the default, but a decision the tenant made: the page can say so.
    expect(await flag('ai.enabled')).toMatchObject({ default: true, tenantValue: true, value: true });
  });

  it('turns on a flag whose default is off', async () => {
    expect((await setFlag('ticket.customFields', { value: true })).status).toBe(200);
    expect(await flag('ticket.customFields')).toMatchObject({ default: false, tenantValue: true, value: true });
  });

  it('leaves the others alone', async () => {
    expect(await flag('rules.engine.enabled')).toMatchObject({ tenantValue: null, value: true });
  });

  it('is the tenant-wide value: an organisation override does not change it', async () => {
    // The administrator is in this organisation, so `isEnabled` would answer
    // false for them — but the switch on the page is the tenant's.
    const scoped = await setFlag('rules.engine.enabled', { value: false, scopeType: 'organisation', scopeId: tenant.orgId });
    expect(scoped.status).toBe(200);
    expect(await flag('rules.engine.enabled')).toMatchObject({ default: true, tenantValue: null, value: true });
  });
});

describe('who may read it', () => {
  it('needs admin.setting.read', async () => {
    for (const persona of ['requester', 'agent', 'lead', 'otherAgent'] as const) {
      const response = await request('/api/v1/feature-flags', { token: tenant.people[persona]!.token });
      expect(response.status, persona).toBe(403);
    }
  });
});
