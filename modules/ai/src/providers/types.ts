import type { Capability } from '../domain/capabilities.js';

/**
 * The one interface every model provider is reached through (ADR-0006).
 *
 * Deliberately narrow. A provider completes a prompt and reports what it
 * charged for; it does not know about tenants, budgets, evidence, prompts or
 * suggestions, because everything that makes those governable lives above it
 * and must not be re-implemented per adapter.
 */
export interface CompletionRequest {
  capability: Capability;
  /** What the model is told it is. */
  systemPrompt: string;
  /** The rendered task. */
  prompt: string;
  model: string;
  maxOutputTokens: number;
}

export interface Completion {
  text: string;
  /** What actually answered, which may not be what was asked for. */
  model: string;
  /** What the provider says it charged for. Never our own estimate. */
  inputTokens: number;
  outputTokens: number;
  /** stop | length | refusal — a refusal is an answer, not an error. */
  finishReason: 'stop' | 'length' | 'refusal';
}

export interface AiProvider {
  readonly name: string;
  readonly models: readonly string[];
  /**
   * Where this provider processes a prompt, as a data region — or `null` when
   * it processes in this very process and nothing leaves the deployment.
   *
   * Residency is a question about data leaving, so a provider that makes no
   * external call has no residency answer to give, and `null` says exactly
   * that rather than inventing a region for it. The stub is the only such
   * provider today.
   *
   * For everything else it is declared rather than inferred, and configured
   * rather than hard-coded: the same vendor is reachable at endpoints in
   * different jurisdictions, and only the operator who set the endpoint knows
   * which one they chose. Guessing from a hostname would be a control that is
   * wrong quietly. A provider that declares the wrong region defeats the check
   * — which is why this is the operator's statement about their own deployment,
   * and why `null` has to be written deliberately rather than being the
   * default for a missing field.
   */
  readonly processingRegion: string | null;
  complete(request: CompletionRequest): Promise<Completion>;
}
