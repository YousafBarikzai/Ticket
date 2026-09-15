import { z } from 'zod';
import {
  type TenantContext,
  type Tx,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  authz,
  newId,
  recordAudit,
  transaction,
} from '@itsm/platform';
import { isOnShift, validateShiftPattern, type ShiftPattern } from '../domain/rota.js';

/**
 * Who is at work.
 *
 * Two sources, deliberately kept apart. A *shift* is what the organisation
 * arranged: a pattern, in a time zone, that is true every week. *Availability*
 * is what the person says right now: at lunch, on holiday, gone. Neither
 * replaces the other — somebody rostered on can still be away, and somebody
 * off shift can still volunteer — so routing reads both and the two never
 * silently overwrite each other.
 */

export const AVAILABILITY_STATUSES = ['available', 'busy', 'away', 'off_shift', 'left'] as const;
export type AvailabilityStatus = (typeof AVAILABILITY_STATUSES)[number];

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

export const shiftPatternSchema = z.record(
  z.enum(WEEKDAYS),
  z.array(z.object({ from: z.string().regex(HHMM, 'HH:MM'), to: z.string().regex(HHMM, 'HH:MM') })).max(4),
);

export const setAvailabilitySchema = z.object({
  /** Omitted means yourself, which is the common case and the one anybody may do. */
  userId: z.string().uuid().optional(),
  status: z.enum(AVAILABILITY_STATUSES),
  reason: z.string().max(200).optional(),
  until: z.coerce.date().optional(),
  capacity: z.number().int().min(0).max(1000).nullable().optional(),
});
export type SetAvailabilityInput = z.input<typeof setAvailabilitySchema>;

export const createShiftSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9-]{1,62}$/, 'lower case, digits and hyphens'),
  name: z.string().min(1).max(120),
  teamId: z.string().uuid(),
  timeZone: z.string().min(1).max(64),
  pattern: shiftPatternSchema,
});

/**
 * Records what somebody is doing.
 *
 * Setting your own is `own` scope; setting somebody else's needs `any`, and is
 * how a manager marks a departure. The distinction matters: "has left" is the
 * status that takes somebody out of every queue, and it is not one a person
 * should be able to set for a colleague on a whim.
 */
export async function setAvailability(ctx: TenantContext, input: SetAvailabilityInput) {
  const parsed = setAvailabilitySchema.parse(input);
  const userId = parsed.userId ?? ctx.actor.id;
  if (!userId) throw new ValidationError('no user to set availability for');

  const forSomebodyElse = userId !== ctx.actor.id;
  authz.require(ctx, 'workload.availability.set');
  if (forSomebodyElse && !ctx.permissions.has('workload.availability.set', 'any')) {
    throw new ForbiddenError('you may only set your own availability');
  }
  if (parsed.until && parsed.until.getTime() < Date.now()) {
    // A return date in the past would leave somebody permanently away, because
    // nothing ever comes along to clear it.
    throw new ValidationError('the date they are back must be in the future');
  }

  return transaction(ctx, async (tx) => {
    const before = await tx.agentAvailability.findFirst({ where: { userId } });
    const data = {
      status: parsed.status,
      reason: parsed.reason ?? null,
      until: parsed.until ?? null,
      source: forSomebodyElse ? 'manager' : 'manual',
      updatedBy: ctx.actor.id,
      // Capacity is how much work somebody holds, not part of saying where they
      // are. Left out of the update unless it was named, so going to lunch does
      // not quietly reset a limit an administrator set months ago.
      ...(parsed.capacity !== undefined ? { capacity: parsed.capacity } : {}),
    };

    const row = await tx.agentAvailability.upsert({
      where: { tenantId_userId: { tenantId: ctx.tenantId, userId } },
      create: { id: newId(), tenantId: ctx.tenantId, userId, capacity: parsed.capacity ?? null, ...data },
      update: data,
    });

    await recordAudit(tx, ctx, {
      action: 'workload.availability.set',
      targetType: 'user',
      targetId: userId,
      before: before ? { status: before.status, until: before.until } : null,
      after: { status: parsed.status, until: parsed.until ?? null },
      ...(parsed.reason ? { reason: parsed.reason } : {}),
    });
    return row;
  });
}

/** What everybody is doing, for a team view. */
export async function listAvailability(ctx: TenantContext, userIds?: string[]) {
  authz.require(ctx, 'workload.read');
  return transaction(ctx, async (tx) =>
    tx.agentAvailability.findMany({
      ...(userIds ? { where: { userId: { in: userIds } } } : {}),
      orderBy: { updatedAt: 'desc' },
      take: 500,
    }),
  );
}

/**
 * The status to route on, which is not always the stored one.
 *
 * An "away until Tuesday" that has passed Tuesday is `available` again. Read
 * here rather than swept by a job, so the answer is right the moment the clock
 * passes it and does not depend on a worker having run.
 */
export function effectiveStatus(
  row: { status: string; until: Date | null } | undefined,
  at: Date = new Date(),
): AvailabilityStatus {
  if (!row) return 'available';
  const status = (AVAILABILITY_STATUSES as readonly string[]).includes(row.status)
    ? (row.status as AvailabilityStatus)
    : 'available';
  // Somebody who has left does not come back when a date passes.
  if (status === 'left') return 'left';
  if (row.until && row.until.getTime() <= at.getTime()) return 'available';
  return status;
}

export async function createShift(ctx: TenantContext, input: z.input<typeof createShiftSchema>) {
  authz.require(ctx, 'workload.manage');
  const parsed = createShiftSchema.parse(input);

  const problems = validateShiftPattern({ timeZone: parsed.timeZone, pattern: parsed.pattern as never });
  if (problems.length > 0) throw new ValidationError(`the shift pattern is not usable: ${problems.join('; ')}`);

  return transaction(ctx, async (tx) => {
    const id = newId();
    const shift = await tx.shift.create({
      data: {
        id,
        tenantId: ctx.tenantId,
        teamId: parsed.teamId,
        key: parsed.key,
        name: parsed.name,
        timeZone: parsed.timeZone,
        pattern: parsed.pattern as never,
        status: 'active',
      },
    });
    await recordAudit(tx, ctx, {
      action: 'workload.shift.created',
      targetType: 'shift',
      targetId: id,
      after: { key: parsed.key, teamId: parsed.teamId, timeZone: parsed.timeZone },
    });
    return shift;
  });
}

export async function listShifts(ctx: TenantContext, filter: { teamId?: string } = {}) {
  authz.require(ctx, 'workload.read');
  return transaction(ctx, async (tx) =>
    tx.shift.findMany({
      where: { status: 'active', ...(filter.teamId ? { teamId: filter.teamId } : {}) },
      include: { assignments: true },
      orderBy: { key: 'asc' },
      take: 200,
    }),
  );
}

export async function retireShift(ctx: TenantContext, key: string) {
  authz.require(ctx, 'workload.manage');
  return transaction(ctx, async (tx) => {
    const shift = await tx.shift.findFirst({ where: { key } });
    if (!shift) throw new NotFoundError('shift', key);
    const updated = await tx.shift.update({ where: { id: shift.id }, data: { status: 'retired' } });
    await recordAudit(tx, ctx, { action: 'workload.shift.retired', targetType: 'shift', targetId: shift.id, before: { status: shift.status } });
    return updated;
  });
}

export const assignToShiftSchema = z.object({
  userId: z.string().uuid(),
  startsOn: z.coerce.date(),
  endsOn: z.coerce.date().optional(),
});

export async function assignToShift(ctx: TenantContext, shiftKey: string, input: z.input<typeof assignToShiftSchema>) {
  authz.require(ctx, 'workload.manage');
  const parsed = assignToShiftSchema.parse(input);
  if (parsed.endsOn && parsed.endsOn.getTime() < parsed.startsOn.getTime()) {
    throw new ValidationError('a shift assignment cannot end before it starts');
  }

  return transaction(ctx, async (tx) => {
    const shift = await tx.shift.findFirst({ where: { key: shiftKey } });
    if (!shift) throw new NotFoundError('shift', shiftKey);

    const id = newId();
    const assignment = await tx.shiftAssignment.create({
      data: {
        id,
        tenantId: ctx.tenantId,
        shiftId: shift.id,
        userId: parsed.userId,
        startsOn: parsed.startsOn,
        endsOn: parsed.endsOn ?? null,
      },
    });
    await recordAudit(tx, ctx, {
      action: 'workload.shift.assigned',
      targetType: 'shift',
      targetId: shift.id,
      after: { userId: parsed.userId, startsOn: parsed.startsOn, endsOn: parsed.endsOn ?? null },
    });
    return assignment;
  });
}

export async function unassignFromShift(ctx: TenantContext, assignmentId: string) {
  authz.require(ctx, 'workload.manage');
  return transaction(ctx, async (tx) => {
    const assignment = await tx.shiftAssignment.findFirst({ where: { id: assignmentId } });
    if (!assignment) throw new NotFoundError('shift assignment', assignmentId);
    await tx.shiftAssignment.delete({ where: { id: assignmentId } });
    await recordAudit(tx, ctx, {
      action: 'workload.shift.unassigned',
      targetType: 'shift',
      targetId: assignment.shiftId,
      before: { userId: assignment.userId },
    });
  });
}

/**
 * Shift state for these people at this instant.
 *
 * Returns both who is *running* a shift and who is rostered on to one at all,
 * because the difference decides what "off shift" means. Somebody who is on no
 * shift is not off shift — they are simply not rostered, and a tenant that has
 * not described its shifts yet must not find that nothing routes to anybody.
 *
 * Takes a transaction rather than opening one, because routing asks this in the
 * middle of the decision it is already making and a second connection would be
 * reading a different instant.
 */
export async function shiftStateFor(
  tx: Tx,
  userIds: string[],
  at: Date = new Date(),
): Promise<{ running: Set<string>; rostered: Set<string> }> {
  const running = new Set<string>();
  const rostered = new Set<string>();
  if (userIds.length === 0) return { running, rostered };

  const assignments = await tx.shiftAssignment.findMany({
    where: {
      userId: { in: userIds },
      startsOn: { lte: at },
      OR: [{ endsOn: null }, { endsOn: { gte: at } }],
    },
    include: { shift: true },
  });

  for (const assignment of assignments) {
    if (assignment.shift.status !== 'active') continue;
    rostered.add(assignment.userId);
    const pattern: ShiftPattern = {
      timeZone: assignment.shift.timeZone,
      pattern: assignment.shift.pattern as never,
    };
    if (isOnShift(pattern, at)) running.add(assignment.userId);
  }
  return { running, rostered };
}

/** Whether somebody's shift constrains them right now. */
export function onShift(state: { running: Set<string>; rostered: Set<string> }, userId: string): boolean {
  return !state.rostered.has(userId) || state.running.has(userId);
}
