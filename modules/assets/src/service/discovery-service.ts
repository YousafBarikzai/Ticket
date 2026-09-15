import { z } from 'zod';
import { events } from '@itsm/contracts';
import {
  type TenantContext,
  type Tx,
  ConflictError,
  NotFoundError,
  ValidationError,
  authz,
  logger,
  metrics,
  newId,
  publish,
  recordAudit,
  transaction,
} from '@itsm/platform';
import { SOURCE_KINDS, isSourceKind, presetFor } from '../sources/presets.js';
import { fetchRecords, resolveSource, sourceConfigSchema, type FetchDeps } from '../sources/fetch.js';
import { isMapped, mapRecord, type MappedRecord } from '../domain/mapping.js';
import { POLICIES, flatten, reconcile, type Rule } from '../domain/reconcile.js';
import { assertAttributes, inheritedAttributes } from '../domain/attributes.js';
import { classChain } from '../repo/graph-repo.js';
import { invalidateTraversals } from './impact-service.js';

/**
 * Discovery: asking other systems what they think is out there, and doing
 * nothing about the answer without being told.
 *
 * The register stops depending on people typing, without starting to depend on
 * a feed being right. A source that could write straight through would rewrite
 * four hundred rows at three in the morning the first time somebody renamed a
 * column upstream, and the first anybody would hear of it is an impact answer
 * that is quietly wrong — which is the exact failure E1 was built to avoid.
 */

// ---- Sources ---------------------------------------------------------------

export const sourceSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_-]{1,60}$/, 'lower kebab or snake case'),
  name: z.string().min(1).max(120),
  kind: z.enum(SOURCE_KINDS),
  credentialRef: z.string().max(60).optional(),
  config: sourceConfigSchema.default({}),
  /** Null, or absent, means it runs only when somebody asks. */
  intervalMinutes: z.number().int().min(15).max(10_080).optional(),
});

export async function createSource(ctx: TenantContext, input: z.input<typeof sourceSchema>) {
  authz.require(ctx, 'discovery.manage');
  const parsed = sourceSchema.parse(input);

  // Resolved now rather than at run time, so a source with no mapping or no URL
  // is refused while somebody is still looking at the form — instead of failing
  // at two in the morning against a queue nobody is watching.
  resolveSource({
    key: parsed.key,
    kind: parsed.kind,
    credentialRef: parsed.credentialRef ?? null,
    config: parsed.config,
  });

  return transaction(ctx, async (tx) => {
    const existing = await tx.discoverySource.findFirst({ where: { key: parsed.key } });
    if (existing) throw new ConflictError(`a discovery source with the key ${parsed.key} already exists`);

    const id = newId();
    const created = await tx.discoverySource.create({
      data: {
        id,
        tenantId: ctx.tenantId,
        key: parsed.key,
        name: parsed.name,
        kind: parsed.kind,
        credentialRef: parsed.credentialRef ?? null,
        config: parsed.config as never,
        intervalMinutes: parsed.intervalMinutes ?? null,
        createdBy: ctx.actor.id,
      },
    });

    await recordAudit(tx, ctx, {
      action: 'discovery.source.created',
      targetType: 'discovery_source',
      targetId: id,
      // The credential is a name, so recording it is safe and useful.
      after: { key: parsed.key, kind: parsed.kind, credentialRef: parsed.credentialRef ?? null },
    });
    return created;
  });
}

export const updateSourceSchema = sourceSchema.partial().omit({ key: true }).extend({
  status: z.enum(['active', 'paused']).optional(),
});

export async function updateSource(ctx: TenantContext, key: string, input: z.input<typeof updateSourceSchema>) {
  authz.require(ctx, 'discovery.manage');
  const parsed = updateSourceSchema.parse(input);

  return transaction(ctx, async (tx) => {
    const source = await loadSource(tx, key);
    const config = parsed.config ?? (source.config as Record<string, unknown>);
    const kind = parsed.kind ?? source.kind;
    resolveSource({ key, kind, credentialRef: parsed.credentialRef ?? source.credentialRef, config });

    const updated = await tx.discoverySource.update({
      where: { id: source.id },
      data: {
        name: parsed.name ?? source.name,
        kind,
        credentialRef: parsed.credentialRef ?? source.credentialRef,
        config: config as never,
        intervalMinutes: parsed.intervalMinutes ?? source.intervalMinutes,
        status: parsed.status ?? source.status,
      },
    });

    await recordAudit(tx, ctx, {
      action: 'discovery.source.updated',
      targetType: 'discovery_source',
      targetId: source.id,
      before: { status: source.status, kind: source.kind },
      after: { status: updated.status, kind: updated.kind },
    });
    return updated;
  });
}

export function listSources(ctx: TenantContext) {
  authz.require(ctx, 'discovery.read');
  return transaction(ctx, (tx) => tx.discoverySource.findMany({ orderBy: { key: 'asc' } }));
}

/** What a preset knows before anybody configures anything. */
export function describeKind(kind: string) {
  if (!isSourceKind(kind)) throw new ValidationError(`${kind} is not a discovery source kind`);
  return { kind, ...presetFor(kind) };
}

/** The same for every kind, behind the same permission as the rest of this. */
export function listKinds(ctx: TenantContext) {
  authz.require(ctx, 'discovery.read');
  return SOURCE_KINDS.map((kind) => describeKind(kind));
}

async function loadSource(tx: Tx, key: string) {
  const source = await tx.discoverySource.findFirst({ where: { key } });
  if (!source) throw new NotFoundError('discovery source', key);
  return source;
}

// ---- Reconciliation rules --------------------------------------------------

export const ruleSchema = z.object({
  /** Absent applies to every source. */
  sourceKey: z.string().max(60).optional(),
  field: z.string().min(1).max(120),
  policy: z.enum(POLICIES),
});

export async function setRule(ctx: TenantContext, input: z.input<typeof ruleSchema>) {
  authz.require(ctx, 'discovery.manage');
  const parsed = ruleSchema.parse(input);

  return transaction(ctx, async (tx) => {
    const source = parsed.sourceKey ? await loadSource(tx, parsed.sourceKey) : null;
    const existing = await tx.reconciliationRule.findFirst({
      where: { sourceId: source?.id ?? null, field: parsed.field },
    });

    const rule = existing
      ? await tx.reconciliationRule.update({ where: { id: existing.id }, data: { policy: parsed.policy } })
      : await tx.reconciliationRule.create({
          data: {
            id: newId(),
            tenantId: ctx.tenantId,
            sourceId: source?.id ?? null,
            field: parsed.field,
            policy: parsed.policy,
            createdBy: ctx.actor.id,
          },
        });

    await recordAudit(tx, ctx, {
      action: 'discovery.rule.set',
      targetType: 'reconciliation_rule',
      targetId: rule.id,
      before: existing ? { policy: existing.policy } : undefined,
      // Loosening a rule is the change worth being able to find later: it is
      // how a field stops being a person's decision.
      after: { field: parsed.field, policy: parsed.policy, sourceKey: parsed.sourceKey ?? null },
    });
    return rule;
  });
}

export function listRules(ctx: TenantContext) {
  authz.require(ctx, 'discovery.read');
  return transaction(ctx, (tx) => tx.reconciliationRule.findMany({ orderBy: [{ field: 'asc' }] }));
}

// ---- Running ---------------------------------------------------------------

export interface RunResult {
  runId: string;
  status: 'completed' | 'failed';
  seen: number;
  unchanged: number;
  proposed: number;
  applied: number;
  rejected: number;
  problems: { externalKey: string | null; messages: string[] }[];
}

const CHUNK = 100;

/**
 * One pull, mapped, matched and reconciled.
 *
 * The network call happens **outside** any transaction, and the writes go in
 * chunks. A transaction held open across an HTTP call to somebody else's API is
 * a transaction whose length is decided by somebody else's API, and a slow feed
 * would hold locks until the statement timeout killed it.
 */
export async function runSource(ctx: TenantContext, key: string, deps: FetchDeps = {}): Promise<RunResult> {
  authz.require(ctx, 'discovery.manage');

  const { source, resolved, rules } = await transaction(ctx, async (tx) => {
    const found = await loadSource(tx, key);
    if (found.status !== 'active') throw new ValidationError(`the source ${key} is ${found.status}`);
    const ruleRows = await tx.reconciliationRule.findMany({});
    return {
      source: found,
      resolved: resolveSource({
        key: found.key,
        kind: found.kind,
        credentialRef: found.credentialRef,
        config: found.config,
      }),
      rules: ruleRows.map((row) => ({ sourceId: row.sourceId, field: row.field, policy: row.policy }) as Rule),
    };
  });

  const runId = newId();
  await transaction(ctx, (tx) =>
    tx.discoveryRun.create({
      data: { id: runId, tenantId: ctx.tenantId, sourceId: source.id, triggeredBy: ctx.actor.id },
    }),
  );

  const result: RunResult = {
    runId,
    status: 'completed',
    seen: 0,
    unchanged: 0,
    proposed: 0,
    applied: 0,
    rejected: 0,
    problems: [],
  };

  try {
    const { records, pages, truncated } = await fetchRecords(ctx, resolved, deps);
    result.seen = records.length;
    if (truncated) {
      // Said out loud, because a partial read makes every "not seen" conclusion
      // unsafe — and those are the conclusions somebody would act on.
      result.problems.push({
        externalKey: null,
        messages: [`the feed was longer than this run reads (${pages} pages); what follows is partial`],
      });
    }

    for (let offset = 0; offset < records.length; offset += CHUNK) {
      const chunk = records.slice(offset, offset + CHUNK);
      await transaction(ctx, async (tx) => {
        for (const record of chunk) {
          const mapped = mapRecord(resolved.mapping, record);
          if (!isMapped(mapped)) {
            result.rejected += 1;
            result.problems.push({ externalKey: null, messages: mapped.problems });
            continue;
          }
          await considerRecord(ctx, tx, { runId, source, rules, mapped, result });
        }
      });
    }
  } catch (error) {
    result.status = 'failed';
    const message = error instanceof Error ? error.message : String(error);
    logger.warn('a discovery run failed', { tenantId: ctx.tenantId, source: key, error: message });
    await finish(ctx, source.id, runId, result, message);
    metrics.increment('discovery_runs_total', { kind: source.kind, outcome: 'failed' });
    return result;
  }

  await finish(ctx, source.id, runId, result, null);
  await invalidateTraversals(ctx.tenantId);
  metrics.increment('discovery_runs_total', { kind: source.kind, outcome: 'completed' });
  metrics.observe('discovery_proposals', result.proposed, { kind: source.kind });
  return result;
}

async function considerRecord(
  ctx: TenantContext,
  tx: Tx,
  input: {
    runId: string;
    source: { id: string; key: string };
    rules: Rule[];
    mapped: MappedRecord;
    result: RunResult;
  },
): Promise<void> {
  const { runId, source, rules, mapped, result } = input;

  const existing = await tx.configurationItem.findFirst({ where: { externalKey: mapped.externalKey } });

  if (!existing) {
    await raise(ctx, tx, {
      runId,
      sourceId: source.id,
      kind: 'create_ci',
      externalKey: mapped.externalKey,
      ciId: null,
      proposed: {
        classKey: mapped.classKey,
        name: mapped.name,
        ...mapped.fields,
        attributes: mapped.attributes,
        // Shown, not applied. Accepting this creates the item; the edges it
        // claims arrive as their own proposals on the next run, once both ends
        // exist and can be checked. Creating an edge to something that is not
        // in the register yet would mean inventing the other end.
        relationships: mapped.relationships,
      },
      current: {},
      result,
    });
    return;
  }

  const incoming = flatten({ name: mapped.name, ...mapped.fields }, mapped.attributes);
  const current = flatten(
    {
      name: existing.name,
      description: existing.description ?? '',
      criticality: existing.criticality,
      environment: existing.environment ?? '',
      status: existing.status,
    },
    (existing.attributes ?? {}) as Record<string, unknown>,
  );

  const verdict = reconcile(current, incoming, rules, source.id);

  if (Object.keys(verdict.apply).length > 0) {
    await applyOwnedFields(ctx, tx, existing, verdict.apply);
    result.applied += Object.keys(verdict.apply).length;
  }

  if (verdict.propose.length > 0) {
    await raise(ctx, tx, {
      runId,
      sourceId: source.id,
      kind: 'update_ci',
      externalKey: mapped.externalKey,
      ciId: existing.id,
      proposed: Object.fromEntries(verdict.propose.map((change) => [change.field, change.to])),
      current: Object.fromEntries(verdict.propose.map((change) => [change.field, change.from])),
      result,
    });
  } else if (Object.keys(verdict.apply).length === 0) {
    result.unchanged += 1;
  }

  // The feed's own record of what depends on what. Proposed, never written:
  // an edge the platform invented is what ADR-0027 refuses, and an invented
  // edge is worse than a missing one because somebody acts on it.
  for (const relationship of mapped.relationships) {
    const other = await tx.configurationItem.findFirst({
      where: { externalKey: relationship.externalKey },
      select: { id: true },
    });
    if (!other) continue;
    const [fromCi, toCi] =
      relationship.direction === 'outgoing' ? [existing.id, other.id] : [other.id, existing.id];
    if (fromCi === toCi) continue;

    const edge = await tx.ciRelationship.findFirst({ where: { fromCi, toCi, type: relationship.type } });
    if (edge) continue;

    await raise(ctx, tx, {
      runId,
      sourceId: source.id,
      kind: 'create_relationship',
      externalKey: `${mapped.externalKey}|${relationship.type}|${relationship.externalKey}`,
      ciId: existing.id,
      proposed: { fromCi, toCi, type: relationship.type },
      current: {},
      result,
    });
  }
}

/**
 * Writes the fields a rule says the source owns.
 *
 * Attributes are validated against the class exactly as a person's edit would
 * be. A source that could write an attribute the class does not declare, or a
 * number as text, would be a way round the validation E1 put there — and the
 * way round a rule is where the bad rows come from.
 */
async function applyOwnedFields(
  ctx: TenantContext,
  tx: Tx,
  ci: { id: string; classId: string; attributes: unknown },
  apply: Record<string, unknown>,
): Promise<void> {
  const fields: Record<string, unknown> = {};
  const attributes = { ...((ci.attributes ?? {}) as Record<string, unknown>) };

  for (const [key, value] of Object.entries(apply)) {
    if (key.startsWith('attributes.')) attributes[key.slice('attributes.'.length)] = value;
    else fields[key] = value;
  }

  if (Object.keys(attributes).length > 0) {
    assertAttributes(inheritedAttributes(await classChain(tx, ctx.tenantId, ci.classId)), attributes);
  }

  await tx.configurationItem.update({
    where: { id: ci.id },
    data: {
      ...fields,
      attributes: attributes as never,
      source: 'discovery',
      lastSeenAt: new Date(),
      version: { increment: 1 },
    },
  });

  await recordAudit(tx, ctx, {
    action: 'discovery.applied',
    targetType: 'configuration_item',
    targetId: ci.id,
    after: { fields: Object.keys(apply) },
  });
}

/**
 * Raises a proposal, unless somebody has already said no to this one.
 *
 * Two behaviours that decide whether the queue is usable after a fortnight.
 * A pending proposal for the same thing is **superseded**, so a daily run does
 * not leave seven copies of every disagreement. And a proposal a person already
 * **rejected**, with the same values, is not raised again — otherwise saying no
 * costs a click a day for ever, and the queue trains people to accept
 * everything to make it stop.
 */
async function raise(
  ctx: TenantContext,
  tx: Tx,
  input: {
    runId: string;
    sourceId: string;
    kind: string;
    externalKey: string;
    ciId: string | null;
    proposed: Record<string, unknown>;
    current: Record<string, unknown>;
    result: RunResult;
  },
): Promise<void> {
  const fingerprint = JSON.stringify(input.proposed);

  const refused = await tx.discoveryProposal.findFirst({
    where: { sourceId: input.sourceId, externalKey: input.externalKey, kind: input.kind, status: 'rejected' },
    orderBy: { decidedAt: 'desc' },
  });
  if (refused && JSON.stringify(refused.proposed) === fingerprint) {
    input.result.unchanged += 1;
    return;
  }

  await tx.discoveryProposal.updateMany({
    where: { sourceId: input.sourceId, externalKey: input.externalKey, kind: input.kind, status: 'pending' },
    data: { status: 'superseded' },
  });

  await tx.discoveryProposal.create({
    data: {
      id: newId(),
      tenantId: ctx.tenantId,
      runId: input.runId,
      sourceId: input.sourceId,
      kind: input.kind,
      externalKey: input.externalKey,
      ciId: input.ciId,
      proposed: input.proposed as never,
      current: input.current as never,
    },
  });
  input.result.proposed += 1;
}

async function finish(
  ctx: TenantContext,
  sourceId: string,
  runId: string,
  result: RunResult,
  error: string | null,
): Promise<void> {
  await transaction(ctx, async (tx) => {
    await tx.discoveryRun.update({
      where: { id: runId },
      data: {
        status: result.status,
        finishedAt: new Date(),
        seen: result.seen,
        unchanged: result.unchanged,
        proposed: result.proposed,
        applied: result.applied,
        rejected: result.rejected,
        // Bounded: a feed whose every row is unreadable would otherwise write a
        // megabyte of identical messages into a row somebody has to open.
        problems: result.problems.slice(0, 100) as never,
        error,
      },
    });
    await tx.discoverySource.update({
      where: { id: sourceId },
      data: { lastRunAt: new Date(), lastRunStatus: result.status },
    });
    await publish(tx, ctx, {
      definition: events.discoveryRunCompleted,
      aggregateId: runId,
      payload: {
        runId,
        sourceId,
        status: result.status,
        seen: result.seen,
        proposed: result.proposed,
        applied: result.applied,
        rejected: result.rejected,
        error,
      },
    });
  });
}
