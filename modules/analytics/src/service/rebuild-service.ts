import { type TenantContext, logger, metrics, transaction } from '@itsm/platform';
import {
  addDelta,
  contributions,
  emptyDelta,
  groupingKey,
  groupingsFor,
  type Grouping,
  type RollupDelta,
  type TicketFactShape,
} from '../domain/rollup.js';
import * as facts from '../repo/fact-repo.js';
import * as rollups from '../repo/rollup-repo.js';
import { ensureDateRange } from '../repo/dimension-repo.js';

/**
 * Rebuilding the rollup from the facts.
 *
 * The rollup is maintained by adding and subtracting, and anything maintained
 * that way drifts: an event redelivered after a crash mid-transaction, a fact
 * corrected by hand, a deployment that lands between the two halves of a
 * change. None of those is common; all of them are silent, and a total that is
 * quietly 1 % light is worse than one that is obviously broken, because it gets
 * quoted in a board pack.
 *
 * So the rollup is treated as a cache of the facts rather than as a record in
 * its own right, and rebuilt on a schedule. Because every counter is derived
 * from the fact row (see `contributions`), the rebuild and the incremental path
 * compute the same thing — which is what makes the difference between them a
 * measurement of drift rather than of design.
 */

const BATCH = 500;

interface Bucket {
  grouping: Grouping;
  delta: RollupDelta;
}

/** Recomputes one day outright. Returns how many facts contributed to it. */
export async function rebuildDay(ctx: TenantContext, date: Date): Promise<number> {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

  return transaction(ctx, async (tx) => {
    const buckets = new Map<string, Bucket>();
    let cursor: string | undefined;
    let seen = 0;

    for (;;) {
      const page = await facts.ticketFactsForDay(tx, day, BATCH, cursor);
      if (page.length === 0) break;

      for (const row of page) {
        seen += 1;
        const shape: TicketFactShape = {
          teamId: row.teamId,
          serviceId: row.serviceId,
          priority: row.priority,
          createdDate: row.createdDate,
          firstResponseAt: row.firstResponseAt,
          resolvedAt: row.resolvedAt,
          closedAt: row.closedAt,
          timeToFirstResponseMinutes: row.timeToFirstResponseMinutes,
          timeToResolveMinutes: row.timeToResolveMinutes,
          reopenCount: row.reopenCount,
          breached: row.breached,
        };

        // A fact can contribute to several days — raised on Monday, resolved on
        // Thursday — so only the part belonging to this day is taken.
        const forThisDay = contributions(shape).find((entry) => entry.date.getTime() === day.getTime());
        if (!forThisDay) continue;

        for (const grouping of groupingsFor(shape)) {
          const key = groupingKey(grouping);
          const bucket = buckets.get(key) ?? { grouping, delta: emptyDelta() };
          bucket.delta = addDelta(bucket.delta, forThisDay.delta);
          buckets.set(key, bucket);
        }
      }

      cursor = page.at(-1)?.id;
      if (page.length < BATCH) break;
    }

    await rollups.replaceDay(
      tx,
      ctx.tenantId,
      day,
      [...buckets].map(([key, bucket]) => ({
        groupingKey: key,
        teamId: bucket.grouping.teamId,
        serviceId: bucket.grouping.serviceId,
        priority: bucket.grouping.priority,
        delta: bucket.delta,
      })),
    );

    metrics.increment('analytics_rollup_days_rebuilt_total', {});
    return seen;
  });
}

/**
 * Rebuilds a span of days, most recent first.
 *
 * Recent days first because they are the ones being looked at: if the job is
 * killed halfway through a long window, the part people are reading is the part
 * that got fixed.
 */
export async function rebuildRange(ctx: TenantContext, from: Date, to: Date): Promise<{ days: number; facts: number }> {
  await transaction(ctx, async (tx) => {
    await ensureDateRange(tx, from, to);
  });

  let days = 0;
  let total = 0;
  const cursor = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
  const first = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());

  while (cursor.getTime() >= first) {
    total += await rebuildDay(ctx, new Date(cursor));
    days += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  logger.info('rollup rebuilt', { tenantId: ctx.tenantId, days, facts: total });
  return { days, facts: total };
}

/** The default window: yesterday and today, which is where incremental drift collects. */
export async function rebuildRecent(ctx: TenantContext, days = 2, now: Date = new Date()): Promise<{ days: number; facts: number }> {
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - (days - 1));
  return rebuildRange(ctx, from, to);
}
