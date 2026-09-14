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
