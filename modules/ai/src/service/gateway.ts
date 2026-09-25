import { DependencyUnavailableError, ForbiddenError, ValidationError, logger, metrics } from '@itsm/platform';
import { renderStrict } from '@itsm/module-workflow';
import { CircuitBreakers, CircuitOpenError } from '@itsm/module-integrations';
import { costOf, isPriced, pricedModels } from '../domain/budget.js';
import type { Capability } from '../domain/capabilities.js';
import { checkDecision, decisionDefinitionFor, decisionModelFor, timeoutFor, type DecisionPurpose } from '../domain/decisions.js';
import { activeDefaultModel, activeProvider, providerNamed } from '../providers/registry.js';
import type { AiProvider, Completion, Decision, DecisionQuestion } from '../providers/types.js';

/**
 * The only place in the platform that calls a model.
 *
 * Everything above it — permissions, kill switches, budgets, evidence,
 * suggestion lifecycle — is governance, and everything below it is a provider.
 * Keeping the call in one function is what makes "no module calls a provider"
 * (ADR-0006) checkable rather than aspirational: there is one call site, and
 * the module contract's egress rule already stops anybody making a second one
 * behind the gateway's back.
 */

/**
 * 503, not 500: the capability exists and the deployment has not been
 * configured for it, which is an operator's problem and not the caller's. A
 * client that retries later is doing the right thing, and an alert on 503 is
 * how somebody finds out the platform is refusing every suggestion.
 */
export class NoProviderConfigured extends DependencyUnavailableError {
  constructor() {
    super('the AI model provider');
    this.message =
      'no AI provider is configured for this deployment, so nothing can be generated. ' +
      'The provider is OD-04, and until it is decided every capability that calls a model is refused rather than answered.';
  }
}

export interface GatewayCall {
  capability: Capability;
  systemPrompt: string;
  template: string;
  context: Record<string, unknown>;
  model?: string;
  maxOutputTokens?: number;
  /**
   * Where this tenant permits its prompts to be processed.
   *
   * Required, and not optional with a permissive default, for the same reason
   * `isPriced` is checked before the call rather than after: a residency
   * control that a caller can forget to pass is a control that is missing
   * wherever somebody forgot. There is one call site, and the compiler makes
   * a second one answer this question too.
   */
  readonly allowedRegions: readonly string[];
}

export interface GatewayResult {
  completion: Completion;
  /** What was actually sent, kept on the job row for audit and evaluation. */
  promptText: string;
  costMicros: bigint;
  provider: string;
  /** How long the provider took, in milliseconds. */
  latencyMs: number;
}

/**
 * A model nobody has priced cannot be called.
 *
 * `costOf` returns nothing for an unpriced model, so before this check a
 * deployment that pointed a prompt at a model missing from its price list
 * spent money the budget recorded as zero — every warning line unreached,
 * every cap unenforced, and nothing anywhere saying so. Refused before the
 * call rather than discovered on an invoice.
 */
export class ModelNotPriced extends ValidationError {
  constructor(model: string) {
    super(
      `${model} has no price in this deployment, so a call against it could not be counted towards any budget. ` +
        `Priced models: ${pricedModels().join(', ') || 'none'}. Set AI_MODEL_PRICES.`,
    );
  }
}

/**
 * A tenant's prompts are not processed where it has not agreed.
 *
 * Refused rather than routed elsewhere. A fallback to a second provider would
 * be this platform deciding, on a customer's behalf, that somewhere else is
 * close enough — which is the whole of what a residency commitment is meant to
 * stop. 403 rather than 503: waiting will not change the answer, and an error
 * that looks transient invites a retry loop against a policy.
 */
export class ProviderOutsideResidency extends ForbiddenError {
  constructor(provider: string, region: string, allowed: readonly string[]) {
    super(
      'ai.suggest',
      `the configured AI provider (${provider}) processes in ${region}, and this tenant permits ` +
        `${allowed.join(', ')}. Nothing was sent. Change the tenant's AI regions, or configure a ` +
        `provider that processes within them.`,
    );
  }
}

/**
 * Whether a provider may be used for a tenant.
 *
 * Exported and pure so the decision is one expression with its own tests
 * rather than a condition buried in the call path. `null` is a provider that
 * makes no external call — the stub — and has no jurisdiction to be outside of.
 */
export function residencyPermits(processingRegion: string | null, allowed: readonly string[]): boolean {
  if (processingRegion === null) return true;
  return allowed.includes(processingRegion);
}

export async function callModel(call: GatewayCall): Promise<GatewayResult> {
  const provider = activeProvider();
  if (!provider) throw new NoProviderConfigured();

  // Before the model check and before the render, so that a tenant whose
  // policy forbids this provider never has its ticket text interpolated into
  // a prompt string at all. Nothing is built that is not allowed to be sent.
  if (!residencyPermits(provider.processingRegion, call.allowedRegions)) {
    metrics.increment('ai_calls_refused_total', { reason: 'residency', provider: provider.name });
    throw new ProviderOutsideResidency(provider.name, provider.processingRegion ?? 'unknown', call.allowedRegions);
  }

  // A registered provider always has a default. The last fallback only
  // satisfies the type, and the price check below would refuse it.
  const model = call.model ?? activeDefaultModel() ?? 'none';
  if (!isPriced(model)) throw new ModelNotPriced(model);
  // Strict: a prompt rendered with a hole in it is a prompt that asks the
  // model to fill the hole, and it will. The workflow engine learned this
  // first; the same renderer is used here rather than a second one.
  const promptText = renderStrict(call.template, call.context);
  const systemPrompt = renderStrict(call.systemPrompt, call.context);

  const started = Date.now();
  const completion = await provider.complete({
    capability: call.capability,
    systemPrompt,
    prompt: promptText,
    model,
    maxOutputTokens: call.maxOutputTokens ?? 1500,
  });

  const latencyMs = Date.now() - started;
  const costMicros = costOf(completion.model, completion.inputTokens, completion.outputTokens);
  metrics.increment('ai_calls_total', { capability: call.capability, provider: provider.name, model: completion.model });
  metrics.observe('ai_call_ms', latencyMs, { capability: call.capability, provider: provider.name });
  logger.info('AI call completed', {
    capability: call.capability,
    provider: provider.name,
    model: completion.model,
    inputTokens: completion.inputTokens,
    outputTokens: completion.outputTokens,
    finishReason: completion.finishReason,
    ms: latencyMs,
  });

  return { completion, promptText, costMicros, provider: provider.name, latencyMs };
}

// ---------------------------------------------------------------------------
// Decisions (ADR-0051)
// ---------------------------------------------------------------------------

/**
 * Why a link of a decision chain was not asked, or did not answer.
 *
 * Every one is recorded against the decision. A chain that fell through to
 * rules without saying why would look exactly like a chain that was never
 * configured.
 */
export type SkipReason = 'not-registered' | 'no-decide' | 'residency' | 'unpriced' | 'circuit-open' | 'budget';
export type FailReason = 'timeout' | 'unavailable' | 'refused' | 'invalid-answer';

export interface ChainAttempt {
  provider: string;
  outcome: 'answered' | 'skipped' | 'failed';
  reason: SkipReason | FailReason | null;
  model: string | null;
  ms: number;
  /** What this attempt was charged, when the provider said. */
  costMicros: string;
}

export interface DecideCall {
  purpose: DecisionPurpose;
  state: Readonly<Record<string, unknown>>;
  questions: Readonly<Record<string, DecisionQuestion>>;
  /** Required for the reason `GatewayCall.allowedRegions` is. */
  readonly allowedRegions: readonly string[];
  /**
   * False when the tenant's budget is spent. Every link is then skipped and
   * the ticket keeps what intake gave it; intake itself is never refused for
   * want of a decision.
   */
  budgetAvailable: boolean;
  /** Overrides the purpose's chain. Tests, and nothing else today. */
  chain?: readonly string[];
}

export interface DecideResult {
  /** The checked answers, or null when nobody answered and rules stand. */
  decision: Decision | null;
  /** Who answered, or `rules`. */
  provider: string;
  model: string | null;
  /** Every attempt the provider reported charging for, answered or not. */
  costMicros: bigint;
  inputTokens: number;
  outputTokens: number;
  /** Of the answering call; 0 when nobody answered. */
  latencyMs: number;
  attempts: ChainAttempt[];
  /** What was wrong with the answer that was used, question by question. */
  problems: string[];
}

/**
 * One breaker per provider for the whole deployment, not per tenant: a
 * provider that is down is down for everybody, and every tenant paying its
 * timeout on every ticket is the outage the breaker exists to stop.
 */
const decisionBreakers = new CircuitBreakers({ threshold: 5, cooldownMs: 30_000 });
const BREAKER_SCOPE = 'deployment';

/** Test helper: forget every open circuit, as a restart would. */
export function resetDecisionBreakers(): void {
  decisionBreakers.reset();
}

class DecisionTimedOut extends Error {}

/**
 * Whether a link may be asked, before anything is built for it. Pure apart
 * from the registry and the breaker, and exported so each refusal has a test.
 */
export function skipReasonFor(
  entry: { provider: AiProvider; defaultModel: string } | null,
  call: Pick<DecideCall, 'allowedRegions' | 'budgetAvailable'>,
  model: string | null = entry?.defaultModel ?? null,
): SkipReason | null {
  if (!entry) return 'not-registered';
  if (typeof entry.provider.decide !== 'function') return 'no-decide';
  if (!residencyPermits(entry.provider.processingRegion, call.allowedRegions)) return 'residency';
  if (!model || !isPriced(model)) return 'unpriced';
  if (!call.budgetAvailable) return 'budget';
  return null;
}

async function withTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      // Marked before the abort: a provider that rejects the moment it is
      // aborted would otherwise win the race with its own error, and a
      // timeout would be recorded as a refusal.
      timedOut = true;
      reject(new DecisionTimedOut());
      controller.abort();
    }, ms);
  });
  try {
    return await Promise.race([run(controller.signal), expired]);
  } catch (error) {
    if (timedOut) throw new DecisionTimedOut();
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Asks each link of the chain in turn until one answers (ADR-0051).
 *
 * The residency rule is ADR-0047's, applied per link: a provider outside the
 * tenant's regions is skipped, never used, and nothing is sent to it. What
 * ADR-0051 adds is that the next link — also inside the regions — may be asked
 * instead. When the chain runs out the answer is `rules`: nothing changes, and
 * nothing fails.
 *
 * One retry, and only for a provider that said "try later" quickly. A timeout
 * is not retried: the time it would take is exactly what the caller does not
 * have.
 */
export async function decide(call: DecideCall): Promise<DecideResult> {
  const definition = decisionDefinitionFor(call.purpose);
  const chain = call.chain ?? definition.chain;
  const attempts: ChainAttempt[] = [];
  let spent = 0n;
  let inputTokens = 0;
  let outputTokens = 0;

  for (const name of chain) {
    const entry = providerNamed(name);
    const candidate = entry ? decisionModelFor(definition, name, entry) : null;
    const skip = skipReasonFor(entry, call, candidate);
    if (skip) {
      attempts.push({ provider: name, outcome: 'skipped', reason: skip, model: candidate, ms: 0, costMicros: '0' });
      if (skip === 'residency') metrics.increment('ai_calls_refused_total', { reason: 'residency', provider: name });
      continue;
    }
    // `skipReasonFor` refuses a missing provider or model, so both are here.
    const provider = entry!.provider;
    const model = candidate!;

    try {
      decisionBreakers.assertClosed(BREAKER_SCOPE, name);
    } catch (error) {
      if (!(error instanceof CircuitOpenError)) throw error;
      attempts.push({ provider: name, outcome: 'skipped', reason: 'circuit-open', model, ms: 0, costMicros: '0' });
      continue;
    }

    const timeoutMs = timeoutFor(definition, name);
    const started = Date.now();
    let failure: FailReason | null = null;
    let answered: Decision | null = null;

    for (let attempt = 0; attempt < 2 && answered === null; attempt += 1) {
      try {
        answered = await withTimeout(timeoutMs, (signal) =>
          provider.decide!({ purpose: call.purpose, model, state: call.state, questions: call.questions, signal }),
        );
        failure = null;
      } catch (error) {
        if (error instanceof DecisionTimedOut) {
          failure = 'timeout';
          break;
        }
        if (error instanceof DependencyUnavailableError) {
          failure = 'unavailable';
          continue;
        }
        // Anything else is the provider refusing the request, which asking
        // again will not change.
        failure = 'refused';
        break;
      }
    }

    const ms = Date.now() - started;
    if (answered === null) {
      decisionBreakers.recordFailure(BREAKER_SCOPE, name);
      attempts.push({ provider: name, outcome: 'failed', reason: failure, model, ms, costMicros: '0' });
      metrics.increment('ai_decision_fallbacks_total', { purpose: call.purpose, provider: name, reason: failure ?? 'unknown' });
      logger.warn('a decision provider did not answer', { purpose: call.purpose, provider: name, reason: failure, ms });
      continue;
    }

    decisionBreakers.recordSuccess(BREAKER_SCOPE, name);
    const cost = costOf(answered.model, answered.inputTokens, answered.outputTokens);
    spent += cost;
    inputTokens += answered.inputTokens;
    outputTokens += answered.outputTokens;
    const checked = checkDecision(call.questions, answered);
    if (checked.empty) {
      // Answered, but with nothing usable. The provider is up, so the breaker
      // is not charged; the answer is still no answer — and still paid for.
      attempts.push({
        provider: name,
        outcome: 'failed',
        reason: 'invalid-answer',
        model: answered.model,
        ms,
        costMicros: String(cost),
      });
      metrics.increment('ai_decision_fallbacks_total', { purpose: call.purpose, provider: name, reason: 'invalid-answer' });
      continue;
    }

    attempts.push({ provider: name, outcome: 'answered', reason: null, model: answered.model, ms, costMicros: String(cost) });
    metrics.increment('ai_decisions_total', { purpose: call.purpose, provider: name, model: answered.model });
    metrics.observe('ai_decision_ms', ms, { purpose: call.purpose, provider: name });
    logger.info('AI decision completed', {
      purpose: call.purpose,
      provider: name,
      model: answered.model,
      inputTokens: answered.inputTokens,
      outputTokens: answered.outputTokens,
      problems: checked.problems.length,
      ms,
    });
    return {
      decision: { ...answered, answers: checked.answers },
      provider: name,
      model: answered.model,
      costMicros: spent,
      inputTokens,
      outputTokens,
      latencyMs: ms,
      attempts,
      problems: checked.problems,
    };
  }

  metrics.increment('ai_decisions_total', { purpose: call.purpose, provider: 'rules', model: 'none' });
  return {
    decision: null,
    provider: 'rules',
    model: null,
    costMicros: spent,
    inputTokens,
    outputTokens,
    latencyMs: 0,
    attempts,
    problems: [],
  };
}
