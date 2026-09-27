import { logger } from '@itsm/platform';
import type { AiProvider } from './types.js';

/**
 * The provider socket.
 *
 * Nothing is registered by default, and that is the point. OD-04 has not been
 * decided, so a deployment with no provider configured must refuse an AI
 * request loudly rather than answer it with something plausible. The stub is
 * registered only outside production — exactly the bargain the email module
 * struck with its development transport, and for the same reason: in
 * production the stub's presence would turn "no provider has been chosen yet"
 * from an error somebody fixes into answers somebody believes.
 */
let provider: AiProvider | null = null;
let defaultModel: string | null = null;

/**
 * Every provider this deployment can reach, by name (ADR-0051).
 *
 * Generation still has exactly one provider — `activeProvider` — and a tenant
 * outside its regions is refused rather than routed. Decisions walk a chain of
 * names and skip any that are missing here, which is how a deployment with a
 * decision engine and one without run the same chain.
 */
const named = new Map<string, { provider: AiProvider; defaultModel: string }>();

export interface ProviderRegistration {
  /**
   * The model a call gets when nothing names one. Must be one the provider
   * offers; left out, it is the first of them.
   */
  readonly defaultModel?: string;
}

/**
 * Which model a call gets when it does not name one.
 *
 * Belongs to the provider, not to the platform. It used to be a constant —
 * `stub-small` — which was right for exactly one provider: every other one
 * was handed a model it had never heard of, and refused every suggestion with
 * a message about a model nobody had configured. The provider's own list is
 * what it will accept, so the default comes from that list or from the
 * operator, and an operator's choice outside the list stops the boot rather
 * than the first suggestion of the day.
 */
export function chooseDefaultModel(implementation: Pick<AiProvider, 'name' | 'models'>, configured?: string): string {
  if (configured !== undefined && configured.length > 0) {
    if (!implementation.models.includes(configured)) {
      throw new Error(
        `AI_DEFAULT_MODEL is ${configured}, which the ${implementation.name} provider does not offer; ` +
          `it offers ${implementation.models.join(', ')}`,
      );
    }
    return configured;
  }
  const first = implementation.models[0];
  if (!first) throw new Error(`the ${implementation.name} provider offers no models, so nothing could be called`);
  return first;
}

/** Registers the provider that generates, which is also reachable by name. */
export function registerAiProvider(implementation: AiProvider, options: ProviderRegistration = {}): void {
  // Chosen before anything is replaced, so a registration that throws leaves
  // the previous provider in place rather than a provider with no default.
  const chosen = chooseDefaultModel(implementation, options.defaultModel);
  provider = implementation;
  defaultModel = chosen;
  named.set(implementation.name, { provider: implementation, defaultModel: chosen });
  logger.info('AI provider registered', {
    provider: implementation.name,
    models: implementation.models,
    defaultModel: chosen,
  });
}

/**
 * Registers a provider that is reachable by name only — a decision engine
 * that writes no prose. It never becomes the generation provider.
 */
export function addAiProvider(implementation: AiProvider, options: ProviderRegistration = {}): void {
  const chosen = chooseDefaultModel(implementation, options.defaultModel);
  named.set(implementation.name, { provider: implementation, defaultModel: chosen });
  logger.info('AI provider added', {
    provider: implementation.name,
    models: implementation.models,
    defaultModel: chosen,
    decides: typeof implementation.decide === 'function',
  });
}

export function activeProvider(): AiProvider | null {
  return provider;
}

/** The model a call gets when it names none. Null only when no provider is registered. */
export function activeDefaultModel(): string | null {
  return defaultModel;
}

export function providerNamed(name: string): { provider: AiProvider; defaultModel: string } | null {
  return named.get(name) ?? null;
}

export function registeredProviderNames(): string[] {
  return [...named.keys()];
}

/** Test helper, and the way a deployment switches every provider off entirely. */
export function clearAiProvider(): void {
  provider = null;
  defaultModel = null;
  named.clear();
}
