import { cache, logger, tenantKey, type LimitVerdict } from '@itsm/platform';
import { METERS, type Meter } from '../domain/meters.js';

/**
 * Where the one word a request reads is kept.
 *
 * Its own file because both halves of this module need it and neither
 * should have to import the other: the usage service writes the verdict as
 * a figure moves, and the plan service drops it when the lines themselves
 * change. A plan upgrade that took a minute to take effect would be a
 * support call every time, so the upgrade clears the cache rather than
 * waiting for it to expire.
 */

export const VERDICT_TTL_SECONDS = 60;

export function verdictKey(tenantId: string, meter: Meter): string {
  return tenantKey(tenantId, 'limit', meter);
}

export async function readVerdict(tenantId: string, meter: Meter): Promise<LimitVerdict | null> {
  const hit = await cache().get(verdictKey(tenantId, meter));
  return hit ? (JSON.parse(hit) as LimitVerdict) : null;
}

export async function writeVerdict(tenantId: string, meter: Meter, verdict: LimitVerdict): Promise<void> {
  try {
    await cache().set(verdictKey(tenantId, meter), JSON.stringify(verdict), 'EX', VERDICT_TTL_SECONDS);
  } catch (error) {
    // Not fatal: the next reader misses and computes it.
    logger.debug('could not cache a limit verdict', { meter, error: (error as Error).message });
  }
}

/** Drops every cached verdict for a tenant, for when its lines move. */
export async function invalidateVerdicts(tenantId: string): Promise<void> {
  try {
    await cache().del(...METERS.map((meter) => verdictKey(tenantId, meter)));
  } catch (error) {
    logger.debug('could not clear cached limit verdicts', { tenantId, error: (error as Error).message });
  }
}
