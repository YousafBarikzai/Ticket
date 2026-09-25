import { afterEach, describe, expect, it } from 'vitest';
import { clearModelPrices, registerModelPrices } from '../domain/budget.js';
import { activeDefaultModel, activeProvider, chooseDefaultModel, clearAiProvider, registerAiProvider } from '../providers/registry.js';
import { stubProvider } from '../providers/stub.js';
import type { AiProvider, CompletionRequest } from '../providers/types.js';
import { callModel } from '../service/gateway.js';

/**
 * Which model a call gets when it names none.
 *
 * This used to be a platform constant, `stub-small`, and every provider that
 * was not the stub refused it: a deployment configured for a real model could
 * not produce a single suggestion, and the message said the model was not
 * configured rather than that the platform had asked for the wrong one.
 */

function fakeProvider(models: string[], seen: CompletionRequest[] = []): AiProvider {
  return {
    name: 'fake',
    models,
    processingRegion: null,
    async complete(request) {
      seen.push(request);
      return { text: '{}', model: request.model, inputTokens: 10, outputTokens: 5, finishReason: 'stop' };
    },
  };
}

afterEach(() => {
  clearAiProvider();
  clearModelPrices();
});

describe('choosing the default', () => {
  it('takes the operator’s choice when the provider offers it', () => {
    expect(chooseDefaultModel(fakeProvider(['a', 'b']), 'b')).toBe('b');
  });

  it('refuses an operator’s choice the provider does not offer, and names both', () => {
    expect(() => chooseDefaultModel(fakeProvider(['a', 'b']), 'stub-small')).toThrow(/stub-small.*offers a, b/);
  });

  it('falls back to the provider’s first model, never to a platform constant', () => {
    expect(chooseDefaultModel(fakeProvider(['claude-sonnet-5', 'claude-haiku-4-5-20251001']))).toBe('claude-sonnet-5');
    expect(chooseDefaultModel(stubProvider())).toBe('stub-small');
  });

  it('treats an empty setting as no setting', () => {
    expect(chooseDefaultModel(fakeProvider(['a']), '')).toBe('a');
  });

  it('refuses a provider with nothing to call', () => {
    expect(() => chooseDefaultModel(fakeProvider([]))).toThrow(/offers no models/);
  });
});

describe('registering', () => {
  it('records the default alongside the provider, and forgets both together', () => {
    registerAiProvider(fakeProvider(['a', 'b']), { defaultModel: 'b' });
    expect(activeDefaultModel()).toBe('b');
    clearAiProvider();
    expect(activeProvider()).toBeNull();
    expect(activeDefaultModel()).toBeNull();
  });

  it('leaves the previous provider in place when a registration is refused', () => {
    registerAiProvider(stubProvider());
    expect(() => registerAiProvider(fakeProvider(['a']), { defaultModel: 'z' })).toThrow();
    expect(activeProvider()?.name).toBe('stub');
    expect(activeDefaultModel()).toBe('stub-small');
  });
});

describe('the gateway', () => {
  it('sends the provider’s default when the call names no model', async () => {
    const seen: CompletionRequest[] = [];
    registerModelPrices({ 'real-model': { inputPerThousand: 1n, outputPerThousand: 1n } });
    registerAiProvider(fakeProvider(['real-model'], seen));

    const result = await callModel({
      capability: 'ticket-summary',
      systemPrompt: 'You summarise.',
      template: 'Title: {{title}}',
      context: { title: 'Printer' },
      allowedRegions: ['eu-west'],
    });

    expect(seen[0]?.model).toBe('real-model');
    expect(result.completion.model).toBe('real-model');
  });

  it('still sends the model a call names', async () => {
    const seen: CompletionRequest[] = [];
    registerAiProvider(stubProvider(), { defaultModel: 'stub-small' });
    const stub = activeProvider()!;
    registerAiProvider({ ...stub, complete: (request) => (seen.push(request), stub.complete(request)) });

    await callModel({
      capability: 'ticket-summary',
      systemPrompt: 'You summarise.',
      template: 'Title: {{title}}',
      context: { title: 'Printer' },
      model: 'stub-large',
      allowedRegions: ['eu-west'],
    });

    expect(seen[0]?.model).toBe('stub-large');
  });
});
