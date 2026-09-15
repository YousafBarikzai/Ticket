import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  availabilityService,
  onCallService,
  routingService,
  setAvailabilitySchema,
  createShiftSchema,
  assignToShiftSchema,
  createRotationSchema,
  updateRotationSchema,
  overrideSchema,
  createSkillSchema,
  grantSkillSchema,
  routingPolicySchema,
} from '@itsm/module-workload';
import { contextOf } from '../plugins/context.js';

/**
 * MOD-20 workload and routing.
 *
 * Two audiences again: a person saying they are at lunch, and an administrator
 * asking why the queue is not moving. `/routing/:teamId/explain` is for the
 * second, and it is the route that stops "routing is broken" being the only
 * available diagnosis.
 */
export async function workloadRoutes(app: FastifyInstance): Promise<void> {
  const byKey = z.object({ key: z.string().min(1).max(200) });
  const byId = z.object({ id: z.string().uuid() });
  const byTeam = z.object({ teamId: z.string().uuid() });

  // ---- availability -------------------------------------------------------
  app.get('/workload/availability', async (request) => {
    const ctx = contextOf(request);
    const query = z.object({ userIds: z.string().max(2000).optional() }).parse(request.query);
    const userIds = query.userIds?.split(',').filter(Boolean);
    const rows = await availabilityService.listAvailability(ctx, userIds);
    return {
      data: rows.map((row) => ({
        userId: row.userId,
        status: row.status,
        effectiveStatus: availabilityService.effectiveStatus(row),
        reason: row.reason,
        until: row.until?.toISOString() ?? null,
        capacity: row.capacity,
        source: row.source,
        updatedAt: row.updatedAt.toISOString(),
      })),
    };
  });

  app.put('/workload/availability', async (request) => {
    const ctx = contextOf(request);
    const row = await availabilityService.setAvailability(ctx, setAvailabilitySchema.parse(request.body));
    return { userId: row.userId, status: row.status, until: row.until?.toISOString() ?? null };
  });

  // ---- shifts -------------------------------------------------------------
  app.get('/workload/shifts', async (request) => {
    const ctx = contextOf(request);
    const query = z.object({ teamId: z.string().uuid().optional() }).parse(request.query);
    const shifts = await availabilityService.listShifts(ctx, query);
    return {
      data: shifts.map((shift) => ({
        key: shift.key,
        name: shift.name,
        teamId: shift.teamId,
        timeZone: shift.timeZone,
        pattern: shift.pattern,
        assignments: shift.assignments.map((assignment) => ({
          id: assignment.id,
          userId: assignment.userId,
          startsOn: assignment.startsOn.toISOString().slice(0, 10),
          endsOn: assignment.endsOn?.toISOString().slice(0, 10) ?? null,
        })),
      })),
    };
  });

  app.post('/workload/shifts', async (request, reply) => {
    const ctx = contextOf(request);
    const shift = await availabilityService.createShift(ctx, createShiftSchema.parse(request.body));
    return reply.code(201).send({ key: shift.key, name: shift.name, teamId: shift.teamId });
  });

  app.delete('/workload/shifts/:key', async (request, reply) => {
    const ctx = contextOf(request);
    await availabilityService.retireShift(ctx, byKey.parse(request.params).key);
    reply.status(204);
  });

  app.post('/workload/shifts/:key/assignments', async (request, reply) => {
    const ctx = contextOf(request);
    const assignment = await availabilityService.assignToShift(
      ctx,
      byKey.parse(request.params).key,
      assignToShiftSchema.parse(request.body),
    );
    return reply.code(201).send({ id: assignment.id, userId: assignment.userId });
  });

  app.delete('/workload/shift-assignments/:id', async (request, reply) => {
    const ctx = contextOf(request);
    await availabilityService.unassignFromShift(ctx, byId.parse(request.params).id);
    reply.status(204);
  });

  // ---- on call ------------------------------------------------------------
  app.get('/workload/rotations', async (request) => {
    const ctx = contextOf(request);
    const query = z.object({ teamId: z.string().uuid().optional() }).parse(request.query);
    const rotations = await onCallService.listRotations(ctx, query);
    return {
      data: rotations.map((rotation) => ({
        key: rotation.key,
        name: rotation.name,
        teamId: rotation.teamId,
        timeZone: rotation.timeZone,
        cadence: rotation.cadence,
        members: rotation.members,
        handoverAt: rotation.handoverAt,
      })),
    };
  });

  app.post('/workload/rotations', async (request, reply) => {
    const ctx = contextOf(request);
    const rotation = await onCallService.createRotation(ctx, createRotationSchema.parse(request.body));
    return reply.code(201).send({ key: rotation.key, name: rotation.name, members: rotation.members });
  });

  app.patch('/workload/rotations/:key', async (request) => {
    const ctx = contextOf(request);
    const rotation = await onCallService.updateRotation(
      ctx,
      byKey.parse(request.params).key,
      updateRotationSchema.parse(request.body),
    );
    return { key: rotation.key, members: rotation.members, handoverAt: rotation.handoverAt };
  });

  /** Who is on call, and when it changes hands next. */
  app.get('/workload/rotations/:key/on-call', async (request) => {
    const ctx = contextOf(request);
    const query = z.object({ at: z.coerce.date().optional() }).parse(request.query);
    return onCallService.whoIsOnCall(ctx, byKey.parse(request.params).key, query.at);
  });

  app.post('/workload/rotations/:key/overrides', async (request, reply) => {
    const ctx = contextOf(request);
    const override = await onCallService.addOverride(
      ctx,
      byKey.parse(request.params).key,
      overrideSchema.parse(request.body),
    );
    return reply.code(201).send({
      id: override.id,
      userId: override.userId,
      startsAt: override.startsAt.toISOString(),
      endsAt: override.endsAt.toISOString(),
    });
  });

  app.delete('/workload/overrides/:id', async (request, reply) => {
    const ctx = contextOf(request);
    await onCallService.removeOverride(ctx, byId.parse(request.params).id);
    reply.status(204);
  });

  // ---- skills -------------------------------------------------------------
  app.get('/workload/skills', async (request) => {
    const ctx = contextOf(request);
    const skills = await routingService.listSkills(ctx);
    return { data: skills.map((skill) => ({ key: skill.key, name: skill.name, description: skill.description })) };
  });

  app.post('/workload/skills', async (request, reply) => {
    const ctx = contextOf(request);
    const skill = await routingService.createSkill(ctx, createSkillSchema.parse(request.body));
    return reply.code(201).send({ key: skill.key, name: skill.name });
  });

  app.put('/workload/skills/:key/agents', async (request) => {
    const ctx = contextOf(request);
    const granted = await routingService.grantSkill(ctx, byKey.parse(request.params).key, grantSkillSchema.parse(request.body));
    return { userId: granted.userId, level: granted.level };
  });

  app.delete('/workload/skills/:key/agents/:userId', async (request, reply) => {
    const ctx = contextOf(request);
    const params = z.object({ key: z.string().min(1).max(200), userId: z.string().uuid() }).parse(request.params);
    await routingService.revokeSkill(ctx, params.key, params.userId);
    reply.status(204);
  });

  // ---- routing ------------------------------------------------------------
  app.get('/workload/routing/:teamId', async (request) => {
    const ctx = contextOf(request);
    return routingService.getRoutingPolicy(ctx, byTeam.parse(request.params).teamId);
  });

  app.put('/workload/routing/:teamId', async (request) => {
    const ctx = contextOf(request);
    const policy = await routingService.setRoutingPolicy(
      ctx,
      byTeam.parse(request.params).teamId,
      routingPolicySchema.parse(request.body),
    );
    return { teamId: policy.teamId, strategy: policy.strategy, defaultCapacity: policy.defaultCapacity };
  });

  /**
   * A rehearsal. Who would take the next ticket, who would not, and why —
   * without assigning anything, so an administrator can check a change to a
   * policy before a real ticket meets it.
   */
  app.get('/workload/routing/:teamId/explain', async (request) => {
    const ctx = contextOf(request);
    const query = z
      .object({ strategy: z.enum(['round_robin', 'least_loaded', 'skill']).optional(), ticketId: z.string().uuid().optional() })
      .parse(request.query);
    return routingService.explainRouting(ctx, byTeam.parse(request.params).teamId, query);
  });
}
