import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  closeHarness,
  createTestTenant,
  deleteTestTenant,
  request,
  type TestTenant,
} from '../support/harness.js';

/**
 * MOD-10-E1 assets and the CMDB, end to end.
 *
 * Two things are worth proving here rather than in a unit test, because both
 * are properties of the SQL rather than of the domain: that impact walks the
 * edges the right way round, and that a graph with a cycle in it returns an
 * answer instead of running until somebody gives up. Real CMDBs are full of
 * cycles — a webserver runs on a VM, the VM is a member of a cluster, the
 * cluster depends on the webserver for its health check — and the first anybody
 * hears of an unbounded traversal is a request timing out during an incident.
 */

let tenant: TestTenant;

beforeAll(async () => {
  tenant = await createTestTenant('assets');
}, 120_000);

afterAll(async () => {
  await deleteTestTenant('assets');
  await closeHarness();
});

const asAdmin = () => tenant.people.admin!.token;
const asLead = () => tenant.people.lead!.token;
const asAgent = () => tenant.people.agent!.token;
const asRequester = () => tenant.people.requester!.token;

interface Ci {
  id: string;
  name: string;
  status: string;
  criticality: string;
  attributes: Record<string, unknown>;
  retiredAt: string | null;
}

interface Traversal {
  ci: { id: string; name: string };
  depth: number;
  summary: { total: number; worst: string | null; truncated: boolean; services: string[] };
  data: { id: string; name: string; depth: number; via: string }[];
}

let unique = 0;
const nameFor = (label: string) => `${label}-${(unique += 1)}`;

async function makeCi(label: string, over: Record<string, unknown> = {}, token = asAdmin()) {
  const response = await request<Ci>('/api/v1/cis', {
    method: 'POST',
    token,
    body: { classKey: 'server', name: nameFor(label), ...over },
  });
  expect(response.status).toBe(201);
  return response.body;
}

async function relate(fromCi: string, toCi: string, type = 'depends_on', token = asAdmin()) {
  return request<{ id: string; reads: string }>('/api/v1/ci-relationships', {
    method: 'POST',
    token,
    body: { fromCi, toCi, type },
  });
}

const impactOf = async (ciId: string, query = '', token = asAgent()) => {
  const response = await request<Traversal>(`/api/v1/cis/${ciId}/impact${query}`, { token });
  expect(response.status).toBe(200);
  return response.body;
};

beforeAll(async () => {
  // One root class and a subclass of it, so inheritance is exercised by every
  // item the rest of the suite creates.
  const server = await request<{ key: string }>('/api/v1/ci-classes', {
    method: 'POST',
    token: asAdmin(),
    body: {
      key: 'server',
      name: 'Server',
      attributes: [{ key: 'environment', label: 'Environment', type: 'string', required: false }],
    },
  });
  expect(server.status).toBe(201);

  const database = await request<{ key: string }>('/api/v1/ci-classes', {
    method: 'POST',
    token: asAdmin(),
    body: {
      key: 'database',
      name: 'Database server',
      parentKey: 'server',
      attributes: [
        { key: 'engine', label: 'Engine', type: 'enum', required: true, options: ['postgres', 'mysql'] },
        { key: 'environment', label: 'Environment', type: 'string', required: true },
      ],
    },
  });
  expect(database.status).toBe(201);
}, 60_000);

describe('a class declares what its items carry', () => {
  it('refuses an item that does not match, naming every problem at once', async () => {
    const attempt = await request<{ detail: string }>('/api/v1/cis', {
      method: 'POST',
      token: asAdmin(),
      body: { classKey: 'database', name: nameFor('bad'), attributes: { engine: 'oracle', cpus: 4 } },
    });
    // Missing required `environment`, an `engine` outside the enum, and a key
    // the class does not declare. An importer fixing a spreadsheet wants all
    // three in one pass, not one at a time.
    expect(attempt.status).toBe(422);
    expect(attempt.body.detail).toMatch(/Engine must be one of/);
    expect(attempt.body.detail).toMatch(/Environment is required/);
    expect(attempt.body.detail).toMatch(/cpus is not an attribute/);
  });

  it('lets a subclass tighten what it inherits', async () => {
    const attributes = await request<{ data: { key: string; required: boolean }[] }>(
      '/api/v1/ci-classes/database/attributes',
      { token: asAgent() },
    );
    expect(attributes.status).toBe(200);
    // Server declares environment optional; Database server requires it.
    expect(attributes.body.data.find((a) => a.key === 'environment')?.required).toBe(true);
  });

  it('accepts an item that matches', async () => {
    const created = await makeCi('orders-db', {
      classKey: 'database',
      attributes: { engine: 'postgres', environment: 'production' },
      criticality: 'critical',
    });
    expect(created.attributes).toEqual({ engine: 'postgres', environment: 'production' });
  });

  it('refuses a class loop rather than letting inheritance depend on where it is cut', async () => {
    const attempt = await request<{ detail: string }>('/api/v1/ci-classes/server', {
      method: 'PATCH',
      token: asAdmin(),
      body: { parentKey: 'database' },
    });
    expect(attempt.status).toBe(422);
    expect(attempt.body.detail).toMatch(/loop/);
  });
});

describe('impact walks the edges the right way round', () => {
  let checkout: Ci;
  let db: Ci;
  let storage: Ci;

  beforeAll(async () => {
    checkout = await makeCi('checkout', { criticality: 'critical' });
    db = await makeCi('orders-db', { criticality: 'high' });
    storage = await makeCi('san', { criticality: 'medium' });
    // checkout depends on db; db depends on storage.
    expect((await relate(checkout.id, db.id)).status).toBe(201);
    expect((await relate(db.id, storage.id)).status).toBe(201);
  }, 60_000);

  it('reads the direction back as a sentence', async () => {
    const again = await relate(checkout.id, db.id);
    // Idempotent: an import that runs twice is not an error.
    expect(again.status).toBe(200);
    expect(again.body.reads).toMatch(/if .* fails, .* is in trouble/);
  });

  it('answers what falls over if this does', async () => {
    const result = await impactOf(storage.id);
    expect(result.data.map((node) => node.name)).toEqual([db.name, checkout.name]);
    expect(result.data[0]!.depth).toBe(1);
    expect(result.data[1]!.depth).toBe(2);
    expect(result.summary.worst).toBe('critical');
  });

  it('answers what this needs, which is the mirror of the same walk', async () => {
    const response = await request<Traversal>(`/api/v1/cis/${checkout.id}/dependencies`, { token: asAgent() });
    expect(response.status).toBe(200);
    expect(response.body.data.map((node) => node.name)).toEqual([db.name, storage.name]);
  });

  it('stops at the depth asked for, and says there may be more', async () => {
    const shallow = await impactOf(storage.id, '?depth=1');
    expect(shallow.data.map((node) => node.name)).toEqual([db.name]);
    expect(shallow.summary.truncated).toBe(true);
  });

  it('ignores the symmetric edge, because everything is connected to something', async () => {
    const printer = await makeCi('printer');
    expect((await relate(printer.id, storage.id, 'connected_to')).status).toBe(201);
    const result = await impactOf(storage.id);
    expect(result.data.map((node) => node.name)).not.toContain(printer.name);
  });

  it('shows a new relationship straight away, rather than a minute later', async () => {
    // The traversal is cached for 60 seconds; a write on either side drops the
    // tenant's cached answers. Without that, an edge added during an incident
    // would not appear in the answer until after the incident.
    const web = await makeCi('web');
    expect((await relate(web.id, storage.id)).status).toBe(201);
    const result = await impactOf(storage.id);
    expect(result.data.map((node) => node.name)).toContain(web.name);
  });

  it('refuses an item that depends on itself', async () => {
    const attempt = await relate(db.id, db.id);
    expect(attempt.status).toBe(422);
  });
});

describe('a cycle', () => {
  it('terminates and returns an answer rather than running for ever', async () => {
    const a = await makeCi('cycle-a');
    const b = await makeCi('cycle-b');
    const c = await makeCi('cycle-c');
    await relate(a.id, b.id);
    await relate(b.id, c.id);
    await relate(c.id, a.id);

    const result = await impactOf(b.id, '?depth=6');
    // Everything whose failure b would take with it, each counted once, at the
    // shortest distance found: a is one hop, c is two.
    expect(result.data.map((node) => node.name).sort()).toEqual([a.name, c.name].sort());
    expect(result.data.find((node) => node.name === a.name)!.depth).toBe(1);
  }, 30_000);
});

describe('a retired configuration item', () => {
  it('stops carrying impact through itself, and keeps its record', async () => {
    const gone = await makeCi('decommissioned');
    const behind = await makeCi('behind-it');
    const front = await makeCi('in-front');
    await relate(gone.id, behind.id);
    await relate(front.id, gone.id);

    expect((await impactOf(behind.id)).data.map((node) => node.name)).toEqual([gone.name, front.name]);

    const retired = await request<Ci>(`/api/v1/cis/${gone.id}/retire`, {
      method: 'POST',
      token: asAdmin(),
      body: { reason: 'Decommissioned; the hardware went back to the supplier.' },
    });
    expect(retired.status).toBe(200);
    expect(retired.body.retiredAt).not.toBeNull();

    // Both disappear: the retired item, and the one only reachable through it.
    // Filtering the result alone would have hidden the dead server and kept
    // everything behind it.
    expect((await impactOf(behind.id)).data).toEqual([]);

    // Retired, never deleted: the record is why there is a CMDB.
    const still = await request<Ci>(`/api/v1/cis/${gone.id}`, { token: asAgent() });
    expect(still.status).toBe(200);
    expect(still.body.status).toBe('retired');
  }, 30_000);
});

describe('what touched this', () => {
  it('answers the correlation question across record types', async () => {
    const box = await makeCi('correlated');
    const changeId = randomUUID();
    const incidentId = randomUUID();

    for (const link of [
      { entityType: 'change', entityId: changeId, role: 'changed' },
      { entityType: 'major_incident', entityId: incidentId, role: 'affected' },
    ]) {
      const response = await request('/api/v1/ci-links', {
        method: 'POST',
        token: asAgent(),
        body: { ...link, ciId: box.id },
      });
      expect(response.status).toBe(201);
    }

    const history = await request<{ data: { entityType: string; role: string }[] }>(
      `/api/v1/cis/${box.id}/history`,
      { token: asAgent() },
    );
    expect(history.status).toBe(200);
    // The change from Tuesday and the incident from Wednesday, in one list.
    // This is the gap MOD-08 left: a change record that cannot name what it
    // changed cannot be correlated with the outage that followed it.
    expect(history.body.data.map((row) => row.entityType).sort()).toEqual(['change', 'major_incident']);

    const forChange = await request<{ data: { role: string; ci: { id: string } | null }[] }>(
      `/api/v1/records/change/${changeId}/cis`,
      { token: asAgent() },
    );
    expect(forChange.status).toBe(200);
    expect(forChange.body.data).toHaveLength(1);
    expect(forChange.body.data[0]!.ci?.id).toBe(box.id);
  });

  it('is idempotent, so a retry is not an error', async () => {
    const box = await makeCi('linked-twice');
    const body = { entityType: 'ticket', entityId: randomUUID(), ciId: box.id, role: 'affected' };
    expect((await request('/api/v1/ci-links', { method: 'POST', token: asAgent(), body })).status).toBe(201);
    expect((await request('/api/v1/ci-links', { method: 'POST', token: asAgent(), body })).status).toBe(200);
  });
});

describe('the asset register', () => {
  it('allocates a tag when nobody has stuck a label on it yet', async () => {
    const created = await request<{ tag: string }>('/api/v1/assets', {
      method: 'POST',
      token: asLead(),
      body: { serial: 'SN-0001', manufacturer: 'Acme', model: 'ProBook 14' },
    });
    expect(created.status).toBe(201);
    expect(created.body.tag).toMatch(/^AST-\d{5}$/);
  });

  it('keeps one open holding, so who-had-it-in-March has an answer', async () => {
    const created = await request<{ tag: string }>('/api/v1/assets', {
      method: 'POST',
      token: asLead(),
      body: { tag: 'LAP-001', serial: 'SN-0002' },
    });
    expect(created.status).toBe(201);

    const first = tenant.people.agent!.id;
    const second = tenant.people.requester!.id;
    expect((await request('/api/v1/assets/LAP-001/assign', { method: 'POST', token: asLead(), body: { userId: first } })).status).toBe(200);
    expect((await request('/api/v1/assets/LAP-001/assign', { method: 'POST', token: asLead(), body: { userId: second } })).status).toBe(200);

    const held = await request<{ status: string; assignments: { userId: string | null; returnedAt: string | null }[] }>(
      '/api/v1/assets/LAP-001',
      { token: asLead() },
    );
    expect(held.status).toBe(200);
    expect(held.body.status).toBe('assigned');
    expect(held.body.assignments).toHaveLength(2);
    // The previous holding is closed rather than overwritten: one asset is
    // never in two places at once, and the history survives.
    expect(held.body.assignments.filter((row) => row.returnedAt === null)).toHaveLength(1);
    expect(held.body.assignments.find((row) => row.returnedAt === null)!.userId).toBe(second);
  });

  it('refuses a cost with no currency, because nobody can add those up', async () => {
    const attempt = await request<{ detail: string }>('/api/v1/assets', {
      method: 'POST',
      token: asLead(),
      body: { tag: 'LAP-002', purchaseCost: 1200 },
    });
    expect(attempt.status).toBe(422);
    expect(attempt.body.detail).toMatch(/currency/);
  });

  it('surfaces a warranty that has already lapsed, rather than hiding it', async () => {
    const past = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    const soon = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    await request('/api/v1/assets', { method: 'POST', token: asLead(), body: { tag: 'LAP-010', warrantyEndsOn: past } });
    await request('/api/v1/assets', { method: 'POST', token: asLead(), body: { tag: 'LAP-011', warrantyEndsOn: soon } });

    const report = await request<{ data: { tag: string; expired: boolean }[] }>(
      '/api/v1/assets-warranties?withinDays=30',
      { token: asLead() },
    );
    expect(report.status).toBe(200);
    const tags = report.body.data.map((row) => row.tag);
    expect(tags).toContain('LAP-010');
    expect(tags).toContain('LAP-011');
    // An expired warranty nobody noticed is the case worth surfacing: it is
    // the one that costs money.
    expect(report.body.data.find((row) => row.tag === 'LAP-010')!.expired).toBe(true);
  });

  it('holds one asset per configuration item, so the two registers agree', async () => {
    const ci = await makeCi('laptop-ci');
    expect((await request('/api/v1/assets', { method: 'POST', token: asLead(), body: { tag: 'LAP-020', ciId: ci.id } })).status).toBe(201);
    const second = await request<{ detail: string }>('/api/v1/assets', {
      method: 'POST',
      token: asLead(),
      body: { tag: 'LAP-021', ciId: ci.id },
    });
    expect(second.status).toBe(409);
  });
});

describe('who may do what', () => {
  it('lets an agent read the register and say what a ticket touched', async () => {
    const ci = await makeCi('agent-readable');
    expect((await request(`/api/v1/cis/${ci.id}`, { token: asAgent() })).status).toBe(200);
    expect(
      (
        await request('/api/v1/ci-links', {
          method: 'POST',
          token: asAgent(),
          body: { entityType: 'ticket', entityId: randomUUID(), ciId: ci.id },
        })
      ).status,
    ).toBe(201);
  });

  it('does not let an agent write the register itself', async () => {
    // The value of a CMDB is that its contents were decided. A register anybody
    // may edit mid-incident stops being one anybody trusts.
    const attempt = await request('/api/v1/cis', {
      method: 'POST',
      token: asAgent(),
      body: { classKey: 'server', name: nameFor('agent-written') },
    });
    expect(attempt.status).toBe(403);
  });

  it('shows a requester none of it', async () => {
    expect((await request('/api/v1/cis', { token: asRequester() })).status).toBe(403);
    expect((await request('/api/v1/assets', { token: asRequester() })).status).toBe(403);
  });
});
