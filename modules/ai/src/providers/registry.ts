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

export function registerAiProvider(implementation: AiProvider): void {
  provider = implementation;
  logger.info('AI provider registered', { provider: implementation.name, models: implementation.models });
}

export function activeProvider(): AiProvider | null {
  return provider;
}

/** Test helper, and the way a deployment switches a provider off entirely. */
export function clearAiProvider(): void {
  provider = null;
}
