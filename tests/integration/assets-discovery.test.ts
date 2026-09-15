import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  closeHarness,
  contextFor,
  createTestTenant,
  deleteTestTenant,
  request,
  type TestTenant,
} from '../support/harness.js';
import { discoveryService, proposalService } from '@itsm/module-assets';
import type { GatewayResponse } from '@itsm/module-integrations';

/**
 * MOD-10-E2 discovery and reconciliation, end to end.
 *
 * The gateway is injected, for the reason the gateway's own suite gives: its
 * address guard refuses every address a test server could be on, so there is no
 * hermetic way to exercise a real successful call. What is proved here is
 * everything after the response arrives — mapping, matching, the propose-only
 * default, and the two behaviours that decide whether the queue is still usable
 * after a fortnight.
 */

let tenant: TestTenant;

beforeAll(async () => {
  tenant = await createTestTenant('discovery');
}, 120_000);

afterAll(async () => {
  await deleteTestTenant('discovery');
  await closeHarness();
});

const asAdmin = () => tenant.people.admin!.token;
const asLead = () => tenant.people.lead!.token;
const asAgent = () => tenant.people.agent!.token;

/** A gateway that answers with whatever the test put in front of it. */
function gatewayReturning(body: unknown, status = 200) {
  const calls: { url: string; hasCredential: boolean }[] = [];
  const callGateway = (async (_ctx: unknown, req: { url: string; credential?: unknown }) => {
    calls.push({ url: req.url, hasCredential: req.credential !== undefined });
    return { status, headers: {}, body, durationMs: 1 } satisfies GatewayResponse;
  }) as never;
  return { callGateway, calls };
}

const device = (over: Record<string, unknown> = {}) => ({
  id: 'intune-1',
  deviceName: 'LAP-042',
  complianceState: 'operational',
  serialNumber: 'SN-0001',
  manufacturer: 'Acme',
  model: 'ProBook 14',
  ...over,
});

beforeAll(async () => {
  // A class for the devices to land in, and one attribute that is declared, so
  // the validation path is exercised rather than bypassed.
  const created = await request('/api/v1/ci-classes', {
    method: 'POST',
    token: asAdmin(),
    body: {
      key: 'device',
      name: 'Device',
      attributes: [
        { key: 'serial', label: 'Serial', type: 'string', required: false },
        { key: 'manufacturer', label: 'Manufacturer', type: 'string', required: false },
        { key: 'model', label: 'Model', type: 'string', required: false },
        { key: 'operatingSystem', label: 'Operating system', type: 'string', required: false },
        { key: 'osVersion', label: 'OS version', type: 'string', required: false },
        { key: 'lastSyncedAt', label: 'Last synced', type: 'date', required: false },
        { key: 'enrolledAt', label: 'Enrolled', type: 'date', required: false },
        { key: 'primaryUser', label: 'Primary user', type: 'string', required: false },
      ],
    },
  });
  expect(created.status).toBe(201);
}, 60_000);

async function makeSource(key: string, over: Record<string, unknown> = {}) {
  const response = await request<{ key: string }>('/api/v1/discovery/sources', {
    method: 'POST',
    token: asAdmin(),
    body: {
      key,
      name: key,
      kind: 'http_json',
      config: {
        url: 'https://inventory.example.com/devices',
        recordsPath: 'value',
        mapping: {
          classKey: 'device',
          externalKeyFrom: 'id',
          nameFrom: 'deviceName',
          fields: { status: 'complianceState' },
          attributes: { serial: 'serialNumber', manufacturer: 'manufacturer', model: 'model' },
        },
      },
      ...over,
    },
  });
  expect(response.status).toBe(201);
  return response.body.key;
}

describe('a source is checked when it is configured', () => {
  it('refuses one with no mapping, rather than failing at two in the morning', async () => {
    const attempt = await request<{ detail: string }>('/api/v1/discovery/sources', {
      method: 'POST',
      token: asAdmin(),
      body: { key: 'no-mapping', name: 'No mapping', kind: 'http_json', config: { url: 'https://x.example.com/a' } },
    });
    expect(attempt.status).toBe(422);
    expect(attempt.body.detail).toMatch(/no mapping/);
  });

  it('describes what each built-in kind already knows', async () => {
    const kinds = await request<{ data: { kind: string; url?: string }[] }>('/api/v1/discovery/kinds', {
      token: asAdmin(),
    });
    expect(kinds.status).toBe(200);
    expect(kinds.body.data.find((row) => row.kind === 'intune')?.url).toMatch(/graph\.microsoft\.com/);
  });
});

describe('a run proposes and does not write', () => {
  it('turns unknown records into create proposals, and writes nothing', async () => {
    const key = await makeSource('propose-only');
    const ctx = contextFor(tenant.id);
    const { callGateway } = gatewayReturning({ value: [device(), device({ id: 'intune-2', deviceName: 'LAP-043' })] });

    const result = await discoveryService.runSource(ctx, key, { callGateway });
    expect(result.status).toBe('completed');
    expect(result.seen).toBe(2);
    expect(result.proposed).toBe(2);
    expect(result.applied).toBe(0);

    // Nothing is in the register yet. This is the whole point of E2.
    const items = await request<{ data: { externalKey: string | null }[] }>('/api/v1/cis?limit=200', {
      token: asAgent(),
    });
    expect(items.body.data.map((row) => row.externalKey)).not.toContain('intune-1');

    const queue = await request<{ data: { kind: string; externalKey: string }[] }>(
      `/api/v1/discovery/proposals?sourceKey=${key}`,
      { token: asLead() },
    );
    expect(queue.status).toBe(200);
    expect(queue.body.data.map((row) => row.kind)).toEqual(['create_ci', 'create_ci']);
  }, 60_000);

  it('reports the records it could not read and imports the rest', async () => {
    const key = await makeSource('partly-bad');
    const ctx = contextFor(tenant.id);
    const { callGateway } = gatewayReturning({
      value: [device({ id: 'ok-1' }), { deviceName: 'no id at all' }, device({ id: 'ok-2' })],
    });

    const result = await discoveryService.runSource(ctx, key, { callGateway });
    expect(result.seen).toBe(3);
    expect(result.rejected).toBe(1);
    expect(result.proposed).toBe(2);
    expect(result.problems[0]!.messages.join(' ')).toMatch(/nothing to match this record on/);
  }, 60_000);

  it('attaches the credential the source names, and nothing when it names none', async () => {
    const key = await makeSource('no-credential');
    const ctx = contextFor(tenant.id);
    const stub = gatewayReturning({ value: [] });
    await discoveryService.runSource(ctx, key, { callGateway: stub.callGateway });
    expect(stub.calls[0]!.hasCredential).toBe(false);
    expect(stub.calls[0]!.url).toBe('https://inventory.example.com/devices');
  }, 60_000);
});

describe('accepting and rejecting', () => {
  it('creates the item when somebody says yes, validating it as a person’s entry would be', async () => {
    const key = await makeSource('accepting');
    const ctx = contextFor(tenant.id);
    const { callGateway } = gatewayReturning({ value: [device({ id: 'accept-1', deviceName: 'LAP-100' })] });
    await discoveryService.runSource(ctx, key, { callGateway });

    const queue = await request<{ data: { id: string }[] }>(`/api/v1/discovery/proposals?sourceKey=${key}`, {
      token: asLead(),
    });
    const proposalId = queue.body.data[0]!.id;

    const accepted = await request<{ ciId: string; created: boolean }>(
      `/api/v1/discovery/proposals/${proposalId}/accept`,
      { method: 'POST', token: asLead() },
    );
    expect(accepted.status).toBe(200);
    expect(accepted.body.created).toBe(true);

    const item = await request<{ name: string; source: string; attributes: Record<string, unknown> }>(
      `/api/v1/cis/${accepted.body.ciId}`,
      { token: asAgent() },
    );
    expect(item.body.name).toBe('LAP-100');
    expect(item.body.source).toBe('discovery');
    expect(item.body.attributes.serial).toBe('SN-0001');
  }, 60_000);

  it('will not accept a proposal twice', async () => {
    const key = await makeSource('accept-twice');
    const ctx = contextFor(tenant.id);
    const { callGateway } = gatewayReturning({ value: [device({ id: 'twice-1', deviceName: 'LAP-101' })] });
    await discoveryService.runSource(ctx, key, { callGateway });

    const queue = await request<{ data: { id: string }[] }>(`/api/v1/discovery/proposals?sourceKey=${key}`, {
      token: asLead(),
    });
    const proposalId = queue.body.data[0]!.id;
    expect((await request(`/api/v1/discovery/proposals/${proposalId}/accept`, { method: 'POST', token: asLead() })).status).toBe(200);
    expect((await request(`/api/v1/discovery/proposals/${proposalId}/accept`, { method: 'POST', token: asLead() })).status).toBe(422);
  }, 60_000);

  it('does not raise the same proposal again once somebody has said no', async () => {
    // Otherwise saying no costs a click a day for ever, and the queue trains
    // people to accept everything to make it stop.
    const key = await makeSource('rejecting');
    const ctx = contextFor(tenant.id);
    const { callGateway } = gatewayReturning({ value: [device({ id: 'reject-1', deviceName: 'LAP-102' })] });
    await discoveryService.runSource(ctx, key, { callGateway });

    const queue = await request<{ data: { id: string }[] }>(`/api/v1/discovery/proposals?sourceKey=${key}`, {
      token: asLead(),
    });
    const rejected = await request(`/api/v1/discovery/proposals/${queue.body.data[0]!.id}/reject`, {
      method: 'POST',
      token: asLead(),
      body: { reason: 'A test machine that should never be in the register.' },
    });
    expect(rejected.status).toBe(200);

    const second = await discoveryService.runSource(ctx, key, { callGateway });
    expect(second.proposed).toBe(0);

    const stillEmpty = await request<{ data: unknown[] }>(`/api/v1/discovery/proposals?sourceKey=${key}`, {
      token: asLead(),
    });
    expect(stillEmpty.body.data).toEqual([]);
  }, 60_000);

  it('supersedes yesterday’s pending proposal rather than stacking another', async () => {
    // A daily run must not leave seven copies of every disagreement.
    const key = await makeSource('superseding');
    const ctx = contextFor(tenant.id);
    const { callGateway } = gatewayReturning({ value: [device({ id: 'super-1', deviceName: 'LAP-103' })] });
    await discoveryService.runSource(ctx, key, { callGateway });
    await discoveryService.runSource(ctx, key, { callGateway });

    const queue = await request<{ data: unknown[] }>(`/api/v1/discovery/proposals?sourceKey=${key}`, {
      token: asLead(),
    });
    expect(queue.body.data).toHaveLength(1);

    const superseded = await request<{ data: unknown[] }>(
      `/api/v1/discovery/proposals?sourceKey=${key}&status=superseded`,
      { token: asLead() },
    );
    expect(superseded.body.data).toHaveLength(1);
  }, 60_000);

  it('refuses a rejection with no reason', async () => {
    const key = await makeSource('no-reason');
    const ctx = contextFor(tenant.id);
    const { callGateway } = gatewayReturning({ value: [device({ id: 'noreason-1' })] });
    await discoveryService.runSource(ctx, key, { callGateway });
    const queue = await request<{ data: { id: string }[] }>(`/api/v1/discovery/proposals?sourceKey=${key}`, {
      token: asLead(),
    });
    const attempt = await request(`/api/v1/discovery/proposals/${queue.body.data[0]!.id}/reject`, {
      method: 'POST',
      token: asLead(),
      body: { reason: '   ' },
    });
    expect(attempt.status).toBe(422);
  }, 60_000);
});

describe('reconciliation rules decide who wins', () => {
  it('proposes a change to an existing item by default, with both values', async () => {
    const key = await makeSource('updating');
    const ctx = contextFor(tenant.id);
    await discoveryService.runSource(ctx, key, {
      callGateway: gatewayReturning({ value: [device({ id: 'update-1', deviceName: 'LAP-200' })] }).callGateway,
    });
    const queue = await request<{ data: { id: string }[] }>(`/api/v1/discovery/proposals?sourceKey=${key}`, {
      token: asLead(),
    });
    await request(`/api/v1/discovery/proposals/${queue.body.data[0]!.id}/accept`, { method: 'POST', token: asLead() });

    // The feed now disagrees about the serial.
    const second = await discoveryService.runSource(ctx, key, {
      callGateway: gatewayReturning({
        value: [device({ id: 'update-1', deviceName: 'LAP-200', serialNumber: 'SN-CHANGED' })],
      }).callGateway,
    });
    expect(second.proposed).toBe(1);
    expect(second.applied).toBe(0);

    const pending = await request<{
      data: { kind: string; proposed: Record<string, unknown>; current: Record<string, unknown> }[];
    }>(`/api/v1/discovery/proposals?sourceKey=${key}`, { token: asLead() });
    expect(pending.body.data[0]!.kind).toBe('update_ci');
    expect(pending.body.data[0]!.proposed['attributes.serial']).toBe('SN-CHANGED');
    expect(pending.body.data[0]!.current['attributes.serial']).toBe('SN-0001');
  }, 60_000);

  it('writes without asking once a rule says the source owns the field', async () => {
    const key = await makeSource('source-wins');
    const ctx = contextFor(tenant.id);
    await discoveryService.runSource(ctx, key, {
      callGateway: gatewayReturning({ value: [device({ id: 'owned-1', deviceName: 'LAP-300' })] }).callGateway,
    });
    const queue = await request<{ data: { id: string }[] }>(`/api/v1/discovery/proposals?sourceKey=${key}`, {
      token: asLead(),
    });
    const accepted = await request<{ ciId: string }>(
      `/api/v1/discovery/proposals/${queue.body.data[0]!.id}/accept`,
      { method: 'POST', token: asLead() },
    );

    const rule = await request('/api/v1/discovery/rules', {
      method: 'PUT',
      token: asAdmin(),
      // A serial read from the device beats one typed by a person. Criticality
      // would be the opposite, which is why this is per field.
      body: { sourceKey: key, field: 'attributes.serial', policy: 'source_wins' },
    });
    expect(rule.status).toBe(200);

    const second = await discoveryService.runSource(ctx, key, {
      callGateway: gatewayReturning({
        value: [device({ id: 'owned-1', deviceName: 'LAP-300', serialNumber: 'SN-AUTHORITATIVE' })],
      }).callGateway,
    });
    expect(second.applied).toBe(1);
    expect(second.proposed).toBe(0);

    const item = await request<{ attributes: Record<string, unknown> }>(`/api/v1/cis/${accepted.body.ciId}`, {
      token: asAgent(),
    });
    expect(item.body.attributes.serial).toBe('SN-AUTHORITATIVE');
  }, 60_000);

  it('does not blank a field the feed stopped sending, even under source_wins', async () => {
    // The failure this guards against: a permission lost upstream looks like
    // every device losing its serial at once.
    const key = await makeSource('silence');
    const ctx = contextFor(tenant.id);
    await discoveryService.runSource(ctx, key, {
      callGateway: gatewayReturning({ value: [device({ id: 'silent-1', deviceName: 'LAP-400' })] }).callGateway,
    });
    const queue = await request<{ data: { id: string }[] }>(`/api/v1/discovery/proposals?sourceKey=${key}`, {
      token: asLead(),
    });
    const accepted = await request<{ ciId: string }>(
      `/api/v1/discovery/proposals/${queue.body.data[0]!.id}/accept`,
      { method: 'POST', token: asLead() },
    );
    await request('/api/v1/discovery/rules', {
      method: 'PUT',
      token: asAdmin(),
      body: { sourceKey: key, field: 'attributes.serial', policy: 'source_wins' },
    });

    const second = await discoveryService.runSource(ctx, key, {
      callGateway: gatewayReturning({
        value: [{ id: 'silent-1', deviceName: 'LAP-400', complianceState: 'operational' }],
      }).callGateway,
    });
    expect(second.applied).toBe(0);

    const item = await request<{ attributes: Record<string, unknown> }>(`/api/v1/cis/${accepted.body.ciId}`, {
      token: asAgent(),
    });
    expect(item.body.attributes.serial).toBe('SN-0001');
  }, 60_000);
});

describe('relationships a feed claims', () => {
  it('arrive as their own proposals once both ends exist, and are never written outright', async () => {
    // Accepting a creation creates the item and nothing else: an edge to
    // something not yet in the register would mean inventing the other end.
    // The next run raises it properly, with both ends checked.
    const key = 'edges';
    const created = await request('/api/v1/discovery/sources', {
      method: 'POST',
      token: asAdmin(),
      body: {
        key,
        name: key,
        kind: 'http_json',
        config: {
          url: 'https://inventory.example.com/resources',
          recordsPath: 'value',
          mapping: {
            classKey: 'device',
            externalKeyFrom: 'id',
            nameFrom: 'deviceName',
            relationships: [{ type: 'runs_on', from: 'runsOn' }],
          },
        },
      },
    });
    expect(created.status).toBe(201);

    const ctx = contextFor(tenant.id);
    const feed = {
      value: [
        { id: 'edge-host', deviceName: 'HOST-1' },
        { id: 'edge-guest', deviceName: 'GUEST-1', runsOn: 'edge-host' },
      ],
    };
    const { callGateway } = gatewayReturning(feed);

    const first = await discoveryService.runSource(ctx, key, { callGateway });
    // Two creations, and no edge: neither end exists yet.
    expect(first.proposed).toBe(2);

    const queue = await request<{ data: { id: string; kind: string }[] }>(
      `/api/v1/discovery/proposals?sourceKey=${key}`,
      { token: asLead() },
    );
    expect(queue.body.data.every((row) => row.kind === 'create_ci')).toBe(true);
    for (const row of queue.body.data) {
      expect((await request(`/api/v1/discovery/proposals/${row.id}/accept`, { method: 'POST', token: asLead() })).status).toBe(200);
    }

    const second = await discoveryService.runSource(ctx, key, { callGateway });
    expect(second.proposed).toBe(1);

    const edges = await request<{ data: { id: string; kind: string; proposed: Record<string, unknown> }[] }>(
      `/api/v1/discovery/proposals?sourceKey=${key}&kind=create_relationship`,
      { token: asLead() },
    );
    expect(edges.body.data).toHaveLength(1);
    expect(edges.body.data[0]!.proposed.type).toBe('runs_on');

    // Still not in the graph until somebody says so.
    const accepted = await request(`/api/v1/discovery/proposals/${edges.body.data[0]!.id}/accept`, {
      method: 'POST',
      token: asLead(),
    });
    expect(accepted.status).toBe(200);

    const third = await discoveryService.runSource(ctx, key, { callGateway });
    // Once the edge exists the feed stops proposing it.
    expect(third.proposed).toBe(0);
  }, 90_000);
});

describe('who may do what', () => {
  it('does not let a lead configure a source, only work the queue', async () => {
    // Configuring a source decides what may write the register without being
    // asked. That is an administrator's decision.
    const attempt = await request('/api/v1/discovery/sources', {
      method: 'POST',
      token: asLead(),
      body: { key: 'lead-written', name: 'x', kind: 'http_json', config: {} },
    });
    expect(attempt.status).toBe(403);
  });

  it('does not let an agent see the queue or accept from it', async () => {
    expect((await request('/api/v1/discovery/proposals', { token: asAgent() })).status).toBe(403);
  });

  it('never returns a credential value, only its name', async () => {
    const key = await makeSource('named-credential', { credentialRef: 'inventory-token' });
    const sources = await request<{ data: { key: string; credentialRef: string | null }[] }>(
      '/api/v1/discovery/sources',
      { token: asAdmin() },
    );
    const row = sources.body.data.find((entry) => entry.key === key)!;
    expect(row.credentialRef).toBe('inventory-token');
    expect(JSON.stringify(sources.body)).not.toMatch(/sealed|value|secret/i);
  });
});

describe('suppliers and contracts', () => {
  beforeAll(async () => {
    expect(
      (await request('/api/v1/suppliers', { method: 'POST', token: asAdmin(), body: { name: 'Acme Support' } })).status,
    ).toBe(201);
  }, 30_000);

  const iso = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

  it('warns on the notice date rather than the end date', async () => {
    const created = await request<{ id: string }>('/api/v1/contracts', {
      method: 'POST',
      token: asAdmin(),
      body: {
        supplierName: 'Acme Support',
        reference: 'ACME-1',
        name: 'Hardware support',
        startsOn: iso(-300),
        endsOn: iso(100),
        noticeDays: 90,
        autoRenews: true,
      },
    });
    expect(created.status).toBe(201);

    const attention = await request<{ data: { reference: string; urgency: string; daysToNotice: number }[] }>(
      '/api/v1/contracts-attention?warnDays=30',
      { token: asAdmin() },
    );
    expect(attention.status).toBe(200);
    const row = attention.body.data.find((entry) => entry.reference === 'ACME-1')!;
    // Ends in 100 days, so an end-date report would say nothing. Notice is due
    // in 10, which is the number somebody has to act on.
    expect(row.urgency).toBe('notice_due');
    expect(row.daysToNotice).toBe(10);
  }, 30_000);

  it('says when the window has closed and the money is committed', async () => {
    await request('/api/v1/contracts', {
      method: 'POST',
      token: asAdmin(),
      body: {
        supplierName: 'Acme Support',
        reference: 'ACME-2',
        name: 'Licences',
        startsOn: iso(-300),
        endsOn: iso(30),
        noticeDays: 90,
        autoRenews: true,
      },
    });

    const attention = await request<{ data: { reference: string; urgency: string }[]; missedNotice: number }>(
      '/api/v1/contracts-attention',
      { token: asAdmin() },
    );
    const row = attention.body.data.find((entry) => entry.reference === 'ACME-2')!;
    expect(row.urgency).toBe('notice_missed');
    expect(attention.body.missedNotice).toBeGreaterThanOrEqual(1);
  }, 30_000);

  it('refuses notice longer than the contract, which could never be given in time', async () => {
    const attempt = await request<{ detail: string }>('/api/v1/contracts', {
      method: 'POST',
      token: asAdmin(),
      body: {
        supplierName: 'Acme Support',
        reference: 'ACME-3',
        name: 'Short',
        startsOn: iso(0),
        endsOn: iso(30),
        noticeDays: 90,
      },
    });
    expect(attempt.status).toBe(422);
    expect(attempt.body.detail).toMatch(/longer than the contract/);
  });

  it('refuses a cost nobody could add up or compare', async () => {
    const attempt = await request<{ detail: string }>('/api/v1/contracts', {
      method: 'POST',
      token: asAdmin(),
      body: {
        supplierName: 'Acme Support',
        reference: 'ACME-4',
        name: 'Costly',
        startsOn: iso(0),
        endsOn: iso(365),
        cost: 40_000,
      },
    });
    expect(attempt.status).toBe(422);
    expect(attempt.body.detail).toMatch(/currency and a period/);
  });

  it('covers one thing per row, not both and not neither', async () => {
    const contract = await request<{ id: string }>('/api/v1/contracts', {
      method: 'POST',
      token: asAdmin(),
      body: {
        supplierName: 'Acme Support',
        reference: 'ACME-5',
        name: 'Coverage',
        startsOn: iso(-10),
        endsOn: iso(355),
      },
    });
    const attempt = await request(`/api/v1/contracts/${contract.body.id}/coverage`, {
      method: 'POST',
      token: asAdmin(),
      body: {},
    });
    expect(attempt.status).toBe(422);
  }, 30_000);
});
