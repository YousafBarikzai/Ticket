import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeHarness, contextFor, createTestTenant, deleteTestTenant, request, type TestTenant } from '../support/harness.js';

/**
 * The dry run of a rule nobody has saved (A8).
 *
 * The test panel could only replay a stored rule, and storing an edit to a
 * published rule takes it offline — so testing a change first meant taking the
 * live rule down. This route replays the definition in the request instead.
 * What is worth proving is the "instead": it evaluates exactly what it was
 * sent, it refuses what saving would refuse, and it leaves nothing behind — no
 * rule, no version, no audit entry, no change to a ticket.
 */

let tenant: TestTenant;

beforeAll(async () => {
  tenant = await createTestTenant('rule-dry-run');
}, 120_000);

afterAll(async () => {
  await deleteTestTenant('rule-dry-run');
  await closeHarness();
});

interface DryRun {
  sampled: number;
  wouldChange: { ticketId: string; number: string; title: string; matched: string[]; effects: { tags?: string[] } }[];
  errors: { ruleKey: string; message: string }[];
}

const tagIncidents = {
  key: 'tag-incidents-draft',
  name: 'Tag every incident',
  event: 'ticket.created',
  conditions: { eq: [{ var: 'ticket.type' }, 'incident'] },
  actions: [{ type: 'addTag', tag: 'dry-run-a8' }],
};

async function dryRun(body: unknown, person = 'admin') {
  return request<DryRun & { detail?: string; errors?: unknown }>('/api/v1/rules/dry-run', {
    method: 'POST',
    token: tenant.people[person]!.token,
    body,
  });
}

async function countRows() {
  const { transaction, withContext } = await import('@itsm/platform');
  const ctx = contextFor(tenant.id);
  return withContext(ctx, () =>
    transaction(ctx, async (tx) => ({
      rules: await tx.businessRule.count(),
      versions: await tx.businessRuleVersion.count(),
      audit: await tx.auditEvent.count({ where: { action: { startsWith: 'rule.' } } }),
    })),
  );
}

describe('replaying an unsaved definition', () => {
  it('reports what the definition would do to recent tickets', async () => {
    const response = await dryRun({ definition: tagIncidents, sampleSize: 50 });
    expect(response.status).toBe(200);
    // The harness raises three incidents; every one of them matches.
    expect(response.body.sampled).toBe(3);
    expect(response.body.wouldChange).toHaveLength(3);
    expect(response.body.wouldChange.map((row) => row.number).sort()).toEqual([...tenant.ticketNumbers].sort());
    expect(response.body.wouldChange[0]!.matched).toEqual(['tag-incidents-draft']);
    expect(response.body.wouldChange[0]!.effects.tags).toContain('dry-run-a8');
    expect(response.body.errors).toEqual([]);
  });

  it('evaluates the conditions it was sent, not a stored rule of the same key', async () => {
    const response = await dryRun({
      definition: { ...tagIncidents, conditions: { eq: [{ var: 'ticket.title' }, 'Printer is jammed'] } },
    });
    expect(response.status).toBe(200);
    expect(response.body.wouldChange.map((row) => row.title)).toEqual(['Printer is jammed']);
  });

  it('reports nothing for a definition that matches nothing', async () => {
    const response = await dryRun({
      definition: { ...tagIncidents, conditions: { eq: [{ var: 'ticket.type' }, 'change'] } },
    });
    expect(response.status).toBe(200);
    expect(response.body.sampled).toBe(3);
    expect(response.body.wouldChange).toEqual([]);
  });

  it('needs neither a key nor a name', async () => {
    // An author trying a rule out has usually not named it yet.
    const { key: _key, name: _name, ...unnamed } = tagIncidents;
    const response = await dryRun({ definition: unnamed });
    expect(response.status).toBe(200);
    expect(response.body.wouldChange[0]!.matched).toEqual(['unsaved-rule']);
  });

  it('honours the sample size', async () => {
    const response = await dryRun({ definition: tagIncidents, sampleSize: 1 });
    expect(response.status).toBe(200);
    expect(response.body.sampled).toBe(1);
  });

  it('writes nothing: no rule, no version, no audit entry, no tag', async () => {
    const before = await countRows();
    const response = await dryRun({ definition: tagIncidents });
    expect(response.status).toBe(200);
    expect(await countRows()).toEqual(before);

    const stored = await request(`/api/v1/rules/${tagIncidents.key}`, { token: tenant.people.admin!.token });
    expect(stored.status).toBe(404);

    const tags = await request<{ data: string[] }>(`/api/v1/tickets/${tenant.ticketNumbers[0]}/tags`, {
      token: tenant.people.admin!.token,
    });
    expect(tags.body.data).not.toContain('dry-run-a8');
  });
});

describe('refusing what saving would refuse', () => {
  it('refuses a condition reading a fact no ticket provides, and says which', async () => {
    const response = await dryRun({
      definition: { ...tagIncidents, conditions: { eq: [{ var: 'ticket.colour' }, 'red'] } },
    });
    expect(response.status).toBe(422);
    expect(response.body.detail).toMatch(/ticket\.colour/);
  });

  it('refuses a comparison that can never be evaluated', async () => {
    const response = await dryRun({
      definition: { ...tagIncidents, conditions: { gt: [{ var: 'ticket.title' }, 5] } },
    });
    expect(response.status).toBe(422);
  });

  it('refuses a malformed definition', async () => {
    expect((await dryRun({ definition: { ...tagIncidents, actions: [] } })).status).toBe(422);
    expect((await dryRun({ definition: { ...tagIncidents, key: 'Not A Key' } })).status).toBe(422);
    expect((await dryRun({ definition: { ...tagIncidents, event: 'ticket.exploded' } })).status).toBe(422);
    expect((await dryRun({ definition: tagIncidents, sampleSize: 501 })).status).toBe(422);
    expect((await dryRun({})).status).toBe(422);
  });

  it('refuses fields it does not know, as saving does', async () => {
    expect((await dryRun({ definition: { ...tagIncidents, status: 'published' } })).status).toBe(422);
    expect((await dryRun({ definition: tagIncidents, publish: true })).status).toBe(422);
  });
});

describe('who may run it', () => {
  it('is for the people who may edit rules', async () => {
    // A lead may read rules but not write them, and a dry run reads every recent
    // ticket in the tenant — so it is gated like the stored test panel.
    for (const person of ['lead', 'agent', 'requester']) {
      const response = await dryRun({ definition: tagIncidents }, person);
      expect(response.status).toBe(403);
    }
  });

  it('refuses a caller with no token', async () => {
    const response = await request('/api/v1/rules/dry-run', { method: 'POST', body: { definition: tagIncidents } });
    expect(response.status).toBe(401);
  });
});

describe('the stored test panel', () => {
  it('still replays a saved draft', async () => {
    const created = await request('/api/v1/rules', {
      method: 'POST',
      token: tenant.people.admin!.token,
      body: { ...tagIncidents, order: 950 },
    });
    expect(created.status).toBe(201);

    const result = await request<DryRun>(`/api/v1/rules/${tagIncidents.key}/test`, {
      method: 'POST',
      token: tenant.people.admin!.token,
      body: { sampleSize: 50 },
    });
    expect(result.status).toBe(200);
    expect(result.body.wouldChange).toHaveLength(3);
    expect(result.body.wouldChange[0]!.matched).toEqual([tagIncidents.key]);
  });
});
