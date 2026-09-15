import { z } from 'zod';
import {
  type TenantContext,
  type Tx,
  ConflictError,
  NotFoundError,
  ValidationError,
  authz,
  newId,
  recordAudit,
  transaction,
} from '@itsm/platform';
import { exprSchema } from '@itsm/expr';
import { validateCalendar } from '@itsm/business-time';

/**
 * MOD-07-E1 policy administration.
 *
 * Targets, calendars, the priority matrix and escalation rules are what a
 * service owner actually changes; the timer engine underneath them does not
 * change at all. Keeping the two apart is what lets an SLA be retuned on a
 * Tuesday afternoon without a deployment (docs/architecture/12 §1).
 */

export const targetSchema = z.object({
  priority: z.enum(['P1', 'P2', 'P3', 'P4']),
  targetType: z.enum(['response', 'update', 'restoration', 'resolution', 'fulfilment', 'approval']),
  minutes: z.number().int().min(1).max(525_600),
  warningThresholds: z.array(z.number().int().min(1).max(99)).max(5).default([50, 75, 90]),
});

export const escalationSchema = z.object({
  /** 'breach', or 'warning:<threshold>' matching one of the target's thresholds. */
  on: z.string().regex(/^(breach|warning:\d{1,2})$/),
  step: z.number().int().min(1).max(10).default(1),
  notify: z
    .object({
      to: z.enum(['requester', 'assignee', 'group', 'watchers']),
      template: z.string().min(1),
    })
    .optional(),
  action: z
    .object({
      reassignGroup: z.string().uuid().optional(),
      raisePriorityTo: z.enum(['P1', 'P2', 'P3', 'P4']).optional(),
      addTag: z.string().min(1).max(40).optional(),
    })
    .optional(),
});

export const policySchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9-]{1,62}$/),
  name: z.string().min(1).max(120),
  match: exprSchema.default({ always: true }),
  specificity: z.number().int().min(0).max(1000).default(0),
  calendarMode: z.enum(['group', 'requester', 'fixed']).default('group'),
  calendarId: z.string().uuid().nullable().optional(),
  targets: z.array(targetSchema).min(1).max(24),
  escalations: z.array(escalationSchema).max(20).default([]),
  orgId: z.string().uuid().nullable().optional(),
});

export async function listPolicies(ctx: TenantContext) {
  authz.require(ctx, 'sla.policy.read');
  return transaction(ctx, async (tx) => {
    const policies = await tx.slaPolicy.findMany({ orderBy: { specificity: 'desc' } });
    const targets = await tx.slaTarget.findMany({ where: { policyId: { in: policies.map((p) => p.id) } } });
    const escalations = await tx.escalationRule.findMany({ where: { policyId: { in: policies.map((p) => p.id) } } });
    return policies.map((policy) => ({
      ...policy,
      targets: targets.filter((target) => target.policyId === policy.id),
      escalations: escalations.filter((rule) => rule.policyId === policy.id),
    }));
  });
}

export async function createPolicy(ctx: TenantContext, input: unknown) {
  authz.require(ctx, 'sla.policy.manage');
  const definition = policySchema.parse(input);
  assertEscalationsMatchThresholds(definition);

  return transaction(ctx, async (tx) => {
    const existing = await tx.slaPolicy.findFirst({ where: { key: definition.key } });
    if (existing) throw new ConflictError(`an SLA policy with the key ${definition.key} already exists`);

    const policy = await tx.slaPolicy.create({
      data: {
        id: newId(),
        tenantId: ctx.tenantId,
        orgId: definition.orgId ?? null,
        key: definition.key,
        name: definition.name,
        match: definition.match as never,
        specificity: definition.specificity,
        calendarMode: definition.calendarMode,
        calendarId: definition.calendarId ?? null,
        status: 'published',
      },
    });

    for (const target of definition.targets) {
      await tx.slaTarget.create({
        data: { id: newId(), tenantId: ctx.tenantId, policyId: policy.id, ...target },
      });
    }
    for (const rule of definition.escalations) {
      await tx.escalationRule.create({
        data: {
          id: newId(),
          tenantId: ctx.tenantId,
          policyId: policy.id,
          on: rule.on,
          step: rule.step,
          notify: (rule.notify ?? {}) as never,
          action: (rule.action ?? null) as never,
        },
      });
    }

    await recordAudit(tx, ctx, {
      action: 'sla.policy.created',
      targetType: 'sla_policy',
      targetId: policy.id,
      after: { key: policy.key, targets: definition.targets.length, escalations: definition.escalations.length },
    });
    return policy;
  });
}

export async function updateTargets(ctx: TenantContext, idOrKey: string, targets: unknown) {
  authz.require(ctx, 'sla.policy.manage');
  const parsed = z.array(targetSchema).min(1).max(24).parse(targets);

  return transaction(ctx, async (tx) => {
    const policy = await loadPolicy(tx, idOrKey);
    const before = await tx.slaTarget.findMany({ where: { policyId: policy.id } });

    // Replace rather than patch: a half-updated target table is a policy nobody
    // can reason about, and the set is small enough that replacing is honest.
    await tx.slaTarget.deleteMany({ where: { policyId: policy.id } });
    for (const target of parsed) {
      await tx.slaTarget.create({ data: { id: newId(), tenantId: ctx.tenantId, policyId: policy.id, ...target } });
    }
    // Running timers keep the target they started with: retuning an SLA must not
    // silently breach every ticket already in flight.
    await tx.slaPolicy.update({ where: { id: policy.id }, data: { version: { increment: 1 } } });

    await recordAudit(tx, ctx, {
      action: 'sla.policy.targets.changed',
      targetType: 'sla_policy',
      targetId: policy.id,
      before: { targets: before.map((t) => ({ priority: t.priority, targetType: t.targetType, minutes: t.minutes })) },
      after: { targets: parsed },
    });
    return tx.slaTarget.findMany({ where: { policyId: policy.id } });
  });
}

export const calendarSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9-]{1,62}$/),
  name: z.string().min(1).max(120),
  timeZone: z.string().min(1).max(64),
  hours: z.record(z.array(z.object({ start: z.string(), end: z.string() }))),
  isDefault: z.boolean().default(false),
  exceptions: z
    .array(
      z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        type: z.enum(['holiday', 'extended']).default('holiday'),
        name: z.string().max(120).optional(),
        hours: z.array(z.object({ start: z.string(), end: z.string() })).optional(),
      }),
    )
    .max(200)
    .default([]),
});

export async function createCalendar(ctx: TenantContext, input: unknown) {
  authz.require(ctx, 'sla.policy.manage');
  const definition = calendarSchema.parse(input);

  // Validated by the same function the timer engine uses, so a calendar that
  // saves is a calendar the engine can compute against.
  const problems = validateCalendar({
    timeZone: definition.timeZone,
    hours: definition.hours as never,
    exceptions: definition.exceptions as never,
  });
  if (problems.length > 0) {
    throw new ValidationError(`this calendar cannot be used: ${problems.join('; ')}`,
      problems.map((message) => ({ field: 'hours', code: 'invalid', message })));
  }

  return transaction(ctx, async (tx) => {
    const existing = await tx.businessCalendar.findFirst({ where: { key: definition.key } });
    if (existing) throw new ConflictError(`a calendar with the key ${definition.key} already exists`);

    const calendar = await tx.businessCalendar.create({
      data: {
        id: newId(),
        tenantId: ctx.tenantId,
        key: definition.key,
        name: definition.name,
        timeZone: definition.timeZone,
        hours: definition.hours as never,
        isDefault: definition.isDefault,
      },
    });
    for (const exception of definition.exceptions) {
      await tx.calendarException.create({
        data: {
          id: newId(),
          tenantId: ctx.tenantId,
          calendarId: calendar.id,
          date: exception.date,
          type: exception.type,
          name: exception.name ?? null,
          hours: (exception.hours ?? null) as never,
        },
      });
    }
    await recordAudit(tx, ctx, {
      action: 'sla.calendar.created',
      targetType: 'business_calendar',
      targetId: calendar.id,
      after: { key: calendar.key, timeZone: calendar.timeZone, exceptions: definition.exceptions.length },
    });
    return calendar;
  });
}

export async function listCalendars(ctx: TenantContext) {
  authz.require(ctx, 'sla.policy.read');
  return transaction(ctx, (tx) => tx.businessCalendar.findMany({ orderBy: { key: 'asc' } }));
}

export async function getPriorityMatrix(ctx: TenantContext) {
  authz.require(ctx, 'sla.policy.read');
  return transaction(ctx, (tx) => tx.priorityMatrix.findMany({ orderBy: [{ impact: 'asc' }, { urgency: 'asc' }] }));
}

export const matrixSchema = z.array(
  z.object({
    impact: z.enum(['high', 'medium', 'low']),
    urgency: z.enum(['high', 'medium', 'low']),
    priority: z.enum(['P1', 'P2', 'P3', 'P4']),
  }),
).length(9, 'every impact and urgency combination needs a priority');

export async function setPriorityMatrix(ctx: TenantContext, input: unknown) {
  authz.require(ctx, 'sla.policy.manage');
  const rows = matrixSchema.parse(input);

  const seen = new Set(rows.map((row) => `${row.impact}:${row.urgency}`));
  if (seen.size !== 9) {
    throw new ValidationError('the matrix has a duplicate impact and urgency combination');
  }

  return transaction(ctx, async (tx) => {
    const before = await tx.priorityMatrix.findMany({});
    await tx.priorityMatrix.deleteMany({ where: { orgId: null } });
    for (const row of rows) {
      await tx.priorityMatrix.create({ data: { id: newId(), tenantId: ctx.tenantId, orgId: null, ...row } });
    }
    await recordAudit(tx, ctx, {
      action: 'sla.matrix.changed',
      targetType: 'priority_matrix',
      targetId: ctx.tenantId,
      before: { rows: before.map((r) => ({ impact: r.impact, urgency: r.urgency, priority: r.priority })) },
      after: { rows },
    });
    return tx.priorityMatrix.findMany({ orderBy: [{ impact: 'asc' }, { urgency: 'asc' }] });
  });
}

async function loadPolicy(tx: Tx, idOrKey: string) {
  const policy = await tx.slaPolicy.findFirst({
    where: /^[0-9a-f-]{36}$/i.test(idOrKey) ? { id: idOrKey } : { key: idOrKey },
  });
  if (!policy) throw new NotFoundError('SLA policy not found');
  return policy;
}

/**
 * An escalation registered against a threshold no target fires would never run.
 * Catching it here turns a silent no-op into a validation message.
 */
function assertEscalationsMatchThresholds(definition: z.infer<typeof policySchema>): void {
  const thresholds = new Set(definition.targets.flatMap((target) => target.warningThresholds));
  const orphaned = definition.escalations
    .map((rule) => rule.on)
    .filter((on) => on.startsWith('warning:'))
    .filter((on) => !thresholds.has(Number(on.slice('warning:'.length))));

  if (orphaned.length > 0) {
    throw new ValidationError(
      `these escalations fire at a threshold no target warns at, so they would never run: ${orphaned.join(', ')}`,
      orphaned.map((on) => ({ field: 'escalations', code: 'orphaned_threshold', message: on })),
    );
  }
}
