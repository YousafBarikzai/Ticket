import { LimitReachedError } from './errors.js';
import { logger } from './telemetry.js';
import type { TenantContext } from './context.js';

/**
 * Plan limits, as the rest of the platform sees them.
 *
 * A module that can grow a metered figure — MOD-04 raising a ticket, MOD-01
 * creating an agent — has to be able to refuse when the tenant is over its
 * plan. It must not have to depend on MOD-21 to do that: the dependency
 * would point from the domain at licensing, which is backwards, and would
 * make the ticket module untestable without the tenancy module.
 *
 * So the platform holds the socket and MOD-21 plugs into it at boot, the
 * way credentials (`registerSecretResolver`) and scopes
 * (`registerScopeResolver`) already work. With nothing registered — a unit
 * test, a deployment without licensing — every check passes, which is the
 * right default for a commercial control.
 */

export interface LimitVerdict {
  /** `ok` | `warned` | `blocked`. Only `blocked` refuses anything. */
  state: 'ok' | 'warned' | 'blocked';
  /** What to tell the person, when there is something to tell them. */
  message?: string;
}

export type LimitChecker = (ctx: TenantContext, meter: string) => Promise<LimitVerdict>;

let checker: LimitChecker | null = null;

export function registerLimitChecker(implementation: LimitChecker): void {
  checker = implementation;
}

/** For tests that need the socket empty again. */
export function clearLimitChecker(): void {
  checker = null;
}

/**
 * Refuses the act when the tenant is over a hard limit, and does nothing
 * otherwise.
 *
 * Fails open. A limit is a commercial control, not a security one: if the
 * cache holding the verdict is unreachable, letting work through and
 * correcting the figure later is right, and refusing every ticket in the
 * company because Redis restarted is not.
 */
export async function assertWithinLimit(ctx: TenantContext, meter: string): Promise<void> {
  if (!checker) return;
  let verdict: LimitVerdict;
  try {
    verdict = await checker(ctx, meter);
  } catch (error) {
    logger.warn('a plan limit could not be checked; allowing the request', { meter, error: (error as Error).message });
    return;
  }
  if (verdict.state === 'blocked') {
    throw new LimitReachedError(meter, verdict.message ?? `this plan's limit for ${meter} has been reached`);
  }
}
