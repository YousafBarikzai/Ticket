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
import { referencedVars } from '@itsm/expr';
import {
  ACTIONS_NOT_YET_AVAILABLE,
  RULE_EVENTS,
  ruleDefinitionSchema,
  type RuleAction,
  type RuleEvent,
} from '../domain/actions.js';
import { decide, effectsOf, type Decision, type LoadedRule } from './engine.js';
import { FACT_PATHS, factsForTicket } from './facts.js';

/**
 * MOD-06-E0 rule administration.
 *
 * Rules follow the versioned-definition lifecycle (docs/architecture/05 §8):
 * edited as a draft, validated, published as an immutable version, and rolled
 * back by re-publishing an earlier one. Nothing evaluates a draft, so an
 * administrator can work on a rule all afternoon without it touching a ticket.
 */

export async function listRules(ctx: TenantContext, filter: { event?: string; status?: string } = {}) {
  authz.require(ctx, 'rules.rule.read');
  return transaction(ctx, (tx) =>
    tx.businessRule.findMany({
      where: {
        ...(filter.event ? { event: filter.event } : {}),
        ...(filter.status ? { status: filter.status } : {}),
      },
      orderBy: [{ event: 'asc' }, { order: 'asc' }],
    }),
  );
}

export async function getRule(ctx: TenantContext, idOrKey: string) {
  authz.require(ctx, 'rules.rule.read');
  return transaction(ctx, async (tx) => {
    const rule = await loadRule(tx, idOrKey);
    const versions = await tx.businessRuleVersion.findMany({
      where: { ruleId: rule.id },
      orderBy: { version: 'desc' },
      take: 20,
    });
    return { ...rule, versions };
  });
}

export type CreateRuleInput = z.input<typeof ruleDefinitionSchema>;

export async function createRule(ctx: TenantContext, input: CreateRuleInput) {
  authz.require(ctx, 'rules.rule.manage');
  const definition = ruleDefinitionSchema.parse(input);
  validateDefinition(definition.conditions, definition.actions as RuleAction[]);

  return transaction(ctx, async (tx) => {
    const existing = await tx.businessRule.findFirst({ where: { key: definition.key } });
    if (existing) throw new ConflictError(`a rule with the key ${definition.key} already exists`);

    const rule = await tx.businessRule.create({
      data: {
        id: newId(),
        tenantId: ctx.tenantId,
        orgId: definition.orgId ?? null,
        key: definition.key,
        name: definition.name,
        description: definition.description ?? null,
        event: definition.event,
        conditions: definition.conditions as never,
        actions: definition.actions as never,
        order: definition.order,
        mode: definition.mode,
        status: 'draft',
        createdBy: ctx.actor.id,
      },
    });

    await recordAudit(tx, ctx, {
      action: 'rule.created',
      targetType: 'business_rule',
      targetId: rule.id,
      after: { key: rule.key, event: rule.event, status: rule.status },
    });
    return rule;
  });
}

export async function updateRule(ctx: TenantContext, idOrKey: string, patch: Partial<CreateRuleInput>) {
  authz.require(ctx, 'rules.rule.manage');

  return transaction(ctx, async (tx) => {
    const rule = await loadRule(tx, idOrKey);
    const merged = ruleDefinitionSchema.parse({
      key: rule.key,
      name: rule.name,
      description: rule.description ?? undefined,
      event: rule.event,
      conditions: rule.conditions,
      actions: rule.actions,
      order: rule.order,
      mode: rule.mode,
      ...patch,
    });
    validateDefinition(merged.conditions, merged.actions as RuleAction[]);

    const updated = await tx.businessRule.update({
      where: { id: rule.id },
      data: {
        name: merged.name,
        description: merged.description ?? null,
        event: merged.event,
        conditions: merged.conditions as never,
        actions: merged.actions as never,
        order: merged.order,
        mode: merged.mode,
        // Editing a published rule returns it to draft: the published version
        // keeps running until the edit is deliberately published in its turn.
        status: rule.status === 'published' ? 'draft' : rule.status,
      },
    });

    await recordAudit(tx, ctx, {
      action: 'rule.updated',
      targetType: 'business_rule',
      targetId: rule.id,
      before: { name: rule.name, order: rule.order, mode: rule.mode, status: rule.status },
      after: { name: updated.name, order: updated.order, mode: updated.mode, status: updated.status },
    });
    return updated;
  });
}

export async function publishRule(ctx: TenantContext, idOrKey: string) {
  authz.require(ctx, 'rules.rule.publish');

  return transaction(ctx, async (tx) => {
    const rule = await loadRule(tx, idOrKey);
    validateDefinition(rule.conditions, rule.actions as RuleAction[]);

    const version = rule.version + 1;
    await tx.businessRuleVersion.create({
      data: {
        id: newId(),
        tenantId: ctx.tenantId,
        ruleId: rule.id,
        version,
        snapshot: {
          key: rule.key,
          name: rule.name,
          event: rule.event,
          conditions: rule.conditions,
          actions: rule.actions,
          order: rule.order,
          mode: rule.mode,
        } as never,
        publishedBy: ctx.actor.id,
      },
    });

    const published = await tx.businessRule.update({
      where: { id: rule.id },
      data: { status: 'published', version, publishedAt: new Date(), publishedBy: ctx.actor.id },
    });

    await recordAudit(tx, ctx, {
      action: 'rule.published',
      targetType: 'business_rule',
      targetId: rule.id,
      before: { status: rule.status, version: rule.version },
      after: { status: 'published', version },
    });
    return published;
  });
}

export async function rollbackRule(ctx: TenantContext, idOrKey: string, toVersion: number) {
  authz.require(ctx, 'rules.rule.publish');

  return transaction(ctx, async (tx) => {
    const rule = await loadRule(tx, idOrKey);
    const snapshot = await tx.businessRuleVersion.findFirst({ where: { ruleId: rule.id, version: toVersion } });
    if (!snapshot) throw new NotFoundError('that version of this rule does not exist');

    const text = snapshot.snapshot as unknown as {
      name: string;
      event: string;
      conditions: unknown;
      actions: RuleAction[];
      order: number;
      mode: string;
    };
    // A rollback is a publish of older text, not a rewind: the version number
    // still goes up, so the history reads forwards and an application can always
    // name the version that ran.
    const version = rule.version + 1;
    await tx.businessRuleVersion.create({
      data: {
        id: newId(),
        tenantId: ctx.tenantId,
        ruleId: rule.id,
        version,
        snapshot: snapshot.snapshot as never,
        publishedBy: ctx.actor.id,
      },
    });
    const restored = await tx.businessRule.update({
      where: { id: rule.id },
      data: {
        name: text.name,
        event: text.event,
        conditions: text.conditions as never,
        actions: text.actions as never,
        order: text.order,
        mode: text.mode,
        status: 'published',
        version,
        publishedAt: new Date(),
        publishedBy: ctx.actor.id,
      },
    });

    await recordAudit(tx, ctx, {
      action: 'rule.rolled_back',
      targetType: 'business_rule',
      targetId: rule.id,
      before: { version: rule.version },
      after: { version, restoredFrom: toVersion },
    });
    return restored;
  });
}

export async function archiveRule(ctx: TenantContext, idOrKey: string) {
  authz.require(ctx, 'rules.rule.manage');
  return transaction(ctx, async (tx) => {
    const rule = await loadRule(tx, idOrKey);
    const archived = await tx.businessRule.update({ where: { id: rule.id }, data: { status: 'archived' } });
    await recordAudit(tx, ctx, {
      action: 'rule.archived',
      targetType: 'business_rule',
      targetId: rule.id,
      before: { status: rule.status },
      after: { status: 'archived' },
    });
    return archived;
  });
}

export interface TestResult {
  sampled: number;
  wouldChange: {
    ticketId: string;
    number: string;
    title: string;
    matched: string[];
    effects: ReturnType<typeof effectsOf>;
  }[];
  errors: Decision['errors'];
}

/**
 * The test panel (docs/architecture/11 §1).
 *
 * Replays recent tickets through the candidate rule — including its unpublished
 * draft text — and reports what would change. Nothing is written: the whole
 * point is to let an administrator find out that their rule would have
 * reassigned four hundred tickets *before* it does.
 */
export async function testRule(ctx: TenantContext, idOrKey: string, sampleSize = 100): Promise<TestResult> {
  authz.require(ctx, 'rules.rule.manage');

  return transaction(ctx, async (tx) => {
    const rule = await loadRule(tx, idOrKey);
    const candidate: LoadedRule = {
      id: rule.id,
      key: rule.key,
      name: rule.name,
      event: rule.event,
      conditions: rule.conditions,
      actions: rule.actions as unknown as RuleAction[],
      order: rule.order,
      mode: rule.mode as 'stop' | 'continue',
      version: rule.version,
    };

    const tickets = await tx.ticket.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(sampleSize, 1), 500),
    });

    const result: TestResult = { sampled: tickets.length, wouldChange: [], errors: [] };
    for (const ticket of tickets) {
      const decision = decide([candidate], factsForTicket(ticket as never));
      result.errors.push(...decision.errors);
      if (decision.matched.length === 0) continue;
      result.wouldChange.push({
        ticketId: ticket.id,
        number: ticket.number,
        title: ticket.title,
        matched: decision.matched.map((m) => m.ruleKey),
        effects: effectsOf(decision),
      });
    }
    // One broken condition produces one error per sampled ticket; the author
    // needs to see it once.
    result.errors = result.errors.filter(
      (error, index, all) => all.findIndex((other) => other.ruleKey === error.ruleKey && other.message === error.message) === index,
    );
    return result;
  });
}

/** The published rule set for one event, in evaluation order. */
export async function loadPublishedRules(tx: Tx, event: RuleEvent): Promise<LoadedRule[]> {
  const rows = await tx.businessRule.findMany({
    where: { event, status: 'published' },
    orderBy: { order: 'asc' },
  });
  return rows.map((row) => ({
    id: row.id,
    key: row.key,
    name: row.name,
    event: row.event,
    conditions: row.conditions,
    actions: row.actions as unknown as RuleAction[],
    order: row.order,
    mode: row.mode as 'stop' | 'continue',
    version: row.version,
  }));
}

async function loadRule(tx: Tx, idOrKey: string) {
  const rule = await tx.businessRule.findFirst({
    where: /^[0-9a-f-]{36}$/i.test(idOrKey) ? { id: idOrKey } : { key: idOrKey },
  });
  if (!rule) throw new NotFoundError('rule not found');
  return rule;
}

/**
 * Rejects a rule that would not do what its author expects.
 *
 * The three checks are the ones that catch a rule which looks right and is not:
 * a condition reading a fact that does not exist (so it never matches), an
 * action this phase cannot carry out (so it silently does nothing), and an
 * event that no handler consumes (so the rule never runs at all).
 */
export function validateDefinition(conditions: unknown, actions: RuleAction[]): void {
  const unknownVars = referencedVars(conditions as never).filter((path) => !isKnownFact(path));
  if (unknownVars.length > 0) {
    throw new ValidationError(
      `this condition reads ${unknownVars.join(', ')}, which no ticket fact provides; it would never match`,
      unknownVars.map((path) => ({
        field: `conditions.${path}`,
        code: 'unknown_fact',
        message: `no fact is called ${path}`,
      })),
    );
  }

  const unavailable = actions
    .map((action) => action.type)
    .filter((type) => type in ACTIONS_NOT_YET_AVAILABLE)
    .map((type) => `${type} (arrives with ${ACTIONS_NOT_YET_AVAILABLE[type]})`);
  if (unavailable.length > 0) {
    throw new ValidationError(
      `this rule uses actions that are not available yet: ${unavailable.join(', ')}`,
      unavailable.map((what) => ({ field: 'actions', code: 'not_yet_available', message: what })),
    );
  }
}

function isKnownFact(path: string): boolean {
  if ((FACT_PATHS as readonly string[]).includes(path)) return true;
  // Custom field values are addressed by key and cannot be enumerated here.
  return path.startsWith('fields.') || path.startsWith('answers.');
}

export { RULE_EVENTS };
