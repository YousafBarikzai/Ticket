import { logger, metrics } from '@itsm/platform';
import { isRetryable, ProviderRefused, ProviderUnavailable, readBounded } from './anthropic.js';
import type { AiProvider, Completion, Decision, DecisionAnswer, DecisionQuestion, DecisionRequest } from './types.js';

/**
 * The JEV adapter: TypeSafe's System One decision engine (ADR-0051, Phase 2).
 *
 * Written against TypeSafe's published API reference (docs.typesafe.ai/api)
 * and its models page, read on 2026-09-28. What was checked, and where it
 * shows up here:
 *
 * - **Endpoint.** `POST https://api.typesafe.ai/v1/systemone`, one call for
 *   every question about one state.
 * - **Authentication.** A bearer token. It travels in the `Authorization`
 *   header and appears nowhere else — not in a log line, an error or a metric.
 * - **Shapes.** A `state`, a `model` and a map of named questions, each a
 *   `choice`, `score` or `noul`; answers come back under the same names.
 * - **Limits.** 64k tokens per request (32k for the state and the longest
 *   question), at most 255 options per choice and 10 levels per score, and a
 *   rate limit that answers 429. The triage description is already cut to
 *   4,000 characters, and `MAX_OPTIONS` (200) is under the choice limit.
 * - **Region.** TypeSafe's privacy policy says the service is hosted in the
 *   United States, and names no narrower region, so this adapter declares
 *   `us`: a tenant is sent to JEV only when its allowed regions say `us` in so
 *   many words. Transfers from the UK and EU are covered by the signed DPA
 *   (EU SCCs with the UK Addendum).
 *
 * **Nothing here is logged except shapes**, exactly as for Anthropic: the
 * state is ticket content, and a log line would be a second copy of it.
 *
 * **Plain `fetch`, not TypeSafe's SDK.** The API is one POST, and the SDK
 * would bring its own retries — the gateway already retries once, and a
 * worker retries the job — and its own reading of the body, where this one
 * is bounded.
 */

const DEFAULT_BASE_URL = 'https://api.typesafe.ai';
/**
 * A backstop only. The gateway gives JEV two seconds and aborts through the
 * request's signal; this is for a caller that forgets to.
 */
const DEFAULT_TIMEOUT_MS = 10_000;
/** TypeSafe's limits on one question (API reference). */
const MAX_CHOICE_OPTIONS = 255;
const MAX_SCORE_LEVELS = 10;

/**
 * The models this adapter will name. `jev-latest` is the product owner's
 * choice for triage: it moves when TypeSafe ships a release, and the version
 * that actually answered comes back on every response and is recorded on the
 * decision, so the shadow record can still be read per version.
 */
export const JEV_MODELS = ['jev-latest', 'jev-1.13.0'] as const;

export interface JevOptions {
  readonly apiKey: string;
  /** For tests and a future regional endpoint; never set by a tenant. */
  readonly baseUrl?: string;
  /**
   * Where the endpoint processes a request. `us`, from TypeSafe's privacy
   * policy. An operator pointing `baseUrl` at an endpoint in another
   * jurisdiction sets this to match; an empty value is refused, because a
   * decision provider with no region cannot be checked against a tenant's
   * policy (ADR-0051).
   */
  readonly processingRegion?: string;
  readonly timeoutMs?: number;
  readonly models?: readonly string[];
  /** Injectable so the tests need no network and no key. */
  readonly fetchImpl?: typeof fetch;
}

/** One question in TypeSafe's vocabulary. */
type JevQuestion =
  | { type: 'choice'; instructions: string; criteria: Record<string, null> }
  | { type: 'score'; instructions: string; criteria: string[] }
  | { type: 'noul'; instructions: string };

/**
 * A platform question as TypeSafe asks it, or null when TypeSafe cannot.
 *
 * A score is a set of ordered levels there, not a range, so only a whole
 * range of two to ten steps translates; anything else is left out and comes
 * back unanswered, which the gateway's check already handles.
 */
export function toJevQuestion(question: DecisionQuestion): JevQuestion | null {
  switch (question.kind) {
    case 'choice': {
      if (question.options.length === 0 || question.options.length > MAX_CHOICE_OPTIONS) return null;
      return { type: 'choice', instructions: question.ask, criteria: Object.fromEntries(question.options.map((option) => [option, null])) };
    }
    case 'score': {
      const levels = question.max - question.min + 1;
      if (!Number.isInteger(question.min) || !Number.isInteger(question.max) || levels < 2 || levels > MAX_SCORE_LEVELS) {
        return null;
      }
      return {
        type: 'score',
        instructions: question.ask,
        criteria: Array.from({ length: levels }, (_, index) => String(question.min + index)),
      };
    }
    case 'yesno':
      return { type: 'noul', instructions: question.ask };
  }
}

/**
 * TypeSafe's answer as the platform's.
 *
 * Confidence is TypeSafe's own for a choice and a score. A noul carries only
 * the probability of yes, so its confidence is worked out the way TypeSafe
 * works out a choice's — `(n · peak − 1) / (n − 1)` — which for two outcomes
 * is `|2p − 1|`: a coin toss is 0, a certain answer is 1. Anything not the
 * shape asked for is no answer, never an exception.
 */
export function fromJevAnswer(question: DecisionQuestion, raw: unknown): DecisionAnswer | null {
  if (!raw || typeof raw !== 'object') return null;
  const answer = raw as { type?: unknown; choice?: unknown; score?: unknown; noul?: unknown; confidence?: unknown };
  const confidence = typeof answer.confidence === 'number' ? answer.confidence : Number.NaN;
  switch (question.kind) {
    case 'choice':
      if (answer.type !== 'choice' || typeof answer.choice !== 'string') return null;
      return { value: answer.choice, confidence };
    case 'score':
      if (answer.type !== 'score' || typeof answer.score !== 'number') return null;
      return { value: question.min + answer.score, confidence };
    case 'yesno': {
      if (answer.type !== 'noul' || typeof answer.noul !== 'number' || !Number.isFinite(answer.noul)) return null;
      const p = answer.noul;
      return { value: p >= 0.5, confidence: Math.abs(2 * p - 1) };
    }
  }
}

interface JevResponse {
  model?: unknown;
  answers?: unknown;
  usage?: { input_tokens?: unknown; output_tokens?: unknown };
}

function tokens(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function jevProvider(options: JevOptions): AiProvider {
  if (!options.apiKey) throw new Error('jevProvider needs an API key');
  const processingRegion = options.processingRegion ?? 'us';
  if (processingRegion.trim().length === 0) {
    throw new Error('jevProvider needs a processing region, so a tenant’s residency policy can be checked against it');
  }
  const models = options.models ?? JEV_MODELS;
  const endpoint = `${(options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '')}/v1/systemone`;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const doFetch = options.fetchImpl ?? fetch;

  return {
    name: 'jev',
    models,
    processingRegion,

    /** JEV answers typed questions and writes no prose. It is never the generation provider. */
    async complete(): Promise<Completion> {
      throw new ProviderRefused('JEV answers typed questions only; it does not write text');
    },

    async decide(request: DecisionRequest): Promise<Decision> {
      if (!models.includes(request.model)) {
        throw new ProviderRefused(`this deployment is not configured for the model ${request.model}; it offers ${models.join(', ')}`);
      }

      const questions: Record<string, JevQuestion> = {};
      for (const [key, question] of Object.entries(request.questions)) {
        const translated = toJevQuestion(question);
        if (translated) questions[key] = translated;
      }
      if (Object.keys(questions).length === 0) {
        throw new ProviderRefused('none of these questions can be asked of JEV');
      }

      const started = Date.now();
      let response: Response;
      try {
        response = await doFetch(endpoint, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${options.apiKey}`,
            'content-type': 'application/json',
            accept: 'application/json',
          },
          body: JSON.stringify({ state: request.state, model: request.model, questions }),
          signal: AbortSignal.any([request.signal, AbortSignal.timeout(timeoutMs)]),
        });
      } catch (error) {
        metrics.increment('ai_provider_errors_total', { provider: 'jev', kind: 'unreachable' });
        const name = error instanceof Error ? error.name : 'unknown';
        throw new ProviderUnavailable(name === 'TimeoutError' || name === 'AbortError' ? name : 'the request did not complete');
      }

      if (!response.ok) {
        // The status only. TypeSafe's error body details the offending field,
        // and a field can be part of the state, so it is never read out.
        const status = response.status;
        await response.body?.cancel().catch(() => undefined);
        metrics.increment('ai_provider_errors_total', { provider: 'jev', kind: String(status) });
        logger.warn('the AI provider refused a call', { provider: 'jev', status, ms: Date.now() - started });
        if (isRetryable(status)) throw new ProviderUnavailable(`it answered ${status}`);
        throw new ProviderRefused(
          status === 401 || status === 403
            ? 'the AI provider rejected this deployment’s credentials; check JEV_API_KEY'
            : `the AI provider rejected the request (${status})`,
        );
      }

      let body: JevResponse;
      try {
        body = JSON.parse(await readBounded(response)) as JevResponse;
      } catch (error) {
        if (error instanceof ProviderUnavailable) throw error;
        throw new ProviderUnavailable('it answered with something that was not JSON');
      }
      if (!body || typeof body !== 'object') throw new ProviderUnavailable('it answered with something that was not JSON');

      const raw = body.answers && typeof body.answers === 'object' ? (body.answers as Record<string, unknown>) : {};
      const answers: Decision['answers'] = {};
      for (const [key, question] of Object.entries(request.questions)) {
        if (!(key in questions)) continue;
        const answer = fromJevAnswer(question, raw[key]);
        if (answer) answers[key] = answer;
      }

      return {
        answers,
        // The versioned id that answered (`jev-1.13.0`), not the alias asked for.
        model: typeof body.model === 'string' && body.model.length > 0 ? body.model : request.model,
        inputTokens: tokens(body.usage?.input_tokens),
        outputTokens: tokens(body.usage?.output_tokens),
        // TypeSafe's documented response carries no request id.
        providerRequestId: response.headers.get('x-request-id'),
      };
    },
  };
}
