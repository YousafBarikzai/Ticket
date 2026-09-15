import { z } from 'zod';
import { events } from '@itsm/contracts';
import {
  type TenantContext,
  type Tx,
  NotFoundError,
  authz,
  getSetting,
  logger,
  metrics,
  newId,
  publish,
  recordAudit,
  transaction,
} from '@itsm/platform';
import { route, type Candidate, type RoutingDecision, type SkillRequirement, type Strategy } from '../domain/strategies.js';
import { effectiveStatus, onShift, shiftStateFor } from './availability-service.js';

/**
 * Picking somebody, and being able to say why.
 *
 * The decision itself is a pure function in `domain/strategies`; everything
 * here is gathering the facts it needs and recording what came of them. Kept
 * apart on purpose: the interesting failures are in the facts — a member list
 * that includes somebody who left, a load count that quietly excludes paused
 * tickets — and they are easier to see when the arithmetic is elsewhere.
 */

/** Open tickets count against an agent; resolved and closed ones do not. */
const COUNTED_CATEGORIES = ['open', 'paused'];

export const routingPolicySchema = z.object({
  strategy: z.enum(['round_robin', 'least_loaded', 'skill']),
  defaultCapacity: z.number().int().min(1).max(1000),
  requireSkill: z.boolean().default(false),
  allowOffShift: z.boolean().default(false),
});

export async function setRoutingPolicy(ctx: TenantContext, teamId: string, input: z.input<typeof routingPolicySchema>) {
  authz.require(ctx, 'workload.manage');
  const parsed = routingPolicySchema.parse(input);

  return transaction(ctx, async (tx) => {
    const before = await tx.routingPolicy.findFirst({ where: { teamId } });
    const policy = await tx.routingPolicy.upsert({
      where: { tenantId_teamId: { tenantId: ctx.tenantId, teamId } },
      create: { id: newId(), tenantId: ctx.tenantId, teamId, ...parsed },
      update: parsed,
    });
    await recordAudit(tx, ctx, {
      action: 'workload.policy.set',
      targetType: 'team',
      targetId: teamId,
      before: before ? { strategy: before.strategy, defaultCapacity: before.defaultCapacity } : null,
      after: { strategy: parsed.strategy, defaultCapacity: parsed.defaultCapacity },
    });
    return policy;
  });
}

export async function getRoutingPolicy(ctx: TenantContext, teamId: string) {
  authz.require(ctx, 'workload.read');
  return transaction(ctx, async (tx) => effectivePolicy(ctx, tx, teamId));
}

export interface EffectivePolicy {
  strategy: Strategy;
  defaultCapacity: number;
  requireSkill: boolean;
  allowOffShift: boolean;
  /** Where these came from, so a surprising decision is traceable. */
  source: 'team' | 'tenant';
}

/** The team's policy, or the tenant's settings where it has none. */
async function effectivePolicy(ctx: TenantContext, tx: Tx, teamId: string): Promise<EffectivePolicy> {
  const stored = await tx.routingPolicy.findFirst({ where: { teamId } });
  if (stored) {
    return {
      strategy: asStrategy(stored.strategy),
      defaultCapacity: stored.defaultCapacity,
      requireSkill: stored.requireSkill,
      allowOffShift: stored.allowOffShift,
      source: 'team',
    };
  }
  return {
    strategy: asStrategy(await getSetting<string>(ctx, 'workload.defaultStrategy')),
    defaultCapacity: await getSetting<number>(ctx, 'workload.defaultCapacity'),
    requireSkill: false,
    allowOffShift: false,
    source: 'tenant',
  };
}

function asStrategy(value: string): Strategy {
  return value === 'round_robin' || value === 'skill' ? value : 'least_loaded';
}

export interface ChooseInput {
  /** The team to route within. */
  teamId: string;
  /** Overrides the team's policy, for a rule that names a strategy. */
  strategy?: Strategy;
  /** What the work needs. Overrides the policy's category matching. */
  requiredSkills?: SkillRequirement[];
  /** The ticket being routed, used for skill matching and for the audit trail. */
  ticketId?: string;
  at?: Date;
}

export interface ChooseResult extends RoutingDecision {
  teamId: string;
  policy: EffectivePolicy;
}

/**
 * Chooses who should take the work.
 *
 * Runs on the caller's transaction so a rule that fires exactly once assigns
 * exactly once, and so the load it counts is the load inside that transaction
 * rather than whatever the number was a moment ago.
 */
export async function chooseAssignee(ctx: TenantContext, tx: Tx, input: ChooseInput): Promise<ChooseResult> {
  const at = input.at ?? new Date();
  const policy = await effectivePolicy(ctx, tx, input.teamId);
  const strategy = input.strategy ?? policy.strategy;

  const members = await tx.teamMembership.findMany({
    where: {
      teamId: input.teamId,
      validFrom: { lte: at },
      OR: [{ validTo: null }, { validTo: { gt: at } }],
    },
    select: { userId: true },
  });
  const userIds = [...new Set(members.map((member) => member.userId))];

  const requiredSkills = input.requiredSkills ?? (await skillsRequiredBy(tx, policy, input.ticketId));
  const candidates = await candidatesFor(tx, userIds, at);
  const decision = route(candidates, {
    strategy,
    allowOffShift: policy.allowOffShift,
    defaultCapacity: policy.defaultCapacity,
    ...(requiredSkills.length > 0 ? { requiredSkills } : {}),
  });

  metrics.increment('workload_routing_decisions_total', { strategy, outcome: decision.userId ? 'assigned' : 'declined' });
  return { ...decision, teamId: input.teamId, policy };
}

/**
 * The same decision, and the record of it.
 *
 * A refusal is published rather than logged and forgotten: a queue that stops
 * moving because everybody is on holiday looks exactly like a broken router,
 * and only one of those is worth waking somebody for.
 */
export async function chooseAndRecord(ctx: TenantContext, tx: Tx, input: ChooseInput & { ticketId: string }): Promise<ChooseResult> {
  const result = await chooseAssignee(ctx, tx, input);

  if (!result.userId) {
    await publish(tx, ctx, {
      definition: events.workloadAssignmentDeclined,
      aggregateId: input.ticketId,
      payload: {
        ticketId: input.ticketId,
        groupId: input.teamId,
        strategy: result.strategy,
        reason: result.reason,
        considered: result.eligible.length + result.rejected.length,
      },
    });
    logger.info('routing declined to assign', {
      ticketId: input.ticketId,
      teamId: input.teamId,
      strategy: result.strategy,
      reason: result.reason,
    });
    return result;
  }

  await markAssigned(tx, ctx, result.userId, new Date());
  return result;
}

/**
 * Stamps when somebody was last given work.
 *
 * This is what round robin reads. It is a projection, and a late one costs at
 * most a delayed turn — which is why it is a mark rather than the cursor it
 * would be so easy to make it.
 */
export async function markAssigned(tx: Tx, ctx: TenantContext, userId: string, at: Date): Promise<void> {
  const existing = await tx.agentRoutingMark.findFirst({ where: { userId } });
  if (!existing) {
    await tx.agentRoutingMark.create({
      data: { id: newId(), tenantId: ctx.tenantId, userId, lastAssignedAt: at, assignedCount: 1 },
    });
    return;
  }
  // An event that arrives late must not move somebody back up the queue: the
  // count still rises, the mark only ever moves forwards.
  const movesForward = at.getTime() > existing.lastAssignedAt.getTime();
  await tx.agentRoutingMark.update({
    where: { id: existing.id },
    data: { assignedCount: { increment: 1 }, ...(movesForward ? { lastAssignedAt: at } : {}) },
  });
}

/** Everything the strategies need to know about a team, in four queries. */
async function candidatesFor(tx: Tx, userIds: string[], at: Date): Promise<Candidate[]> {
  if (userIds.length === 0) return [];

  const [availability, shifts, skills, loads, marks] = await Promise.all([
    tx.agentAvailability.findMany({ where: { userId: { in: userIds } } }),
    shiftStateFor(tx, userIds, at),
    tx.agentSkill.findMany({ where: { userId: { in: userIds } }, include: { skill: true } }),
    tx.ticket.groupBy({
      by: ['assigneeId'],
      where: { assigneeId: { in: userIds }, statusCategory: { in: COUNTED_CATEGORIES }, deletedAt: null },
      _count: { _all: true },
    }),
    tx.agentRoutingMark.findMany({ where: { userId: { in: userIds } } }),
  ]);

  const availabilityBy = new Map(availability.map((row) => [row.userId, row]));
  const markBy = new Map(marks.map((row) => [row.userId, row]));
  const loadBy = new Map(loads.map((row) => [row.assigneeId as string, row._count._all]));
  const skillsBy = new Map<string, Record<string, number>>();
  for (const held of skills) {
    const forUser = skillsBy.get(held.userId) ?? {};
    // The highest level wins if the same skill is somehow recorded twice.
    forUser[held.skill.key] = Math.max(forUser[held.skill.key] ?? 0, held.level);
    skillsBy.set(held.userId, forUser);
  }

  return userIds.map((userId) => {
    const row = availabilityBy.get(userId);
    const status = effectiveStatus(row, at);
    return {
      userId,
      load: loadBy.get(userId) ?? 0,
      capacity: row?.capacity ?? null,
      availability: status,
      onShift: onShift(shifts, userId),
      skills: skillsBy.get(userId) ?? {},
      lastAssignedAt: markBy.get(userId)?.lastAssignedAt ?? null,
    };
  });
}

/**
 * What the ticket needs, by convention rather than by configuration.
 *
 * A skill whose key matches the ticket's category key is taken to be the skill
 * that category needs. The convention avoids a mapping table nobody would keep
 * up to date, and it degrades quietly: a category with no matching skill
 * requires nothing, rather than requiring something impossible.
 */
async function skillsRequiredBy(tx: Tx, policy: EffectivePolicy, ticketId?: string): Promise<SkillRequirement[]> {
  if (!policy.requireSkill || !ticketId) return [];

  const ticket = await tx.ticket.findFirst({ where: { id: ticketId }, select: { categoryId: true } });
  if (!ticket?.categoryId) return [];

  const category = await tx.category.findFirst({ where: { id: ticket.categoryId }, select: { key: true } });
  if (!category) return [];

  const skill = await tx.skill.findFirst({ where: { key: category.key }, select: { key: true } });
  return skill ? [{ key: skill.key }] : [];
}

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------

export const createSkillSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9-]{1,62}$/, 'lower case, digits and hyphens'),
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
});

export async function createSkill(ctx: TenantContext, input: z.input<typeof createSkillSchema>) {
  authz.require(ctx, 'workload.manage');
  const parsed = createSkillSchema.parse(input);
  return transaction(ctx, async (tx) => {
    const id = newId();
    const skill = await tx.skill.create({
      data: { id, tenantId: ctx.tenantId, key: parsed.key, name: parsed.name, description: parsed.description ?? null },
    });
    await recordAudit(tx, ctx, { action: 'workload.skill.created', targetType: 'skill', targetId: id, after: { key: parsed.key } });
    return skill;
  });
}

export async function listSkills(ctx: TenantContext) {
  authz.require(ctx, 'workload.read');
  return transaction(ctx, async (tx) => tx.skill.findMany({ orderBy: { key: 'asc' }, take: 500 }));
}

export const grantSkillSchema = z.object({
  userId: z.string().uuid(),
  /** 1 learning, 2 competent, 3 expert. */
  level: z.number().int().min(1).max(3).default(2),
});

export async function grantSkill(ctx: TenantContext, skillKey: string, input: z.input<typeof grantSkillSchema>) {
  authz.require(ctx, 'workload.manage');
  const parsed = grantSkillSchema.parse(input);

  return transaction(ctx, async (tx) => {
    const skill = await tx.skill.findFirst({ where: { key: skillKey } });
    if (!skill) throw new NotFoundError('skill', skillKey);

    const granted = await tx.agentSkill.upsert({
      where: { tenantId_userId_skillId: { tenantId: ctx.tenantId, userId: parsed.userId, skillId: skill.id } },
      create: { id: newId(), tenantId: ctx.tenantId, userId: parsed.userId, skillId: skill.id, level: parsed.level },
      update: { level: parsed.level },
    });
    await recordAudit(tx, ctx, {
      action: 'workload.skill.granted',
      targetType: 'user',
      targetId: parsed.userId,
      after: { skill: skillKey, level: parsed.level },
    });
    return granted;
  });
}

export async function revokeSkill(ctx: TenantContext, skillKey: string, userId: string) {
  authz.require(ctx, 'workload.manage');
  return transaction(ctx, async (tx) => {
    const skill = await tx.skill.findFirst({ where: { key: skillKey } });
    if (!skill) throw new NotFoundError('skill', skillKey);
    const existing = await tx.agentSkill.findFirst({ where: { userId, skillId: skill.id } });
    if (!existing) throw new NotFoundError('skill grant', `${skillKey}/${userId}`);

    await tx.agentSkill.delete({ where: { id: existing.id } });
    await recordAudit(tx, ctx, {
      action: 'workload.skill.revoked',
      targetType: 'user',
      targetId: userId,
      before: { skill: skillKey, level: existing.level },
    });
  });
}

/**
 * A rehearsal: who would take the next ticket for this team, and who would not.
 *
 * The rejection list is the point. "Nobody is available" is a complaint; "four
 * of six are away and two are at capacity" is something an administrator can do
 * something about this morning.
 */
export async function explainRouting(ctx: TenantContext, teamId: string, options: { strategy?: Strategy; ticketId?: string } = {}) {
  authz.require(ctx, 'workload.read');
  return transaction(ctx, async (tx) =>
    chooseAssignee(ctx, tx, {
      teamId,
      ...(options.strategy ? { strategy: options.strategy } : {}),
      ...(options.ticketId ? { ticketId: options.ticketId } : {}),
    }),
  );
}
