import { DependencyUnavailableError, ValidationError, logger, metrics } from '@itsm/platform';
import type { AiProvider, Completion, CompletionRequest } from './types.js';

/**
 * The Anthropic adapter (closes OD-04).
 *
 * Everything that makes this governable — permissions, kill switches, budgets,
 * evidence, the suggestion lifecycle, the refusals — was built against the stub
 * and does not change. This file is the twenty lines ADR-0040 said would be
 * left, plus the thing twenty lines of happy path always leaves out: what to do
 * when the provider says no.
 *
 * **Nothing here is logged except shapes.** Not the prompt, not the completion,
 * not the key. The prompt carries ticket content — somebody's name, their
 * machine, what they told the service desk — and a log line is a second copy of
 * it with a different retention policy and a different audience. Token counts,
 * the model, the stop reason and the duration are enough to operate this, and
 * they are what the caller already records on the job row.
 *
 * **This is why it does not go through the integration gateway** (ADR-0023),
 * which is otherwise the only way out of the platform. The gateway records
 * request and response bodies to `integration_log` after redacting credentials
 * — correct for a supplier's webhook, and exactly wrong for a prompt. The
 * gateway's other services are reproduced here at a smaller scale: a hard
 * timeout, a bounded read, and errors classified into retryable and not. The
 * destination is fixed by this file rather than configured by a tenant, which
 * is the same argument the Meilisearch backend and the OIDC discovery call
 * make.
 */

const API_VERSION = '2023-06-01';
const DEFAULT_BASE_URL = 'https://api.anthropic.com';
const DEFAULT_TIMEOUT_MS = 60_000;
/** A completion is text. A megabyte of it is a provider having a bad day. */
const MAX_RESPONSE_BYTES = 2_000_000;

export interface AnthropicOptions {
  readonly apiKey: string;
  /** Overridden for a proxy or a compatible endpoint; never by a tenant. */
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  /** The models this deployment is allowed to ask for. */
  readonly models?: readonly string[];
  /** Injectable so the tests need no network and no key. */
  readonly fetchImpl?: typeof fetch;
}

/**
 * The models this adapter is willing to name.
 *
 * A closed list, because `model` reaches here from a prompt version in the
 * database: a typo would otherwise be a 404 from the provider halfway through
 * a job, and a model nobody has priced would be a call the budget cannot see.
 * Pricing is separate and operator-supplied (`domain/budget.ts`), because
 * published prices change, are quoted in another currency, and are not this
 * repository's to assert.
 */
export const ANTHROPIC_MODELS = [
  'claude-opus-5',
  'claude-sonnet-5',
  'claude-haiku-4-5-20251001',
] as const;

interface MessagesResponse {
  model?: string;
  content?: { type?: string; text?: string }[];
  stop_reason?: string | null;
  usage?: { input_tokens?: number; output_tokens?: number };
}

/**
 * A provider that cannot be reached, or is overloaded, or rate-limited.
 *
 * `DependencyUnavailableError` is a 503 at the API edge and a retry in the
 * worker, which is the right answer for all three: the request was fine and the
 * provider was not.
 */
export class ProviderUnavailable extends DependencyUnavailableError {
  constructor(detail: string) {
    super('the AI model provider');
    this.message = `the model provider could not answer: ${detail}`;
  }
}

/**
 * A request the provider refused on its own terms — a bad key, a model this
 * account cannot use, a payload it will not accept.
 *
 * Not retryable, and deliberately a different class: retrying a 401 sixty times
 * is how an account gets rate-limited for a configuration mistake.
 */
export class ProviderRefused extends ValidationError {}

/** `stop_reason` in the provider's vocabulary, mapped to the platform's three. */
export function finishReasonOf(stopReason: string | null | undefined): Completion['finishReason'] {
  switch (stopReason) {
    case 'max_tokens':
      return 'length';
    case 'refusal':
      return 'refusal';
    case 'end_turn':
    case 'stop_sequence':
    case 'tool_use':
      return 'stop';
    default:
      // An unrecognised reason is treated as a clean stop rather than as a
      // failure: the text is there, and the caller parses it strictly anyway.
      // Guessing "refusal" would throw away a good answer.
      return 'stop';
  }
}

/** Concatenates the text blocks. Anything that is not text is not an answer. */
export function textOf(content: MessagesResponse['content']): string {
  if (!Array.isArray(content)) return '';
  return content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text as string)
    .join('');
}

/**
 * Which HTTP statuses mean "ask again later".
 *
 * 429 and 529 are the provider saying it is busy; 5xx is it being broken. 408
 * is a timeout it noticed before we did. Everything else is a request that will
 * fail identically however many times it is sent.
 */
export function isRetryable(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

export function anthropicProvider(options: AnthropicOptions): AiProvider {
  if (!options.apiKey) throw new Error('anthropicProvider needs an API key');
  const doFetch = options.fetchImpl ?? fetch;
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
  const models = options.models ?? ANTHROPIC_MODELS;

  return {
    name: 'anthropic',
    models,

    async complete(request: CompletionRequest): Promise<Completion> {
      if (!models.includes(request.model)) {
        throw new ProviderRefused(
          `this deployment is not configured for the model ${request.model}; it offers ${models.join(', ')}`,
        );
      }

      const started = Date.now();
      let response: Response;
      try {
        response = await doFetch(`${baseUrl}/v1/messages`, {
          method: 'POST',
          headers: {
            // The key travels in a header and appears nowhere else — not in a
            // log line, not in an error, not in a metric label.
            'x-api-key': options.apiKey,
            'anthropic-version': API_VERSION,
            'content-type': 'application/json',
            accept: 'application/json',
          },
          body: JSON.stringify({
            model: request.model,
            max_tokens: request.maxOutputTokens,
            system: request.systemPrompt,
            messages: [{ role: 'user', content: request.prompt }],
          }),
          signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
        });
      } catch (error) {
        // A timeout and a connection failure are the same thing to the caller:
        // no answer, try later.
        metrics.increment('ai_provider_errors_total', { provider: 'anthropic', kind: 'unreachable' });
        throw new ProviderUnavailable(error instanceof Error ? error.name : 'the request did not complete');
      }

      if (!response.ok) {
        // The body may name the account or echo part of the request, so it is
        // read for the shape of the failure and never repeated outwards.
        const detail = await failureDetail(response);
        metrics.increment('ai_provider_errors_total', { provider: 'anthropic', kind: String(response.status) });
        logger.warn('the AI provider refused a call', {
          provider: 'anthropic',
          status: response.status,
          type: detail,
          ms: Date.now() - started,
        });

        if (isRetryable(response.status)) throw new ProviderUnavailable(`it answered ${response.status}`);
        throw new ProviderRefused(
          response.status === 401 || response.status === 403
            ? 'the AI provider rejected this deployment’s credentials; check the configured key'
            : `the AI provider rejected the request (${response.status})`,
        );
      }

      const text = await readBounded(response);
      let body: MessagesResponse;
      try {
        body = JSON.parse(text) as MessagesResponse;
      } catch {
        throw new ProviderUnavailable('it answered with something that was not JSON');
      }

      const completion = textOf(body.content);
      if (completion.length === 0) {
        // An empty completion is not a failure of ours to report as a 500: the
        // provider answered, and it said nothing. Upstream treats a completion
        // it cannot parse as a failed job with a reason, which is the right
        // outcome and the right audit trail.
        logger.warn('the AI provider returned no text', { provider: 'anthropic', stopReason: body.stop_reason });
      }

      return {
        text: completion,
        // What actually answered, which may not be what was asked for: an alias
        // resolves to a dated snapshot, and the cost is charged against that.
        model: typeof body.model === 'string' && body.model.length > 0 ? body.model : request.model,
        inputTokens: Math.max(0, body.usage?.input_tokens ?? 0),
        outputTokens: Math.max(0, body.usage?.output_tokens ?? 0),
        finishReason: finishReasonOf(body.stop_reason),
      };
    },
  };
}

/** The error's `type`, if it has one. Never its message, which may quote the request. */
async function failureDetail(response: Response): Promise<string> {
  try {
    const parsed = JSON.parse(await response.text()) as { error?: { type?: string } };
    return typeof parsed.error?.type === 'string' ? parsed.error.type : 'unknown';
  } catch {
    return 'unreadable';
  }
}

/**
 * Reads the body with a ceiling.
 *
 * A provider that streams a runaway response would otherwise be answered with
 * as much memory as the worker has. The gateway does the same thing for the
 * same reason (ADR-0023).
 */
async function readBounded(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return response.text();

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new ProviderUnavailable('it answered with more than this platform will read');
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(concat(chunks, total));
}

function concat(chunks: readonly Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
