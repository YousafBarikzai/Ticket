import { afterEach, describe, expect, it, vi } from 'vitest';
import { logger } from '@itsm/platform';
import { ProviderRefused, ProviderUnavailable } from '../providers/anthropic.js';
import { fromJevAnswer, JEV_MODELS, jevProvider, toJevQuestion } from '../providers/jev.js';
import type { DecisionQuestion, DecisionRequest } from '../providers/types.js';

/**
 * The JEV adapter (ADR-0051, Phase 2).
 *
 * Shapes are from TypeSafe's API reference. What is worth proving is the
 * translation both ways, that the key and the ticket go nowhere but the
 * request, and which failures are worth trying again.
 */

const KEY = 'jev-not-a-real-key';
const TITLE = 'Payroll export fails for Jane Example';

const QUESTIONS: Record<string, DecisionQuestion> = {
  type: { kind: 'choice', ask: 'Type?', options: ['incident', 'request', 'question'] },
  majorIncident: { kind: 'yesno', ask: 'Major?' },
};

function respond(status: number, body: unknown, headers: Record<string, string> = {}): typeof fetch {
  return vi.fn(
    async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } }),
  ) as unknown as typeof fetch;
}

function request(overrides: Partial<DecisionRequest> = {}): DecisionRequest {
  return {
    purpose: 'triage',
    model: 'jev-latest',
    state: { title: TITLE, description: 'Since this morning.', sourceChannel: 'email' },
    questions: QUESTIONS,
    signal: new AbortController().signal,
    ...overrides,
  };
}

const OK = {
  model: 'jev-1.13.0',
  answers: {
    type: { type: 'choice', choice: 'incident', probabilities: { incident: 0.9, request: 0.08, question: 0.02 }, confidence: 0.85 },
    majorIncident: { type: 'noul', noul: 0.1 },
  },
  usage: { input_tokens: 310, output_tokens: 22 },
};

function mockCall(doFetch: typeof fetch) {
  return (doFetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
}

afterEach(() => vi.restoreAllMocks());

describe('the request it sends', () => {
  it('posts the state and typed questions to the System One endpoint', async () => {
    const doFetch = respond(200, OK);
    await jevProvider({ apiKey: KEY, fetchImpl: doFetch }).decide!(request());

    const [url, init] = mockCall(doFetch);
    expect(url).toBe('https://api.typesafe.ai/v1/systemone');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      state: { title: TITLE, description: 'Since this morning.', sourceChannel: 'email' },
      model: 'jev-latest',
      questions: {
        type: { type: 'choice', instructions: 'Type?', criteria: { incident: null, request: null, question: null } },
        majorIncident: { type: 'noul', instructions: 'Major?' },
      },
    });
  });

  it('sends the key as a bearer token and nowhere else', async () => {
    const doFetch = respond(200, OK);
    await jevProvider({ apiKey: KEY, fetchImpl: doFetch }).decide!(request());

    const [url, init] = mockCall(doFetch);
    expect(new Headers(init.headers).get('authorization')).toBe(`Bearer ${KEY}`);
    expect(String(url)).not.toContain(KEY);
    expect(String(init.body)).not.toContain(KEY);
  });

  it('refuses a model this deployment was not configured for, before any request', async () => {
    const doFetch = respond(200, OK);
    await expect(jevProvider({ apiKey: KEY, fetchImpl: doFetch }).decide!(request({ model: 'jev-invented' }))).rejects.toBeInstanceOf(
      ProviderRefused,
    );
    expect(doFetch).not.toHaveBeenCalled();
  });

  it('will not be built without a key, or with an empty region', () => {
    expect(() => jevProvider({ apiKey: '' })).toThrow(/API key/);
    expect(() => jevProvider({ apiKey: KEY, processingRegion: ' ' })).toThrow(/region/);
  });

  it('declares the region TypeSafe states, and names only the models it knows', () => {
    const provider = jevProvider({ apiKey: KEY });
    expect(provider.processingRegion).toBe('us');
    expect(provider.name).toBe('jev');
    expect([...JEV_MODELS]).toEqual(['jev-latest', 'jev-1.13.0']);
  });

  it('writes no prose', async () => {
    const provider = jevProvider({ apiKey: KEY, fetchImpl: respond(200, OK) });
    await expect(
      provider.complete({ capability: 'reply-draft', systemPrompt: '', prompt: '', model: 'jev-latest', maxOutputTokens: 1 }),
    ).rejects.toBeInstanceOf(ProviderRefused);
  });
});

describe('the answer it reads', () => {
  it('maps choices and nouls, and reports the version that answered', async () => {
    const decision = await jevProvider({ apiKey: KEY, fetchImpl: respond(200, OK, { 'x-request-id': 'req_42' }) }).decide!(request());

    expect(decision.answers.type).toEqual({ value: 'incident', confidence: 0.85 });
    // p = 0.1 is a confident no: |2p − 1| = 0.8.
    expect(decision.answers.majorIncident!.value).toBe(false);
    expect(decision.answers.majorIncident!.confidence).toBeCloseTo(0.8);
    expect(decision).toMatchObject({ model: 'jev-1.13.0', inputTokens: 310, outputTokens: 22, providerRequestId: 'req_42' });
  });

  it('leaves out an answer that is not the shape asked for, rather than throwing', async () => {
    const body = { ...OK, answers: { type: { type: 'score', score: 1 }, majorIncident: 'yes' } };
    const decision = await jevProvider({ apiKey: KEY, fetchImpl: respond(200, body) }).decide!(request());
    expect(decision.answers).toEqual({});
  });
});

describe('translating a question', () => {
  it('turns a whole range of up to ten steps into score levels, and leaves out anything else', () => {
    expect(toJevQuestion({ kind: 'score', ask: 'How bad?', min: 1, max: 4 })).toEqual({
      type: 'score',
      instructions: 'How bad?',
      criteria: ['1', '2', '3', '4'],
    });
    expect(toJevQuestion({ kind: 'score', ask: 'x', min: 0, max: 100 })).toBeNull();
    expect(toJevQuestion({ kind: 'score', ask: 'x', min: 0, max: 0.5 })).toBeNull();
    expect(toJevQuestion({ kind: 'choice', ask: 'x', options: Array.from({ length: 256 }, (_, i) => `o${i}`) })).toBeNull();
  });

  it('reads a score back onto the range it was asked on', () => {
    const question: DecisionQuestion = { kind: 'score', ask: 'x', min: 1, max: 4 };
    expect(fromJevAnswer(question, { type: 'score', score: 2.5, confidence: 0.7 })).toEqual({ value: 3.5, confidence: 0.7 });
  });

  it('gives a coin-toss noul no confidence', () => {
    expect(fromJevAnswer({ kind: 'yesno', ask: 'x' }, { type: 'noul', noul: 0.5 })).toEqual({ value: true, confidence: 0 });
  });
});

describe('when TypeSafe says no', () => {
  it.each([429, 529, 500, 503])('treats %i as try-later', async (status) => {
    await expect(jevProvider({ apiKey: KEY, fetchImpl: respond(status, {}) }).decide!(request())).rejects.toBeInstanceOf(
      ProviderUnavailable,
    );
  });

  it.each([401, 403, 422])('treats %i as a refusal that asking again will not change', async (status) => {
    await expect(jevProvider({ apiKey: KEY, fetchImpl: respond(status, {}) }).decide!(request())).rejects.toBeInstanceOf(
      ProviderRefused,
    );
  });

  it('never repeats the error body, which can echo the state', async () => {
    const doFetch = respond(422, { detail: `field state.title: ${TITLE}` });
    const error = (await jevProvider({ apiKey: KEY, fetchImpl: doFetch }).decide!(request()).catch((e: unknown) => e)) as Error;
    expect(error.message).not.toContain(TITLE);
  });

  it('calls a network failure unavailable', async () => {
    const doFetch = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    await expect(jevProvider({ apiKey: KEY, fetchImpl: doFetch }).decide!(request())).rejects.toBeInstanceOf(ProviderUnavailable);
  });

  it('calls a body that is not JSON unavailable', async () => {
    const doFetch = vi.fn(async () => new Response('<html>busy</html>', { status: 200 })) as unknown as typeof fetch;
    await expect(jevProvider({ apiKey: KEY, fetchImpl: doFetch }).decide!(request())).rejects.toBeInstanceOf(ProviderUnavailable);
  });
});

describe('what it logs', () => {
  it('logs neither the key nor the ticket, on success or failure', async () => {
    const lines: string[] = [];
    for (const level of ['debug', 'info', 'warn', 'error'] as const) {
      vi.spyOn(logger, level).mockImplementation(((message: string, fields?: unknown) => {
        lines.push(`${message} ${JSON.stringify(fields ?? {})}`);
      }) as never);
    }

    await jevProvider({ apiKey: KEY, fetchImpl: respond(200, OK) }).decide!(request());
    await jevProvider({ apiKey: KEY, fetchImpl: respond(401, { detail: TITLE }) }).decide!(request()).catch(() => undefined);

    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).not.toContain(KEY);
      expect(line).not.toContain(TITLE);
    }
  });
});
