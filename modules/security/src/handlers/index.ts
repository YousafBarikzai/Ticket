import { defineHandler, logger } from '@itsm/platform';

/**
 * MOD-15 watches for the signals that usually precede an incident: repeated
 * failed logins, and privilege grants that nobody expected.
 */

const FAILED_LOGIN_WINDOW_MS = 10 * 60_000;
const FAILED_LOGIN_THRESHOLD = 5;

defineHandler({
  consumer: 'security',
  moduleId: 'MOD-15',
  eventType: 'auth.login.failed',
  required: false,
  async handle(ctx, event, tx) {
    const payload = event.payload as { subject: string | null; ip: string | null };
    if (!payload.subject) return;

    const since = new Date(Date.now() - FAILED_LOGIN_WINDOW_MS);
    const recent = await tx.auditEvent.count({
      where: { action: 'auth.login.failed', occurredAt: { gte: since }, targetId: payload.subject },
    });
    if (recent < FAILED_LOGIN_THRESHOLD) return;

    const { newId } = await import('@itsm/platform');
    await tx.securityAlert.create({
      data: {
        id: newId(),
        tenantId: ctx.tenantId,
        type: 'auth.login.failed.burst',
        severity: 'medium',
        details: { subject: payload.subject, ip: payload.ip, attempts: recent, windowMinutes: 10 } as never,
      },
    });
    logger.warn('repeated failed logins', { subject: payload.subject, attempts: recent });
  },
});

defineHandler({
  consumer: 'security',
  moduleId: 'MOD-15',
  eventType: 'role.assignment.changed',
  required: false,
  async handle(ctx, event, tx) {
    const payload = event.payload as { userId: string; roleId: string; action: string };
    if (payload.action !== 'granted') return;

    const role = await tx.role.findFirst({ where: { id: payload.roleId } });
    // Administrator grants are the ones worth waking someone for.
    if (!role || role.key !== 'administrator') return;

    const { newId } = await import('@itsm/platform');
    await tx.securityAlert.create({
      data: {
        id: newId(),
        tenantId: ctx.tenantId,
        type: 'privilege.administrator.granted',
        severity: 'high',
        details: { userId: payload.userId, roleKey: role.key, grantedBy: ctx.actor.id } as never,
      },
    });
  },
});
