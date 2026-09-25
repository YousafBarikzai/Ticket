import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { systemContext, transaction, withContext } from '@itsm/platform';
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
import { closeHarness, contextFor, createTestTenant, deleteTestTenant, request, type TestTenant } from '../support/harness.js';

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

async function raiseTicket(title: string, description: string): Promise<string> {
  const response = await request<{ id: string }>('/api/v1/tickets', {
    method: 'POST',
    token: tenant.people.agent!.token,
    body: { type: 'incident', title, description, priority: 'P3' },
  });
  expect(response.status).toBe(201);
  return response.body.id;
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
