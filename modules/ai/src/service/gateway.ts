import { DependencyUnavailableError, logger, metrics } from '@itsm/platform';
import { renderStrict } from '@itsm/module-workflow';
import { DEFAULT_MODEL, costOf } from '../domain/budget.js';
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
}

export interface GatewayResult {
  completion: Completion;
  /** What was actually sent, kept on the job row for audit and evaluation. */
  promptText: string;
  costMicros: bigint;
  provider: string;
}

export async function callModel(call: GatewayCall): Promise<GatewayResult> {
  const provider = activeProvider();
  if (!provider) throw new NoProviderConfigured();

  const model = call.model ?? DEFAULT_MODEL;
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
