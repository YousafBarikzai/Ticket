import { z } from 'zod';
import {
  type TenantContext,
  type Tx,
  ConflictError,
  NotFoundError,
  ValidationError,
  authz,
  enqueue,
  logger,
  newId,
  publish,
  recordAudit,
  transaction,
} from '@itsm/platform';
import { events } from '@itsm/contracts';
import { evaluate, type EvalContext } from '@itsm/expr';
import { graphSchema, parseGraph, type WorkflowGraph } from '../domain/definition.js';
import { unresolvedPaths, validateGraph, type GraphProblem } from '../domain/graph.js';
import { advance } from './runtime.js';
import { dryRunExecutor } from './executors.js';

/**
 * MOD-06-E1 workflow administration.
 *
 * The same versioned-definition lifecycle as rules, forms and SLA policies
 * (docs/architecture/05 §8), with one difference that matters: a workflow run
 * takes minutes or days, so publishing a new version must not change what is
 * already in flight. A run is pinned to the version it started on, and rollback
 * is a forward publish. The alternative — runs picking up whichever graph is
 * current — means a person's request finishes under rules nobody chose for it.
 */

export const definitionSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9-]{1,62}$/),
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  graph: graphSchema,
  changeNote: z.string().max(500).optional(),
});

/**
 * The context paths a run provides, for validating `{{…}}` before publication.
 *
 * Node outputs are handled separately in `unresolvedPaths`, addressed by node
 * key, so this is only what the trigger puts there.
 */
export const RUN_FACTS = ['ticket', 'requester', 'answers', 'event', 'now', 'run'] as const;

export async function listWorkflows(ctx: TenantContext, filter: { status?: string } = {}) {
  authz.require(ctx, 'workflow.read');
  return transaction(ctx, (tx) =>
    tx.workflowDefinition.findMany({
      where: filter.status ? { status: filter.status } : {},
      orderBy: { updatedAt: 'desc' },
      take: 200,
    }),
  );
}

export async function getWorkflow(ctx: TenantContext, key: string) {
  authz.require(ctx, 'workflow.read');
  return transaction(ctx, async (tx) => {
    const definition = await load(tx, key);
    const versions = await tx.workflowVersion.findMany({
      where: { definitionId: definition.id },
      orderBy: { version: 'desc' },
    });
    return {
      key: definition.key,
      name: definition.name,
      status: definition.status,
      versions: versions.map((version) => ({
        version: version.version,
        status: version.status,
        changeNote: version.changeNote,
        publishedAt: version.publishedAt,
        isCurrent: version.id === definition.currentVersionId,
      })),
      graph: versions[0]?.graph ?? null,
    };
  });
}

export async function createWorkflow(ctx: TenantContext, input: unknown) {
  authz.require(ctx, 'workflow.manage');
  const parsed = definitionSchema.parse(input);

  return transaction(ctx, async (tx) => {
    const existing = await tx.workflowDefinition.findFirst({ where: { key: parsed.key } });
    if (existing) throw new ConflictError(`a workflow with the key ${parsed.key} already exists`);

    const definitionId = newId();
    const definition = await tx.workflowDefinition.create({
      data: {
        id: definitionId,
        tenantId: ctx.tenantId,
        key: parsed.key,
        name: parsed.name,
        description: parsed.description ?? null,
        status: 'draft',
        ownerId: ctx.actor.id ?? null,
      },
    });

    await tx.workflowVersion.create({
      data: {
        id: newId(),
        tenantId: ctx.tenantId,
        definitionId,
        version: 1,
        graph: parsed.graph as never,
        status: 'draft',
        changeNote: parsed.changeNote ?? null,
      },
    });

    await recordAudit(tx, ctx, {
      action: 'workflow.created',
      targetType: 'workflow',
      targetId: definitionId,
      after: { key: parsed.key, name: parsed.name, nodes: parsed.graph.nodes.length },
    });

    return definition;
  });
}

export async function saveDraft(ctx: TenantContext, key: string, graph: unknown, changeNote?: string) {
  authz.require(ctx, 'workflow.manage');
  const parsed = parseGraph(graph);

  return transaction(ctx, async (tx) => {
    const definition = await load(tx, key);
    const draft = await draftFor(tx, ctx, definition);

    const updated = await tx.workflowVersion.update({
      where: { id: draft.id },
      data: { graph: parsed as never, changeNote: changeNote ?? draft.changeNote },
    });

    await recordAudit(tx, ctx, {
      action: 'workflow.draft.saved',
      targetType: 'workflow',
      targetId: definition.id,
      after: { version: updated.version, nodes: parsed.nodes.length },
    });

    return { version: updated.version, problems: checkGraph(parsed) };
  });
}

/**
 * Renames a workflow, or changes what it says it is for.
 *
 * Deliberately not a way to change the graph: that is `saveDraft`, and it is
 * versioned. The definition row carries only the label, so editing it is not a
 * new version and does not disturb a run already in flight.
 */
export const workflowUpdateSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    description: z.string().max(2000).nullable().optional(),
  })
  .strict();

export async function updateWorkflow(ctx: TenantContext, key: string, patch: unknown) {
  authz.require(ctx, 'workflow.manage');
  const parsed = workflowUpdateSchema.parse(patch);

  return transaction(ctx, async (tx) => {
    const definition = await load(tx, key);
    const updated = await tx.workflowDefinition.update({
      where: { id: definition.id },
      data: { name: parsed.name, description: parsed.description },
    });
    await recordAudit(tx, ctx, {
      action: 'workflow.updated',
      targetType: 'workflow',
      targetId: definition.id,
      before: { name: definition.name, description: definition.description },
      after: { name: updated.name, description: updated.description },
    });
    return updated;
  });
}

/**
 * Everything wrong with a graph, in one list.
 *
 * Exposed as its own call as well as run at publish, because an administrator
 * building a workflow wants to be told about an unreachable node while they can
 * still see why they added it.
 */
export function checkGraph(graph: WorkflowGraph): GraphProblem[] {
  return [...validateGraph(graph), ...unresolvedPaths(graph, RUN_FACTS)];
}

export async function validateWorkflow(ctx: TenantContext, key: string) {
  authz.require(ctx, 'workflow.read');
  return transaction(ctx, async (tx) => {
    const definition = await load(tx, key);
    const draft = await tx.workflowVersion.findFirst({
      where: { definitionId: definition.id },
      orderBy: { version: 'desc' },
    });
    if (!draft) throw new NotFoundError('workflow version', key);
    return { version: draft.version, problems: checkGraph(parseGraph(draft.graph)) };
  });
}

export async function publishWorkflow(ctx: TenantContext, key: string) {
  authz.require(ctx, 'workflow.publish');

  return transaction(ctx, async (tx) => {
    const definition = await load(tx, key);
    const draft = await tx.workflowVersion.findFirst({
      where: { definitionId: definition.id, status: 'draft' },
      orderBy: { version: 'desc' },
    });
    if (!draft) throw new ValidationError('there is no draft to publish; edit the workflow to start one');

    const graph = parseGraph(draft.graph);
    const problems = checkGraph(graph);
    if (problems.length > 0) {
      throw new ValidationError(
        `this workflow cannot be published yet: ${problems.map((p) => p.message).join('; ')}`,
        problems.map((problem) => ({ field: problem.where, code: problem.code, message: problem.message })),
      );
    }

    const now = new Date();
    await tx.workflowVersion.update({
      where: { id: draft.id },
      data: { status: 'published', publishedAt: now, publishedBy: ctx.actor.id ?? null },
    });
    await tx.workflowDefinition.update({
      where: { id: definition.id },
      data: { status: 'published', currentVersionId: draft.id },
    });

    await recordAudit(tx, ctx, {
      action: 'workflow.published',
      targetType: 'workflow',
      targetId: definition.id,
      before: { version: definition.currentVersionId },
      after: { version: draft.version, trigger: graph.trigger.kind },
    });

    return { key: definition.key, version: draft.version, status: 'published' };
  });
}

/** Rollback is a forward publish of an earlier version's graph. */
export async function rollbackWorkflow(ctx: TenantContext, key: string, toVersion: number) {
  authz.require(ctx, 'workflow.publish');

  return transaction(ctx, async (tx) => {
    const definition = await load(tx, key);
    const source = await tx.workflowVersion.findFirst({
      where: { definitionId: definition.id, version: toVersion, status: 'published' },
    });
    if (!source) throw new NotFoundError('workflow version', String(toVersion));

    const next = (await latestVersionNumber(tx, definition.id)) + 1;
    const now = new Date();
    const restored = await tx.workflowVersion.create({
      data: {
        id: newId(),
        tenantId: ctx.tenantId,
        definitionId: definition.id,
        version: next,
        graph: source.graph as never,
        status: 'published',
        changeNote: `Restored the graph of version ${toVersion}`,
        publishedAt: now,
        publishedBy: ctx.actor.id ?? null,
      },
    });

    await tx.workflowDefinition.update({
      where: { id: definition.id },
      data: { status: 'published', currentVersionId: restored.id },
    });

    await recordAudit(tx, ctx, {
      action: 'workflow.rolled_back',
      targetType: 'workflow',
      targetId: definition.id,
      after: { version: next, restoredFrom: toVersion },
    });

    // Runs already in flight are not moved. They finish on the version they
    // started on, which is the point of pinning them.
    return { key: definition.key, version: next, restoredFrom: toVersion };
  });
}

// ---------------------------------------------------------------------------
// Starting runs
// ---------------------------------------------------------------------------

export interface StartInput {
  key: string;
  ticketId?: string | null;
  context?: Record<string, unknown>;
  triggeredBy?: string;
  /** Set for an event trigger, so the same event cannot start two runs. */
  dedupeOn?: { eventId: string };
}

/**
 * Starts a run on the published version.
 *
 * Returns null rather than throwing when the workflow is not published or does
 * not exist: a trigger firing for a workflow somebody unpublished this morning
 * is ordinary, and taking the triggering event down with it would be worse than
 * doing nothing.
 */
export async function startRun(ctx: TenantContext, tx: Tx, input: StartInput): Promise<{ runId: string; firstStep: string } | null> {
  const definition = await tx.workflowDefinition.findFirst({ where: { key: input.key } });
  if (!definition?.currentVersionId) {
    logger.debug('a workflow trigger found no published version', { key: input.key });
    return null;
  }

  const version = await tx.workflowVersion.findFirst({ where: { id: definition.currentVersionId } });
  if (!version) return null;

  if (input.dedupeOn) {
    const existing = await tx.workflowRun.findFirst({
      where: { definitionId: definition.id, triggeredBy: `event:${input.dedupeOn.eventId}` },
    });
    if (existing) return { runId: existing.id, firstStep: '' };
  }

  const graph = parseGraph(version.graph);
  const runId = newId();

  await tx.workflowRun.create({
    data: {
      id: runId,
      tenantId: ctx.tenantId,
      definitionId: definition.id,
      versionId: version.id,
      ticketId: input.ticketId ?? null,
      status: 'queued',
      context: { ...(input.context ?? {}), run: { id: runId, workflow: definition.key } } as never,
      currentKeys: [graph.start],
      triggeredBy: input.dedupeOn ? `event:${input.dedupeOn.eventId}` : (input.triggeredBy ?? 'manual'),
    },
  });

  await publish(tx, ctx, {
    definition: events.workflowRunStarted,
    aggregateId: runId,
    payload: {
      runId,
      definitionId: definition.id,
      definitionKey: definition.key,
      version: version.version,
      ticketId: input.ticketId ?? null,
      triggeredBy: input.triggeredBy ?? 'event',
    },
  });

  // Enqueued rather than run here: the triggering transaction should commit as
  // fast as it can, and a workflow that takes thirty seconds must not be inside
  // the request that started it.
  await enqueue(ctx, 'workflow', 'workflow.advance', { runId, stepKey: graph.start });

  return { runId, firstStep: graph.start };
}

/** Whether an event trigger's `when` holds for this payload. */
export function triggerMatches(graph: WorkflowGraph, eventType: string, facts: EvalContext): boolean {
  if (graph.trigger.kind !== 'event' || graph.trigger.event !== eventType) return false;
  if (!graph.trigger.when) return true;
  try {
    return evaluate(graph.trigger.when, facts);
  } catch (error) {
    // A trigger nobody can evaluate must not start every run, nor stop every
    // other workflow from seeing the event.
    logger.warn('a workflow trigger condition could not be evaluated', {
      event: eventType,
      reason: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

// ---------------------------------------------------------------------------
// Test mode
// ---------------------------------------------------------------------------

export interface DryRunStep {
  stepKey: string;
  type: string;
  would: Record<string, unknown>;
}

/**
 * Walks the graph with a registry that writes nothing.
 *
 * It is the same `nextKeys` and the same node set as the live path, so the
 * order the rehearsal takes is the order a real run would take. What differs is
 * only the registry: every step records what it would have done. Waits and
 * approvals resolve at once, because a rehearsal that parked for five days
 * would not be a rehearsal.
 */
export async function dryRun(
  ctx: TenantContext,
  key: string,
  seed: Record<string, unknown> = {},
  stubs: { approvalDecision?: string } = {},
): Promise<{ trace: DryRunStep[]; problems: GraphProblem[]; stoppedBecause?: string }> {
  authz.require(ctx, 'workflow.read');

  const { graph } = await transaction(ctx, async (tx) => {
    const definition = await load(tx, key);
    const version = await tx.workflowVersion.findFirst({
      where: { definitionId: definition.id },
      orderBy: { version: 'desc' },
    });
    if (!version) throw new NotFoundError('workflow version', key);
    return { graph: parseGraph(version.graph) };
  });

  const problems = checkGraph(graph);
  const trace: DryRunStep[] = [];
  const executor = dryRunExecutor(trace, stubs);

  let context: EvalContext = { ...seed, now: new Date().toISOString(), run: { id: 'dry-run', workflow: key } };
  let current = graph.start;
  const visits = new Map<string, number>();
  let stoppedBecause: string | undefined;

  for (let step = 0; step < 200; step += 1) {
    const node = graph.nodes.find((n) => n.key === current);
    if (!node) {
      stoppedBecause = `${current} is not a node`;
      break;
    }

    const seen = (visits.get(current) ?? 0) + 1;
    visits.set(current, seen);
    if (seen > 10) {
      // A loop is legitimate; a rehearsal going round it fifty times is not
      // informative. Stopping and saying so beats a trace nobody reads.
      stoppedBecause = `${current} ran ten times; the rehearsal stopped rather than looping further`;
      break;
    }

    const outcome = await executor(ctx, {
      node,
      run: { id: 'dry-run', ticketId: null, definitionId: 'dry-run', definitionKey: key, version: 0 },
      context,
      idempotencyKey: `dry-run:${current}`,
    });
    context = { ...context, [current]: outcome.output };

    if (node.type === 'end') break;

    const { keys, errors } = (await import('../domain/graph.js')).nextKeys(graph, current, context);
    if (errors.length > 0) trace.push({ stepKey: current, type: 'edge', would: { errors } });
    if (keys.length === 0) {
      stoppedBecause = `no branch out of ${current} applied`;
      break;
    }
    // A rehearsal follows one path; a fork is reported so the reader knows the
    // trace is one of several.
    if (keys.length > 1) trace.push({ stepKey: current, type: 'fork', would: { branches: keys } });
    current = keys[0]!;
  }

  return { trace, problems, ...(stoppedBecause ? { stoppedBecause } : {}) };
}

// ---------------------------------------------------------------------------
// Operating a run
// ---------------------------------------------------------------------------

export async function listRuns(ctx: TenantContext, filter: { status?: string; ticketId?: string; limit?: number } = {}) {
  authz.require(ctx, 'workflow.read');
  return transaction(ctx, (tx) =>
    tx.workflowRun.findMany({
      where: {
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.ticketId ? { ticketId: filter.ticketId } : {}),
      },
      orderBy: { startedAt: 'desc' },
      take: Math.min(filter.limit ?? 50, 200),
    }),
  );
}

export async function getRun(ctx: TenantContext, runId: string) {
  authz.require(ctx, 'workflow.read');
  return transaction(ctx, async (tx) => {
    const run = await tx.workflowRun.findFirst({ where: { id: runId } });
    if (!run) throw new NotFoundError('workflow run', runId);
    const steps = await tx.workflowStepRun.findMany({ where: { runId }, orderBy: { startedAt: 'asc' } });
    return { ...run, steps };
  });
}

/** Retries a failed step, on a new attempt with the same idempotency key. */
export async function retryRun(ctx: TenantContext, runId: string) {
  authz.require(ctx, 'workflow.operate');

  const stepKey = await transaction(ctx, async (tx) => {
    const run = await tx.workflowRun.findFirst({ where: { id: runId } });
    if (!run) throw new NotFoundError('workflow run', runId);
    if (run.status !== 'failed') throw new ValidationError('only a failed run can be retried');
    const key = run.currentKeys[0];
    if (!key) throw new ValidationError('this run does not say which step failed');
    await tx.workflowRun.update({ where: { id: runId }, data: { status: 'running', error: null } });
    return key;
  });

  return advance(ctx, { runId, stepKey });
}

/** Skips a failed step with a reason, and carries on from its edges. */
export async function skipStep(ctx: TenantContext, runId: string, reason: string) {
  authz.require(ctx, 'workflow.operate');
  if (!reason.trim()) throw new ValidationError('skipping a step needs a reason; somebody will ask why later');

  return transaction(ctx, async (tx) => {
    const run = await tx.workflowRun.findFirst({ where: { id: runId } });
    if (!run) throw new NotFoundError('workflow run', runId);
    if (run.status !== 'failed') throw new ValidationError('only a failed run has a step to skip');

    const stepKey = run.currentKeys[0]!;
    const latest = await tx.workflowStepRun.findFirst({
      where: { runId, stepKey },
      orderBy: { attempt: 'desc' },
    });
    if (latest) {
      await tx.workflowStepRun.update({
        where: { id: latest.id },
        data: { status: 'skipped', error: `skipped: ${reason}`, endedAt: new Date() },
      });
    }

    await recordAudit(tx, ctx, {
      action: 'workflow.step.skipped',
      targetType: 'workflow_run',
      targetId: runId,
      after: { stepKey },
      reason,
    });

    const version = await tx.workflowVersion.findFirst({ where: { id: run.versionId } });
    const graph = parseGraph(version!.graph);
    const { nextKeys } = await import('../domain/graph.js');
    const { keys } = nextKeys(graph, stepKey, (run.context ?? {}) as EvalContext);

    await tx.workflowRun.update({
      where: { id: runId },
      data: { status: keys.length > 0 ? 'running' : 'completed', currentKeys: keys, error: null },
    });

    for (const key of keys) await enqueue(ctx, 'workflow', 'workflow.advance', { runId, stepKey: key });
    return { runId, skipped: stepKey, next: keys };
  });
}

export async function cancelRun(ctx: TenantContext, runId: string, reason: string) {
  authz.require(ctx, 'workflow.operate');
  return transaction(ctx, async (tx) => {
    const run = await tx.workflowRun.findFirst({ where: { id: runId } });
    if (!run) throw new NotFoundError('workflow run', runId);
    await tx.workflowRun.update({
      where: { id: runId },
      data: { status: 'cancelled', currentKeys: [], endedAt: new Date(), error: reason },
    });
    await tx.workflowWait.updateMany({ where: { runId, status: 'waiting' }, data: { status: 'cancelled' } });
    await recordAudit(tx, ctx, {
      action: 'workflow.run.cancelled',
      targetType: 'workflow_run',
      targetId: runId,
      reason,
    });
    return { runId, status: 'cancelled' };
  });
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

async function load(tx: Tx, key: string) {
  const definition = await tx.workflowDefinition.findFirst({ where: { key } });
  if (!definition) throw new NotFoundError('workflow', key);
  return definition;
}

async function latestVersionNumber(tx: Tx, definitionId: string): Promise<number> {
  const latest = await tx.workflowVersion.findFirst({ where: { definitionId }, orderBy: { version: 'desc' } });
  return latest?.version ?? 0;
}

async function draftFor(tx: Tx, ctx: TenantContext, definition: { id: string; currentVersionId: string | null }) {
  const existing = await tx.workflowVersion.findFirst({
    where: { definitionId: definition.id, status: 'draft' },
    orderBy: { version: 'desc' },
  });
  if (existing) return existing;

  const published = definition.currentVersionId
    ? await tx.workflowVersion.findFirst({ where: { id: definition.currentVersionId } })
    : null;

  return tx.workflowVersion.create({
    data: {
      id: newId(),
      tenantId: ctx.tenantId,
      definitionId: definition.id,
      version: (await latestVersionNumber(tx, definition.id)) + 1,
      graph: (published?.graph ?? { schemaVersion: 1, trigger: { kind: 'manual' }, start: 'end', nodes: [{ key: 'end', type: 'end' }], edges: [] }) as never,
      status: 'draft',
    },
  });
}
