import { defineJob, enqueue, logger, transaction } from '@itsm/platform';
import type { EvalContext } from '@itsm/expr';
import { parseGraph } from '../domain/definition.js';
import { nextKeys } from '../domain/graph.js';
import { advance } from '../service/runtime.js';

/**
 * The engine's worker: one step per job (ADR-0009).
 *
 * One step rather than a loop, so that a long workflow is many short jobs. A
 * job that ran a whole workflow would hold a worker for as long as the slowest
 * thing in it, retry the whole graph on a failure at step nine, and be
 * impossible to observe halfway through.
 */
defineJob<{ runId: string; stepKey: string }>('workflow', 'workflow.advance', async (payload, { ctx }) => {
  const result = await advance(ctx, { runId: payload.runId, stepKey: payload.stepKey });

  for (const key of result.next) {
    // The job id makes a re-delivery of the same transition idempotent at the
    // queue as well as in the database.
    await enqueue(ctx, 'workflow', 'workflow.advance', { runId: payload.runId, stepKey: key }, {
      jobId: `${payload.runId}-${key}`,
    });
  }

  logger.debug('workflow step advanced', {
    runId: payload.runId,
    stepKey: payload.stepKey,
    status: result.status,
    next: result.next,
  });
});

/**
 * Resumes a run whose wait has been satisfied.
 *
 * It does not re-run the parked step — that would park it again — but computes
 * the step's edges and enqueues what comes next, with whatever woke it merged
 * into the run context so a later condition can read it.
 */
defineJob<{ runId: string; stepKey: string; woken?: Record<string, unknown> }>(
  'workflow',
  'workflow.resume',
  async (payload, { ctx }) => {
    const next = await transaction(ctx, async (tx) => {
      const run = await tx.workflowRun.findFirst({ where: { id: payload.runId } });
      if (!run || run.status === 'cancelled' || run.status === 'completed') return [];

      const version = await tx.workflowVersion.findFirst({ where: { id: run.versionId } });
      if (!version) return [];

      const graph = parseGraph(version.graph);
      const existing = (run.context ?? {}) as EvalContext;
      const stepOutput = { ...(existing[payload.stepKey] as Record<string, unknown> | undefined), ...(payload.woken ?? {}) };
      const context: EvalContext = { ...existing, [payload.stepKey]: stepOutput };

      const { keys } = nextKeys(graph, payload.stepKey, context);
      await tx.workflowRun.update({
        where: { id: run.id },
        data: {
          status: keys.length > 0 ? 'running' : 'completed',
          context: context as never,
          currentKeys: keys,
          ...(keys.length === 0 ? { endedAt: new Date() } : {}),
        },
      });
      return keys;
    });

    for (const key of next) {
      await enqueue(ctx, 'workflow', 'workflow.advance', { runId: payload.runId, stepKey: key }, {
        jobId: `${payload.runId}-${key}`,
      });
    }
  },
);

/**
 * Re-schedules timers that Redis has forgotten.
 *
 * `wf_wait` is in PostgreSQL because Redis is a scheduler, not a system of
 * record. This sweep is what makes that true in practice: after a flush or a
 * restart, a timer that was due and has no job is picked up here rather than
 * leaving a run parked for ever.
 */
defineJob<Record<string, never>>('workflow', 'workflow.timers', async (_payload, { ctx }) => {
  const due = await transaction(ctx, (tx) =>
    tx.workflowWait.findMany({
      where: { status: 'waiting', dueAt: { lte: new Date() } },
      orderBy: { dueAt: 'asc' },
      take: 200,
    }),
  );

  for (const wait of due) {
    await transaction(ctx, (tx) =>
      tx.workflowWait.update({ where: { id: wait.id }, data: { status: 'resolved', resolvedAt: new Date() } }),
    );
    await transaction(ctx, (tx) =>
      tx.workflowStepRun.updateMany({
        where: { runId: wait.runId, stepKey: wait.stepKey, status: 'started' },
        data: { status: 'done', endedAt: new Date() },
      }),
    );

    // An event wait that timed out goes to its timeout branch if it has one,
    // and otherwise carries on down its ordinary edges. Both are better than
    // sitting there.
    if (wait.onTimeoutKey) {
      await enqueue(ctx, 'workflow', 'workflow.advance', { runId: wait.runId, stepKey: wait.onTimeoutKey });
    } else {
      await enqueue(ctx, 'workflow', 'workflow.resume', {
        runId: wait.runId,
        stepKey: wait.stepKey,
        woken: { timedOut: true },
      });
    }
  }

  if (due.length > 0) logger.info('workflow timers fired', { tenantId: ctx.tenantId, count: due.length });
});
