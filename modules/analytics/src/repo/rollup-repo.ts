import type { Tx } from '@itsm/platform';
import { newId } from '@itsm/platform';
import { emptyDelta, groupingKey, type RollupDelta, type RollupEntry } from '../domain/rollup.js';
import { ensureDate } from './dimension-repo.js';

/**
 * The daily rollup table.
 *
 * Maintained by adding and subtracting, which is what makes a projection cheap:
 * a ticket that resolves touches six small rows rather than provoking a scan of
 * everything raised that day. The cost is that an addition can be applied twice
 * or a subtraction lost, so the same table is also rebuilt from the facts —
 * see `rebuildDay`.
 */

export async function applyEntries(tx: Tx, tenantId: string, entries: RollupEntry[]): Promise<void> {
  for (const entry of entries) {
    const key = groupingKey(entry.grouping);
    await ensureDate(tx, entry.date);
    await tx.rollupTicketDaily.upsert({
      where: { tenantId_date_groupingKey: { tenantId, date: entry.date, groupingKey: key } },
      create: {
        id: newId(),
        tenantId,
        date: entry.date,
        groupingKey: key,
        teamId: entry.grouping.teamId,
        serviceId: entry.grouping.serviceId,
        priority: entry.grouping.priority,
        created: entry.delta.created,
        resolved: entry.delta.resolved,
        closed: entry.delta.closed,
        reopened: entry.delta.reopened,
        breached: entry.delta.breached,
        resolveMinutesSum: entry.delta.resolveMinutesSum,
        resolveMinutesCount: entry.delta.resolveMinutesCount,
        firstResponseMinutesSum: entry.delta.firstResponseMinutesSum,
        firstResponseMinutesCount: entry.delta.firstResponseMinutesCount,
      },
      update: {
        created: { increment: entry.delta.created },
        resolved: { increment: entry.delta.resolved },
        closed: { increment: entry.delta.closed },
        reopened: { increment: entry.delta.reopened },
        breached: { increment: entry.delta.breached },
        resolveMinutesSum: { increment: entry.delta.resolveMinutesSum },
        resolveMinutesCount: { increment: entry.delta.resolveMinutesCount },
        firstResponseMinutesSum: { increment: entry.delta.firstResponseMinutesSum },
        firstResponseMinutesCount: { increment: entry.delta.firstResponseMinutesCount },
      },
    });
  }
}

export interface RollupRow extends RollupDelta {
  date: Date;
  groupingKey: string;
  teamId: string | null;
  serviceId: string | null;
  priority: string | null;
}

export async function readDay(tx: Tx, date: Date): Promise<RollupRow[]> {
  const rows = await tx.rollupTicketDaily.findMany({ where: { date }, orderBy: { groupingKey: 'asc' } });
  return rows.map((row) => ({
    date: row.date,
    groupingKey: row.groupingKey,
    teamId: row.teamId,
    serviceId: row.serviceId,
    priority: row.priority,
    created: row.created,
    resolved: row.resolved,
    closed: row.closed,
    reopened: row.reopened,
    breached: row.breached,
    resolveMinutesSum: row.resolveMinutesSum,
    resolveMinutesCount: row.resolveMinutesCount,
    firstResponseMinutesSum: row.firstResponseMinutesSum,
    firstResponseMinutesCount: row.firstResponseMinutesCount,
  }));
}

/** Replaces a day's rows outright. Used by the rebuild, never by a projector. */
export async function replaceDay(
  tx: Tx,
  tenantId: string,
  date: Date,
  rows: { groupingKey: string; teamId: string | null; serviceId: string | null; priority: string | null; delta: RollupDelta }[],
): Promise<void> {
  await ensureDate(tx, date);
  await tx.rollupTicketDaily.deleteMany({ where: { date } });
  if (rows.length === 0) return;

  await tx.rollupTicketDaily.createMany({
    data: rows.map((row) => ({
      id: newId(),
      tenantId,
      date,
      groupingKey: row.groupingKey,
      teamId: row.teamId,
      serviceId: row.serviceId,
      priority: row.priority,
      ...row.delta,
    })),
  });
}

export function zeroDelta(): RollupDelta {
  return emptyDelta();
}
