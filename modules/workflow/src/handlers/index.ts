import { defineHandler, enqueue, logger, transaction } from '@itsm/platform';
import { evaluate, type EvalContext } from '@itsm/expr';
import { parseGraph } from '../domain/definition.js';
import { startRun, triggerMatches } from '../service/workflow-service.js';

/**
 * What starts and wakes a workflow.
 *
 * Two jobs, both driven by the outbox so they are exactly-once per event: start
 * a run whose trigger matches, and wake a run parked on an event it was waiting
 * for. A workflow engine that polled for either would be simpler to write and
 * would lose runs on the day the poll interval mattered.
 */

/** Events a workflow may be triggered by, or park on. */
const TRIGGERING_EVENTS = [
  'ticket.created',
  'ticket.updated',
  'ticket.status.changed',
  'ticket.comment.added',
  'ticket.task.completed',
  'request.submitted',
  'approval.decided',
  'sla.timer.breached',
] as const;

for (const eventType of TRIGGERING_EVENTS) {
  defineHandler({
    consumer: 'workflow',
    moduleId: 'MOD-06-E1',
    eventType,
    required: false,
    async handle(ctx, event, tx) {
      const facts = factsFor(eventType, event.payload as Record<string, unknown>);

      // ---- start runs whose trigger matches --------------------------------
      const published = await tx.workflowDefinition.findMany({ where: { status: 'published' } });
      for (const definition of published) {
        if (!definition.currentVersionId) continue;
        const version = await tx.workflowVersion.findFirst({ where: { id: definition.currentVersionId } });
        if (!version) continue;

        const graph = parseGraph(version.graph);
        if (!triggerMatches(graph, eventType, facts)) continue;

        await startRun(ctx, tx, {
          key: definition.key,
          ticketId: (event.payload as { ticketId?: string }).ticketId ?? null,
          context: facts,
          triggeredBy: `event:${eventType}`,
          dedupeOn: { eventId: event.id },
        });
      }

      // ---- wake runs parked on this event ----------------------------------
      await wakeWaiting(ctx, tx, eventType, facts);
    },
  });
}

/**
 * Wakes every run parked on this event whose filter matches.
 *
 * The filter is what stops one ticket's comment waking a run waiting for a
 * different ticket's. Without it a busy tenant would advance every parked run
 * on every event, which looks like the engine working until somebody checks
 * what it actually did.
 */
async function wakeWaiting(
  ctx: Parameters<typeof startRun>[0],
  tx: Parameters<typeof startRun>[1],
  eventType: string,
  facts: EvalContext,
): Promise<void> {
  const waiting = await tx.workflowWait.findMany({ where: { status: 'waiting', eventType } });

  for (const wait of waiting) {
    if (wait.eventFilter) {
      let matches = false;
      try {
        matches = evaluate(wait.eventFilter as never, facts);
      } catch (error) {
        logger.warn('a workflow wait filter could not be evaluated', {
          runId: wait.runId,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
      if (!matches) continue;
    }

    await tx.workflowWait.update({ where: { id: wait.id }, data: { status: 'resolved', resolvedAt: new Date() } });

    // The parked step is finished, so the run resumes from the step's edges
    // rather than re-running the step. Re-running a `wait` would park it again
    // and the run would never move.
    await tx.workflowStepRun.updateMany({
      where: { runId: wait.runId, stepKey: wait.stepKey, status: 'started' },
      data: { status: 'done', endedAt: new Date() },
    });

    await enqueue(ctx, 'workflow', 'workflow.resume', { runId: wait.runId, stepKey: wait.stepKey, woken: facts });
  }
}

/**
 * The facts a trigger condition and a wait filter read.
 *
 * Flattened from the event payload and namespaced, so `{ eq: [{var:'ticketId'},
 * …] }` in a wait filter reads the same field the payload carries.
 */
function factsFor(eventType: string, payload: Record<string, unknown>): EvalContext {
  return { ...payload, event: { type: eventType }, now: new Date().toISOString() };
}
