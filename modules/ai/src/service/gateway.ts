import { DependencyUnavailableError, ForbiddenError, ValidationError, logger, metrics } from '@itsm/platform';
import { renderStrict } from '@itsm/module-workflow';
import { DEFAULT_MODEL, costOf, isPriced, pricedModels } from '../domain/budget.js';
import type { Capability } from '../domain/capabilities.js';
import { activeProvider } from '../providers/registry.js';
import type { Completion } from '../providers/types.js';

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

  const model = call.model ?? DEFAULT_MODEL;
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

  const costMicros = costOf(completion.model, completion.inputTokens, completion.outputTokens);
  metrics.increment('ai_calls_total', { capability: call.capability, provider: provider.name, model: completion.model });
  logger.info('AI call completed', {
    capability: call.capability,
    provider: provider.name,
    model: completion.model,
    inputTokens: completion.inputTokens,
    outputTokens: completion.outputTokens,
    finishReason: completion.finishReason,
    ms: Date.now() - started,
  });

  return { completion, promptText, costMicros, provider: provider.name };
}
