import { type TenantContext, type Tx, logger, metrics, recordAudit } from '@itsm/platform';
import { notificationService } from '@itsm/module-notifications';
import { ticketService } from '@itsm/module-ticket';

/**
 * MOD-07-E1 escalations.
 *
 * A warning or a breach that only writes a row is a warning nobody sees. An
 * escalation rule turns it into something that reaches a person: a notification,
 * a reassignment, or both.
 *
 * Escalations run on the scheduler's transaction, so the timer state and the
 * escalation that followed from it commit together. A failed escalation must not
 * leave a timer marked breached with nothing having happened — but equally, one
 * badly configured rule must not stop the tick for every other tenant, so each
 * step is guarded and reported rather than thrown.
 */

export interface EscalationRuleRow {
  id: string;
  policyId: string;
  on: string;
  step: number;
  notify: unknown;
  action: unknown;
}

interface NotifySpec {
  to?: 'requester' | 'assignee' | 'group' | 'watchers';
  template?: string;
}

interface ActionSpec {
  /** Move the ticket to another group. */
  reassignGroup?: string;
  /** Raise the priority, but never lower it: an escalation does not de-escalate. */
  raisePriorityTo?: 'P1' | 'P2' | 'P3' | 'P4';
  addTag?: string;
}

const PRIORITY_ORDER = ['P4', 'P3', 'P2', 'P1'];

/**
 * Applies every escalation rule registered for one timer event.
 *
 * `on` is matched against the event that just happened — `warning:75`, `breach`
 * — so one policy can warn at 75 per cent, warn harder at 90, and reassign on
 * breach without three separate policies.
 */
export async function applyEscalations(
  ctx: TenantContext,
  tx: Tx,
  input: {
    policyId: string;
    ticketId: string;
    timerId: string;
    /** 'breach', or 'warning:<threshold>'. */
    on: string;
    eventId: string;
  },
): Promise<number> {
  const rules = await tx.escalationRule.findMany({
    where: { policyId: input.policyId, on: input.on },
    orderBy: { step: 'asc' },
  });
  if (rules.length === 0) return 0;

  let applied = 0;
  for (const rule of rules) {
    try {
      await applyOne(ctx, tx, rule as EscalationRuleRow, input);
      applied += 1;
    } catch (error) {
      // One tenant's misconfigured escalation must not stop the scheduler tick.
      logger.warn('an escalation rule could not be applied', {
        ruleId: rule.id,
        on: input.on,
        reason: error instanceof Error ? error.message : String(error),
      });
      metrics.increment('sla_escalation_errors_total', { on: input.on });
    }
  }

  metrics.increment('sla_escalations_applied_total', { on: input.on }, applied);
  return applied;
}

async function applyOne(
  ctx: TenantContext,
  tx: Tx,
  rule: EscalationRuleRow,
  input: { ticketId: string; timerId: string; on: string; eventId: string },
): Promise<void> {
  const notify = (rule.notify ?? {}) as NotifySpec;
  const action = (rule.action ?? {}) as ActionSpec | null;

  if (notify.template && notify.to) {
    await notificationService.queueFromRule(ctx, tx, {
      ticketId: input.ticketId,
      template: notify.template,
      to: notify.to,
      eventId: input.eventId,
      // The escalation step identifies the sender, so two steps on the same
      // event each reach their own audience instead of deduplicating together.
      ruleKey: `sla-escalation-${rule.id}-${rule.step}`,
    });
  }

  if (!action) return;

  const ticket = await tx.ticket.findFirst({ where: { id: input.ticketId } });
  if (!ticket) return;

  const change: Parameters<typeof ticketService.applyAutomatedChange>[3] = { patch: {}, tags: [] };

  if (action.reassignGroup && action.reassignGroup !== ticket.groupId) {
    change.patch!.groupId = action.reassignGroup;
  }

  if (action.raisePriorityTo) {
    const current = PRIORITY_ORDER.indexOf(ticket.priority);
    const target = PRIORITY_ORDER.indexOf(action.raisePriorityTo);
    // Never downwards: an escalation that lowered the priority would be a
    // de-escalation wearing the wrong name, and would restart the SLA clock
    // with a longer target than the one just breached.
    if (target > current) change.patch!.priority = action.raisePriorityTo;
  }

  if (action.addTag) change.tags!.push(action.addTag);

  const hasWork = Object.keys(change.patch ?? {}).length > 0 || (change.tags?.length ?? 0) > 0;
  if (!hasWork) return;

  const outcome = await ticketService.applyAutomatedChange(ctx, tx, input.ticketId, change, {
    kind: 'workflow',
    id: rule.id,
    key: `sla-escalation:${input.on}`,
    version: rule.step,
    reason: `SLA ${input.on} on ${input.timerId}`,
  });

  await recordAudit(tx, ctx, {
    action: 'sla.escalated',
    targetType: 'ticket',
    targetId: input.ticketId,
    after: {
      on: input.on,
      step: rule.step,
      changed: outcome.changed,
      tagsAdded: outcome.tagsAdded,
      refused: outcome.refused,
    },
  });
}
