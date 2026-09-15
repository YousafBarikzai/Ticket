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
  complete(request: CompletionRequest): Promise<Completion>;
}
