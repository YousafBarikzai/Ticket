import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { workflowService, advance, idempotencyKeyFor } from '@itsm/module-workflow';
import { transaction, withContext } from '@itsm/platform';
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
 * The workflow engine (MOD-06-E1), end to end.
 *
 * The assertions that earn the run are the ones about *time*: a run that
 * survives a crash mid-step without doing its work twice, a run pinned to the
 * version it started on while a newer one is published, and a run woken by an
 * event rather than a poll. A test that only proved a three-node graph reaches
 * its end would prove nothing the unit tests do not.
 */

let tenant: TestTenant;

beforeAll(async () => {
  tenant = await createTestTenant('workflow');
}, 120_000);

afterAll(async () => {
  await deleteTestTenant('workflow');
  await closeHarness();
});

const admin = () => tenant.people.admin!.token;
const ctx = () => contextFor(tenant.id);

const linearGraph = (status = 'in_progress') => ({
  schemaVersion: 1 as const,
  trigger: { kind: 'manual' as const },
  start: 'move',
  nodes: [
    { key: 'move', type: 'changeStatus' as const, status },
    { key: 'note', type: 'createTask' as const, taskKey: 'follow-up', title: 'Follow up on {{ticket.id}}' },
    { key: 'done', type: 'end' as const },
  ],
  edges: [
    { from: 'move', to: 'note' },
    { from: 'note', to: 'done' },
  ],
});

async function publish(key: string, graph: unknown) {
  const created = await request('/api/v1/workflows', {
    method: 'POST',
    token: admin(),
    body: { key, name: `Workflow ${key}`, graph },
  });
  expect(created.status).toBe(201);
  const published = await request(`/api/v1/workflows/${key}/publish`, { method: 'POST', token: admin() });
  expect(published.status).toBe(200);
  return published;
}

describe('a tenant starts with workflows that work', () => {
  it('seeds the reference workflows published', async () => {
    const response = await request<{ data: { key: string; status: string }[] }>('/api/v1/workflows', {
      token: admin(),
    });
    expect(response.status).toBe(200);
    const keys = response.body.data.map((w) => w.key);
    expect(keys).toContain('auto-close-resolved');
    expect(response.body.data.every((w) => w.status === 'published')).toBe(true);
  });
});

describe('publishing', () => {
  it('refuses a graph with a node nothing leads to', async () => {
    const response = await request<{ detail: string }>('/api/v1/workflows', {
      method: 'POST',
      token: admin(),
      body: {
        key: 'has-an-orphan',
        name: 'Has an orphan',
        graph: {
          schemaVersion: 1,
          trigger: { kind: 'manual' },
          start: 'a',
          nodes: [
            { key: 'a', type: 'changeStatus', status: 'in_progress' },
            { key: 'orphan', type: 'changeStatus', status: 'closed' },
            { key: 'end', type: 'end' },
          ],
          edges: [{ from: 'a', to: 'end' }],
        },
      },
    });
    expect(response.status).toBe(201);

    const published = await request<{ detail: string }>('/api/v1/workflows/has-an-orphan/publish', {
      method: 'POST',
      token: admin(),
    });
    expect(published.status).toBe(422);
    expect(published.body.detail).toMatch(/would never run/);
  });

  it('refuses an action step, naming the phase that delivers it', async () => {
    await request('/api/v1/workflows', {
      method: 'POST',
      token: admin(),
      body: {
        key: 'calls-out',
        name: 'Calls another system',
        graph: {
          schemaVersion: 1,
          trigger: { kind: 'manual' },
          start: 'call',
          nodes: [
            { key: 'call', type: 'action', action: 'http.entra.createUser', input: {} },
            { key: 'end', type: 'end' },
          ],
          edges: [{ from: 'call', to: 'end' }],
        },
      },
    });
    const published = await request<{ detail: string }>('/api/v1/workflows/calls-out/publish', {
      method: 'POST',
      token: admin(),
    });
    expect(published.status).toBe(422);
    expect(published.body.detail).toMatch(/MOD-06-E2/);
  });
});

describe('running', () => {
  it('walks a graph to its end, changing the ticket on the way', async () => {
    await publish('linear', linearGraph());

    const ticketId = tenant.ticketIds[0]!;
    const started = await withContext(ctx(), () =>
      transaction(ctx(), (tx) =>
        workflowService.startRun(ctx(), tx, { key: 'linear', ticketId, context: { ticket: { id: ticketId } } }),
      ),
    );
    expect(started).not.toBeNull();

    // Driven by hand rather than through the queue, so the assertions are about
    // the engine rather than about BullMQ's timing.
    let step: string | undefined = started!.firstStep;
    const seen: string[] = [];
    while (step) {
      seen.push(step);
      const result = await withContext(ctx(), () => advance(ctx(), { runId: started!.runId, stepKey: step! }));
      step = result.next[0];
    }

    expect(seen).toEqual(['move', 'note', 'done']);

    const run = await request<{ status: string; steps: { stepKey: string; status: string }[] }>(
      `/api/v1/workflow-runs/${started!.runId}`,
      { token: admin() },
    );
    expect(run.body.status).toBe('completed');
    expect(run.body.steps.every((s) => s.status === 'done')).toBe(true);

    const ticket = await request<{ status: string }>(`/api/v1/tickets/${tenant.ticketNumbers[0]}`, { token: admin() });
    expect(ticket.body.status).toBe('in_progress');
  });

  it('does the work once when a step is re-delivered after a crash', async () => {
    // The assertion the whole three-transaction protocol exists for. A worker
    // killed between executing and recording leaves a `started` step; the retry
    // must re-execute with the *same* idempotency key and not create a second
    // task.
    await publish('crashy', linearGraph('on_hold'));

    const ticketId = tenant.ticketIds[1]!;
    const started = await withContext(ctx(), () =>
      transaction(ctx(), (tx) =>
        workflowService.startRun(ctx(), tx, { key: 'crashy', ticketId, context: { ticket: { id: ticketId } } }),
      ),
    );

    await withContext(ctx(), () => advance(ctx(), { runId: started!.runId, stepKey: 'move' }));

    // Simulate the crash: the task step runs, then its recording is lost.
    await withContext(ctx(), () => advance(ctx(), { runId: started!.runId, stepKey: 'note' }));
    await withContext(ctx(), () =>
      transaction(ctx(), (tx) =>
        tx.workflowStepRun.updateMany({
          where: { runId: started!.runId, stepKey: 'note' },
          data: { status: 'started', endedAt: null },
        }),
      ),
    );

    // The retry.
    await withContext(ctx(), () => advance(ctx(), { runId: started!.runId, stepKey: 'note' }));

    const tasks = await withContext(ctx(), () =>
      transaction(ctx(), (tx) => tx.ticketTask.findMany({ where: { ticketId, key: 'follow-up' } })),
    );
    expect(tasks).toHaveLength(1);

    const steps = await withContext(ctx(), () =>
      transaction(ctx(), (tx) => tx.workflowStepRun.findMany({ where: { runId: started!.runId, stepKey: 'note' } })),
    );
    // Two attempts, one task, one idempotency key.
    expect(steps.length).toBeGreaterThanOrEqual(2);
    expect(new Set(steps.map((s) => s.idempotencyKey)).size).toBe(1);
    expect(steps[0]!.idempotencyKey).toBe(idempotencyKeyFor(started!.runId, 'note'));
  });

  it('lets only one worker claim a step', async () => {
    // Two workers reaching the same step at the same moment: one claims it, the
    // other finds the constraint and stops. No locks, no leases, no clock.
    await publish('contended', linearGraph('in_progress'));
    const ticketId = tenant.ticketIds[0]!;
    const started = await withContext(ctx(), () =>
      transaction(ctx(), (tx) =>
        workflowService.startRun(ctx(), tx, { key: 'contended', ticketId, context: { ticket: { id: ticketId } } }),
      ),
    );

    const [a, b] = await Promise.all([
      withContext(ctx(), () => advance(ctx(), { runId: started!.runId, stepKey: 'move', attempt: 1 })),
      withContext(ctx(), () => advance(ctx(), { runId: started!.runId, stepKey: 'move', attempt: 1 })),
    ]);

    const outcomes = [a.status, b.status].sort();
    expect(outcomes).toEqual(['done', 'skipped']);
  });
});

describe('versions', () => {
  it('finishes a run on the version it started on', async () => {
    // Publishing must not change what is already in flight: a person's request
    // finishing under rules nobody chose for it is the failure this prevents.
    await publish('pinned', linearGraph('in_progress'));

    const ticketId = tenant.ticketIds[0]!;
    const started = await withContext(ctx(), () =>
      transaction(ctx(), (tx) =>
        workflowService.startRun(ctx(), tx, { key: 'pinned', ticketId, context: { ticket: { id: ticketId } } }),
      ),
    );

    // Publish a second version that would do something different.
    await request('/api/v1/workflows/pinned', {
      method: 'PATCH',
      token: admin(),
      body: { graph: linearGraph('closed'), changeNote: 'Now closes instead' },
    });
    await request('/api/v1/workflows/pinned/publish', { method: 'POST', token: admin() });

    let step: string | undefined = 'move';
    while (step) {
      const result = await withContext(ctx(), () => advance(ctx(), { runId: started!.runId, stepKey: step! }));
      step = result.next[0];
    }

    const ticket = await request<{ status: string }>(`/api/v1/tickets/${tenant.ticketNumbers[0]}`, { token: admin() });
    // Version 1's status, not version 2's.
    expect(ticket.body.status).toBe('in_progress');
  });
});

describe('the test panel', () => {
  it('walks the graph without writing anything', async () => {
    const before = await withContext(ctx(), () =>
      transaction(ctx(), (tx) => tx.workflowRun.count({ where: { } })),
    );

    const response = await request<{ trace: { stepKey: string; would: Record<string, unknown> }[] }>(
      '/api/v1/workflows/linear/test',
      { method: 'POST', token: admin(), body: { context: { ticket: { id: tenant.ticketIds[0] } } } },
    );
    expect(response.status).toBe(200);
    expect(response.body.trace.map((t) => t.stepKey)).toEqual(['move', 'note', 'done']);

    const after = await withContext(ctx(), () =>
      transaction(ctx(), (tx) => tx.workflowRun.count({ where: { } })),
    );
    expect(after).toBe(before);
  });

  it('resolves an approval immediately, with the stub decision asked for', async () => {
    // A rehearsal that parked for five days would not be a rehearsal.
    const response = await request<{ trace: { stepKey: string; would: Record<string, unknown> }[] }>(
      '/api/v1/workflows/request-fulfilment/test',
      { method: 'POST', token: admin(), body: { approvalDecision: 'rejected' } },
    );
    expect(response.status).toBe(200);
    const approval = response.body.trace.find((t) => t.stepKey === 'approve');
    expect(approval?.would.decision).toBe('rejected');
    // Rejected, so the trace goes to the requester rather than the task.
    expect(response.body.trace.map((t) => t.stepKey)).toContain('tell-requester');
    expect(response.body.trace.map((t) => t.stepKey)).not.toContain('do-the-work');
  });
});

describe('a rule can start a workflow', () => {
  it('starts a run when the rule that names it fires', async () => {
    // `startWorkflow` refused at publish for the whole of PH-2, naming PH-3.
    await publish('started-by-rule', linearGraph('in_progress'));

    const rule = await request('/api/v1/rules', {
      method: 'POST',
      token: admin(),
      body: {
        key: 'starts-a-workflow',
        name: 'Starts a workflow',
        event: 'ticket.created',
        conditions: { eq: [{ var: 'ticket.type' }, 'incident'] },
        actions: [{ type: 'startWorkflow', definitionKey: 'started-by-rule' }],
      },
    });
    expect(rule.status).toBe(201);

    const published = await request('/api/v1/rules/starts-a-workflow/publish', { method: 'POST', token: admin() });
    expect(published.status).toBe(200);

    const ticket = await request<{ id: string }>('/api/v1/tickets', {
      method: 'POST',
      token: tenant.people.agent!.token,
      body: { type: 'incident', title: 'Something a workflow should pick up', description: 'x', priority: 'P3' },
    });
    expect(ticket.status).toBe(201);
    await drainEvents(tenant.id);

    const runs = await request<{ data: { ticketId: string; triggeredBy: string }[] }>(
      `/api/v1/workflow-runs?ticketId=${ticket.body.id}`,
      { token: admin() },
    );
    expect(runs.body.data.length).toBeGreaterThan(0);
    expect(runs.body.data[0]!.triggeredBy).toMatch(/starts-a-workflow|event:/);
  });
});

describe('operating a stuck run', () => {
  it('needs a reason to skip a step', async () => {
    const runs = await request<{ data: { id: string }[] }>('/api/v1/workflow-runs?limit=1', { token: admin() });
    const runId = runs.body.data[0]!.id;
    const response = await request(`/api/v1/workflow-runs/${runId}/skip`, {
      method: 'POST',
      token: admin(),
      body: { reason: '' },
    });
    // Somebody will ask why this step did not run; "an operator skipped it" is
    // not an answer.
    expect(response.status).toBe(422);
  });

  it('refuses an agent the operating routes', async () => {
    const runs = await request<{ data: { id: string }[] }>('/api/v1/workflow-runs?limit=1', { token: admin() });
    const runId = runs.body.data[0]!.id;
    const response = await request(`/api/v1/workflow-runs/${runId}/cancel`, {
      method: 'POST',
      token: tenant.people.agent!.token,
      body: { reason: 'no' },
    });
    expect(response.status).toBe(403);
  });
});
