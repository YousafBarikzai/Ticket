import { type TenantContext, type Tx, logger, metrics, newId, recordAudit, publish } from '@itsm/platform';
import { evaluate, type EvalContext } from '@itsm/expr';
import { events } from '@itsm/contracts';
import { EXCLUSIVE_ACTIONS, conflictKey, type RuleAction, type RuleEvent } from '../domain/actions.js';

/**
 * The rules interpreter.
 *
 * It runs inside the consuming handler's transaction, which is what makes rule
 * application exactly-once per event rather than "usually once": the inbox row,
 * the ticket change, the audit entry and the outbox event either all commit or
 * none do (docs/architecture/11 §1).
 *
 * The interpreter is deliberately split from the effects. `decide()` is pure —
 * given facts and a rule set it returns what would happen — and `applyDecision`
 * carries it out. The test panel calls the first without the second, so a dry
 * run is genuinely the same evaluation as a live one rather than a re-implementation
 * of it that can drift.
 */

export interface LoadedRule {
  id: string;
  key: string;
  name: string;
  event: string;
  conditions: unknown;
  actions: RuleAction[];
  order: number;
  mode: 'stop' | 'continue';
  version: number;
}

export interface PlannedAction {
  ruleId: string;
  ruleKey: string;
  ruleVersion: number;
  action: RuleAction;
}

export interface SkippedAction extends PlannedAction {
  /** The rule that already claimed this action type. */
  supersededBy: string;
}

export interface Decision {
  matched: { ruleId: string; ruleKey: string; ruleVersion: number }[];
  applied: PlannedAction[];
  skipped: SkippedAction[];
  /** Rules never reached because an earlier matching rule had mode `stop`. */
  notReached: string[];
  errors: { ruleKey: string; message: string }[];
}

/**
 * Works out what a rule set would do to one set of facts. No I/O, no writes:
 * everything the test panel and the live path share lives here.
 */
export function decide(rules: LoadedRule[], facts: EvalContext): Decision {
  const decision: Decision = { matched: [], applied: [], skipped: [], notReached: [], errors: [] };
  const claimed = new Map<string, string>();
  let stopped = false;

  for (const rule of [...rules].sort((a, b) => a.order - b.order || a.key.localeCompare(b.key))) {
    if (stopped) {
      decision.notReached.push(rule.key);
      continue;
    }

    let matches = false;
    try {
      matches = evaluate(rule.conditions as never, facts);
    } catch (error) {
      // A rule whose condition cannot be evaluated must not take the event down
      // with it: the other rules still run and the failure is reported to the
      // author rather than to the person who raised the ticket.
      decision.errors.push({ ruleKey: rule.key, message: error instanceof Error ? error.message : String(error) });
      continue;
    }
    if (!matches) continue;

    decision.matched.push({ ruleId: rule.id, ruleKey: rule.key, ruleVersion: rule.version });

    for (const action of rule.actions) {
      const planned: PlannedAction = { ruleId: rule.id, ruleKey: rule.key, ruleVersion: rule.version, action };
      if (!EXCLUSIVE_ACTIONS.has(action.type)) {
        decision.applied.push(planned);
        continue;
      }
      const key = conflictKey(action);
      const owner = claimed.get(key);
      if (owner) {
        decision.skipped.push({ ...planned, supersededBy: owner });
        continue;
      }
      claimed.set(key, rule.key);
      decision.applied.push(planned);
    }

    if (rule.mode === 'stop') stopped = true;
  }

  return decision;
}

/**
 * The effects a rule can have on a ticket, as a patch plus the side effects that
 * are not field writes. Returning a description rather than performing the
 * writes keeps this module from reaching into MOD-04's tables: the caller hands
 * the patch to `ticketService`, which is the only writer of a ticket row.
 */
export interface RuleEffects {
  patch: Record<string, unknown>;
  tags: string[];
  watchers: string[];
  notifications: { template: string; to: 'requester' | 'assignee' | 'group' | 'watchers' }[];
  links: { of: string }[];
  /** Workflows this rule set would start, by definition key (MOD-06-E1). */
  workflows: { definitionKey: string }[];
  status?: { status: string; reason?: string };
  priorityReason?: string;
  /** How the ticket should be routed to a person (MOD-20). */
  assignStrategy?: 'round_robin' | 'least_loaded' | 'skill';
}

export function effectsOf(decision: Decision): RuleEffects {
  const effects: RuleEffects = { patch: {}, tags: [], watchers: [], notifications: [], links: [], workflows: [] };

  for (const { action } of decision.applied) {
    switch (action.type) {
      case 'setField':
        effects.patch[action.field] = action.value;
        break;
      case 'setCategory':
        effects.patch.categoryId = action.categoryId;
        if (action.subcategoryId) effects.patch.subcategoryId = action.subcategoryId;
        break;
      case 'setPriority':
        effects.patch.priority = action.priority;
        effects.priorityReason = action.reason;
        break;
      case 'setStatus':
        effects.status = { status: action.status, ...(action.reason ? { reason: action.reason } : {}) };
        break;
      case 'assignGroup':
        effects.patch.groupId = action.groupId;
        break;
      case 'addWatcher':
        effects.watchers.push(action.userId);
        break;
      case 'addTag':
        effects.tags.push(action.tag);
        break;
      case 'sendNotification':
        effects.notifications.push({ template: action.template, to: action.to });
        break;
      case 'linkDuplicate':
        effects.links.push({ of: action.of });
        break;
      case 'startWorkflow':
        // Delivered in PH-3. The rule decides *whether*; the workflow engine
        // decides what happens over the following minutes or days, which is the
        // division of labour the two engines exist for.
        effects.workflows.push({ definitionKey: action.definitionKey });
        break;
      case 'assignStrategy':
        // The rule names *how* to choose, never who: picking the person needs
        // the team's availability, shifts, skills and current load, and all of
        // that belongs to MOD-20. The caller asks it, in the same transaction.
        effects.assignStrategy = action.strategy;
        break;
    }
  }

  return effects;
}

/**
 * Records what ran. The audit entry names the rule and the version of its text,
 * so "why did this ticket become P1?" is answerable months later even if the
 * rule has been edited since.
 */
export async function recordApplications(
  ctx: TenantContext,
  tx: Tx,
  decision: Decision,
  event: RuleEvent,
  ticketId: string | null,
): Promise<void> {
  for (const matched of decision.matched) {
    const applied = decision.applied.filter((a) => a.ruleId === matched.ruleId).map((a) => a.action);
    const skipped = decision.skipped
      .filter((a) => a.ruleId === matched.ruleId)
      .map((a) => ({ action: a.action, supersededBy: a.supersededBy }));

    await tx.ruleApplication.create({
      data: {
        id: newId(),
        tenantId: ctx.tenantId,
        ruleId: matched.ruleId,
        ruleVersion: matched.ruleVersion,
        ticketId,
        event,
        applied: applied as never,
        skipped: skipped as never,
      },
    });

    await recordAudit(tx, ctx, {
      action: 'rule.applied',
      targetType: 'ticket',
      targetId: ticketId ?? matched.ruleId,
      after: { ruleKey: matched.ruleKey, ruleVersion: matched.ruleVersion, applied, skipped },
    });

    await publish(tx, ctx, {
      definition: events.ruleApplied,
      aggregateId: ticketId ?? matched.ruleId,
      payload: {
        ruleId: matched.ruleId,
        ruleKey: matched.ruleKey,
        ruleVersion: matched.ruleVersion,
        event,
        ticketId,
        actions: applied.map((a) => a.type),
      },
    });

    metrics.increment('rules_applied_total', { event, rule: matched.ruleKey });
  }

  for (const failure of decision.errors) {
    metrics.increment('rules_errors_total', { event, rule: failure.ruleKey });
    logger.warn('rule condition could not be evaluated', { rule: failure.ruleKey, reason: failure.message });
  }
}
