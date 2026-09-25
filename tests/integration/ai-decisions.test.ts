import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { getSetting, queue, systemContext, transaction, withContext } from '@itsm/platform';
import { settingsService } from '@itsm/module-admin';
import { tenantService } from '@itsm/module-tenancy';
import {
  activeProvider,
  clearAiProvider,
  registerAiProvider,
  resetDecisionBreakers,
  reviewAutoMode,
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

  it('cannot be put into a mode that does not exist', async () => {
    await expect(setSetting('ai.decision.triage.mode', 'always')).rejects.toThrow();
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

describe('in suggest mode', () => {
  beforeAll(async () => {
    await setFlag('ai.decision.triage', true);
    await setSetting('ai.decision.triage.mode', 'suggest');
  });

  afterAll(async () => {
    await setSetting('ai.decision.triage.mode', 'off');
    await setFlag('ai.decision.triage', false);
  });

  /**
   * The stub is too crude to be confident about anything on purpose, so this
   * provider answers the way a confident one would: the agent's own team,
   * priority P2, a request rather than an incident, and a major incident.
   */
  function confidentProvider() {
    const stub = stubProvider();
    return {
      ...stub,
      async decide(request: Parameters<NonNullable<typeof stub.decide>>[0]) {
        const answers: Record<string, { value: string | boolean; confidence: number }> = {
          type: { value: 'request', confidence: 0.9 },
          priority: { value: 'P2', confidence: 0.85 },
          majorIncident: { value: true, confidence: 0.8 },
        };
        if (request.questions.group) answers.group = { value: 'Service Desk', confidence: 0.9 };
        return { answers, model: request.model, inputTokens: 100, outputTokens: 20, providerRequestId: null };
      },
    };
  }

  interface TriageView {
    decisionId: string;
    suggestions: { question: string; kind: string; value: unknown; display: string }[];
  }

  async function suggestionsFor(ticketId: string, token = tenant.people.agent!.token) {
    return request<{ data: TriageView | null }>(`/api/v1/ai/triage/${ticketId}`, { token });
  }

  async function ticketVersion(number: string): Promise<number> {
    const response = await request<{ version: number }>(`/api/v1/tickets/${number}`, { token: tenant.people.agent!.token });
    return response.body.version;
  }

  it('shows an agent what the AI suggested, and what each one would do', async () => {
    registerAiProvider(confidentProvider());
    const ticket = await raise('Everyone on floor two lost the VPN', 'Nobody can connect.', 'portal');
    const run = await triage(ticket.id);
    expect(run).toMatchObject({ outcome: 'suggested', provider: 'stub' });

    const view = await suggestionsFor(ticket.id);
    expect(view.status).toBe(200);
    const kinds = Object.fromEntries(view.body.data!.suggestions.map((item) => [item.question, item.kind]));
    expect(kinds).toEqual({ group: 'apply', priority: 'apply', type: 'info', majorIncident: 'warning' });
  });

  it('applies an accepted suggestion as the agent’s own edit, and remembers it', async () => {
    registerAiProvider(confidentProvider());
    const ticket = await raise('Printer queue stuck', 'Jobs will not print.', 'email');
    await triage(ticket.id);
    const { decisionId } = (await suggestionsFor(ticket.id)).body.data!;

    const accepted = await request(`/api/v1/ai/decisions/${decisionId}/suggestions/priority/accept`, {
      method: 'POST',
      token: tenant.people.agent!.token,
      body: { version: await ticketVersion(ticket.number) },
    });
    expect(accepted.status).toBe(200);

    const after = await read((tx) => tx.ticket.findFirst({ where: { id: ticket.id } }));
    expect(after!.priority).toBe('P2');
    // The change is the agent's, not the AI's.
    expect(after!.updatedBy).toBe(tenant.people.agent!.id);

    const audit = await read((tx) =>
      tx.auditEvent.findFirst({ where: { action: 'ai.suggestion.accepted', targetId: ticket.id } }),
    );
    expect(audit?.after).toMatchObject({ decisionId, question: 'priority', value: 'P2' });

    // Dealt with, so it is no longer shown.
    const remaining = (await suggestionsFor(ticket.id)).body.data!.suggestions.map((item) => item.question);
    expect(remaining).not.toContain('priority');

    const score = await request<{ questions: { question: string; responses: { accepted: number } }[] }>(
      '/api/v1/ai/decisions/score',
      { token: tenant.people.admin!.token },
    );
    expect(score.body.questions.find((question) => question.question === 'priority')!.responses.accepted).toBeGreaterThanOrEqual(1);
  });

  it('assigns the suggested team through the ordinary assignment', async () => {
    registerAiProvider(confidentProvider());
    const ticket = await raise('New starter needs an account', 'Starts Monday.', 'portal');
    await triage(ticket.id);
    const { decisionId } = (await suggestionsFor(ticket.id)).body.data!;

    const accepted = await request(`/api/v1/ai/decisions/${decisionId}/suggestions/group/accept`, {
      method: 'POST',
      token: tenant.people.agent!.token,
      body: { version: await ticketVersion(ticket.number) },
    });
    expect(accepted.status).toBe(200);
    const after = await read((tx) => tx.ticket.findFirst({ where: { id: ticket.id } }));
    expect(after!.groupId).toBe(tenant.teamId);
  });

  it('refuses a stale version rather than overwriting somebody else’s change', async () => {
    registerAiProvider(confidentProvider());
    const ticket = await raise('Laptop battery drains fast', 'Two hours at most.', 'email');
    await triage(ticket.id);
    const { decisionId } = (await suggestionsFor(ticket.id)).body.data!;
    const stale = (await ticketVersion(ticket.number)) - 1;

    const refused = await request(`/api/v1/ai/decisions/${decisionId}/suggestions/priority/accept`, {
      method: 'POST',
      token: tenant.people.agent!.token,
      body: { version: stale < 1 ? 999 : stale },
    });
    expect(refused.status).toBe(409);
  });

  it('never declares a major incident or changes a type from a suggestion — only dismisses them', async () => {
    registerAiProvider(confidentProvider());
    const ticket = await raise('All phones are down', 'Nobody can call out.', 'voice');
    await triage(ticket.id);
    const { decisionId } = (await suggestionsFor(ticket.id)).body.data!;
    const version = await ticketVersion(ticket.number);

    for (const question of ['majorIncident', 'type']) {
      const refused = await request(`/api/v1/ai/decisions/${decisionId}/suggestions/${question}/accept`, {
        method: 'POST',
        token: tenant.people.agent!.token,
        body: { version },
      });
      // A request the API understood and will not carry out.
      expect(refused.status).toBe(422);
    }
    expect(await read((tx) => tx.majorIncident.count({ where: { ticketId: ticket.id } }))).toBe(0);

    const dismissed = await request(`/api/v1/ai/decisions/${decisionId}/suggestions/majorIncident/dismiss`, {
      method: 'POST',
      token: tenant.people.agent!.token,
      body: {},
    });
    expect(dismissed.status).toBe(200);
    const remaining = (await suggestionsFor(ticket.id)).body.data!.suggestions.map((item) => item.question);
    expect(remaining).not.toContain('majorIncident');
  });

  it('keeps suggestions, and the answers to them, from a requester', async () => {
    registerAiProvider(confidentProvider());
    const ticket = await raise('Shared mailbox missing', 'Gone since this morning.', 'email');
    await triage(ticket.id);
    const { decisionId } = (await suggestionsFor(ticket.id)).body.data!;

    expect((await suggestionsFor(ticket.id, tenant.people.requester!.token)).status).toBe(403);
    const dismissed = await request(`/api/v1/ai/decisions/${decisionId}/suggestions/type/dismiss`, {
      method: 'POST',
      token: tenant.people.requester!.token,
      body: {},
    });
    expect(dismissed.status).toBe(403);
  });

  it('shows agents nothing while the desk is only in shadow', async () => {
    registerAiProvider(confidentProvider());
    const ticket = await raise('Webcam not detected', 'Worked yesterday.', 'portal');
    await triage(ticket.id);
    await setSetting('ai.decision.triage.mode', 'shadow');
    try {
      expect((await suggestionsFor(ticket.id)).body.data).toBeNull();
    } finally {
      await setSetting('ai.decision.triage.mode', 'suggest');
    }
  });
});

describe('in auto mode', () => {
  type CategoryRow = { id: string; tenantId: string; name: string; key: string; path: string };
  let access: CategoryRow;
  let printing: CategoryRow;
  let fastPolicyKey: string;

  beforeAll(async () => {
    await setFlag('ai.decision.triage', true);
    await setSetting('ai.decision.triage.mode', 'auto');
    const category = (key: string, name: string): CategoryRow => ({
      id: randomUUID(),
      tenantId: tenant.id,
      name,
      key,
      path: name,
    });
    access = category('access-vpn', 'Access / VPN');
    printing = category('printing', 'Hardware / Printing');
    await read((tx) => tx.category.createMany({ data: [access, printing] }));
  });

  afterAll(async () => {
    await setSetting('ai.decision.triage.mode', 'off');
    await setFlag('ai.decision.triage', false);
  });

  /** A provider sure of itself: Access / VPN, the Service Desk, and a type and priority it may never apply. */
  function sureProvider(confidence = 0.96) {
    const stub = stubProvider();
    return {
      ...stub,
      async decide(request: Parameters<NonNullable<typeof stub.decide>>[0]) {
        const answers: Record<string, { value: string | boolean; confidence: number }> = {
          type: { value: 'request', confidence },
          priority: { value: 'P1', confidence },
          majorIncident: { value: false, confidence },
        };
        if (request.questions.category) answers.category = { value: 'Access / VPN', confidence };
        if (request.questions.group) answers.group = { value: 'Service Desk', confidence };
        return { answers, model: request.model, inputTokens: 100, outputTokens: 20, providerRequestId: null };
      },
    };
  }

  /**
   * A shadow record that earns a field: resolved tickets where a confident
   * answer matched what the desk settled on. Written straight to the table,
   * because two hundred resolved tickets is what earning it takes.
   */
  async function earn(question: 'category' | 'group', value: string, label: string, count = 210): Promise<void> {
    await read((tx) =>
      tx.aiDecision.createMany({
        data: Array.from({ length: count }, () => ({
          id: randomUUID(),
          tenantId: tenant.id,
          purpose: 'triage',
          subjectType: 'ticket',
          subjectId: randomUUID(),
          mode: 'shadow',
          questionSetVersion: 1,
          provider: 'stub',
          model: 'stub-small',
          answers: { [question]: { value: label, confidence: 0.95 } },
          proposed: { [question]: value },
          settled: { [question]: value },
          settledAt: new Date(),
          outcome: 'shadowed',
          periodKey: '2026-09',
        })),
      }),
    );
  }

  interface AutoView {
    decisionId: string;
    suggestions: { question: string; kind: string }[];
    applied: { question: string; field: string; value: string; display: string }[];
  }

  async function viewFor(ticketId: string, token = tenant.people.agent!.token) {
    return request<{ data: AutoView | null }>(`/api/v1/ai/triage/${ticketId}`, { token });
  }

  async function ticketRow(id: string) {
    return read((tx) => tx.ticket.findFirst({ where: { id } }));
  }

  async function decisionRow(ticketId: string) {
    return read((tx) => tx.aiDecision.findFirst({ where: { subjectId: ticketId }, orderBy: { createdAt: 'desc' } }));
  }

  it('suggests, and sets nothing, until a field has earned it on this desk', async () => {
    registerAiProvider(sureProvider());
    const ticket = await raise('Cannot reach the VPN from home', 'It times out.', 'email');
    const run = await triage(ticket.id);
    expect(run).toMatchObject({ outcome: 'suggested' });

    const row = await ticketRow(ticket.id);
    expect(row).toMatchObject({ categoryId: null, groupId: null });
    const plan = (await decisionRow(ticket.id))!.plan as { question: string; action: string; reason: string }[];
    expect(plan.find((entry) => entry.question === 'group')).toMatchObject({ action: 'suggest' });
    expect(plan.find((entry) => entry.question === 'group')!.reason).toMatch(/has not earned auto/);

    const view = (await viewFor(ticket.id)).body.data!;
    expect(view.applied).toEqual([]);
    expect(view.suggestions.map((item) => item.question)).toEqual(expect.arrayContaining(['category', 'group']));
  });

  it('sets a field that has earned it, as the AI, and only suggests one that has not', async () => {
    await earn('group', tenant.teamId, 'Service Desk');
    registerAiProvider(sureProvider());
    const ticket = await raise('VPN drops every ten minutes', 'Since the update.', 'email');
    const run = await triage(ticket.id);
    expect(run).toMatchObject({ outcome: 'applied' });

    const row = await ticketRow(ticket.id);
    expect(row).toMatchObject({ groupId: tenant.teamId, categoryId: null, type: 'incident', priority: 'P3' });

    const decision = (await decisionRow(ticket.id))!;
    expect(decision.outcome).toBe('applied');
    expect(decision.applied).toMatchObject({ group: { field: 'groupId', from: null, to: tenant.teamId } });

    // The ticket's history says the AI did it, not the requester or the agent.
    const history = await read((tx) =>
      tx.ticketEvent.findFirst({ where: { ticketId: ticket.id, type: 'updated' }, orderBy: { occurredAt: 'desc' } }),
    );
    expect(history).toMatchObject({ actorType: 'ai' });
    const audit = await read((tx) => tx.auditEvent.findFirst({ where: { action: 'ai.decision.applied', targetId: ticket.id } }));
    expect(audit).toMatchObject({ actorType: 'ai' });
    expect(audit!.after).toMatchObject({ decisionId: decision.id, provider: 'stub', fields: { group: { confidence: 0.96 } } });
    // What SLA re-matches on.
    const classified = await read((tx) =>
      tx.outboxEvent.count({ where: { type: 'ticket.classified', aggregateId: ticket.id } }),
    );
    expect(classified).toBe(1);

    const view = (await viewFor(ticket.id)).body.data!;
    expect(view.applied.map((item) => [item.question, item.display])).toEqual([['group', 'Service Desk']]);
    expect(view.suggestions.map((item) => item.question)).toContain('category');
  });

  it('never writes over a field somebody already set', async () => {
    await earn('category', access.id, 'Access / VPN');
    registerAiProvider(sureProvider());
    const response = await request<{ id: string }>('/api/v1/tickets', {
      method: 'POST',
      token: tenant.people.agent!.token,
      body: { type: 'incident', title: 'VPN certificate expired', priority: 'P3', sourceChannel: 'portal', groupId: tenant.otherTeamId },
    });
    expect(response.status).toBe(201);
    await triage(response.body.id);

    const row = await ticketRow(response.body.id);
    // The team somebody chose stands; the empty category is filled.
    expect(row).toMatchObject({ groupId: tenant.otherTeamId, categoryId: access.id });
    const plan = (await decisionRow(response.body.id))!.plan as { question: string; action: string; reason: string }[];
    expect(plan.find((entry) => entry.question === 'group')!.reason).toMatch(/set by a person or a rule/);
  });

  it('moves the SLA onto the policy the new category matches, and keeps the clock running from creation', async () => {
    fastPolicyKey = `vpn-fast-${Date.now().toString(36)}`;
    const created = await request('/api/v1/sla-policies', {
      method: 'POST',
      token: tenant.people.admin!.token,
      body: {
        key: fastPolicyKey,
        name: 'VPN, fast',
        match: { eq: [{ var: 'ticket.categoryId' }, access.id] },
        specificity: 900,
        calendarMode: 'fixed',
        calendarId: null,
        targets: [{ priority: 'P3', targetType: 'resolution', minutes: 60 }],
      },
    });
    expect(created.status).toBe(201);

    registerAiProvider(sureProvider());
    const ticket = await raise('VPN client will not install', 'Installer fails at 90%.', 'email');
    await drainEvents(tenant.id);
    const before = await read((tx) => tx.slaTimer.findFirst({ where: { ticketId: ticket.id, targetType: 'resolution' } }));
    expect(before).not.toBeNull();

    await triage(ticket.id);
    await drainEvents(tenant.id);

    const policy = await read((tx) => tx.slaPolicy.findFirst({ where: { key: fastPolicyKey } }));
    const after = await read((tx) => tx.slaTimer.findFirst({ where: { ticketId: ticket.id, targetType: 'resolution' } }));
    expect(after).toMatchObject({ policyId: policy!.id, targetMs: 60 * 60_000, state: 'running' });
    // The clock did not restart: same start, and the hour counts from then.
    expect(after!.startedAt.getTime()).toBe(before!.startedAt.getTime());
    expect(after!.dueAt!.getTime()).toBeLessThanOrEqual(before!.startedAt.getTime() + 60 * 60_000 + 1_000);
    expect((await ticketRow(ticket.id))!.slaPolicyId).toBe(policy!.id);
    const audit = await read((tx) => tx.auditEvent.findFirst({ where: { action: 'sla.timers.rematched', targetId: ticket.id } }));
    expect(audit).not.toBeNull();
  });

  it('shows what the AI set with an Undo that puts it back, as the agent, and counts it as a correction', async () => {
    registerAiProvider(sureProvider());
    const ticket = await raise('Printer asks for a VPN login', 'Odd prompt.', 'email');
    await triage(ticket.id);
    const view = (await viewFor(ticket.id)).body.data!;
    expect(view.applied.map((item) => item.question).sort()).toEqual(['category', 'group']);

    const version = (await ticketRow(ticket.id))!.version;
    // A requester cannot undo anything.
    const refused = await request(`/api/v1/ai/decisions/${view.decisionId}/applied/group/undo`, {
      method: 'POST',
      token: tenant.people.requester!.token,
      body: { version },
    });
    expect(refused.status).toBe(403);

    const undone = await request(`/api/v1/ai/decisions/${view.decisionId}/applied/group/undo`, {
      method: 'POST',
      token: tenant.people.agent!.token,
      body: { version },
    });
    expect(undone.status).toBe(200);
    const row = await ticketRow(ticket.id);
    expect(row).toMatchObject({ groupId: null, categoryId: access.id });
    expect(row!.updatedBy).toBe(tenant.people.agent!.id);

    const decision = (await decisionRow(ticket.id))!;
    expect(decision.responses).toMatchObject({ group: { action: 'undone', by: tenant.people.agent!.id } });
    const audit = await read((tx) => tx.auditEvent.findFirst({ where: { action: 'ai.decision.undone', targetId: ticket.id } }));
    expect(audit!.after).toMatchObject({ question: 'group', restored: null });

    // Only the category is left to undo, and the group cannot be undone twice.
    expect((await viewFor(ticket.id)).body.data!.applied.map((item) => item.question)).toEqual(['category']);
    const again = await request(`/api/v1/ai/decisions/${view.decisionId}/applied/group/undo`, {
      method: 'POST',
      token: tenant.people.agent!.token,
      body: { version: (await ticketRow(ticket.id))!.version },
    });
    expect(again.status).toBe(422);
  });

  it('counts a person changing what the AI set as a correction — and not the AI, and not a reassignment', async () => {
    registerAiProvider(sureProvider());
    const ticket = await raise('VPN slow on hotel wifi', 'Unusable.', 'email');
    await triage(ticket.id);
    // The AI's own write comes back as an event too; it is not a correction.
    await drainEvents(tenant.id);
    expect((await decisionRow(ticket.id))!.responses).toEqual({});

    // Taking the ticket keeps the team the AI set: not a correction either.
    const taken = await request(`/api/v1/tickets/${ticket.number}/assign`, {
      method: 'POST',
      token: tenant.people.agent!.token,
      body: { assigneeId: tenant.people.agent!.id },
    });
    expect(taken.status).toBe(200);
    await drainEvents(tenant.id);
    expect((await decisionRow(ticket.id))!.responses).toEqual({});

    const changed = await request(`/api/v1/tickets/${ticket.number}`, {
      method: 'PATCH',
      token: tenant.people.agent!.token,
      headers: { 'if-match': `"${(await ticketRow(ticket.id))!.version}"` },
      body: { categoryId: printing.id },
    });
    expect(changed.status).toBe(200);
    await drainEvents(tenant.id);

    const decision = (await decisionRow(ticket.id))!;
    expect(decision.responses).toMatchObject({ category: { action: 'overridden', to: printing.id } });
    expect((decision.responses as Record<string, unknown>).group).toBeUndefined();
    const audit = await read((tx) => tx.auditEvent.findFirst({ where: { action: 'ai.decision.overridden', targetId: ticket.id } }));
    expect(audit).not.toBeNull();

    const score = await request<{ questions: { question: string; applied: { applied: number; overridden: number } }[] }>(
      '/api/v1/ai/decisions/score',
      { token: tenant.people.admin!.token },
    );
    expect(score.body.questions.find((question) => question.question === 'category')!.applied.overridden).toBeGreaterThanOrEqual(1);
  });

  it('steps itself back to suggest when people correct too many, and tells the administrators', async () => {
    // The last hundred applied decisions, newest of all, six of them corrected.
    const now = Date.now();
    await read((tx) =>
      tx.aiDecision.createMany({
        data: Array.from({ length: 100 }, (_, index) => ({
          id: randomUUID(),
          tenantId: tenant.id,
          purpose: 'triage',
          subjectType: 'ticket',
          subjectId: randomUUID(),
          mode: 'auto',
          questionSetVersion: 1,
          provider: 'stub',
          model: 'stub-small',
          applied: { group: { field: 'groupId', from: null, to: tenant.teamId, confidence: 0.95, at: new Date(now).toISOString() } },
          responses: index < 6 ? { group: { action: 'overridden', by: tenant.people.agent!.id } } : {},
          outcome: 'applied',
          periodKey: '2026-09',
          createdAt: new Date(now + 60_000 + index),
        })),
      }),
    );

    const worker = systemContext(tenant.id, { region: 'eu-west' });
    expect(await withContext(worker, () => reviewAutoMode(worker, 'triage'))).toBe(true);
    // Once is enough: it is in suggest now.
    expect(await withContext(worker, () => reviewAutoMode(worker, 'triage'))).toBe(false);

    const context = ctx();
    expect(await withContext(context, () => getSetting(context, 'ai.decision.triage.mode'))).toBe('suggest');
    const audit = await read((tx) => tx.auditEvent.findFirst({ where: { action: 'ai.decision.stepped_down' } }));
    expect(audit).toMatchObject({ actorType: 'system' });
    expect(audit!.after).toMatchObject({ mode: 'suggest', overridden: 6, window: 100 });

    await drainEvents(tenant.id);
    const told = await read((tx) =>
      tx.notification.findMany({ where: { eventType: 'ai.decision.stepped_down', recipientId: tenant.people.admin!.id } }),
    );
    expect(told.length).toBeGreaterThanOrEqual(1);

    const score = await request<{ lastStepDown: { overridden: number } | null; stepDown: { wouldStepDown: boolean } }>(
      '/api/v1/ai/decisions/score',
      { token: tenant.people.admin!.token },
    );
    expect(score.body.lastStepDown).toMatchObject({ overridden: 6 });
    expect(score.body.stepDown.wouldStepDown).toBe(true);

    // What the AI already set keeps its Undo after the step-down.
    registerAiProvider(sureProvider());
    await setSetting('ai.decision.triage.mode', 'auto');
    const ticket = await raise('VPN will not reconnect after sleep', 'Every morning.', 'email');
    // Auto again, but the evidence has not changed: the next correction would
    // step it down again, and until then it applies.
    await triage(ticket.id);
    await setSetting('ai.decision.triage.mode', 'suggest');
    expect((await viewFor(ticket.id)).body.data!.applied.length).toBeGreaterThan(0);
  });
});
