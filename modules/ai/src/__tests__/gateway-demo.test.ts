import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiProvider, Decision, DecisionQuestion } from '../providers/types.js';

/**
 * E9 (SPEC v3 §4.7.2, D13): the shared demo calls no live model.
 *
 * `callModel` refuses with the demo's own problem, `demo_disabled` for the
 * `ai` feature, before the provider, the price or the prompt are looked at;
 * `decide` answers "rules" with every link of the chain skipped for the demo,
 * and asks no provider. A real tenant's identical call goes through, which is
 * the half that proves the guard is keyed on the tenant and nothing else.
 * The suggestion door says the same thing before a job is queued.
 */

const flags = vi.hoisted(() => ({ enabled: true }));
const tickets = vi.hoisted(() => ({ read: [] as string[] }));

vi.mock('@itsm/platform', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@itsm/platform')>();
  return { ...actual, isEnabled: async () => flags.enabled };
});

vi.mock('@itsm/module-ticket', () => ({
  ticketService: {
    getTicket: async (_ctx: unknown, id: string) => {
      tickets.read.push(id);
      // Stops the request here: what is under test is what happened before.
      throw new Error('ticket read');
    },
  },
}));

const { DemoDisabledError, buildPermissionSet, createContext, demoDisabledForForbidden, metrics, setTenantKindReader } = await import('@itsm/platform');
const { demoDisabledSentence } = await import('@itsm/contracts/demo');
const { clearModelPrices, registerModelPrices } = await import('../domain/budget.js');
const { addAiProvider, clearAiProvider, registerAiProvider } = await import('../providers/registry.js');
const { NoProviderConfigured, callModel, decide, resetDecisionBreakers } = await import('../service/gateway.js');
const { requestSuggestion } = await import('../service/suggestion-service.js');

const DEMO = '0192a000-0000-7000-8000-00000000de00';
const STANDARD = '0192a000-0000-7000-8000-000000000001';

function suppressed(): number {
  return metrics.snapshot().counters['demo_egress_suppressed_total{choke=E9}'] ?? 0;
}

const QUESTIONS: Record<string, DecisionQuestion> = {
  type: { kind: 'choice', ask: 'Type?', options: ['incident', 'request'] },
};

const asked: string[] = [];

function provider(name: string): AiProvider {
  return {
    name,
    models: [`${name}-model`],
    processingRegion: 'eu-west',
    async complete(request) {
      asked.push(`${name}:complete`);
      return { text: '{"summary":"ok"}', model: request.model, inputTokens: 10, outputTokens: 5, finishReason: 'stop' };
    },
    async decide(): Promise<Decision> {
      asked.push(`${name}:decide`);
      return { answers: { type: { value: 'incident', confidence: 0.9 } }, model: `${name}-model`, inputTokens: 100, outputTokens: 5, providerRequestId: null };
    },
  };
}

function modelCall(tenantId: string) {
  return {
    tenantId,
    capability: 'ticket-summary' as const,
    systemPrompt: 'You summarise.',
    template: 'Title: {{title}}',
    context: { title: 'The VPN is down for everyone' },
    allowedRegions: ['eu-west'],
  };
}

function decideCall(tenantId: string) {
  return {
    tenantId,
    purpose: 'triage' as const,
    state: { title: 'The VPN is down for everyone' },
    questions: QUESTIONS,
    allowedRegions: ['eu-west'],
    budgetAvailable: true,
    chain: ['engine', 'general'],
  };
}

beforeEach(() => {
  asked.length = 0;
  tickets.read.length = 0;
  flags.enabled = true;
  setTenantKindReader(async (tenantId) => (tenantId === DEMO ? 'demo' : 'standard'));
  registerModelPrices({
    'engine-model': { inputPerThousand: 1n, outputPerThousand: 1n },
    'general-model': { inputPerThousand: 1n, outputPerThousand: 1n },
  });
});

afterEach(() => {
  clearAiProvider();
  clearModelPrices();
  resetDecisionBreakers();
  setTenantKindReader(null);
});

describe('callModel', () => {
  it('refuses the demo with demo_disabled for live AI, and asks no provider', async () => {
    registerAiProvider(provider('engine'));
    const before = suppressed();
    const refusal = callModel(modelCall(DEMO));

    await expect(refusal).rejects.toBeInstanceOf(DemoDisabledError);
    const error = (await refusal.catch((e: unknown) => e)) as InstanceType<typeof DemoDisabledError>;
    expect(error.feature).toBe('ai');
    expect(error.status).toBe(403);
    expect(error.message).toBe(demoDisabledSentence('ai'));
    expect(asked).toEqual([]);
    expect(suppressed()).toBe(before + 1);
  });

  it('says so even where no provider is configured: the demo’s answer, not a missing provider', async () => {
    await expect(callModel(modelCall(DEMO))).rejects.toBeInstanceOf(DemoDisabledError);
    await expect(callModel(modelCall(STANDARD))).rejects.toBeInstanceOf(NoProviderConfigured);
  });

  it('calls the provider for a real tenant, as before', async () => {
    registerAiProvider(provider('engine'));
    const before = suppressed();
    const result = await callModel(modelCall(STANDARD));

    expect(result.provider).toBe('engine');
    expect(asked).toEqual(['engine:complete']);
    expect(suppressed()).toBe(before);
  });
});

describe('decide', () => {
  it('answers rules for the demo, with every link skipped for the demo and none asked', async () => {
    addAiProvider(provider('engine'));
    addAiProvider(provider('general'));
    const before = suppressed();
    const result = await decide(decideCall(DEMO));

    expect(result).toMatchObject({ decision: null, provider: 'rules', model: null, costMicros: 0n, inputTokens: 0, outputTokens: 0, problems: [] });
    expect(result.attempts).toEqual([
      { provider: 'engine', outcome: 'skipped', reason: 'demo', model: 'engine-model', ms: 0, costMicros: '0' },
      { provider: 'general', outcome: 'skipped', reason: 'demo', model: 'general-model', ms: 0, costMicros: '0' },
    ]);
    expect(asked).toEqual([]);
    expect(suppressed()).toBe(before + 1);
  });

  it('records a link this deployment does not have as skipped for the demo too', async () => {
    const result = await decide(decideCall(DEMO));
    expect(result.attempts.map((attempt) => [attempt.provider, attempt.reason, attempt.model])).toEqual([
      ['engine', 'demo', null],
      ['general', 'demo', null],
    ]);
  });

  it('asks the chain for a real tenant, as before', async () => {
    addAiProvider(provider('engine'));
    addAiProvider(provider('general'));
    const before = suppressed();
    const result = await decide(decideCall(STANDARD));

    expect(result.provider).toBe('engine');
    expect(result.decision?.answers.type).toEqual({ value: 'incident', confidence: 0.9 });
    expect(asked).toEqual(['engine:decide']);
    expect(suppressed()).toBe(before);
  });
});

describe('asking for a suggestion', () => {
  function asker(tenantId: string) {
    return createContext({
      tenantId,
      actor: { type: 'user', id: '0192a000-0000-7000-8000-0000000000a1', displayName: 'Alex Morgan' },
      permissions: buildPermissionSet([{ key: 'ai.suggest', scope: 'any' }]),
    });
  }

  it('is refused at the door in the demo for a capability that calls a model, before the ticket is read', async () => {
    registerAiProvider(provider('engine'));
    const before = suppressed();
    const refusal = requestSuggestion(asker(DEMO), { capability: 'ticket-summary', ticketId: 'INC-000101' });

    await expect(refusal).rejects.toBeInstanceOf(DemoDisabledError);
    await expect(refusal).rejects.toMatchObject({ feature: 'ai' });
    expect(tickets.read).toEqual([]);
    expect(asked).toEqual([]);
    expect(suppressed()).toBe(before + 1);
    // Not a permission failure dressed up: nothing for the errors plugin to translate.
    expect(demoDisabledForForbidden(await refusal.catch((e: unknown) => e))).toBeNull();
  });

  it('lets the demo ask for retrieval, which calls no model', async () => {
    const before = suppressed();
    await expect(requestSuggestion(asker(DEMO), { capability: 'similar-work', ticketId: 'INC-000101' })).rejects.toThrow('ticket read');
    expect(tickets.read).toEqual(['INC-000101']);
    expect(suppressed()).toBe(before);
  });

  it('lets a real tenant through the door to the checks after it', async () => {
    // No provider is configured, so the next refusal is the provider one.
    await expect(requestSuggestion(asker(STANDARD), { capability: 'ticket-summary', ticketId: 'INC-000101' })).rejects.toBeInstanceOf(
      NoProviderConfigured,
    );
  });
});
