import { z } from 'zod';
import { events } from '@itsm/contracts';
import {
  type TenantContext,
  NotFoundError,
  ValidationError,
  authz,
  newId,
  publish,
  recordAudit,
  transaction,
} from '@itsm/platform';
import { onCallAt, upcomingHandovers, type Override, type RotationDefinition } from '../domain/rota.js';

/**
 * Who answers out of hours.
 *
 * The rotation is a definition, not a schedule: a start, a cadence and an
 * order. Nothing is written when a handover happens, because nothing needs to
 * be — the answer is computed from the clock. What *is* written is a swap,
 * because a swap is the one thing the definition cannot predict.
 */

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export const createRotationSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9-]{1,62}$/, 'lower case, digits and hyphens'),
  name: z.string().min(1).max(120),
  teamId: z.string().uuid(),
  timeZone: z.string().min(1).max(64),
  cadence: z.enum(['daily', 'weekly']).default('weekly'),
  startsAt: z.coerce.date(),
  members: z.array(z.string().uuid()).min(1).max(100),
  handoverAt: z.string().regex(HHMM, 'HH:MM').default('09:00'),
});

export const overrideSchema = z.object({
  userId: z.string().uuid(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  reason: z.string().max(200).optional(),
});

export async function createRotation(ctx: TenantContext, input: z.input<typeof createRotationSchema>) {
  authz.require(ctx, 'workload.manage');
  const parsed = createRotationSchema.parse(input);

  if (new Set(parsed.members).size !== parsed.members.length) {
    // Twice in the list is twice as many turns, which is never what was meant
    // and is invisible once the rota is running.
    throw new ValidationError('the same person appears twice in the rotation');
  }
  // Validates the time zone by using it, rather than by keeping a list.
  assertUsable({ ...parsed, startsAt: parsed.startsAt });

  return transaction(ctx, async (tx) => {
    const id = newId();
    const rotation = await tx.onCallRotation.create({
      data: {
        id,
        tenantId: ctx.tenantId,
        teamId: parsed.teamId,
        key: parsed.key,
        name: parsed.name,
        timeZone: parsed.timeZone,
        cadence: parsed.cadence,
        startsAt: parsed.startsAt,
        members: parsed.members,
        handoverAt: parsed.handoverAt,
        status: 'active',
      },
    });
    await recordAudit(tx, ctx, {
      action: 'workload.rotation.created',
      targetType: 'oncall_rotation',
      targetId: id,
      after: { key: parsed.key, cadence: parsed.cadence, members: parsed.members, handoverAt: parsed.handoverAt },
    });
    return rotation;
  });
}

export const updateRotationSchema = createRotationSchema.partial().omit({ key: true });

/**
 * Edits a rotation.
 *
 * Reordering the member list reorders every future turn, which is why a swap
 * belongs in an override instead. The audit entry records both lists so the
 * question "when did my week move?" has an answer.
 */
export async function updateRotation(ctx: TenantContext, key: string, input: z.input<typeof updateRotationSchema>) {
  authz.require(ctx, 'workload.manage');
  const parsed = updateRotationSchema.parse(input);

  return transaction(ctx, async (tx) => {
    const rotation = await tx.onCallRotation.findFirst({ where: { key } });
    if (!rotation) throw new NotFoundError('on-call rotation', key);
    if (parsed.members && new Set(parsed.members).size !== parsed.members.length) {
      throw new ValidationError('the same person appears twice in the rotation');
    }

    const next = { ...definitionOf(rotation), ...parsed };
    assertUsable(next);

    const updated = await tx.onCallRotation.update({
      where: { id: rotation.id },
      data: {
        ...(parsed.name ? { name: parsed.name } : {}),
        ...(parsed.teamId ? { teamId: parsed.teamId } : {}),
        ...(parsed.timeZone ? { timeZone: parsed.timeZone } : {}),
        ...(parsed.cadence ? { cadence: parsed.cadence } : {}),
        ...(parsed.startsAt ? { startsAt: parsed.startsAt } : {}),
        ...(parsed.members ? { members: parsed.members } : {}),
        ...(parsed.handoverAt ? { handoverAt: parsed.handoverAt } : {}),
      },
    });
    await recordAudit(tx, ctx, {
      action: 'workload.rotation.updated',
      targetType: 'oncall_rotation',
      targetId: rotation.id,
      before: { members: rotation.members, handoverAt: rotation.handoverAt, cadence: rotation.cadence },
      after: { members: updated.members, handoverAt: updated.handoverAt, cadence: updated.cadence },
    });
    return updated;
  });
}

export async function listRotations(ctx: TenantContext, filter: { teamId?: string } = {}) {
  authz.require(ctx, 'workload.read');
  return transaction(ctx, async (tx) =>
    tx.onCallRotation.findMany({
      where: { status: 'active', ...(filter.teamId ? { teamId: filter.teamId } : {}) },
      orderBy: { key: 'asc' },
      take: 200,
    }),
  );
}

/**
 * Who is on call, now or at any instant, and what happens next.
 *
 * The upcoming handovers come back with the answer rather than from a second
 * call, because the question behind "who is on call?" is almost always "and
 * how long until it is somebody else?".
 */
export async function whoIsOnCall(ctx: TenantContext, key: string, at: Date = new Date()) {
  authz.require(ctx, 'workload.read');
  return transaction(ctx, async (tx) => {
    const rotation = await tx.onCallRotation.findFirst({ where: { key } });
    if (!rotation) throw new NotFoundError('on-call rotation', key);

    const overrides = await tx.onCallOverride.findMany({
      where: { rotationId: rotation.id, endsAt: { gte: at } },
      orderBy: { startsAt: 'asc' },
    });

    const definition = definitionOf(rotation);
    const active = overrides.map(toOverride);
    const current = onCallAt(definition, active, at);

    return {
      rotation: { key: rotation.key, name: rotation.name, teamId: rotation.teamId, timeZone: rotation.timeZone },
      at: at.toISOString(),
      ...current,
      // Each handover is resolved through the overrides too. A rota that shows
      // whose turn it *would* be, on a night somebody has agreed to cover, is
      // worse than no rota: it is the page that goes to the wrong person.
      upcoming: upcomingHandovers(definition, at, 4).map((handover) => {
        const resolved = onCallAt(definition, active, handover.at);
        return {
          at: handover.at.toISOString(),
          userId: resolved.userId ?? handover.userId,
          covered: resolved.via === 'override',
        };
      }),
      overrides: overrides.map((override) => ({
        id: override.id,
        userId: override.userId,
        startsAt: override.startsAt.toISOString(),
        endsAt: override.endsAt.toISOString(),
        reason: override.reason,
      })),
    };
  });
}

/** Records a swap. */
export async function addOverride(ctx: TenantContext, key: string, input: z.input<typeof overrideSchema>) {
  authz.require(ctx, 'workload.oncall.override');
  const parsed = overrideSchema.parse(input);
  if (parsed.endsAt.getTime() <= parsed.startsAt.getTime()) {
    throw new ValidationError('an override must end after it starts');
  }

  return transaction(ctx, async (tx) => {
    const rotation = await tx.onCallRotation.findFirst({ where: { key } });
    if (!rotation) throw new NotFoundError('on-call rotation', key);

    const clashing = await tx.onCallOverride.findFirst({
      where: { rotationId: rotation.id, startsAt: { lt: parsed.endsAt }, endsAt: { gt: parsed.startsAt } },
    });
    if (clashing) {
      // Two people covering the same night means the pager goes to whichever
      // row came back first. Refuse rather than pick.
      throw new ValidationError('another override already covers part of that period');
    }

    const id = newId();
    const override = await tx.onCallOverride.create({
      data: {
        id,
        tenantId: ctx.tenantId,
        rotationId: rotation.id,
        userId: parsed.userId,
        startsAt: parsed.startsAt,
        endsAt: parsed.endsAt,
        reason: parsed.reason ?? null,
        createdBy: ctx.actor.id,
      },
    });
    await recordAudit(tx, ctx, {
      action: 'workload.oncall.overridden',
      targetType: 'oncall_rotation',
      targetId: rotation.id,
      after: { userId: parsed.userId, startsAt: parsed.startsAt, endsAt: parsed.endsAt },
      ...(parsed.reason ? { reason: parsed.reason } : {}),
    });
    await publish(tx, ctx, {
      definition: events.workloadOnCallOverridden,
      aggregateId: rotation.id,
      payload: {
        rotationId: rotation.id,
        rotationKey: rotation.key,
        userId: parsed.userId,
        startsAt: parsed.startsAt.toISOString(),
        endsAt: parsed.endsAt.toISOString(),
      },
    });
    return override;
  });
}

export async function removeOverride(ctx: TenantContext, overrideId: string) {
  authz.require(ctx, 'workload.oncall.override');
  return transaction(ctx, async (tx) => {
    const override = await tx.onCallOverride.findFirst({ where: { id: overrideId } });
    if (!override) throw new NotFoundError('on-call override', overrideId);
    await tx.onCallOverride.delete({ where: { id: overrideId } });
    await recordAudit(tx, ctx, {
      action: 'workload.oncall.override.removed',
      targetType: 'oncall_rotation',
      targetId: override.rotationId,
      before: { userId: override.userId, startsAt: override.startsAt, endsAt: override.endsAt },
    });
  });
}

interface RotationRow {
  timeZone: string;
  cadence: string;
  startsAt: Date;
  members: string[];
  handoverAt: string;
}

function definitionOf(rotation: RotationRow): RotationDefinition {
  return {
    timeZone: rotation.timeZone,
    cadence: rotation.cadence === 'daily' ? 'daily' : 'weekly',
    startsAt: rotation.startsAt,
    members: rotation.members,
    handoverAt: rotation.handoverAt,
  };
}

function toOverride(row: { userId: string; startsAt: Date; endsAt: Date }): Override {
  return { userId: row.userId, startsAt: row.startsAt, endsAt: row.endsAt };
}

/**
 * Proves the definition can answer a question before it is stored.
 *
 * An unknown time zone or an unreadable handover time is a failure at write
 * time here, rather than at 2am when something asks who to wake up.
 */
function assertUsable(definition: RotationDefinition): void {
  try {
    upcomingHandovers(definition, new Date(), 1);
  } catch (error) {
    throw new ValidationError(`this rotation could not be read: ${(error as Error).message}`);
  }
}
