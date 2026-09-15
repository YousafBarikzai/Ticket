import { createHash } from 'node:crypto';
import {
  type TenantContext,
  type Tx,
  logger,
  metrics,
  newId,
  publish,
  recordAudit,
  transaction,
} from '@itsm/platform';
import { events } from '@itsm/contracts';
import type { EvalContext } from '@itsm/expr';
import { nextKeys, nodesByKey } from '../domain/graph.js';
import { PARKING_NODES, TERMINAL_NODES, parseGraph, type WorkflowGraph, type WorkflowNode } from '../domain/definition.js';
import { executeNode, type NodeOutcome, type StepExecutor } from './executors.js';

/**
 * The workflow executor (ADR-0009, docs/architecture/11 §3).
 *
 * One step per job, in three transactions with a durable marker between them:
 *
 *   1. **Claim** — insert `wf_step_run(status = 'started')`. The unique
 *      constraint on (run, step, attempt) is the whole concurrency control: a
 *      second worker that reaches the same step fails the insert and stops. No
 *      locks, no leases, no clock.
 *   2. **Execute** — perform the side effect, outside any transaction, with an
 *      idempotency key that is stable across attempts.
 *   3. **Record** — write the output, work out the next nodes, enqueue them.
 *
 * A worker killed during step 2 leaves a `started` row. The retry sees the
 * marker, and re-executes with the *same* idempotency key, so whatever it did
 * the first time deduplicates rather than happening twice. That asymmetry is
 * the entire design: the engine promises at-least-once execution and derives
 * exactly-once *effects* from the key, because a distributed system cannot
 * promise the first thing and a person cannot tolerate the second.
 */

export interface AdvanceRequest {
  runId: string;
  stepKey: string;
  attempt?: number;
}

export interface AdvanceResult {
  status: 'done' | 'parked' | 'ended' | 'failed' | 'skipped';
  runStatus: string;
  next: string[];
  error?: string;
}

/**
 * The idempotency key for a step.
 *
 * Deliberately independent of `attempt`: a retry after a crash must present the
 * same key as the attempt that may already have had half an effect. Including
 * the attempt would make every retry a fresh request to the outside world,
 * which is exactly the duplicate this is here to prevent.
 */
export function idempotencyKeyFor(runId: string, stepKey: string): string {
  return createHash('sha256').update(`${runId}:${stepKey}`).digest('hex').slice(0, 32);
}

const MAX_ATTEMPTS = 5;

export async function advance(
  ctx: TenantContext,
  request: AdvanceRequest,
  executor: StepExecutor = executeNode,
): Promise<AdvanceResult> {
  // ---- 1. Claim -----------------------------------------------------------
  const claim = await transaction(ctx, async (tx) => {
    const run = await tx.workflowRun.findFirst({ where: { id: request.runId } });
    if (!run) return { kind: 'gone' as const };
    if (run.status === 'cancelled' || run.status === 'completed') return { kind: 'finished' as const, run };

    const version = await tx.workflowVersion.findFirst({ where: { id: run.versionId } });
    if (!version) return { kind: 'gone' as const };
    const definition = await tx.workflowDefinition.findFirst({ where: { id: run.definitionId } });
    if (!definition) return { kind: 'gone' as const };

    const graph = parseGraph(version.graph);
    const node = nodesByKey(graph).get(request.stepKey);
    if (!node) return { kind: 'unknown-node' as const, run };

    const attempt = request.attempt ?? (await nextAttempt(tx, run.id, request.stepKey));
    if (attempt > MAX_ATTEMPTS) return { kind: 'exhausted' as const, run, node, graph, attempt };

    const idempotencyKey = idempotencyKeyFor(run.id, request.stepKey);
    const context = (run.context ?? {}) as EvalContext;

    // What a previous attempt produced, so a step that is naturally hard to
    // repeat can recognise its own half-finished work.
    const previous = await tx.workflowStepRun.findFirst({
      where: { runId: run.id, stepKey: request.stepKey, attempt: { lt: attempt } },
      orderBy: { attempt: 'desc' },
    });

    return {
      kind: 'claimed' as const,
      run,
      node,
      graph,
      attempt,
      idempotencyKey,
      context,
      stepRun: {
        id: run.id,
        ticketId: run.ticketId,
        definitionId: run.definitionId,
        definitionKey: definition.key,
        version: version.version,
      },
      previousOutput: (previous?.output ?? undefined) as Record<string, unknown> | undefined,
    };
  });

  if (claim.kind === 'gone') return { status: 'skipped', runStatus: 'gone', next: [] };
  if (claim.kind === 'finished') return { status: 'skipped', runStatus: claim.run.status, next: [] };
  if (claim.kind === 'unknown-node') {
    return failRun(ctx, claim.run.id, `the workflow has no step called ${request.stepKey}`);
  }
  if (claim.kind === 'exhausted') {
    return failRun(ctx, claim.run.id, `${request.stepKey} failed ${MAX_ATTEMPTS} times and was not retried again`);
  }

  // ---- 1b. Claim, in a transaction of its own ------------------------------
  // Separate on purpose. In PostgreSQL a failed statement aborts the whole
  // surrounding transaction, so losing the race on the unique constraint from
  // inside the read transaction would poison every statement after it,
  // including the commit — the same trap the Phase 2 tenant purge fell into.
  // Here, losing the race spoils nothing but its own transaction.
  const claimed = await transaction(ctx, async (tx) => {
    await tx.workflowStepRun.create({
      data: {
        id: newId(),
        tenantId: ctx.tenantId,
        runId: claim.run.id,
        stepKey: request.stepKey,
        attempt: claim.attempt,
        status: 'started',
        input: { node: claim.node.type } as never,
        idempotencyKey: claim.idempotencyKey,
      },
    });
    return true;
  }).catch(() => false);

  if (!claimed) {
    // Somebody else has this exact attempt. Theirs, not ours.
    return { status: 'skipped', runStatus: claim.run.status, next: [] };
  }

  if (claim.run.status !== 'running') {
    await transaction(ctx, (tx) =>
      tx.workflowRun.update({ where: { id: claim.run.id }, data: { status: 'running' } }),
    );
  }

  // ---- 2. Execute ---------------------------------------------------------
  // Outside a transaction on purpose. A side effect that reaches another system
  // cannot be rolled back by the database, so holding a transaction open across
  // it buys nothing and holds a connection for as long as the slowest thing the
  // workflow touches.
  let outcome: NodeOutcome;
  try {
    outcome = await executor(ctx, {
      node: claim.node,
      run: claim.stepRun,
      context: claim.context,
      idempotencyKey: claim.idempotencyKey,
      ...(claim.previousOutput ? { previousOutput: claim.previousOutput } : {}),
    });
  } catch (error) {
    return recordFailure(ctx, claim.run.id, request.stepKey, claim.attempt, error);
  }

  // ---- 3. Record ----------------------------------------------------------
  return transaction(ctx, async (tx) => {
    const step = await tx.workflowStepRun.findFirst({
      where: { runId: claim.run.id, stepKey: request.stepKey, attempt: claim.attempt },
    });
    if (step) {
      await tx.workflowStepRun.update({
        where: { id: step.id },
        data: { status: 'done', output: outcome.output as never, endedAt: new Date() },
      });
    }

    // A node's output is addressed by its key, so a later condition reads
    // `approve.decision` without the graph having to declare a variable.
    const context: EvalContext = { ...claim.context, [request.stepKey]: outcome.output };

    if (outcome.parked) {
      await tx.workflowRun.update({
        where: { id: claim.run.id },
        data: { status: 'waiting', context: context as never, currentKeys: [request.stepKey] },
      });
      metrics.increment('workflow_steps_total', { node: claim.node.type, result: 'parked' });
      return { status: 'parked' as const, runStatus: 'waiting', next: [] };
    }

    if (TERMINAL_NODES.has(claim.node.type)) {
      await tx.workflowRun.update({
        where: { id: claim.run.id },
        data: { status: 'completed', context: context as never, currentKeys: [], endedAt: new Date() },
      });
      await recordAudit(tx, ctx, {
        action: 'workflow.run.completed',
        targetType: 'workflow_run',
        targetId: claim.run.id,
        after: { lastStep: request.stepKey },
      });
      await publish(tx, ctx, {
        definition: events.workflowRunCompleted,
        aggregateId: claim.run.id,
        payload: { runId: claim.run.id, definitionId: claim.run.definitionId, ticketId: claim.run.ticketId, status: 'completed' },
      });
      metrics.increment('workflow_runs_total', { result: 'completed' });
      return { status: 'ended' as const, runStatus: 'completed', next: [] };
    }

    const { keys, errors } = nextKeys(claim.graph, request.stepKey, context);
    if (errors.length > 0) {
      logger.warn('a workflow edge condition could not be evaluated', { runId: claim.run.id, errors });
    }

    if (keys.length === 0) {
      // Validation refuses a dead end at publish, so reaching one means the run
      // is on an older version published before that check, or a condition
      // refused every branch. Either way the run stops visibly rather than
      // sitting in `running` for ever.
      await tx.workflowRun.update({
        where: { id: claim.run.id },
        data: {
          status: 'completed',
          context: context as never,
          currentKeys: [],
          endedAt: new Date(),
          error: errors.length > 0 ? errors.join('; ') : null,
        },
      });
      return { status: 'ended' as const, runStatus: 'completed', next: [] };
    }

    await tx.workflowRun.update({
      where: { id: claim.run.id },
      data: { status: 'running', context: context as never, currentKeys: keys },
    });

    metrics.increment('workflow_steps_total', { node: claim.node.type, result: 'done' });
    return { status: 'done' as const, runStatus: 'running', next: keys };
  });
}

async function nextAttempt(tx: Tx, runId: string, stepKey: string): Promise<number> {
  const latest = await tx.workflowStepRun.findFirst({
    where: { runId, stepKey },
    orderBy: { attempt: 'desc' },
  });
  if (!latest) return 1;
  // A step already done is not re-run: this is the marker that makes a restart
  // safe to repeat rather than expensive.
  return latest.status === 'done' ? latest.attempt : latest.attempt + 1;
}

async function recordFailure(
  ctx: TenantContext,
  runId: string,
  stepKey: string,
  attempt: number,
  error: unknown,
): Promise<AdvanceResult> {
  const message = error instanceof Error ? error.message : String(error);

  return transaction(ctx, async (tx) => {
    const step = await tx.workflowStepRun.findFirst({ where: { runId, stepKey, attempt } });
    if (step) {
      await tx.workflowStepRun.update({
        where: { id: step.id },
        data: { status: 'failed', error: message, endedAt: new Date() },
      });
    }

    // The run pauses rather than dying: a failed step is usually somebody
    // else's outage, and an operator retrying it is the normal resolution.
    await tx.workflowRun.update({
      where: { id: runId },
      data: { status: 'failed', error: message, currentKeys: [stepKey] },
    });

    const run = await tx.workflowRun.findFirst({ where: { id: runId } });
    if (run) {
      await publish(tx, ctx, {
        definition: events.workflowRunFailed,
        aggregateId: runId,
        payload: { runId, definitionId: run.definitionId, ticketId: run.ticketId, stepKey, error: message },
      });
    }

    logger.warn('a workflow step failed', { runId, stepKey, attempt, reason: message });
    metrics.increment('workflow_steps_total', { node: 'unknown', result: 'failed' });
    return { status: 'failed' as const, runStatus: 'failed', next: [], error: message };
  });
}

async function failRun(ctx: TenantContext, runId: string, message: string): Promise<AdvanceResult> {
  return transaction(ctx, async (tx) => {
    await tx.workflowRun.update({ where: { id: runId }, data: { status: 'failed', error: message } });
    return { status: 'failed' as const, runStatus: 'failed', next: [], error: message };
  });
}

export { PARKING_NODES };
export type { WorkflowGraph, WorkflowNode };
