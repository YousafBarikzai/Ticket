import {
  type TenantContext,
  authz,
  newId,
  publish,
  transaction,
  verifyAuditChain,
  logger,
} from '@itsm/platform';
import { events } from '@itsm/contracts';

/** MOD-15 audit search and chain verification. */

export interface AuditQuery {
  actorId?: string;
  action?: string;
  targetType?: string;
  targetId?: string;
  from?: Date;
  to?: Date;
  limit: number;
  cursor?: string;
}

export async function searchAuditEvents(ctx: TenantContext, query: AuditQuery) {
  authz.require(ctx, 'audit.read');
  return transaction(ctx, async (tx) => {
    const rows = await tx.auditEvent.findMany({
      where: {
        ...(query.actorId ? { actorId: query.actorId } : {}),
        ...(query.action ? { action: { startsWith: query.action } } : {}),
        ...(query.targetType ? { targetType: query.targetType } : {}),
        ...(query.targetId ? { targetId: query.targetId } : {}),
        ...(query.from || query.to
          ? { occurredAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } }
          : {}),
        ...(query.cursor ? { seq: { lt: BigInt(query.cursor) } } : {}),
      },
      orderBy: { seq: 'desc' },
      take: query.limit + 1,
    });

    const hasMore = rows.length > query.limit;
    const data = hasMore ? rows.slice(0, query.limit) : rows;
    return {
      data: data.map((row) => ({ ...row, seq: String(row.seq) })),
      nextCursor: hasMore ? String(data.at(-1)?.seq) : null,
    };
  });
}

/**
 * Verifies a tenant's hash chain and raises a security alert on a break. Runs
 * nightly: a tamper that the grants and the trigger somehow allowed still gets
 * noticed within a day (MOD-15-E1-S1).
 */
export async function verifyTenantChain(ctx: TenantContext): Promise<{ valid: boolean; checked: number }> {
  const result = await transaction(ctx, (tx) => verifyAuditChain(tx, ctx.tenantId));

  if (!result.valid) {
    logger.error('audit chain verification failed', { tenantId: ctx.tenantId, brokenAt: result.brokenAt });
    await transaction(ctx, async (tx) => {
      const alertId = newId();
      await tx.securityAlert.create({
        data: {
          id: alertId,
          tenantId: ctx.tenantId,
          type: 'audit.chain.broken',
          severity: 'critical',
          details: { brokenAt: result.brokenAt, checked: result.checked } as never,
        },
      });
      await publish(tx, ctx, {
        definition: events.securityAlertRaised,
        aggregateId: alertId,
        payload: {
          alertId,
          alertType: 'audit.chain.broken',
          severity: 'critical',
          details: { brokenAt: result.brokenAt ?? null, checked: result.checked },
        },
      });
    });
  }

  return { valid: result.valid, checked: result.checked };
}

export async function raiseAlert(
  ctx: TenantContext,
  input: { type: string; severity: 'low' | 'medium' | 'high' | 'critical'; details: Record<string, unknown> },
) {
  return transaction(ctx, async (tx) => {
    const alertId = newId();
    await tx.securityAlert.create({
      data: { id: alertId, tenantId: ctx.tenantId, type: input.type, severity: input.severity, details: input.details as never },
    });
    await publish(tx, ctx, {
      definition: events.securityAlertRaised,
      aggregateId: alertId,
      payload: { alertId, alertType: input.type, severity: input.severity, details: input.details },
    });
    return alertId;
  });
}

export async function listAlerts(ctx: TenantContext, limit = 50) {
  authz.require(ctx, 'security.alert.read');
  return transaction(ctx, (tx) =>
    tx.securityAlert.findMany({ where: { status: 'open' }, orderBy: { createdAt: 'desc' }, take: limit }),
  );
}
