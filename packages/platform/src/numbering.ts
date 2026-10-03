import type { TenantContext } from './context.js';
import type { Tx } from './db.js';

/**
 * Human-readable numbers (ADR-0020).
 *
 * The counter is incremented inside the creating transaction, so a rolled-back
 * create leaves no gap and two concurrent creates cannot collide. Sequences
 * would be faster but are non-transactional and would leave holes, which
 * auditors and requesters both notice.
 */
export async function nextNumber(tx: Tx, ctx: TenantContext, type: string, prefix: string, width = 6): Promise<string> {
  // RETURNING sees the row as it now stands, so the number just allocated is
  // one less than the stored "next": 2 - 1 = 1 on the first insert, and
  // (previous + 1) - 1 = previous on every conflict update.
  const rows = await tx.$queryRaw<{ allocated: number }[]>`
    INSERT INTO ticket_counter (tenant_id, type, next)
    VALUES (${ctx.tenantId}::uuid, ${type}, 2)
    ON CONFLICT (tenant_id, type) DO UPDATE SET next = ticket_counter.next + 1
    RETURNING ticket_counter.next - 1 AS allocated
  `;

  const allocated = rows[0]?.allocated;
  if (allocated === undefined) throw new Error(`could not allocate a ${type} number`);
  return `${prefix}-${String(allocated).padStart(width, '0')}`;
}

/**
 * Raises a counter so the next number it allocates is at least `floor`, and
 * never lowers it. Returns the number `nextNumber` will allocate next.
 *
 * The shared demo's history starts mid-story: Northwind's incidents are in the
 * four thousands and its changes past eleven hundred (A4 §1.15), because a
 * service desk whose oldest ticket is `INC-000001` reads as a system switched
 * on yesterday. The importer floors each counter before its first row.
 *
 * `GREATEST` rather than a plain set, so a floor below the counter is a no-op:
 * running it after numbers were already allocated can never hand one out a
 * second time. `next` keeps `nextNumber`'s meaning — the number to allocate
 * next — so a floor of 4101 makes the next ticket `INC-004101`.
 */
export async function ensureCounterAtLeast(tx: Tx, ctx: TenantContext, type: string, floor: number): Promise<number> {
  if (!Number.isSafeInteger(floor) || floor < 1 || floor > 2_147_483_647) {
    throw new RangeError(`a counter floor must be a whole number from 1, not ${String(floor)}`);
  }
  const rows = await tx.$queryRaw<{ next: number }[]>`
    INSERT INTO ticket_counter (tenant_id, type, next)
    VALUES (${ctx.tenantId}::uuid, ${type}, ${floor}::int)
    ON CONFLICT (tenant_id, type) DO UPDATE SET next = GREATEST(ticket_counter.next, EXCLUDED.next)
    RETURNING ticket_counter.next AS next
  `;

  const next = rows[0]?.next;
  if (next === undefined) throw new Error(`could not floor the ${type} counter`);
  return Number(next);
}
