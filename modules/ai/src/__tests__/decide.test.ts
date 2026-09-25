import { afterEach, describe, expect, it } from 'vitest';
import { DependencyUnavailableError, ValidationError } from '@itsm/platform';
import { clearModelPrices, registerModelPrices } from '../domain/budget.js';
import { addAiProvider, clearAiProvider, registerAiProvider } from '../providers/registry.js';
import { stubProvider } from '../providers/stub.js';
import type { AiProvider, Decision, DecisionQuestion, DecisionRequest } from '../providers/types.js';
import { decide, resetDecisionBreakers, type DecideCall } from '../service/gateway.js';

/**
 * The decision chain (ADR-0051).
 *
 * What is worth proving is every way a link is passed over, because each of
 * them ends the same way from the ticket's point of view — nothing changes —
 * and only the record says which one it was.
 */

const QUESTIONS: Record<string, DecisionQuestion> = {
  type: { kind: 'choice', ask: 'Type?', options: ['incident', 'request', 'question'] },
  majorIncident: { kind: 'yesno', ask: 'Major?' },
};

function call(overrides: Partial<DecideCall> = {}): DecideCall {
  return {
    purpose: 'triage',
    state: { title: 'The VPN is down for everyone' },
    questions: QUESTIONS,
    allowedRegions: ['eu-west'],
    budgetAvailable: true,
    chain: ['engine', 'general'],
    ...overrides,
  };
}

function provider(
  name: string,
  decideImpl: ((request: DecisionRequest) => Promise<Decision>) | undefined,
  processingRegion: string | null = 'eu-west',
): AiProvider {
  return {
    name,
    models: [`${name}-model`],
    processingRegion,
    async complete() {
      throw new Error('not used');
    },
    ...(decideImpl ? { decide: decideImpl } : {}),
  };
}

const answer = (model: string, value = 'incident'): Decision => ({
  answers: { type: { value, confidence: 0.9 }, majorIncident: { value: true, confidence: 0.8 } },
  model,
  inputTokens: 1000,
  outputTokens: 50,
  providerRequestId: 'req_1',
});

function priced(...models: string[]): void {
  registerModelPrices(Object.fromEntries(models.map((model) => [model, { inputPerThousand: 1_000n, outputPerThousand: 10_000n }])));
}

afterEach(() => {
  clearAiProvider();
  clearModelPrices();
  resetDecisionBreakers();
});

describe('the first link that answers', () => {
  it('is the one used, and the rest are not asked', async () => {
    let generalAsked = false;
    priced('engine-model', 'general-model');
    addAiProvider(provider('engine', async () => answer('engine-model')));
    addAiProvider(
      provider('general', async () => {
        generalAsked = true;
        return answer('general-model');
      }),
    );

    const result = await decide(call());
    expect(result.provider).toBe('engine');
    expect(result.decision?.answers.type).toEqual({ value: 'incident', confidence: 0.9 });
    expect(generalAsked).toBe(false);
    // 1000 input at 1000/thousand + 50 output at 10000/thousand
    expect(result.costMicros).toBe(1_500n);
    expect(result.attempts).toEqual([
      expect.objectContaining({ provider: 'engine', outcome: 'answered', reason: null, costMicros: '1500' }),
    ]);
  });
});

describe('a link that is passed over', () => {
  it('is skipped when it is not registered in this deployment', async () => {
    priced('general-model');
    addAiProvider(provider('general', async () => answer('general-model')));
    const result = await decide(call());
    expect(result.provider).toBe('general');
    expect(result.attempts[0]).toMatchObject({ provider: 'engine', outcome: 'skipped', reason: 'not-registered' });
  });

  it('is skipped when it cannot decide', async () => {
    priced('engine-model', 'general-model');
    addAiProvider(provider('engine', undefined));
    addAiProvider(provider('general', async () => answer('general-model')));
    const result = await decide(call());
    expect(result.attempts[0]).toMatchObject({ outcome: 'skipped', reason: 'no-decide' });
  });

  it('is skipped, and sent nothing, when it processes outside the tenant’s regions', async () => {
    let sent = false;
    priced('engine-model', 'general-model');
    addAiProvider(
      provider(
        'engine',
        async () => {
          sent = true;
          return answer('engine-model');
        },
        'us-east',
      ),
    );
    addAiProvider(provider('general', async () => answer('general-model')));

    const result = await decide(call());
    expect(sent).toBe(false);
    expect(result.provider).toBe('general');
    expect(result.attempts[0]).toMatchObject({ provider: 'engine', outcome: 'skipped', reason: 'residency' });
  });

  it('falls to rules rather than leaving the regions, when every link is outside them', async () => {
    priced('engine-model', 'general-model');
    addAiProvider(provider('engine', async () => answer('engine-model'), 'us-east'));
    addAiProvider(provider('general', async () => answer('general-model'), 'us-west'));
    const result = await decide(call());
    expect(result.provider).toBe('rules');
    expect(result.decision).toBeNull();
    expect(result.attempts.map((attempt) => attempt.reason)).toEqual(['residency', 'residency']);
  });

  it('is skipped when its model has no price', async () => {
    priced('general-model');
    addAiProvider(provider('engine', async () => answer('engine-model')));
    addAiProvider(provider('general', async () => answer('general-model')));
    const result = await decide(call());
    expect(result.attempts[0]).toMatchObject({ reason: 'unpriced' });
  });

  it('is skipped when the tenant’s budget is spent — and nothing fails', async () => {
    priced('engine-model');
    addAiProvider(provider('engine', async () => answer('engine-model')));
    const result = await decide(call({ budgetAvailable: false, chain: ['engine'] }));
    expect(result.provider).toBe('rules');
    expect(result.attempts[0]).toMatchObject({ reason: 'budget' });
  });
});

describe('a link that does not answer', () => {
  it('moves on after a timeout, without retrying it', async () => {
    // `jev` is the name the catalogue gives a two-second timeout, so the slow
    // provider is registered under it.
    let asked = 0;
    priced('jev-model', 'general-model');
    addAiProvider(
      provider('jev', (request) => {
        asked += 1;
        return new Promise<Decision>((_, reject) => request.signal.addEventListener('abort', () => reject(new Error('aborted'))));
      }),
    );
    addAiProvider(provider('general', async () => answer('general-model')));

    const started = Date.now();
    const result = await decide(call({ chain: ['jev', 'general'] }));
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(asked).toBe(1);
    expect(result.provider).toBe('general');
    expect(result.attempts[0]).toMatchObject({ provider: 'jev', outcome: 'failed', reason: 'timeout' });
  }, 10_000);

  it('retries once when the provider says "try later", then moves on', async () => {
    let asked = 0;
    priced('engine-model', 'general-model');
    addAiProvider(
      provider('engine', async () => {
        asked += 1;
        throw new DependencyUnavailableError('engine');
      }),
    );
    addAiProvider(provider('general', async () => answer('general-model')));
    const result = await decide(call());
    expect(asked).toBe(2);
    expect(result.attempts[0]).toMatchObject({ outcome: 'failed', reason: 'unavailable' });
    expect(result.provider).toBe('general');
  });

  it('does not retry a refusal', async () => {
    let asked = 0;
    priced('engine-model');
    addAiProvider(
      provider('engine', async () => {
        asked += 1;
        throw new ValidationError('bad key');
      }),
    );
    const result = await decide(call({ chain: ['engine'] }));
    expect(asked).toBe(1);
    expect(result.attempts[0]).toMatchObject({ reason: 'refused' });
    expect(result.provider).toBe('rules');
  });

  it('moves on from an answer with nothing usable in it, and still counts what it cost', async () => {
    priced('engine-model', 'general-model');
    addAiProvider(
      provider('engine', async () => ({
        ...answer('engine-model'),
        answers: { type: { value: 'outage', confidence: 0.9 }, majorIncident: { value: 'yes', confidence: 0.9 } },
      })),
    );
    addAiProvider(provider('general', async () => answer('general-model')));

    const result = await decide(call());
    expect(result.attempts[0]).toMatchObject({ provider: 'engine', outcome: 'failed', reason: 'invalid-answer', costMicros: '1500' });
    expect(result.provider).toBe('general');
    expect(result.costMicros).toBe(3_000n);
    expect(result.inputTokens).toBe(2_000);
  });

  it('stops asking a provider that keeps failing, until its cooldown ends', async () => {
    let asked = 0;
    priced('engine-model');
    addAiProvider(
      provider('engine', async () => {
        asked += 1;
        throw new ValidationError('broken');
      }),
    );
    for (let index = 0; index < 5; index += 1) await decide(call({ chain: ['engine'] }));
    expect(asked).toBe(5);

    const result = await decide(call({ chain: ['engine'] }));
    expect(asked).toBe(5);
    expect(result.attempts[0]).toMatchObject({ outcome: 'skipped', reason: 'circuit-open' });
  });
});

describe('the stub', () => {
  it('decides deterministically, so the chain can be proved without a network', async () => {
    registerAiProvider(stubProvider());
    const first = await decide(call({ chain: ['stub'] }));
    const second = await decide(call({ chain: ['stub'] }));
    expect(first.provider).toBe('stub');
    expect(first.decision?.answers).toEqual(second.decision?.answers);
    // "down for everyone" reads as a major incident to the stub's crude rule.
    expect(first.decision?.answers.majorIncident).toEqual({ value: true, confidence: 0.7 });
  });
});

describe('the model a purpose asks with', () => {
  it('uses the purpose’s choice when the provider offers it', async () => {
    const seen: string[] = [];
    registerModelPrices({ 'claude-sonnet-5': { inputPerThousand: 1n, outputPerThousand: 1n } });
    addAiProvider({
      ...provider('anthropic', async (request) => {
        seen.push(request.model);
        return answer(request.model);
      }),
      models: ['claude-opus-5', 'claude-sonnet-5'],
    });

    const result = await decide(call({ chain: ['anthropic'] }));
    // Triage names Sonnet 5 for this provider, even though Opus 5 is its default.
    expect(seen).toEqual(['claude-sonnet-5']);
    expect(result.model).toBe('claude-sonnet-5');
  });

  it('falls back to the provider’s default when it does not offer the choice', async () => {
    const seen: string[] = [];
    registerModelPrices({ 'claude-opus-5': { inputPerThousand: 1n, outputPerThousand: 1n } });
    addAiProvider({
      ...provider('anthropic', async (request) => {
        seen.push(request.model);
        return answer(request.model);
      }),
      models: ['claude-opus-5'],
    });

    await decide(call({ chain: ['anthropic'] }));
    expect(seen).toEqual(['claude-opus-5']);
  });

  it('skips the provider, naming the model, when the chosen model has no price', async () => {
    registerModelPrices({ 'claude-opus-5': { inputPerThousand: 1n, outputPerThousand: 1n } });
    addAiProvider({ ...provider('anthropic', async (request) => answer(request.model)), models: ['claude-opus-5', 'claude-sonnet-5'] });

    const result = await decide(call({ chain: ['anthropic'] }));
    expect(result.provider).toBe('rules');
    expect(result.attempts[0]).toMatchObject({ reason: 'unpriced', model: 'claude-sonnet-5' });
  });
});
