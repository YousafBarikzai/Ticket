import { type TenantContext, type Tx, ValidationError, newId, transaction } from '@itsm/platform';
import { evaluate, parseDuration, type EvalContext } from '@itsm/expr';
import { ticketService } from '@itsm/module-ticket';
import { approvalService } from '@itsm/module-approvals';
import { notificationService } from '@itsm/module-notifications';
import { renderStrict } from '../domain/template.js';
import type { WorkflowNode } from '../domain/definition.js';

/**
 * What each node type actually does.
 *
 * Two registries implement this interface: the live one below, and a dry-run
 * one that records what it *would* do and writes nothing. The test panel uses
 * the second and the executor uses the first, but both are driven by the same
 * `advance()` and the same graph — so a rehearsal cannot take a different path
 * from the real run, which is the failure mode a separate simulator always has.
 */

export interface NodeOutcome {
  /** Merged into the run context under the node's key, readable as `{{key.x}}`. */
  output: Record<string, unknown>;
  /** True when the run should stop here and wait to be woken. */
  parked?: boolean;
}

export interface StepContext {
  node: WorkflowNode;
  run: { id: string; ticketId: string | null; definitionId: string; definitionKey: string; version: number };
  context: EvalContext;
  idempotencyKey: string;
  /** What a previous attempt of this step produced, if one got that far. */
  previousOutput?: Record<string, unknown>;
}

export type StepExecutor = (ctx: TenantContext, input: StepContext) => Promise<NodeOutcome>;

function provenanceFor(run: { id: string; definitionId: string; definitionKey: string; version: number }) {
  // The audit entry names the workflow and the version of its graph, so "why
  // did this ticket change?" is answerable months later even if the definition
  // has been edited since.
  return { kind: 'workflow' as const, id: run.definitionId, key: run.definitionKey, version: run.version };
}

function requireTicket(run: { ticketId: string | null }): string {
  if (!run.ticketId) {
    throw new ValidationError('this step changes a ticket, but the run is not attached to one');
  }
  return run.ticketId;
}

/** The live registry: every node type, doing the real thing. */
export const executeNode: StepExecutor = async (ctx, input) => {
  const { node, run, context } = input;

  switch (node.type) {
    case 'condition':
      // A condition node decides nothing by itself: the edges leaving it carry
      // the conditions. Its output records what it saw so a run's history
      // explains which way it went.
      return { output: { result: safeEvaluate(node.when, context) } };

    case 'setField': {
      const value = renderStrict(node.value, context);
      const outcome = await transaction(ctx, (tx) =>
        ticketService.applyAutomatedChange(ctx, tx, requireTicket(run), { patch: { [node.field]: value } }, provenanceFor(run)),
      );
      return { output: { field: node.field, value, refused: outcome.refused } };
    }

    case 'assign': {
      const assigneeId = node.assigneeId ? renderStrict(node.assigneeId, context) : undefined;
      const patch: Record<string, unknown> = {};
      if (node.groupId) patch.groupId = node.groupId;
      if (assigneeId) patch.assigneeId = assigneeId;
      const outcome = await transaction(ctx, (tx) =>
        ticketService.applyAutomatedChange(ctx, tx, requireTicket(run), { patch }, provenanceFor(run)),
      );
      return { output: { ...patch, refused: outcome.refused } };
    }

    case 'changeStatus': {
      const outcome = await transaction(ctx, (tx) =>
        ticketService.applyAutomatedChange(
          ctx,
          tx,
          requireTicket(run),
          { status: { status: node.status, ...(node.reason ? { reason: node.reason } : {}) } },
          provenanceFor(run),
        ),
      );
      // A refused transition is reported in the output rather than thrown: the
      // state machine is the authority on what a ticket may do, and a workflow
      // asking for the impossible is a definition to fix, not an outage.
      return { output: { status: node.status, applied: outcome.statusChanged !== null, refused: outcome.refused } };
    }

    case 'createTask': {
      const title = renderStrict(node.title, context);
      const assigneeId = node.assigneeId ? renderStrict(node.assigneeId, context) : null;
      const ticketId = requireTicket(run);

      // A crash between creating the task and recording the step leaves a task
      // with no output to point at it. The retry finds it by the step's own
      // recorded output if there is one, and otherwise by the task key on this
      // ticket — so a restart adds a duplicate task only if the first attempt
      // never got as far as the database, which is the one case where there is
      // nothing to duplicate.
      const alreadyMade = input.previousOutput?.taskId;
      if (typeof alreadyMade === 'string') {
        return { output: { taskId: alreadyMade, taskKey: node.taskKey, title, deduplicated: true } };
      }

      const taskId = await transaction(ctx, async (tx) => {
        const existing = await tx.ticketTask.findFirst({ where: { ticketId, key: node.taskKey } });
        if (existing) return existing.id;
        const created = await tx.ticketTask.create({
          data: {
            id: newId(),
            tenantId: ctx.tenantId,
            ticketId,
            key: node.taskKey,
            title: title.slice(0, 200),
            status: 'open',
            assigneeId,
            groupId: node.groupId ?? null,
          },
        });
        return created.id;
      });
      return { output: { taskId, taskKey: node.taskKey, title } };
    }

    case 'approval': {
      const ticketId = run.ticketId;
      const request = await transaction(ctx, (tx) =>
        approvalService.requestApproval(ctx, tx, {
          subjectType: 'workflow_run',
          subjectId: run.id,
          ticketId: ticketId ?? null,
          facts: { ...context, policyKey: node.policyKey },
        }),
      );
      if (!request) {
        // No policy matched, so there is nobody to ask. Continuing is the only
        // sensible reading: an approval step whose policy was deleted must not
        // strand the run for ever, and refusing silently would be worse.
        return { output: { decision: 'not_required', reason: `no approval policy matched ${node.policyKey}` } };
      }
      await parkOnApproval(ctx, run.id, node.key, request.id, node.onTimeoutKey ?? null);
      return { output: { approvalId: request.id, decision: null }, parked: true };
    }

    case 'wait': {
      await parkOnWait(ctx, run.id, node);
      return { output: { waiting: node.duration ?? node.event }, parked: true };
    }

    case 'notify': {
      // Through the notifications service, not by writing rows: quiet hours,
      // digests and per-person preferences all live behind it, and a workflow
      // that could notify around somebody's preferences would be the most
      // annoying feature in the product.
      //
      // The dispatch is keyed by (eventId, recipient, ruleKey), so passing the
      // step's idempotency key as the event id makes a retry after a crash
      // deduplicate against whatever the first attempt queued.
      const ticketId = requireTicket(run);
      const queued = await transaction(ctx, (tx) =>
        notificationService.queueFromRule(ctx, tx, {
          ticketId,
          template: node.template,
          to: node.to,
          eventId: run.id,
          ruleKey: `workflow:${run.definitionKey}:${node.key}`,
        }),
      );
      return { output: { template: node.template, to: node.to, queued } };
    }

    case 'action':
      // Refused at publish (NODES_NOT_YET_AVAILABLE), so reaching here means a
      // definition published before that check existed.
      throw new ValidationError(
        `${node.key} is an action step, which arrives with MOD-06-E2 in PH-4; this run cannot carry it out`,
      );

    case 'end':
      return { output: { status: node.status ?? 'completed' } };
  }
};

/**
 * The dry-run registry.
 *
 * Every node records what it would have done and returns a plausible output, so
 * the graph is traversed exactly as it would be live. Approvals and waits
 * resolve immediately — a rehearsal that parked for five days would not be a
 * rehearsal — with the stub outcome the caller chose.
 */
export function dryRunExecutor(
  trace: { stepKey: string; type: string; would: Record<string, unknown> }[],
  stubs: { approvalDecision?: string } = {},
): StepExecutor {
  return async (_ctx, input) => {
    const { node, context } = input;
    const record = (would: Record<string, unknown>): NodeOutcome => {
      trace.push({ stepKey: node.key, type: node.type, would });
      return { output: would };
    };

    switch (node.type) {
      case 'condition':
        return record({ result: safeEvaluate(node.when, context) });
      case 'setField':
        return record({ field: node.field, value: renderOrExplain(node.value, context) });
      case 'assign':
        return record({
          groupId: node.groupId ?? null,
          assigneeId: node.assigneeId ? renderOrExplain(node.assigneeId, context) : null,
        });
      case 'changeStatus':
        return record({ status: node.status });
      case 'createTask':
        return record({ taskKey: node.taskKey, title: renderOrExplain(node.title, context) });
      case 'approval':
        // Resolved rather than parked, so the trace shows what happens after.
        return record({ policyKey: node.policyKey, decision: stubs.approvalDecision ?? 'approved' });
      case 'wait':
        return record({ waitedFor: node.duration ?? node.event, resolved: 'immediately, in a dry run' });
      case 'notify':
        return record({ template: node.template, to: node.to });
      case 'action':
        return record({ action: node.action, refused: 'action steps arrive with MOD-06-E2 (PH-4)' });
      case 'end':
        return record({ status: node.status ?? 'completed' });
    }
  };
}

function safeEvaluate(when: Parameters<typeof evaluate>[0], context: EvalContext): boolean | string {
  try {
    return evaluate(when, context);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** Renders, or returns the explanation, so a dry run shows the problem rather than throwing. */
function renderOrExplain(template: string, context: EvalContext): string {
  try {
    return renderStrict(template, context);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

async function parkOnApproval(
  ctx: TenantContext,
  runId: string,
  stepKey: string,
  approvalId: string,
  onTimeoutKey: string | null,
): Promise<void> {
  await transaction(ctx, async (tx) => {
    const existing = await tx.workflowWait.findFirst({ where: { runId, stepKey } });
    if (existing) return;
    await tx.workflowWait.create({
      data: {
        id: newId(),
        tenantId: ctx.tenantId,
        runId,
        stepKey,
        kind: 'event',
        eventType: 'approval.decided',
        eventFilter: { eq: [{ var: 'approvalId' }, approvalId] } as never,
        onTimeoutKey,
        status: 'waiting',
      },
    });
  });
}

async function parkOnWait(ctx: TenantContext, runId: string, node: Extract<WorkflowNode, { type: 'wait' }>): Promise<void> {
  await transaction(ctx, async (tx) => {
    const existing = await tx.workflowWait.findFirst({ where: { runId, stepKey: node.key } });
    if (existing) return;

    const dueAt = node.duration
      ? new Date(Date.now() + parseDuration(node.duration))
      : node.timeout
        ? new Date(Date.now() + parseDuration(node.timeout))
        : null;

    await tx.workflowWait.create({
      data: {
        id: newId(),
        tenantId: ctx.tenantId,
        runId,
        stepKey: node.key,
        kind: node.duration ? 'timer' : 'event',
        eventType: node.event ?? null,
        eventFilter: (node.when ?? null) as never,
        dueAt,
        onTimeoutKey: node.onTimeoutKey ?? null,
        status: 'waiting',
      },
    });
  });
}
