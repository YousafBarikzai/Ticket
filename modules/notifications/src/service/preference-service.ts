import { z } from 'zod';
import { type TenantContext, ForbiddenError, authz, newId, recordAudit, transaction } from '@itsm/platform';

/**
 * MOD-11-E1 notification preferences.
 *
 * Preferences belong to the person, not to the administrator: anyone may set
 * their own without holding a permission beyond reading their own notifications.
 * Setting someone *else's* is an administrative act and checked as one, because
 * silencing another person's alerts is a way to hide activity from them.
 */

const timePattern = /^([01]?\d|2[0-3]):[0-5]\d$/;

export const preferenceSchema = z.object({
  channel: z.enum(['inapp', 'email', 'push', 'sms']),
  enabled: z.boolean().default(true),
  quietHours: z
    .object({ start: z.string().regex(timePattern), end: z.string().regex(timePattern) })
    .nullable()
    .optional(),
  digestMode: z.enum(['immediate', 'hourly', 'daily']).default('immediate'),
});
export type PreferenceInput = z.infer<typeof preferenceSchema>;

export async function listPreferences(ctx: TenantContext, userId?: string) {
  const target = userId ?? ctx.actor.id;
  if (!target) throw new ForbiddenError('notification.read', 'only a person has notification preferences');
  requireSelfOrAdmin(ctx, target);

  return transaction(ctx, (tx) => tx.notificationPreference.findMany({ where: { userId: target }, orderBy: { channel: 'asc' } }));
}

export async function setPreference(ctx: TenantContext, input: unknown, userId?: string) {
  const parsed = preferenceSchema.parse(input);
  const target = userId ?? ctx.actor.id;
  if (!target) throw new ForbiddenError('notification.read', 'only a person has notification preferences');
  requireSelfOrAdmin(ctx, target);

  return transaction(ctx, async (tx) => {
    const existing = await tx.notificationPreference.findFirst({ where: { userId: target, channel: parsed.channel } });

    const data = {
      enabled: parsed.enabled,
      quietHours: (parsed.quietHours ?? null) as never,
      digestMode: parsed.digestMode,
    };

    const saved = existing
      ? await tx.notificationPreference.update({ where: { id: existing.id }, data })
      : await tx.notificationPreference.create({
          data: { id: newId(), tenantId: ctx.tenantId, userId: target, channel: parsed.channel, ...data },
        });

    // Audited even when someone changes their own: "why did I stop getting
    // these?" is a support question, and turning off another person's alerts is
    // a way to hide activity from them.
    await recordAudit(tx, ctx, {
      action: 'notification.preference.changed',
      targetType: 'notification_preference',
      targetId: saved.id,
      before: existing
        ? { enabled: existing.enabled, digestMode: existing.digestMode, quietHours: existing.quietHours }
        : null,
      after: { channel: parsed.channel, enabled: parsed.enabled, digestMode: parsed.digestMode, quietHours: parsed.quietHours ?? null },
    });
    return saved;
  });
}

function requireSelfOrAdmin(ctx: TenantContext, targetUserId: string): void {
  if (ctx.actor.id === targetUserId) return;
  authz.require(ctx, 'identity.user.manage');
}
