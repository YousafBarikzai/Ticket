import { z } from 'zod';
import { events } from '@itsm/contracts';
import { requestApproval } from '@itsm/module-approvals';
import {
  type TenantContext,
  type Tx,
  NotFoundError,
  ValidationError,
  authz,
  getSetting,
  metrics,
  newId,
  nextNumber,
  publish,
  recordAudit,
  transaction,
} from '@itsm/platform';
import {
  CHANGE_KINDS,
  CLOSE_CODES,
  assertTransition,
  isChangeState,
  onSubmission,
  succeeded,
  type ChangeKind,
  type ChangeState,
  type CloseCode,
} from '../domain/lifecycle.js';
import { checkSchedule } from '../domain/windows.js';

/**
 * Raising, approving, scheduling and closing changes.
 *
 * The three kinds are approved in three different ways and that is the whole
 * design: a standard change inherits its template's approval, a normal change
 * goes to MOD-17, and an emergency change is recorded first and approved
 * afterwards. Each is a deliberate trade between control and coverage, and the
 * emergency case is the one people get wrong — refusing to record a change
 * until somebody approves it means emergency changes stop being recorded, and
 * the record is then missing exactly the changes most likely to have caused the
 * next outage.
 */

export const createChangeSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(20_000).optional(),
  kind: z.enum(CHANGE_KINDS).default('normal'),
  risk: z.enum(['low', 'medium', 'high']).default('medium'),
  impact: z.enum(['low', 'medium', 'high']).default('medium'),
  serviceId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  problemId: z.string().uuid().optional(),
  majorIncidentId: z.string().uuid().optional(),
  ownerId: z.string().uuid().optional(),
  /** Required for a standard change: the template is what pre-approves it. */
  templateKey: z.string().max(200).optional(),
  implementationPlan: z.string().max(20_000).optional(),
  backoutPlan: z.string().max(20_000).optional(),
  testPlan: z.string().max(20_000).optional(),
  plannedStartAt: z.coerce.date().optional(),
  plannedEndAt: z.coerce.date().optional(),
});

export async function createChange(ctx: TenantContext, input: z.input<typeof createChangeSchema>) {
  authz.require(ctx, 'change.raise');
  const parsed = createChangeSchema.parse(input);
  assertPlannedPeriod(parsed.plannedStartAt, parsed.plannedEndAt);

  return transaction(ctx, async (tx) => {
    let templateId: string | null = null;
    let templateVersion: number | null = null;
    let plans = {
      implementationPlan: parsed.implementationPlan ?? null,
      backoutPlan: parsed.backoutPlan ?? null,
      testPlan: parsed.testPlan ?? null,
    };

    if (parsed.kind === 'standard') {
      if (!parsed.templateKey) {
        throw new ValidationError(
          'a standard change comes from a published template; without one it is a normal change and needs approving',
        );
      }
      const template = await tx.standardChangeTemplate.findFirst({ where: { key: parsed.templateKey } });
      if (!template) throw new NotFoundError('standard change template', parsed.templateKey);
      if (template.status !== 'published') {
        throw new ValidationError(`the template ${parsed.templateKey} is ${template.status}; only a published one pre-approves`);
      }
      templateId = template.id;
      // Pinned to the version that was approved, so editing the template later
      // cannot retroactively change what somebody signed off.
      templateVersion = template.version;
      plans = {
        implementationPlan: parsed.implementationPlan ?? template.implementationPlan,
        backoutPlan: parsed.backoutPlan ?? template.backoutPlan,
        testPlan: parsed.testPlan ?? template.testPlan,
      };
    } else if (parsed.templateKey) {
      throw new ValidationError('only a standard change comes from a template');
    }

    const id = newId();
    const number = await nextNumber(tx, ctx, 'change', 'CHG', 4);
    const change = await tx.change.create({
      data: {
        id,
        tenantId: ctx.tenantId,
        number,
        title: parsed.title,
        description: parsed.description ?? null,
        kind: parsed.kind,
        status: 'draft',
        risk: parsed.risk,
        impact: parsed.impact,
        serviceId: parsed.serviceId ?? null,
        categoryId: parsed.categoryId ?? null,
        problemId: parsed.problemId ?? null,
        majorIncidentId: parsed.majorIncidentId ?? null,
        requestedBy: ctx.actor.id,
        ownerId: parsed.ownerId ?? ctx.actor.id,
        templateId,
        templateVersion,
        ...plans,
        plannedStartAt: parsed.plannedStartAt ?? null,
        plannedEndAt: parsed.plannedEndAt ?? null,
      },
    });

    await recordAudit(tx, ctx, {
      action: 'change.created',
      targetType: 'change',
      targetId: id,
      after: { number, kind: parsed.kind, risk: parsed.risk, templateKey: parsed.templateKey ?? null },
    });
    return change;
  });
}

/**
 * Submits it, and approves it in whichever of the three ways its kind implies.
 *
 * A normal change with no matching approval policy is **approved with the
 * reason recorded**, not left waiting for ever. A tenant that has not written a
 * CAB policy is not asking for every change to be blocked; what matters is that
 * "approved because no policy applied" is written down, so it is
 * distinguishable from a change that slipped past one.
 */
export async function submitChange(ctx: TenantContext, number: string) {
  authz.require(ctx, 'change.raise');

  return transaction(ctx, async (tx) => {
    const change = await loadByNumber(tx, number);
    const from = stateOf(change);
    assertTransition(from, 'submitted');

    const kind = (CHANGE_KINDS as readonly string[]).includes(change.kind) ? (change.kind as ChangeKind) : 'normal';
    if (kind !== 'emergency' && !change.backoutPlan) {
      // The one field worth refusing over. A change nobody can undo at 2am is
      // the change that turns a bad deploy into an outage; an emergency change
      // is exempt because it is already happening.
      throw new ValidationError('this change has no back-out plan; say what happens if it does not work');
    }

    const route = onSubmission(kind);
    let approvalRequestId: string | null = null;
    let approvalNote: string | null = null;
    let to: ChangeState = route.to;

    if (route.needsApproval) {
      const request = await requestApproval(ctx, tx, {
        subjectType: 'change',
        subjectId: change.id,
        facts: { change: { kind, risk: change.risk, impact: change.impact, serviceId: change.serviceId } },
      });
      if (request) {
        approvalRequestId = request.id;
      } else {
        to = 'approved';
        approvalNote = 'Approved without CAB: no approval policy matched this change.';
      }
    } else if (kind === 'standard') {
      approvalNote = `Pre-approved by standard change template version ${change.templateVersion}.`;
    } else {
      approvalNote = 'Emergency change: recorded now, approval owed afterwards.';
    }

    const submitted = await tx.change.update({
      where: { id: change.id },
      data: {
        status: to,
        approvalRequestId,
        approvalNote,
        version: { increment: 1 },
      },
    });

    await recordAudit(tx, ctx, {
      action: 'change.submitted',
      targetType: 'change',
      targetId: change.id,
      after: { status: to, kind, approvalNote },
    });
    await publish(tx, ctx, {
      definition: events.changeSubmitted,
      aggregateId: change.id,
      payload: {
        changeId: change.id,
        number: change.number,
        kind,
        title: change.title,
        risk: change.risk,
        serviceId: change.serviceId,
        needsApproval: route.needsApproval && approvalRequestId !== null,
      },
    });

    if (to === 'approved' || to === 'scheduled') {
      await publish(tx, ctx, {
        definition: events.changeApproved,
        aggregateId: change.id,
        payload: {
          changeId: change.id,
          number: change.number,
          kind,
          via: kind === 'standard' ? 'template' : kind === 'emergency' ? 'emergency' : 'no_policy',
          retrospective: false,
        },
      });
    }

    metrics.increment('change_submitted_total', { kind });
    return submitted;
  });
}

export const scheduleSchema = z.object({
  plannedStartAt: z.coerce.date(),
  plannedEndAt: z.coerce.date(),
});

/**
 * Books it into a period.
 *
 * A blackout **refuses**. The whole point of declaring "no changes during
 * year-end close" is that it holds, and a warning is a thing people click
 * through. Change windows advise rather than refuse, because the set of
 * legitimate exceptions is large and a hard refusal would push people to raise
 * changes as emergencies — trading a small governance win for a large hole in
 * the record.
 */
export async function scheduleChange(ctx: TenantContext, number: string, input: z.input<typeof scheduleSchema>) {
  authz.require(ctx, 'change.implement');
  const parsed = scheduleSchema.parse(input);
  assertPlannedPeriod(parsed.plannedStartAt, parsed.plannedEndAt);

  return transaction(ctx, async (tx) => {
    const change = await loadByNumber(tx, number);
    const from = stateOf(change);
    assertTransition(from, 'scheduled');

    const windows = await tx.changeWindow.findMany({ where: { status: 'active' } });
    const verdict = checkSchedule(
      windows as never,
      { start: parsed.plannedStartAt, end: parsed.plannedEndAt },
      change.serviceId,
    );

    if (!verdict.allowed) {
      const reason = verdict.blockedBy?.reason ? `: ${verdict.blockedBy.reason}` : '';
      throw new ValidationError(
        `that period is inside the blackout "${verdict.blockedBy?.name}"${reason}`,
        [{ field: 'plannedStartAt', code: 'blackout_window', message: verdict.blockedBy?.name ?? 'blackout' }],
      );
    }

    const scheduled = await tx.change.update({
      where: { id: change.id },
      data: {
        status: 'scheduled',
        plannedStartAt: parsed.plannedStartAt,
        plannedEndAt: parsed.plannedEndAt,
        version: { increment: 1 },
      },
    });

    await recordAudit(tx, ctx, {
      action: 'change.scheduled',
      targetType: 'change',
      targetId: change.id,
      after: {
        plannedStartAt: parsed.plannedStartAt,
        plannedEndAt: parsed.plannedEndAt,
        inWindows: verdict.inWindows,
        outsideWindows: verdict.outsideWindows,
      },
    });
    await publish(tx, ctx, {
      definition: events.changeScheduled,
      aggregateId: change.id,
      payload: {
        changeId: change.id,
        number: change.number,
        kind: change.kind,
        plannedStartAt: parsed.plannedStartAt.toISOString(),
        plannedEndAt: parsed.plannedEndAt.toISOString(),
        serviceId: change.serviceId,
        inWindows: verdict.inWindows,
        outsideWindows: verdict.outsideWindows,
      },
    });
    return { change: scheduled, verdict };
  });
}

export const transitionSchema = z.object({
  to: z.string(),
  closeCode: z.enum(CLOSE_CODES).optional(),
  notes: z.string().max(10_000).optional(),
});

export async function transition(ctx: TenantContext, number: string, input: z.input<typeof transitionSchema>) {
  authz.require(ctx, 'change.implement');
  const parsed = transitionSchema.parse(input);
  if (!isChangeState(parsed.to)) throw new ValidationError(`unknown change state: ${parsed.to}`);
  const to: ChangeState = parsed.to;

  return transaction(ctx, async (tx) => {
    const change = await loadByNumber(tx, number);
    const from = stateOf(change);
    assertTransition(from, to);
    if (from === to) return change;

    const now = new Date();
    const data: Record<string, unknown> = { status: to, version: { increment: 1 } };
    if (to === 'implementing') data.actualStartAt = change.actualStartAt ?? now;
    if (to === 'review') data.actualEndAt = now;
    if (to === 'closed') {
      if (!parsed.closeCode) {
        // A change closed with no outcome is a change that tells you nothing:
        // the only reason to keep the record is to be able to ask later whether
        // it worked.
        throw new ValidationError(`say how it went; one of ${CLOSE_CODES.join(', ')}`);
      }
      data.closeCode = parsed.closeCode;
      data.closeNotes = parsed.notes ?? null;
      data.closedAt = now;
    }

    const moved = await tx.change.update({ where: { id: change.id }, data });

    await recordAudit(tx, ctx, {
      action: 'change.status.changed',
      targetType: 'change',
      targetId: change.id,
      before: { status: from },
      after: { status: to, closeCode: parsed.closeCode ?? null },
      ...(parsed.notes ? { reason: parsed.notes } : {}),
    });

    if (to === 'closed') {
      const closeCode = parsed.closeCode as CloseCode;
      await publish(tx, ctx, {
        definition: events.changeClosed,
        aggregateId: change.id,
        payload: {
          changeId: change.id,
          number: change.number,
          kind: change.kind,
          closeCode,
          succeeded: succeeded(closeCode),
          // Null here is the number worth watching: an emergency change nobody
          // ever came back to approve.
          retrospectiveApprovedAt: change.retrospectiveApprovedAt?.toISOString() ?? null,
        },
      });
      metrics.increment('change_closed_total', { kind: change.kind, closeCode });
    }

    return moved;
  });
}

/**
 * Approves an emergency change after the fact.
 *
 * The debt the record carries. It is a separate permission from raising or
 * implementing one, because the person who made the emergency change at 3am is
 * exactly the person who should not be signing it off at 9am.
 */
export async function approveRetrospectively(ctx: TenantContext, number: string, note?: string) {
  authz.require(ctx, 'change.approve.retrospective');

  return transaction(ctx, async (tx) => {
    const change = await loadByNumber(tx, number);
    if (change.kind !== 'emergency') {
      throw new ValidationError('only an emergency change is approved after the fact');
    }
    if (change.retrospectiveApprovedAt) throw new ValidationError('this change has already been approved');
    if (change.requestedBy && change.requestedBy === ctx.actor.id) {
      throw new ValidationError('an emergency change is not approved by the person who made it');
    }

    const approved = await tx.change.update({
      where: { id: change.id },
      data: {
        retrospectiveApprovedAt: new Date(),
        retrospectiveApprovedBy: ctx.actor.id,
        approvalNote: note ?? change.approvalNote,
        version: { increment: 1 },
      },
    });
    await recordAudit(tx, ctx, {
      action: 'change.approved.retrospective',
      targetType: 'change',
      targetId: change.id,
      after: { approvedBy: ctx.actor.id },
      ...(note ? { reason: note } : {}),
    });
    await publish(tx, ctx, {
      definition: events.changeApproved,
      aggregateId: change.id,
      payload: { changeId: change.id, number: change.number, kind: change.kind, via: 'retrospective', retrospective: true },
    });
    return approved;
  });
}

/** Emergency changes still owing a retrospective approval, oldest first. */
export async function owedRetrospectives(ctx: TenantContext) {
  authz.require(ctx, 'change.read');
  const dueHours = (await getSetting<number>(ctx, 'change.retrospectiveDueHours')) ?? 72;
  const dueBefore = new Date(Date.now() - dueHours * 3_600_000);

  return transaction(ctx, async (tx) => {
    const owed = await tx.change.findMany({
      where: { kind: 'emergency', retrospectiveApprovedAt: null, status: { notIn: ['cancelled'] } },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
    return owed.map((change) => ({
      number: change.number,
      title: change.title,
      status: change.status,
      createdAt: change.createdAt,
      overdue: change.createdAt.getTime() < dueBefore.getTime(),
    }));
  });
}

export async function listChanges(ctx: TenantContext, filter: { status?: string; kind?: string; open?: boolean } = {}) {
  authz.require(ctx, 'change.read');
  return transaction(ctx, (tx) =>
    tx.change.findMany({
      where: {
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.kind ? { kind: filter.kind } : {}),
        ...(filter.open ? { status: { notIn: ['closed', 'cancelled'] } } : {}),
      },
      orderBy: [{ plannedStartAt: 'asc' }, { createdAt: 'desc' }],
      take: 100,
    }),
  );
}

export async function getChange(ctx: TenantContext, number: string) {
  authz.require(ctx, 'change.read');
  return transaction(ctx, (tx) => loadByNumber(tx, number));
}

// ---------------------------------------------------------------------------

function assertPlannedPeriod(start?: Date, end?: Date): void {
  if (!start || !end) return;
  if (end.getTime() <= start.getTime()) throw new ValidationError('a change cannot end before it starts');
}

async function loadByNumber(tx: Tx, number: string) {
  const change = await tx.change.findFirst({ where: { number } });
  if (!change) throw new NotFoundError('change', number);
  return change;
}

function stateOf(change: { status: string }): ChangeState {
  return isChangeState(change.status) ? change.status : 'draft';
}
