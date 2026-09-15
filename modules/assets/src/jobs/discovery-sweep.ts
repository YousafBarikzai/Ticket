import { defineJob, logger, metrics, transaction, type TenantContext } from '@itsm/platform';
import { runSource } from '../service/discovery-service.js';

/**
 * Runs the sources that are due.
 *
 * Sequentially, deliberately. Four feeds pulled at once are four concurrent
 * calls to four third parties from one worker, and the failure they produce
 * together — rate limits, a breaker opening, a timeout that takes the job with
 * it — is harder to read than four runs that each say what happened. Discovery
 * is not urgent: nothing waits on it, and a run that starts a minute later than
 * it could is a cost nobody can measure.
 */

export async function dueSources(ctx: TenantContext, now: Date = new Date()): Promise<string[]> {
  return transaction(ctx, async (tx) => {
    const sources = await tx.discoverySource.findMany({
      where: { status: 'active', intervalMinutes: { not: null } },
      select: { key: true, intervalMinutes: true, lastRunAt: true },
    });
    return sources
      .filter((source) => {
        if (!source.lastRunAt) return true;
        const due = source.lastRunAt.getTime() + (source.intervalMinutes ?? 0) * 60_000;
        return due <= now.getTime();
      })
      .map((source) => source.key);
  });
}

defineJob<Record<string, never>>('imports', 'assets.discovery.sweep', async (_payload, { ctx }) => {
  const due = await dueSources(ctx);
  if (due.length === 0) return;

  for (const key of due) {
    try {
      const result = await runSource(ctx, key);
      logger.info('a discovery source ran', {
        tenantId: ctx.tenantId,
        source: key,
        seen: result.seen,
        proposed: result.proposed,
        rejected: result.rejected,
      });
    } catch (error) {
      // One source failing must not stop the others. A source is somebody
      // else's API, and somebody else's API being down is the normal case
      // rather than the exception.
      logger.warn('a discovery source could not be run', {
        tenantId: ctx.tenantId,
        source: key,
        error: error instanceof Error ? error.message : String(error),
      });
      metrics.increment('discovery_runs_total', { kind: 'unknown', outcome: 'error' });
    }
  }
});
