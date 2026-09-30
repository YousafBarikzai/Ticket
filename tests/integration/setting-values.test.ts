import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { modules } from '@itsm/platform';
import { closeHarness, createTestTenant, deleteTestTenant, request, type TestTenant } from '../support/harness.js';

/**
 * `GET /settings` with values, provenance and types (A2).
 *
 * The list used to be declarations only — key, scopes, default — so the
 * settings page made one `GET /settings/:key` per setting for the values and
 * kept its own table of which setting was a number and which a choice. Both
 * now come back in one call: the value exactly as `GET /settings/:key` reports
 * it, and a type descriptor read from the schema the write is validated
 * against.
 */

let tenant: TestTenant;
const asAdmin = () => tenant.people.admin!.token;

interface Setting {
  key: string;
  module: string;
  scopes: string[];
  default: unknown;
  description: string | null;
  value: unknown;
  source: 'organisation' | 'tenant' | 'platform-default';
  scopeId: string | null;
  version: number | null;
  publishedAt: string | null;
  publishedBy: string | null;
  type: { kind: string; [detail: string]: unknown };
}

async function settings(token = asAdmin()): Promise<Setting[]> {
  const response = await request<{ data: Setting[] }>('/api/v1/settings', { token });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return response.body.data;
}

async function setting(key: string): Promise<Setting> {
  const found = (await settings()).find((row) => row.key === key);
  expect(found, `${key} is declared`).toBeDefined();
  return found!;
}

const publish = (key: string, body: Record<string, unknown>) =>
  request<{ version: number }>(`/api/v1/settings/${key}`, { method: 'PUT', token: asAdmin(), body });

/** The single-key answer every row must agree with. */
async function describedAlone(key: string) {
  const response = await request<{ value: unknown; source: string; scopeId: string | null; version: number | null }>(
    `/api/v1/settings/${key}`,
    { token: asAdmin() },
  );
  expect(response.status).toBe(200);
  const { value, source, scopeId, version } = response.body;
  return { value, source, scopeId, version };
}

beforeAll(async () => {
  tenant = await createTestTenant('setting-values');
}, 120_000);

afterAll(async () => {
  await deleteTestTenant('setting-values');
  await closeHarness();
});

describe('type descriptors', () => {
  it('describes every declared setting, and none of them as opaque json', async () => {
    const rows = await settings();
    const declared = modules().flatMap((module) => module.settings.map((declaration) => declaration.key));
    expect(declared.length).toBeGreaterThanOrEqual(30);
    expect(rows.map((row) => row.key).sort()).toEqual([...declared].sort());
    // `json` is the "cannot say" answer. Every setting in the image today can
    // be said, so a new one that cannot is a decision someone should make.
    expect(rows.filter((row) => row.type.kind === 'json').map((row) => row.key)).toEqual([]);
  });

  it('reads the bounds and options from the schema the write is checked against', async () => {
    const byKey = new Map((await settings()).map((row) => [row.key, row.type]));
    expect(byKey.get('ticket.defaultPriority')).toEqual({ kind: 'enum', options: ['P1', 'P2', 'P3', 'P4'] });
    expect(byKey.get('ticket.autoClose.days')).toEqual({ kind: 'number', int: true, min: 1, max: 90 });
    expect(byKey.get('ticket.reopen.windowDays')).toEqual({ kind: 'number', int: true, min: 0, max: 90 });
    expect(byKey.get('notification.email.enabled')).toEqual({ kind: 'boolean' });
    expect(byKey.get('ai.language')).toEqual({ kind: 'string', min: 2, max: 40 });
    expect(byKey.get('ai.decision.autoThreshold')).toEqual({ kind: 'number', int: false, min: 0, minExclusive: true, max: 1 });
    expect(byKey.get('workload.defaultStrategy')).toEqual({ kind: 'enum', options: ['round_robin', 'least_loaded', 'skill'] });
    expect(byKey.get('problem.recurrenceThreshold')).toEqual({
      kind: 'object',
      fields: {
        tickets: { kind: 'number', int: true, min: 2, max: 500 },
        withinDays: { kind: 'number', int: true, min: 1, max: 365 },
      },
    });
    expect(byKey.get('incident.updateIntervalMinutes')).toEqual({
      kind: 'record',
      keys: ['SEV1', 'SEV2', 'SEV3'],
      value: { kind: 'number', int: true, min: 5, max: 1440 },
    });
  });

  it('describes a choice that a write outside its options is refused for', async () => {
    const refused = await publish('ticket.defaultPriority', { value: 'P5' });
    expect(refused.status).toBe(422);
  });
});

describe('values', () => {
  it('starts at the manifest defaults', async () => {
    for (const row of await settings()) {
      expect({ key: row.key, value: row.value, source: row.source, version: row.version, publishedAt: row.publishedAt }).toEqual({
        key: row.key,
        value: row.default,
        source: 'platform-default',
        version: null,
        publishedAt: null,
      });
    }
  });

  it('shows a tenant value, with its version and who published it', async () => {
    expect((await publish('ticket.reopen.windowDays', { value: 21, reason: 'Longer grace period' })).status).toBe(200);
    const row = await setting('ticket.reopen.windowDays');
    expect(row).toMatchObject({ value: 21, default: 14, source: 'tenant', scopeId: null, version: 1, publishedBy: tenant.people.admin!.id });
    expect(Date.parse(row.publishedAt!)).not.toBeNaN();
  });

  it('shows the organisation value to someone in that organisation, and says so', async () => {
    expect((await publish('ticket.autoClose.days', { value: 3 })).status).toBe(200);
    expect((await publish('ticket.autoClose.days', { value: 10, scopeType: 'organisation', scopeId: tenant.orgId })).status).toBe(200);
    expect(await setting('ticket.autoClose.days')).toMatchObject({ value: 10, source: 'organisation', scopeId: tenant.orgId, version: 1 });
  });

  it('follows a rollback, which is a new version', async () => {
    expect((await publish('ticket.reopen.windowDays', { value: 30 })).status).toBe(200);
    expect(await setting('ticket.reopen.windowDays')).toMatchObject({ value: 30, version: 2 });
    const rolledBack = await request('/api/v1/settings/ticket.reopen.windowDays/rollback', {
      method: 'POST',
      token: asAdmin(),
      body: { toVersion: 1 },
    });
    expect(rolledBack.status).toBe(200);
    expect(await setting('ticket.reopen.windowDays')).toMatchObject({ value: 21, source: 'tenant', version: 3 });
  });

  it('agrees with GET /settings/:key for every setting', async () => {
    // The list resolves every key in one query and the single read resolves
    // one; this is what keeps the two rules the same rule.
    for (const row of await settings()) {
      expect({ key: row.key, value: row.value, source: row.source, scopeId: row.scopeId, version: row.version }).toEqual({
        key: row.key,
        ...(await describedAlone(row.key)),
      });
    }
  });
});

describe('who may read it', () => {
  it('needs admin.setting.read', async () => {
    for (const persona of ['requester', 'agent', 'lead', 'otherAgent'] as const) {
      const response = await request('/api/v1/settings', { token: tenant.people[persona]!.token });
      expect(response.status, persona).toBe(403);
    }
  });
});
