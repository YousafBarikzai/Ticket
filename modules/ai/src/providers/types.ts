import type { Capability } from '../domain/capabilities.js';
import type { DecisionPurpose } from '../domain/decisions.js';

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
  /** The provider's own id for the call, so its support can find it. */
  providerRequestId?: string | null;
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
  /**
   * Answers typed questions about a state (ADR-0051). Optional: a provider
   * that only writes prose leaves it out, and the gateway skips it in a
   * decision chain rather than asking it to pretend.
   */
  decide?(request: DecisionRequest): Promise<Decision>;
}

/**
 * One question, in a shape every decision provider can answer.
 *
 * Three kinds and no more, because they are the three a decision engine and a
 * general model can both be held to: pick one of a closed list, give a number
 * in a range, say yes or no. Anything richer is prose, and prose is
 * `complete`.
 */
export type DecisionQuestion =
  | { readonly kind: 'choice'; readonly ask: string; readonly options: readonly string[] }
  | { readonly kind: 'score'; readonly ask: string; readonly min: number; readonly max: number }
  | { readonly kind: 'yesno'; readonly ask: string };

export interface DecisionRequest {
  purpose: DecisionPurpose;
  model: string;
  /**
   * What is being decided about. Already masked under the classification
   * registry: a provider is sent what the tenant's policy lets leave, never a
   * raw row.
   */
  state: Readonly<Record<string, unknown>>;
  questions: Readonly<Record<string, DecisionQuestion>>;
  /** Fires when the gateway has stopped waiting. A provider passes it on. */
  signal: AbortSignal;
}

export type DecisionValue = string | number | boolean;

export interface DecisionAnswer {
  /** Null when the provider declined this one question. */
  value: DecisionValue | null;
  /**
   * 0 to 1, as the provider claims it. A claim, not a fact: what a 0.9 is
   * worth is measured against what people set (ADR-0051), per provider.
   */
  confidence: number;
}

export interface Decision {
  answers: Record<string, DecisionAnswer>;
  /** What actually answered. */
  model: string;
  /** What the provider says it charged for. Never our own estimate. */
  inputTokens: number;
  outputTokens: number;
  /** The provider's own id for the call, so support can find it. */
  providerRequestId: string | null;
}
