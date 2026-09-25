import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { queue, systemContext, transaction, withContext } from '@itsm/platform';
import { settingsService } from '@itsm/module-admin';
import { tenantService } from '@itsm/module-tenancy';
import {
  activeProvider,
  clearAiProvider,
  registerAiProvider,
  resetDecisionBreakers,
  runTriage,
  stubProvider,
} from '@itsm/module-ai';
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
 * Structured decisions, in shadow (ADR-0051).
 *
 * The unit suite proves the chain, the checks and the policy. This proves the
 * promises that only exist once there is a database: that a decision is off
 * until a tenant switches it on, that shadow records everything and changes
 * nothing on the ticket, that the record and the audit log say which AI
 * decided and what it cost, that the cost lands in the month's budget, and
 * that residency and a spent budget end in rules rather than in a failure.
 */

let tenant: TestTenant;

beforeAll(async () => {
  tenant = await createTestTenant('ai-decisions');
}, 120_000);

afterAll(async () => {
  await deleteTestTenant('ai-decisions');
  await closeHarness();
});

const original = activeProvider();

afterEach(async () => {
  if (original) registerAiProvider(original);
  else clearAiProvider();
  resetDecisionBreakers();
});

function ctx() {
  return contextFor(tenant.id);
}

/** Runs triage the way the ticket.created consumer will: a fresh system context. */
async function triage(ticketId: string) {
  const worker = systemContext(tenant.id, { region: 'eu-west' });
  return withContext(worker, () => runTriage(worker, ticketId));
}

async function read<T>(fn: (tx: Parameters<Parameters<typeof transaction>[1]>[0]) => Promise<T>): Promise<T> {
  const context = ctx();
  return withContext(context, () => transaction(context, fn));
}

async function setFlag(key: string, value: boolean): Promise<void> {
  const context = ctx();
  await withContext(context, () => settingsService.setFlag(context, { key, value, reason: 'integration test' }));
}

async function setSetting(key: string, value: unknown): Promise<void> {
  const context = ctx();
  await withContext(context, () => settingsService.publishSetting(context, { key, value, reason: 'integration test' }));
}

async function raiseTicket(title: string, description: string, sourceChannel = 'api'): Promise<string> {
  return (await raise(title, description, sourceChannel)).id;
}

async function raise(title: string, description: string, sourceChannel = 'api'): Promise<{ id: string; number: string }> {
  const response = await request<{ id: string; number: string }>('/api/v1/tickets', {
    method: 'POST',
    token: tenant.people.agent!.token,
    body: { type: 'incident', title, description, priority: 'P3', sourceChannel },
  });
  expect(response.status).toBe(201);
  return response.body;
}

async function move(number: string, to: string): Promise<void> {
  const response = await request(`/api/v1/tickets/${number}/transitions`, {
    method: 'POST',
    token: tenant.people.agent!.token,
    body: { to },
  });
  expect(response.status).toBe(200);
}

interface DecisionView {
  id: string;
  provider: string;
  model: string | null;
  mode: string;
  outcome: string;
  costMicros: string;
  latencyMs: number;
  attempts: { provider: string; outcome: string; reason: string | null }[];
  answers: Record<string, { value: unknown; confidence: number }>;
  plan: { question: string; action: string }[];
}

async function decisionsFor(ticketId: string, token = tenant.people.agent!.token) {
  return request<{ data: DecisionView[] }>(`/api/v1/ai/decisions?subjectId=${ticketId}`, { token });
}

describe('before a tenant switches it on', () => {
  it('sends nothing and records nothing', async () => {
    const ticketId = await raiseTicket('Printer on floor 3 is jammed', 'It jams on every page.');
    expect(await triage(ticketId)).toBeNull();
    const rows = await read((tx) => tx.aiDecision.count({ where: { subjectId: ticketId } }));
    expect(rows).toBe(0);
  });

  it('stays off with the flag on and the mode left at off', async () => {
    await setFlag('ai.decision.triage', true);
    try {
      const ticketId = await raiseTicket('Monitor flickers', 'Only on the left screen.');
      expect(await triage(ticketId)).toBeNull();
    } finally {
      await setFlag('ai.decision.triage', false);
    }
  });

  it('cannot be put into a mode this release does not honour', async () => {
    await expect(setSetting('ai.decision.triage.mode', 'auto')).rejects.toThrow();
    await expect(setSetting('ai.decision.triage.mode', 'suggest')).rejects.toThrow();
  });
});

describe('in shadow', () => {
  beforeAll(async () => {
    await setFlag('ai.decision.triage', true);
    await setSetting('ai.decision.triage.mode', 'shadow');
  });

  afterAll(async () => {
    await setSetting('ai.decision.triage.mode', 'off');
    await setFlag('ai.decision.triage', false);
  });

  it('records who decided, how sure it was and what it cost — and leaves the ticket alone', async () => {
    registerAiProvider(stubProvider());
    const ticketId = await raiseTicket('The VPN is down for everyone', 'Nobody can connect from home since 9am.');
    const before = await read((tx) => tx.ticket.findFirst({ where: { id: ticketId } }));

    const run = await triage(ticketId);
    expect(run).toMatchObject({ outcome: 'shadowed', provider: 'stub' });

    const after = await read((tx) => tx.ticket.findFirst({ where: { id: ticketId } }));
    // Shadow changes nothing on the ticket, however confident the answer.
    for (const field of ['type', 'categoryId', 'groupId', 'priority', 'status', 'version'] as const) {
      expect(after![field]).toEqual(before![field]);
    }

    const response = await decisionsFor(ticketId);
    expect(response.status).toBe(200);
    const [decision] = response.body.data;
    expect(decision).toMatchObject({ provider: 'stub', model: 'stub-small', mode: 'shadow', outcome: 'shadowed' });
    expect(BigInt(decision!.costMicros)).toBeGreaterThan(0n);
    expect(decision!.answers.type!.value).toBeTypeOf('string');
    expect(decision!.plan.every((entry) => entry.action === 'record')).toBe(true);
    // The chain passed over the providers this deployment does not have, and says so.
    expect(decision!.attempts.map((attempt) => [attempt.provider, attempt.reason])).toEqual([
      ['jev', 'not-registered'],
      ['anthropic', 'not-registered'],
      ['stub', null],
    ]);

    const audit = await read((tx) =>
      tx.auditEvent.findFirst({ where: { action: 'ai.decision.recorded', targetId: ticketId }, orderBy: { seq: 'desc' } }),
    );
    expect(audit?.after).toMatchObject({ decisionId: decision!.id, provider: 'stub', model: 'stub-small', outcome: 'shadowed' });
  });

  it('counts its cost towards the month’s AI budget', async () => {
    registerAiProvider(stubProvider());
    const ticketId = await raiseTicket('Outlook keeps asking for a password', 'Since this morning.');
    const before = await read((tx) => tx.aiBudget.findFirst({ orderBy: { periodKey: 'desc' } }));
    await triage(ticketId);
    const after = await read((tx) => tx.aiBudget.findFirst({ orderBy: { periodKey: 'desc' } }));
    const decision = await read((tx) => tx.aiDecision.findFirst({ where: { subjectId: ticketId } }));
    expect(after!.spentMicros - (before?.spentMicros ?? 0n)).toBe(decision!.costMicros);
  });

  it('falls to rules rather than leaving the tenant’s regions, and costs nothing', async () => {
    registerAiProvider({ ...stubProvider(), processingRegion: 'us-east' });
    await tenantService.setAiRegions(tenant.id, { regions: ['eu-west'] });
    try {
      const ticketId = await raiseTicket('Laptop battery swelling', 'The case is lifting.');
      const run = await triage(ticketId);
      expect(run).toMatchObject({ outcome: 'none', provider: 'rules' });
      const decision = await read((tx) => tx.aiDecision.findFirst({ where: { subjectId: ticketId } }));
      expect(decision!.model).toBeNull();
      expect(decision!.costMicros).toBe(0n);
      expect((decision!.attempts as { reason: string }[]).at(-1)!.reason).toBe('residency');
    } finally {
      await tenantService.setAiRegions(tenant.id, { regions: [] });
    }
  });

  it('falls to rules when the budget is spent, and intake is not refused', async () => {
    registerAiProvider(stubProvider());
    await request('/api/v1/ai/budget', { method: 'PUT', token: tenant.people.admin!.token, body: { limitPence: 0, warnPence: null } });
    try {
      const ticketId = await raiseTicket('New starter needs a laptop', 'Starting Monday.');
      const run = await triage(ticketId);
      expect(run).toMatchObject({ outcome: 'none', provider: 'rules' });
      const decision = await read((tx) => tx.aiDecision.findFirst({ where: { subjectId: ticketId } }));
      expect((decision!.attempts as { reason: string }[]).at(-1)!.reason).toBe('budget');
    } finally {
      await request('/api/v1/ai/budget', { method: 'PUT', token: tenant.people.admin!.token, body: { limitPence: null, warnPence: null } });
    }
  });

  it('is readable by an agent and not by a requester', async () => {
    registerAiProvider(stubProvider());
    const ticketId = await raiseTicket('Shared drive is read-only', 'Cannot save anything.');
    await triage(ticketId);
    expect((await decisionsFor(ticketId)).status).toBe(200);
    expect((await decisionsFor(ticketId, tenant.people.requester!.token)).status).toBe(403);
  });
});

describe('wired to the ticket lifecycle', () => {
  beforeAll(async () => {
    await setFlag('ai.decision.triage', true);
    await setSetting('ai.decision.triage.mode', 'shadow');
  });

  afterAll(async () => {
    await setSetting('ai.decision.triage.mode', 'off');
    await setFlag('ai.decision.triage', false);
  });

  it('queues triage for a ticket that arrived by a channel, once, and not for one an agent raised', async () => {
    const portal = await raiseTicket('Cannot print to the third floor printer', 'Jobs sit in the queue.', 'portal');
    const byAgent = await raiseTicket('Swap the monitor on desk 12', 'Agreed with the user.', 'api');
    await drainEvents(tenant.id);

    const queued = await queue('ai').getJob(`triage-${portal}`);
    try {
      expect(queued?.name).toBe('ai.decide');
      expect((queued?.data as { payload: { ticketId: string } }).payload.ticketId).toBe(portal);
      // An agent picked the fields themselves; there is nothing to learn.
      expect(await queue('ai').getJob(`triage-${byAgent}`)).toBeUndefined();
    } finally {
      await queued?.remove();
    }
  });

  it('decides a ticket once, however often it is asked', async () => {
    registerAiProvider(stubProvider());
    const ticketId = await raiseTicket('Laptop fan is loud', 'Constant noise since Monday.', 'email');
    const first = await triage(ticketId);
    const second = await triage(ticketId);
    expect(second?.decisionId).toBe(first?.decisionId);
    expect(await read((tx) => tx.aiDecision.count({ where: { subjectId: ticketId } }))).toBe(1);
  });

  it('settles its decisions with what the ticket was resolved as, and scores them', async () => {
    registerAiProvider(stubProvider());
    const ticket = await raise('The VPN drops every hour', 'Reconnecting works for a while.', 'portal');
    await triage(ticket.id);

    await move(ticket.number, 'in_progress');
    await move(ticket.number, 'resolved');
    await drainEvents(tenant.id);

    const decision = await read((tx) => tx.aiDecision.findFirst({ where: { subjectId: ticket.id } }));
    const resolved = await read((tx) => tx.ticket.findFirst({ where: { id: ticket.id } }));
    expect(decision!.settledAt).not.toBeNull();
    expect(decision!.settled).toEqual({
      type: resolved!.type,
      category: resolved!.categoryId,
      group: resolved!.groupId,
      priority: resolved!.priority,
      majorIncident: false,
    });

    const score = await request<{ settled: number; questions: { question: string; scored: number }[]; mode: string }>(
      '/api/v1/ai/decisions/score',
      { token: tenant.people.admin!.token },
    );
    expect(score.status).toBe(200);
    expect(score.body.mode).toBe('shadow');
    expect(score.body.settled).toBeGreaterThanOrEqual(1);
    expect(score.body.questions.find((question) => question.question === 'type')!.scored).toBeGreaterThanOrEqual(1);
  });

  it('keeps a worker to the tenant’s own regions, not the default its context was built with', async () => {
    // The worker's context names the tenant and nothing else, so it carries
    // the default region. The tenant allows only us-east; the provider is in
    // the default region. Before the fix, the default won.
    registerAiProvider({ ...stubProvider(), processingRegion: 'eu-west' });
    await tenantService.setAiRegions(tenant.id, { regions: ['us-east'] });
    try {
      const ticketId = await raiseTicket('Keyboard missing keys', 'Two keys fell off.', 'email');
      const worker = systemContext(tenant.id);
      const run = await withContext(worker, () => runTriage(worker, ticketId));
      expect(run).toMatchObject({ provider: 'rules', outcome: 'none' });
      const decision = await read((tx) => tx.aiDecision.findFirst({ where: { subjectId: ticketId } }));
      expect((decision!.attempts as { reason: string }[]).at(-1)!.reason).toBe('residency');
    } finally {
      await tenantService.setAiRegions(tenant.id, { regions: [] });
    }
  });

  it('lists every decision only for someone who manages AI', async () => {
    expect((await request('/api/v1/ai/decisions', { token: tenant.people.admin!.token })).status).toBe(200);
    expect((await request('/api/v1/ai/decisions', { token: tenant.people.agent!.token })).status).toBe(403);
  });
});
