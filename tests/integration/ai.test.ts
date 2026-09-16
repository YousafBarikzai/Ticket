import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { systemContext, transaction, withContext } from '@itsm/platform';
import { settingsService } from '@itsm/module-admin';
import { tenantService } from '@itsm/module-tenancy';
import { userService } from '@itsm/module-identity';
import { articleService } from '@itsm/module-knowledge';
import { activeProvider, clearAiProvider, registerAiProvider, runSuggestionJob, stubProvider, sweepPrompts } from '@itsm/module-ai';
import { closeHarness, contextFor, createTestTenant, deleteTestTenant, drainEvents, request, type TestTenant } from '../support/harness.js';

/**
 * The governed AI service (MOD-09 AI).
 *
 * The unit suite proves the arithmetic, the parsing and the scoring. This
 * proves the governance, which is the part that only exists once there is a
 * database, a permission model and a queue: that a suggestion is grounded in
 * evidence the asker could already read, that an ungrounded one is refused
 * rather than invented, that the budget and the kill switches actually stop
 * it, and that a job runs as the person who asked rather than as the worker.
 */

let tenant: TestTenant;

beforeAll(async () => {
  tenant = await createTestTenant('ai');
}, 120_000);

afterAll(async () => {
  await deleteTestTenant('ai');
  await closeHarness();
});

const asAdmin = () => tenant.people.admin!.token;
const asAgent = () => tenant.people.agent!.token;
const asRequester = () => tenant.people.requester!.token;

function ctx() {
  return contextFor(tenant.id);
}

async function write<T>(fn: (tx: Parameters<Parameters<typeof transaction>[1]>[0]) => Promise<T>): Promise<T> {
  const context = ctx();
  return withContext(context, () => transaction(context, fn));
}

interface SuggestResult {
  jobId: string;
  status: 'queued' | 'completed';
  suggestionId: string | null;
  detail?: string;
}

interface JobView {
  id: string;
  status: string;
  cost: string;
  inputTokens: number;
  outputTokens: number;
  error: string | null;
  suggestion: { id: string; content: Record<string, unknown>; reason: string; confidence: string; evidence: { kind: string; ref: string }[]; outcome: string } | null;
}

async function suggest(capability: string, ticketId: string, token = asAgent()) {
  return request<SuggestResult>('/api/v1/ai/suggest', { method: 'POST', token, body: { capability, ticketId } });
}

async function job(jobId: string): Promise<JobView> {
  const response = await request<JobView>(`/api/v1/ai/jobs/${jobId}`, { token: asAgent() });
  expect(response.status).toBe(200);
  return response.body;
}

/** Runs the queued job the way the worker would: a fresh system context. */
async function work(jobId: string): Promise<void> {
  const worker = systemContext(tenant.id, { region: 'eu-west' });
  await withContext(worker, () => runSuggestionJob(worker, jobId));
}

async function raiseTicket(title: string, description: string, token = asAgent()): Promise<string> {
  const response = await request<{ id: string }>('/api/v1/tickets', {
    method: 'POST',
    token,
    body: { type: 'incident', title, description, priority: 'P3' },
  });
  expect(response.status).toBe(201);
  return response.body.id;
}

async function setFlag(key: string, value: boolean): Promise<void> {
  const context = ctx();
  await withContext(context, () => settingsService.setFlag(context, { key, value, reason: 'integration test' }));
}

describe('what the service will answer', () => {
  it('reports the stub provider and every capability as available', async () => {
    const response = await request<{ provider: string | null; capabilities: { key: string; available: boolean; callsAModel: boolean }[] }>(
      '/api/v1/ai/capabilities',
      { token: asAgent() },
    );
    expect(response.status).toBe(200);
    // Outside production the stub is registered, which is what makes every
    // assertion below possible without a provider account (OD-04).
    expect(response.body.provider).toBe('stub');
    expect(response.body.capabilities.every((capability) => capability.available)).toBe(true);
    expect(response.body.capabilities.find((capability) => capability.key === 'similar-work')?.callsAModel).toBe(false);
  });

  it('is an agent’s tool, not a requester’s', async () => {
    const ticketId = tenant.ticketIds[0]!;
    const refused = await suggest('ticket-summary', ticketId, asRequester());
    // ADR-0006's line, enforced rather than described: nothing this module
    // produces reaches a requester without a person putting it there.
    expect(refused.status).toBe(403);
  });
});

describe('a suggestion, end to end', () => {
  let ticketId: string;
  let jobId: string;

  it('queues, runs, and comes back with its reasoning and its cost', async () => {
    ticketId = await raiseTicket('Laptop will not charge', 'It stopped charging on Friday. A second cable made no difference.');

    const queued = await suggest('ticket-summary', ticketId);
    expect(queued.status).toBe(202);
    expect(queued.body.status).toBe('queued');
    jobId = queued.body.jobId;

    await work(jobId);

    const finished = await job(jobId);
    expect(finished.status).toBe('completed');
    expect(finished.suggestion).not.toBeNull();
    expect(finished.suggestion!.reason.length).toBeGreaterThan(0);
    expect(['low', 'medium', 'high']).toContain(finished.suggestion!.confidence);
    expect(finished.suggestion!.content.summary).toContain('charg');
    // A call that reported no tokens and cost nothing is a call that did not
    // happen, however convincing the answer looks. One completion costs a
    // fraction of a penny, and it is shown as one rather than as £0.00.
    expect(finished.inputTokens).toBeGreaterThan(0);
    expect(finished.outputTokens).toBeGreaterThan(0);
    expect(finished.cost).toMatch(/p$/);
    expect(finished.cost).not.toBe('£0.00');
  });

  it('moves the month’s spend by what the job cost, and no more', async () => {
    const budget = await request<{ spentMicros: string; state: string }>('/api/v1/ai/budget', { token: asAdmin() });
    expect(budget.status).toBe(200);
    const spent = BigInt(budget.body.spentMicros);
    expect(spent).toBeGreaterThan(0n);

    // Running the same job again is a redelivery, and the figure is a sum of
    // the jobs rather than an accumulator, so it cannot move (ADR-0031).
    await work(jobId);
    const again = await request<{ spentMicros: string }>('/api/v1/ai/budget', { token: asAdmin() });
    expect(BigInt(again.body.spentMicros)).toBe(spent);
  });

  it('records what the person did with it, once', async () => {
    const suggestionId = (await job(jobId)).suggestion!.id;
    const accepted = await request<{ outcome: string }>(`/api/v1/ai/suggestions/${suggestionId}/outcome`, {
      method: 'POST',
      token: asAgent(),
      body: { outcome: 'edited', note: 'Shortened it.' },
    });
    expect(accepted.status).toBe(200);
    expect(accepted.body.outcome).toBe('edited');

    // An outcome that could be revised could not be joined to what happened to
    // the ticket afterwards, which is the only reason to collect it.
    const twice = await request<{ detail: string }>(`/api/v1/ai/suggestions/${suggestionId}/outcome`, {
      method: 'POST',
      token: asAgent(),
      body: { outcome: 'accepted' },
    });
    expect(twice.status).toBe(422);
  });

  it('keeps the rendered prompt for audit, and the sweep takes it away', async () => {
    const before = await write((tx) => tx.aiJob.findFirst({ where: { id: jobId } }));
    expect(before?.promptText).toContain('Laptop will not charge');

    const context = ctx();
    // Pretend the retention window has passed rather than waiting thirty days.
    await withContext(context, () => sweepPrompts(context, new Date(Date.now() + 31 * 86_400_000)));

    const after = await write((tx) => tx.aiJob.findFirst({ where: { id: jobId } }));
    expect(after?.promptText).toBeNull();
    expect(after?.completionText).toBeNull();
    // The job, its cost and its outcome are the audit record and the figures
    // the budget is rebuilt from. Only the text goes.
    expect(after?.costMicros).toBe(before?.costMicros);
  });
});

describe('grounding', () => {
  it('refuses to draft a reply it has nothing to base on, and says why', async () => {
    const ticketId = await raiseTicket('Zarquon flux capacitor emits quadrotriticale', 'Nothing in this tenant is about this.');
    const queued = await suggest('reply-draft', ticketId);
    expect(queued.status).toBe(202);
    await work(queued.body.jobId);

    const finished = await job(queued.body.jobId);
    // Not "failed": nothing went wrong. The module declined, and the reason is
    // actionable — the knowledge base is what is missing.
    expect(finished.status).toBe('refused');
    expect(finished.error).toMatch(/nothing to ground/i);
    expect(finished.suggestion).toBeNull();
  });

  it('drafts one when there is an article to cite, and cites it', async () => {
    const context = ctx();
    await withContext(context, async () => {
      await articleService.createArticle(context, {
        key: 'charging-faults',
        title: 'Diagnosing a laptop that will not charge',
        summary: 'Cable, port, battery, in that order.',
        body: [{ type: 'paragraph', content: [{ text: 'Try a known-good charger before replacing anything.' }] }],
        // Internal on purpose: this is the case that could not work until the
        // agent role's search scope was widened, and it is the ordinary one —
        // most of what grounds a reply is written for agents.
        audience: 'internal',
      });
      await articleService.publishArticle(context, 'charging-faults');
    });
    await drainEvents(tenant.id);

    const ticketId = await raiseTicket('Laptop will not charge at all', 'No light on the charger.');
    const queued = await suggest('reply-draft', ticketId);
    await work(queued.body.jobId);

    const finished = await job(queued.body.jobId);
    expect(finished.status).toBe('completed');
    expect(finished.suggestion!.evidence.length).toBeGreaterThan(0);
    // The evidence is what a person opens to check the answer. Without a
    // reference it is a claim rather than a citation.
    expect(finished.suggestion!.evidence.some((one) => one.kind === 'article')).toBe(true);
    expect(finished.suggestion!.evidence.every((one) => one.ref.length > 0)).toBe(true);
  });
});

describe('the controls that stop it', () => {
  it('refuses over the budget, and leaves retrieval working', async () => {
    const ticketId = await raiseTicket('Monitor flickers on the left side', 'Since this morning.');

    // A cap of nothing: the honest way to prove the refusal, because a
    // completion costs a fraction of a penny and reaching a cap of one would
    // take twenty calls to say the same thing. An administrator setting zero
    // is also a real act — it is how AI is paused without switching it off.
    const set = await request<{ state: string }>('/api/v1/ai/budget', {
      method: 'PUT',
      token: asAdmin(),
      body: { limitPence: 0, warnPence: 0 },
    });
    expect(set.status).toBe(200);

    const refused = await suggest('ticket-summary', ticketId);
    expect(refused.status).toBe(402);
    expect(refused.body.detail).toMatch(/AI budget/);
    // 402, not 403: the caller is permitted and the obstacle is commercial, so
    // a client that retries after the budget is raised is doing the right thing.

    // The capability that calls no model costs nothing, so a spent budget does
    // not take it away.
    const stillWorks = await suggest('similar-work', ticketId);
    expect(stillWorks.status).toBe(201);
    expect(stillWorks.body.status).toBe('completed');

    await request('/api/v1/ai/budget', { method: 'PUT', token: asAdmin(), body: { limitPence: null, warnPence: null } });
  });

  /**
   * Residency, end to end.
   *
   * The unit test proves the comparison; this proves it is wired into the one
   * path that calls a model. Worth having separately because the failure mode
   * is invisible: a policy that is never consulted looks exactly like a policy
   * that is satisfied, and nothing in a passing suggestion would say which.
   *
   * The stub declares no region, so it can never be refused. A provider that
   * makes a call has to name one, and this registers a stub that does.
   */
  it('refuses a provider that processes outside the tenant\u2019s regions', async () => {
    const ticketId = await raiseTicket('Laptop will not wake from sleep', 'Since the update.');
    const original = activeProvider();

    // Through the service, not the HTTP route. `PUT /tenants/:id/ai-regions`
    // needs `platform.tenant.manage` at `any` scope, and no tenant role holds
    // a `platform.*` permission — which is the route being a platform door
    // working correctly, not a gap. Every other integration test reaches a
    // platform-level operation the same way.
    const setRegions = (regions: string[]) => tenantService.setAiRegions(tenant.id, { regions });

    // Everything the stub does, plus a jurisdiction.
    registerAiProvider({ ...stubProvider(), processingRegion: 'us-east' });
    await setRegions(['eu-west']);

    try {
      const refused = await suggest('ticket-summary', ticketId);
      // 403, not 503: waiting will not change the answer, and an error that
      // looks transient invites a retry loop against a policy.
      expect(refused.status).toBe(403);
      expect(JSON.stringify(refused.body)).toMatch(/us-east/);

      // The same tenant, with the region permitted, gets its job. 202 and not
      // 201: `ticket-summary` calls a model, so the door's answer is a queued
      // job id, the same as the end-to-end test above.
      await setRegions(['eu-west', 'us-east']);
      const allowed = await suggest('ticket-summary', ticketId);
      expect(allowed.status).toBe(202);
      expect(allowed.body.status).toBe('queued');
    } finally {
      // Restored either way. Leaving a us-east stub registered because there
      // was nothing to put back would quietly fail every AI test after this
      // one, in a suite where the provider is process-global.
      if (original) registerAiProvider(original);
      else clearAiProvider();
      await setRegions([]);
    }
  });

  it('refuses a warning line above the cap, which could never be reached', async () => {
    const response = await request<{ detail: string }>('/api/v1/ai/budget', {
      method: 'PUT',
      token: asAdmin(),
      body: { limitPence: 100, warnPence: 500 },
    });
    expect(response.status).toBe(422);
    await request('/api/v1/ai/budget', { method: 'PUT', token: asAdmin(), body: { limitPence: null, warnPence: null } });
  });

  it('stops one capability without stopping the rest', async () => {
    const ticketId = await raiseTicket('Keyboard types double letters', 'Every key, intermittently.');
    await setFlag('ai.capability.ticket-summary', false);

    const off = await suggest('ticket-summary', ticketId);
    expect(off.status).toBe(403);
    const on = await suggest('similar-work', ticketId);
    expect(on.status).toBe(201);

    await setFlag('ai.capability.ticket-summary', true);
  });

  it('stops everything when the tenant switch goes off', async () => {
    const ticketId = await raiseTicket('Mouse pointer jumps across the screen', 'Only on the docking station.');
    await setFlag('ai.enabled', false);

    expect((await suggest('ticket-summary', ticketId)).status).toBe(403);
    expect((await suggest('similar-work', ticketId)).status).toBe(403);

    await setFlag('ai.enabled', true);
    expect((await suggest('similar-work', ticketId)).status).toBe(201);
  });
});

describe('who the job runs as', () => {
  it('refuses a queued job whose asker no longer has an account, rather than running it on the worker’s rights', async () => {
    const context = ctx();
    const spare = tenant.people.spare!;
    await withContext(context, () => userService.assignRole(context, { userId: spare.id, roleKey: 'agent' }));

    // Raised by the spare themselves: they hold the agent role but belong to
    // no team, so a ticket in somebody else's queue is one they may not read
    // — and a suggestion must not be the thing that shows it to them.
    const ticketId = await raiseTicket('Docking station drops the network', 'Happens when the lid closes.', spare.token);
    const queued = await request<SuggestResult>('/api/v1/ai/suggest', {
      method: 'POST',
      token: spare.token,
      body: { capability: 'ticket-summary', ticketId },
    });
    expect(queued.status).toBe(202);

    await withContext(context, () => userService.deactivateUser(context, spare.id, 'left the organisation'));
    await work(queued.body.jobId);

    const finished = await job(queued.body.jobId);
    // A job arrives with the asker's id and the worker's permissions. If the
    // worker's were used, this would have run happily — with the platform's
    // system rights, for somebody who no longer works here.
    expect(finished.status).toBe('refused');
    expect(finished.error).toMatch(/no longer has an active account/);
  });
});
