import { createHash } from 'node:crypto';
import type { TenantContext } from './context.js';
import type { Tx } from './db.js';
import { newId } from './ids.js';
import { redact } from './telemetry.js';

/**
 * The audit writer (ADR-0014).
 *
 * Rows are inserted in the same transaction as the change that caused them, so
 * there is no window in which a change exists without its audit record. Each
 * row carries a hash of its content plus the previous row's hash for that
 * tenant, which makes a deletion or edit detectable even by someone with
 * database access.
 */

export interface AuditInput {
  action: string;
  targetType: string;
  targetId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
}

/**
 * Deliberately *not* `canonicalJson` from `./json.js`, though it does the same
 * job. This one sorts keys with `localeCompare` and the shared helper sorts by
 * code point, and the two disagree whenever a key starts with an upper-case
 * letter. Every hash in the chain was computed with this ordering, so adopting
 * the other would change the canonical string for those payloads, change their
 * hash, and make every historical row fail the nightly verifier — tamper
 * evidence reporting tampering that never happened.
 *
 * Changing it needs a hash version on the row and a verifier that knows both,
 * which is a change to tamper evidence and not a tidy-up. Left alone until then.
 */
function canonical(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
}

export function computeAuditHash(row: {
  id: string;
  tenantId: string;
  actorType: string;
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  before: unknown;
  after: unknown;
  occurredAt: Date;
  prevHash: string | null;
}): string {
  const material = canonical({
    id: row.id,
    tenantId: row.tenantId,
    actorType: row.actorType,
    actorId: row.actorId,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    before: row.before ?? null,
    after: row.after ?? null,
    occurredAt: row.occurredAt.toISOString(),
    prevHash: row.prevHash,
  });
  return createHash('sha256').update(material).digest('hex');
}

/**
 * Writes one audit row inside the caller's transaction.
 *
 * The chain is linearised with a per-tenant advisory lock held only for the
 * insert, which keeps the cost inside the < 5 ms budget while making concurrent
 * writers produce a single well-ordered chain.
 */
export async function recordAudit(tx: Tx, ctx: TenantContext, input: AuditInput): Promise<{ id: string; hash: string }> {
  const lockKey = BigInt.asIntN(64, BigInt(`0x${createHash('sha256').update(ctx.tenantId).digest('hex').slice(0, 15)}`));
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey}::bigint)`;

  const previous = await tx.$queryRaw<{ hash: string }[]>`
    SELECT hash FROM audit_event WHERE tenant_id = ${ctx.tenantId}::uuid ORDER BY seq DESC LIMIT 1
  `;
  const prevHash = previous[0]?.hash ?? null;

  const id = newId();
  const occurredAt = new Date();
  const before = input.before === undefined ? null : (redact(input.before) as object);
  const after = input.after === undefined ? null : (redact(input.after) as object);

  const hash = computeAuditHash({
    id,
    tenantId: ctx.tenantId,
    actorType: ctx.actor.type,
    actorId: ctx.actor.id,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId ?? null,
    before,
    after,
    occurredAt,
    prevHash,
  });

  await tx.auditEvent.create({
    data: {
      id,
      tenantId: ctx.tenantId,
      actorType: ctx.actor.type,
      actorId: ctx.actor.id,
      onBehalfOf: ctx.actor.onBehalfOf ?? ctx.impersonation?.byUserId ?? null,
      granteeTenantId: ctx.granteeTenantId ?? null,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      before: before as never,
      after: after as never,
      reason: input.reason ?? ctx.impersonation?.reason ?? null,
      correlationId: ctx.correlationId,
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
      occurredAt,
      hash,
      prevHash,
    },
  });

  return { id, hash };
}

export interface ChainVerification {
  tenantId: string;
  checked: number;
  valid: boolean;
  brokenAt?: { id: string; seq: string; reason: string };
}

/**
 * Walks a tenant's chain and reports the first break. Run nightly; a break
 * raises a security alert (MOD-15-E1-S1).
 */
export async function verifyAuditChain(tx: Tx, tenantId: string, limit = 100_000): Promise<ChainVerification> {
  const rows = await tx.$queryRaw<
    {
      id: string;
      seq: bigint;
      actor_type: string;
      actor_id: string | null;
      action: string;
      target_type: string;
      target_id: string | null;
      before: unknown;
      after: unknown;
      occurred_at: Date;
      hash: string;
      prev_hash: string | null;
    }[]
  >`SELECT id, seq, actor_type, actor_id, action, target_type, target_id, before, after, occurred_at, hash, prev_hash
    FROM audit_event WHERE tenant_id = ${tenantId}::uuid ORDER BY seq ASC LIMIT ${limit}`;

  let expectedPrev: string | null = null;
  for (const row of rows) {
    if (row.prev_hash !== expectedPrev) {
      return {
        tenantId,
        checked: rows.length,
        valid: false,
        brokenAt: { id: row.id, seq: String(row.seq), reason: 'previous hash does not match the preceding row' },
      };
    }
    const recomputed = computeAuditHash({
      id: row.id,
      tenantId,
      actorType: row.actor_type,
      actorId: row.actor_id,
      action: row.action,
      targetType: row.target_type,
      targetId: row.target_id,
      before: row.before ?? null,
      after: row.after ?? null,
      occurredAt: row.occurred_at,
      prevHash: row.prev_hash,
    });
    if (recomputed !== row.hash) {
      return {
        tenantId,
        checked: rows.length,
        valid: false,
        brokenAt: { id: row.id, seq: String(row.seq), reason: 'row content does not match its hash' },
      };
    }
    expectedPrev = row.hash;
  }

  return { tenantId, checked: rows.length, valid: true };
}
