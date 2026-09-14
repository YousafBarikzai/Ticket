import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  closeHarness,
  contextFor,
  createTestTenant,
  deleteTestTenant,
  drainEvents,
  request,
  type TestTenant,
} from '../support/harness.js';

/**
 * The business rules engine (MOD-06-E0), end to end.
 *
 * Every assertion goes through the API and then through the real event handlers,
 * because the thing worth proving is not that the interpreter returns the right
 * decision — the unit tests cover that — but that a rule published through the
 * admin API changes a ticket raised through the ticket API, exactly once, with
 * an audit trail that names it.
 */

let tenant: TestTenant;

beforeAll(async () => {
  tenant = await createTestTenant('rules');
}, 120_000);

afterAll(async () => {
  await deleteTestTenant('rules');
  await closeHarness();
});

async function raiseTicket(body: Record<string, unknown>): Promise<{ id: string; number: string }> {
  const created = await request<{ id: string; number: string }>('/api/v1/tickets', {
    method: 'POST',
    token: tenant.people.requester!.token,
    body: { type: 'incident', sourceChannel: 'portal', ...body },
  });
  expect(created.status).toBe(201);
  return created.body;
}

describe('the rules a tenant starts with', () => {
  it('seeds them published, so a new tenant has a working engine', async () => {
    const response = await request<{ data: { key: string; status: string }[] }>('/api/v1/rules', {
      token: tenant.people.admin!.token,
    });
    expect(response.status).toBe(200);
    const keys = response.body.data.filter((rule) => rule.status === 'published').map((rule) => rule.key);
    expect(keys).toContain('major-incident-p1');
    expect(keys).toContain('requester-replied');
  });

  it('raises a high-impact, high-urgency ticket to P1 and tags it', async () => {
    const ticket = await raiseTicket({ title: 'Whole site is down', impact: 'high', urgency: 'high' });
    const delivered = await drainEvents(tenant.id);
    expect(delivered).toBeGreaterThan(0);

    const after = await request<{ priority: string }>(`/api/v1/tickets/${ticket.number}`, {
      token: tenant.people.agent!.token,
    });
    expect(after.body.priority).toBe('P1');

    const tags = await request<{ data: string[] }>(`/api/v1/tickets/${ticket.number}/tags`, {
      token: tenant.people.agent!.token,
    });
    expect(tags.body.data).toContain('major-incident');
  });

  it('leaves a low-impact ticket where the priority matrix put it', async () => {
    const ticket = await raiseTicket({ title: 'Mouse is sticky', impact: 'low', urgency: 'low' });
    await drainEvents(tenant.id);
    const after = await request<{ priority: string }>(`/api/v1/tickets/${ticket.number}`, {
      token: tenant.people.agent!.token,
    });
    expect(after.body.priority).toBe('P4');
  });
});

describe('what the rule did is answerable afterwards', () => {
  it('records the rule and the version of its text in the audit trail', async () => {
    const ticket = await raiseTicket({ title: 'Payroll is unreachable', impact: 'high', urgency: 'high' });
    await drainEvents(tenant.id);

    const audit = await request<{ data: { action: string; targetId: string; after: Record<string, unknown> }[] }>(
      '/api/v1/audit-events?limit=200',
      { token: tenant.people.admin!.token },
    );
    const applied = audit.body.data.filter((row) => row.action === 'rule.applied' && row.targetId === ticket.id);
    expect(applied.length).toBeGreaterThan(0);
    expect(applied[0]!.after).toMatchObject({ ruleKey: 'major-incident-p1', ruleVersion: 1 });
  });
});

describe('a rule does not react to its own change', () => {
  it('applies once, not repeatedly, when its action satisfies its own condition', async () => {
    // A rule that sets P1 on anything not already P1 is the shape that loops.
    // It is published here on purpose: the guard is the thing under test.
    const created = await request<{ id: string }>('/api/v1/rules', {
      method: 'POST',
      token: tenant.people.admin!.token,
      body: {
        key: 'would-loop',
        name: 'Raise anything that is not already P1',
        event: 'ticket.updated',
        conditions: { ne: [{ var: 'ticket.priority' }, 'P1'] },
        actions: [{ type: 'setPriority', priority: 'P1', reason: 'loop guard test' }],
        order: 500,
      },
    });
    expect(created.status).toBe(201);
    await request(`/api/v1/rules/would-loop/publish`, { method: 'POST', token: tenant.people.admin!.token });

    const ticket = await raiseTicket({ title: 'Loop candidate', impact: 'low', urgency: 'low' });
    await drainEvents(tenant.id);

    const current = await request<{ version: number }>(`/api/v1/tickets/${ticket.number}`, {
      token: tenant.people.agent!.token,
    });
    await request(`/api/v1/tickets/${ticket.number}`, {
      method: 'PATCH',
      token: tenant.people.agent!.token,
      headers: { 'if-match': String(current.body.version) },
      body: { urgency: 'medium' },
    });
    // Ten rounds: if the guard failed, the rule would still be re-triggering.
    await drainEvents(tenant.id, 10);

    const ctx = contextFor(tenant.id);
    const { transaction, withContext } = await import('@itsm/platform');
    const applications = await withContext(ctx, () =>
      transaction(ctx, (tx) =>
        tx.ruleApplication.findMany({ where: { ticketId: ticket.id } }),
      ),
    );
    const loopRuns = applications.filter((row) => row.event === 'ticket.updated');
    expect(loopRuns.length).toBe(1);

    await request('/api/v1/rules/would-loop/archive', { method: 'POST', token: tenant.people.admin!.token });
  });
});

describe('publishing', () => {
  it('refuses a condition that reads a fact which does not exist', async () => {
    const response = await request<{ detail: string }>('/api/v1/rules', {
      method: 'POST',
      token: tenant.people.admin!.token,
      body: {
        key: 'reads-nothing',
        name: 'Reads a fact that is not there',
        event: 'ticket.created',
        conditions: { eq: [{ var: 'ticket.colour' }, 'blue'] },
        actions: [{ type: 'addTag', tag: 'x' }],
      },
    });
    expect(response.status).toBe(422);
    expect(response.body.detail).toMatch(/ticket\.colour/);
  });

  it('refuses an action that this phase cannot carry out', async () => {
    const response = await request<{ detail: string }>('/api/v1/rules', {
      method: 'POST',
      token: tenant.people.admin!.token,
      body: {
        key: 'needs-workflow',
        name: 'Starts a workflow',
        event: 'ticket.created',
        conditions: { always: true },
        actions: [{ type: 'startWorkflow', definitionKey: 'new-starter' }],
      },
    });
    expect(response.status).toBe(422);
    expect(response.body.detail).toMatch(/not available yet/);
  });

  it('does not let a draft affect a live ticket', async () => {
    await request('/api/v1/rules', {
      method: 'POST',
      token: tenant.people.admin!.token,
      body: {
        key: 'draft-only',
        name: 'Tags everything, but only as a draft',
        event: 'ticket.created',
        conditions: { always: true },
        actions: [{ type: 'addTag', tag: 'should-not-appear' }],
        order: 900,
      },
    });

    const ticket = await raiseTicket({ title: 'Raised while a draft exists' });
    await drainEvents(tenant.id);
    const tags = await request<{ data: string[] }>(`/api/v1/tickets/${ticket.number}/tags`, {
      token: tenant.people.agent!.token,
    });
    expect(tags.body.data).not.toContain('should-not-appear');
  });

  it('rolls back to an earlier version, and the version number still goes up', async () => {
    await request('/api/v1/rules/draft-only/publish', { method: 'POST', token: tenant.people.admin!.token });
    await request('/api/v1/rules/draft-only', {
      method: 'PATCH',
      token: tenant.people.admin!.token,
      body: { actions: [{ type: 'addTag', tag: 'second-text' }] },
    });
    await request('/api/v1/rules/draft-only/publish', { method: 'POST', token: tenant.people.admin!.token });

    const rolled = await request<{ version: number; actions: { tag: string }[] }>(
      '/api/v1/rules/draft-only/rollback',
      { method: 'POST', token: tenant.people.admin!.token, body: { toVersion: 2 } },
    );
    expect(rolled.status).toBe(200);
    expect(rolled.body.actions[0]!.tag).toBe('should-not-appear');
    // A rollback is a publish of older text, not a rewind of the history.
    expect(rolled.body.version).toBe(4);

    await request('/api/v1/rules/draft-only/archive', { method: 'POST', token: tenant.people.admin!.token });
  });
});

describe('the test panel', () => {
  it('reports what a rule would do without writing anything', async () => {
    await request('/api/v1/rules', {
      method: 'POST',
      token: tenant.people.admin!.token,
      body: {
        key: 'dry-run-only',
        name: 'Would tag every incident',
        event: 'ticket.created',
        conditions: { eq: [{ var: 'ticket.type' }, 'incident'] },
        actions: [{ type: 'addTag', tag: 'dry-run' }],
        order: 950,
      },
    });

    const result = await request<{ sampled: number; wouldChange: { number: string }[] }>(
      '/api/v1/rules/dry-run-only/test',
      { method: 'POST', token: tenant.people.admin!.token, body: { sampleSize: 50 } },
    );
    expect(result.status).toBe(200);
    expect(result.body.sampled).toBeGreaterThan(0);
    expect(result.body.wouldChange.length).toBeGreaterThan(0);

    // Nothing was written: the tag exists only in the report.
    const sample = result.body.wouldChange[0]!;
    const tags = await request<{ data: string[] }>(`/api/v1/tickets/${sample.number}/tags`, {
      token: tenant.people.admin!.token,
    });
    expect(tags.body.data).not.toContain('dry-run');
  });
});

describe('permissions', () => {
  it('lets a lead read the rules but not publish one', async () => {
    const read = await request('/api/v1/rules', { token: tenant.people.lead!.token });
    expect(read.status).toBe(200);

    const publish = await request('/api/v1/rules/major-incident-p1/publish', {
      method: 'POST',
      token: tenant.people.lead!.token,
    });
    expect(publish.status).toBe(403);
  });

  it('refuses an agent entirely', async () => {
    const response = await request('/api/v1/rules', { token: tenant.people.agent!.token });
    expect(response.status).toBe(403);
  });
});
