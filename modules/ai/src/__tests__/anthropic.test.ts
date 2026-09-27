import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ANTHROPIC_MODELS,
  anthropicProvider,
  answersIn,
  decisionSchema,
  finishReasonOf,
  isRetryable,
  ProviderRefused,
  ProviderUnavailable,
  takesEffort,
  textOf,
} from '../providers/anthropic.js';
import type { DecisionQuestion } from '../providers/types.js';
import {
  clearModelPrices,
  costOf,
  isPriced,
  parseModelPrices,
  priceFor,
  registerModelPrices,
} from '../domain/budget.js';

/**
 * The adapter, and the pricing gap it exposed.
 *
 * Everything about the happy path is three lines of JSON mapping. What is
 * worth testing is the rest: which failures are worth retrying, what is safe
 * to say about a failure, and — the defect this work found — that a model
 * nobody has priced is refused rather than counted as free.
 */

const KEY = 'sk-not-a-real-key';

function respond(status: number, body: unknown): typeof fetch {
  return vi.fn(
    async () =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  ) as unknown as typeof fetch;
}

function provider(fetchImpl: typeof fetch) {
  return anthropicProvider({ apiKey: KEY, fetchImpl });
}

const CALL = {
  capability: 'reply-draft' as const,
  systemPrompt: 'You are a service desk.',
  prompt: 'Title: VPN will not connect',
  model: 'claude-sonnet-5',
  maxOutputTokens: 1000,
};

afterEach(() => clearModelPrices());

describe('the request it sends', () => {
  it('names the model, the system prompt and the message', async () => {
    const doFetch = respond(200, {
      model: 'claude-sonnet-5-20260101',
      content: [{ type: 'text', text: '{"ok":true}' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 120, output_tokens: 40 },
    });

    await provider(doFetch).complete(CALL);

    const [url, init] = (doFetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      model: 'claude-sonnet-5',
      max_tokens: 1000,
      system: 'You are a service desk.',
      messages: [{ role: 'user', content: 'Title: VPN will not connect' }],
    });
  });

  it('sends the key in a header and nowhere else', async () => {
    const doFetch = respond(200, { content: [{ type: 'text', text: 'x' }], stop_reason: 'end_turn' });
    await provider(doFetch).complete(CALL);

    const [url, init] = (doFetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(new Headers(init.headers).get('x-api-key')).toBe(KEY);
    expect(String(url)).not.toContain(KEY);
    expect(String(init.body)).not.toContain(KEY);
  });

  it('refuses a model this deployment was not configured for', async () => {
    const doFetch = respond(200, {});
    await expect(provider(doFetch).complete({ ...CALL, model: 'claude-invented-9' })).rejects.toBeInstanceOf(
      ProviderRefused,
    );
    // Refused before the request, not after.
    expect(doFetch).not.toHaveBeenCalled();
  });

  it('offers only models it names', () => {
    expect([...ANTHROPIC_MODELS]).toContain('claude-sonnet-5');
    expect(anthropicProvider({ apiKey: KEY, models: ['only-this'] }).models).toEqual(['only-this']);
  });

  it('will not be built without a key', () => {
    expect(() => anthropicProvider({ apiKey: '' })).toThrow(/API key/);
  });
});

describe('the answer it reads', () => {
  it('reports what actually answered, not what was asked for', async () => {
    // An alias resolves to a dated snapshot, and the cost is charged against
    // that — so the returned model has to be the one that ran.
    const completion = await provider(
      respond(200, {
        model: 'claude-sonnet-5-20260101',
        content: [{ type: 'text', text: 'hello' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 3 },
      }),
    ).complete(CALL);

    expect(completion.model).toBe('claude-sonnet-5-20260101');
    expect(completion.inputTokens).toBe(10);
    expect(completion.outputTokens).toBe(3);
  });

  it('falls back to the requested model when the provider names none', async () => {
    const completion = await provider(
      respond(200, { content: [{ type: 'text', text: 'hello' }], stop_reason: 'end_turn' }),
    ).complete(CALL);
    expect(completion.model).toBe('claude-sonnet-5');
  });

  it('concatenates text blocks and ignores anything that is not text', () => {
    expect(textOf([{ type: 'text', text: 'a' }, { type: 'thinking' }, { type: 'text', text: 'b' }])).toBe('ab');
    expect(textOf(undefined)).toBe('');
    expect(textOf([])).toBe('');
  });

  it('maps every stop reason onto the platform’s three', () => {
    expect(finishReasonOf('end_turn')).toBe('stop');
    expect(finishReasonOf('stop_sequence')).toBe('stop');
    expect(finishReasonOf('max_tokens')).toBe('length');
    expect(finishReasonOf('refusal')).toBe('refusal');
    // An unrecognised reason keeps the text rather than throwing it away by
    // guessing "refusal".
    expect(finishReasonOf('something_new')).toBe('stop');
    expect(finishReasonOf(null)).toBe('stop');
  });

  it('returns an empty completion rather than inventing one', async () => {
    const completion = await provider(respond(200, { content: [], stop_reason: 'end_turn' })).complete(CALL);
    expect(completion.text).toBe('');
  });

  it('treats a non-JSON body as the provider being unwell', async () => {
    const doFetch = vi.fn(async () => new Response('<html>502</html>', { status: 200 })) as unknown as typeof fetch;
    await expect(provider(doFetch).complete(CALL)).rejects.toBeInstanceOf(ProviderUnavailable);
  });
});

describe('which failures are worth retrying', () => {
  it('classifies the statuses that mean "ask again later"', () => {
    expect(isRetryable(429)).toBe(true);
    expect(isRetryable(529)).toBe(true);
    expect(isRetryable(500)).toBe(true);
    expect(isRetryable(408)).toBe(true);
    expect(isRetryable(400)).toBe(false);
    expect(isRetryable(401)).toBe(false);
    expect(isRetryable(404)).toBe(false);
  });

  it('raises a retryable failure as a dependency problem', async () => {
    await expect(provider(respond(429, { error: { type: 'rate_limit_error' } })).complete(CALL)).rejects.toBeInstanceOf(
      ProviderUnavailable,
    );
  });

  it('raises a bad key as a configuration problem, not a retry', async () => {
    // Retrying a 401 sixty times is how an account gets rate-limited for a
    // configuration mistake.
    const failure = await provider(respond(401, { error: { type: 'authentication_error' } }))
      .complete(CALL)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ProviderRefused);
    expect((failure as Error).message).toMatch(/credentials/);
    // The message an operator reads must not contain the key.
    expect((failure as Error).message).not.toContain(KEY);
  });

  it('does not repeat the provider’s prose, which may quote the request', async () => {
    const failure = await provider(
      respond(400, { error: { type: 'invalid_request_error', message: 'the prompt mentioned Jane Smith of Acme' } }),
    )
      .complete(CALL)
      .catch((error: unknown) => error);

    expect((failure as Error).message).not.toContain('Jane Smith');
  });

  it('treats a network failure as no answer rather than as a crash', async () => {
    const doFetch = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    await expect(provider(doFetch).complete(CALL)).rejects.toBeInstanceOf(ProviderUnavailable);
  });
});

describe('the SDK underneath', () => {
  it('makes one attempt and leaves retrying to the worker', async () => {
    // An SDK retry inside a worker retry multiplies every retry by three.
    const doFetch = respond(529, { error: { type: 'overloaded_error' } });
    await expect(provider(doFetch).complete(CALL)).rejects.toBeInstanceOf(ProviderUnavailable);
    expect(doFetch).toHaveBeenCalledTimes(1);
  });

  it('sends only the configured key, never a token it found in the environment', async () => {
    const previous = process.env.ANTHROPIC_AUTH_TOKEN;
    process.env.ANTHROPIC_AUTH_TOKEN = 'ambient-token';
    try {
      const doFetch = respond(200, { content: [{ type: 'text', text: 'x' }], stop_reason: 'end_turn' });
      await provider(doFetch).complete(CALL);
      const [, init] = (doFetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(new Headers(init.headers).get('authorization')).toBeNull();
      expect(new Headers(init.headers).get('x-api-key')).toBe(KEY);
    } finally {
      if (previous === undefined) delete process.env.ANTHROPIC_AUTH_TOKEN;
      else process.env.ANTHROPIC_AUTH_TOKEN = previous;
    }
  });

  it('still reads the body with a ceiling', async () => {
    const huge = 'x'.repeat(2_100_000);
    const doFetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ content: [{ type: 'text', text: huge }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    ) as unknown as typeof fetch;
    const failure = await provider(doFetch)
      .complete(CALL)
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ProviderUnavailable);
    expect((failure as Error).message).toMatch(/more than this platform will read/);
  });
});

const QUESTIONS: Record<string, DecisionQuestion> = {
  type: { kind: 'choice', ask: 'Which type?', options: ['incident', 'request'] },
  majorIncident: { kind: 'yesno', ask: 'Major?' },
  impact: { kind: 'score', ask: 'How many people?', min: 0, max: 100 },
};

function decideCall(model = 'claude-sonnet-5') {
  return {
    purpose: 'triage' as const,
    model,
    state: { title: 'VPN will not connect' },
    questions: QUESTIONS,
    signal: new AbortController().signal,
  };
}

describe('a decision', () => {
  it('asks for structured output shaped by the questions', async () => {
    const doFetch = respond(200, {
      id: 'msg_1',
      model: 'claude-sonnet-5',
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            type: { value: 'incident', confidence: 0.92 },
            majorIncident: { value: false, confidence: 0.8 },
            impact: { value: 3, confidence: 0.5 },
          }),
        },
      ],
      stop_reason: 'end_turn',
      usage: { input_tokens: 300, output_tokens: 40 },
    });

    const decision = await provider(doFetch).decide!(decideCall());

    const [, init] = (doFetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const body = JSON.parse(String(init.body));
    expect(body.output_config.format.type).toBe('json_schema');
    expect(body.output_config.format.schema.required).toEqual(['type', 'majorIncident', 'impact']);
    expect(body.output_config.effort).toBe('low');
    expect(JSON.parse(body.messages[0].content).record).toEqual({ title: 'VPN will not connect' });

    expect(decision.answers.type).toEqual({ value: 'incident', confidence: 0.92 });
    expect(decision.answers.majorIncident).toEqual({ value: false, confidence: 0.8 });
    expect(decision.inputTokens).toBe(300);
    expect(decision.providerRequestId).toBe('msg_1');
  });

  it('leaves effort out for a model that refuses it', () => {
    expect(takesEffort('claude-haiku-4-5-20251001')).toBe(false);
    expect(takesEffort('claude-opus-5')).toBe(true);
  });

  it('builds a schema a choice cannot escape', () => {
    const schema = decisionSchema(QUESTIONS) as {
      additionalProperties: boolean;
      properties: Record<string, { properties: { value: { anyOf: unknown[] } } }>;
    };
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.type!.properties.value.anyOf).toEqual([
      { type: 'string', enum: ['incident', 'request'] },
      { type: 'null' },
    ]);
    expect(schema.properties.majorIncident!.properties.value.anyOf[0]).toEqual({ type: 'boolean' });
  });

  it('turns an answer that is not the shape asked for into no answer', () => {
    expect(answersIn('not json', QUESTIONS)).toEqual({});
    expect(answersIn('[]', QUESTIONS)).toEqual({});
    const answers = answersIn(JSON.stringify({ type: { value: { nested: true }, confidence: 'high' } }), QUESTIONS);
    expect(answers.type!.value).toBeNull();
    expect(Number.isNaN(answers.type!.confidence)).toBe(true);
  });

  it('treats a refusal as a refusal, not as an answer', async () => {
    const doFetch = respond(200, { content: [], stop_reason: 'refusal', usage: { input_tokens: 10, output_tokens: 0 } });
    await expect(provider(doFetch).decide!(decideCall())).rejects.toBeInstanceOf(ProviderRefused);
  });

  it('refuses a model this deployment was not configured for, before sending anything', async () => {
    const doFetch = respond(200, {});
    await expect(provider(doFetch).decide!(decideCall('claude-invented-9'))).rejects.toBeInstanceOf(ProviderRefused);
    expect(doFetch).not.toHaveBeenCalled();
  });
});

describe('pricing, which a real provider made load-bearing', () => {
  it('prices the stub out of the box and nothing else', () => {
    expect(isPriced('stub-small')).toBe(true);
    // A real model's price is published by its vendor and changes without
    // asking this repository; a number hard-coded here would be a guess that
    // looks like a fact.
    expect(isPriced('claude-sonnet-5')).toBe(false);
  });

  it('takes an operator’s price list', () => {
    registerModelPrices({ 'claude-sonnet-5': { inputPerThousand: 240_000n, outputPerThousand: 1_200_000n } });
    expect(isPriced('claude-sonnet-5')).toBe(true);
    expect(priceFor('claude-sonnet-5')?.outputPerThousand).toBe(1_200_000n);
  });

  it('costs a call against the registered price, rounded up', () => {
    registerModelPrices({ 'm': { inputPerThousand: 1_000n, outputPerThousand: 10_000n } });
    // 1500 input tokens at 1000 per thousand is 1500 micro-pence; 100 output
    // at 10000 per thousand is 1000. Rounded up at each step.
    expect(costOf('m', 1500, 100)).toBe(2_500n);
    expect(costOf('m', 1, 0)).toBe(1n);
  });

  it('replaces a price rather than accumulating it', () => {
    registerModelPrices({ 'm': { inputPerThousand: 1n, outputPerThousand: 1n } });
    registerModelPrices({ 'm': { inputPerThousand: 9n, outputPerThousand: 9n } });
    expect(priceFor('m')?.inputPerThousand).toBe(9n);
  });

  it('reads a price list from JSON in the unit the budget works in', () => {
    const parsed = parseModelPrices('{"m":{"inputPerThousand":240000,"outputPerThousand":1200000}}');
    expect(parsed.m).toEqual({ inputPerThousand: 240_000n, outputPerThousand: 1_200_000n });
  });

  it('refuses a price list rather than half-loading one', () => {
    // A budget that half-works is worse than a process that will not start.
    expect(() => parseModelPrices('[]')).toThrow(/object keyed by model/);
    expect(() => parseModelPrices('{"m":{}}')).toThrow(/non-negative/);
    expect(() => parseModelPrices('{"m":{"inputPerThousand":-1,"outputPerThousand":1}}')).toThrow(/non-negative/);
    expect(() => parseModelPrices('{"m":{"inputPerThousand":"lots","outputPerThousand":1}}')).toThrow(/non-negative/);
  });

  it('costs an unpriced model at nothing, which is why the call is refused before it happens', () => {
    // Left as 0n deliberately: `isPriced` is the guard, and a `costOf` that
    // threw would turn a completed call into a lost one.
    expect(costOf('never-priced', 1000, 1000)).toBe(0n);
    expect(isPriced('never-priced')).toBe(false);
  });
});
