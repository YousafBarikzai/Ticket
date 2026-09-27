import {
  getSetting,
  invalidateSettings,
  logger,
  metrics,
  publish,
  recordAudit,
  transaction,
  writeSettingVersion,
  type TenantContext,
  type Tx,
} from '@itsm/platform';
import { events } from '@itsm/contracts';
import {
  STEP_DOWN,
  decisionDefinitionFor,
  overrides,
  shouldStepDown,
  type AppliedEntry,
  type DecisionPurpose,
} from '../domain/decisions.js';

/**
 * What keeps `auto` honest after it has been switched on (ADR-0051).
 *
 * The gate decides when a field may start being applied. This decides when
 * the whole purpose must stop: when people correct more than 5% of the last
 * 100 decisions it applied, it moves itself back to `suggest`, audits that,
 * and tells the tenant's administrators. Nobody has to notice first.
 *
 * A correction is a person — actor `user` — changing an applied field to
 * something else, or undoing it. A rule reacting to the AI's value is not a
 * person disagreeing with it, and the AI's own writes are not corrections.
 */

export interface StepDownState {
  /** How many applied decisions the rule looks at. */
  window: number;
  /** How many there are so far, up to `window`. */
  considered: number;
  overridden: number;
  /** Corrections over `considered`, or null before there are any. */
  rate: number | null;
  /** Above this, over a full window, `auto` withdraws itself. */
  limit: number;
  /** Whether the rule would withdraw `auto` now. */
  wouldStepDown: boolean;
}

type ResponseMap = Record<string, { action?: string } | undefined>;

/** Whether a person undid or changed any value this decision applied. */
function corrected(applied: unknown, responses: unknown): boolean {
  const answered = (responses as ResponseMap) ?? {};
  return Object.keys((applied as object) ?? {}).some((question) => {
    const action = answered[question]?.action;
    return action === 'undone' || action === 'overridden';
  });
}

/** The step-down rule's inputs and verdict, read from the most recent applied decisions. */
export async function stepDownState(tx: Tx, purpose: DecisionPurpose): Promise<StepDownState> {
  const rows = await tx.aiDecision.findMany({
    where: { purpose, outcome: 'applied' },
    orderBy: { createdAt: 'desc' },
    take: STEP_DOWN.window,
    select: { applied: true, responses: true },
  });
  const flags = rows.map((row) => corrected(row.applied, row.responses));
  const overridden = flags.filter(Boolean).length;
  return {
    window: STEP_DOWN.window,
    considered: rows.length,
    overridden,
    rate: rows.length > 0 ? overridden / rows.length : null,
    limit: STEP_DOWN.maxOverrideRate,
    wouldStepDown: shouldStepDown(flags),
  };
}

/**
 * Records that a person changed fields a decision applied to this ticket.
 *
 * `after` is each changed field's new value. Only the first thing a person
 * does about an applied value is recorded: a correction, once made, is not
 * made again by the next edit. One statement per answer, merged into the
 * others, so an undo arriving at the same moment cannot be lost. Returns
 * whether anything was recorded — the caller then asks whether the purpose
 * should step down.
 */
export async function recordOverrides(
  ctx: TenantContext,
  tx: Tx,
  ticketId: string,
  after: Readonly<Record<string, unknown>>,
  at = new Date(),
): Promise<boolean> {
  const decisions = await tx.aiDecision.findMany({
    where: { subjectType: 'ticket', subjectId: ticketId, outcome: 'applied' },
    select: { id: true, purpose: true, applied: true, responses: true },
  });
  let recorded = false;
  for (const decision of decisions) {
    const answered = (decision.responses as ResponseMap) ?? {};
    for (const [question, entry] of Object.entries((decision.applied as unknown as Record<string, AppliedEntry>) ?? {})) {
      if (!(entry.field in after) || answered[question]) continue;
      if (!overrides(entry, after[entry.field])) continue;
      const response = JSON.stringify({
        [question]: { action: 'overridden', by: ctx.actor.id, at: at.toISOString(), to: after[entry.field] ?? null },
      });
      const changed = await tx.$executeRaw`
        UPDATE ai_decision SET responses = responses || ${response}::jsonb
        WHERE id = ${decision.id}::uuid AND (responses -> ${question}) IS NULL
      `;
      if (changed === 0) continue;
      recorded = true;
      metrics.increment('ai_decision_overrides_total', { purpose: decision.purpose, question });
      await recordAudit(tx, ctx, {
        action: 'ai.decision.overridden',
        targetType: 'ticket',
        targetId: ticketId,
        before: { [entry.field]: entry.to },
        after: { decisionId: decision.id, question, [entry.field]: after[entry.field] ?? null },
      });
    }
  }
  return recorded;
}

/** How a step-down is attributed: the platform's rule, not the agent whose edit tipped it. */
function stepDownActor(ctx: TenantContext, purpose: DecisionPurpose): TenantContext {
  return { ...ctx, actor: { type: 'system', id: null, displayName: `AI ${purpose} step-down` } };
}

/**
 * Moves a purpose from `auto` back to `suggest` if people have corrected too
 * much of what it applied. Safe to call as often as corrections arrive: it
 * does nothing unless the purpose is in `auto` and the rule says so, and two
 * reviews at once step down once.
 */
export async function reviewAutoMode(ctx: TenantContext, purpose: DecisionPurpose): Promise<boolean> {
  const definition = decisionDefinitionFor(purpose);
  // The cached value is enough to skip the common case; the stored value is
  // read again under the lock before anything is written.
  if ((await getSetting<string>(ctx, definition.modeSetting)) !== 'auto') return false;

  const actor = stepDownActor(ctx, purpose);
  const steppedDown = await transaction(actor, async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ai-step-down:${ctx.tenantId}:${purpose}`}))`;
    const setting = await tx.setting.findFirst({
      where: { key: definition.modeSetting, scopeType: 'tenant', scopeId: null },
      select: { id: true, currentVersion: true },
    });
    if (!setting) return null;
    const stored = await tx.settingVersion.findFirst({
      where: { settingId: setting.id, version: setting.currentVersion },
      select: { value: true },
    });
    if (stored?.value !== 'auto') return null;

    const state = await stepDownState(tx, purpose);
    if (!state.wouldStepDown) return null;

    const reason = `${state.overridden} of the last ${state.considered} values AI ${purpose} applied were corrected by people, above the ${state.limit * 100}% limit`;
    const written = await writeSettingVersion(tx, actor, {
      key: definition.modeSetting,
      scopeType: 'tenant',
      scopeId: null,
      value: 'suggest',
      reason,
    });
    // The same record a person's change leaves, so the settings history
    // reads straight through it, and then the step-down's own.
    await recordAudit(tx, actor, {
      action: 'config.published',
      targetType: 'setting',
      targetId: definition.modeSetting,
      before: { value: 'auto', source: 'tenant' },
      after: { value: 'suggest', scopeType: 'tenant', scopeId: null, version: written.version },
      reason,
    });
    await publish(tx, actor, {
      definition: events.configPublished,
      aggregateId: definition.modeSetting,
      payload: { key: definition.modeSetting, scopeType: 'tenant', scopeId: null, version: written.version },
    });
    await recordAudit(tx, actor, {
      action: 'ai.decision.stepped_down',
      targetType: 'ai_purpose',
      targetId: purpose,
      before: { mode: 'auto' },
      after: { mode: 'suggest', overridden: state.overridden, window: state.considered, limit: state.limit },
      reason,
    });
    const administrators = await tx.roleAssignment.findMany({
      where: { role: { key: 'administrator' }, user: { status: 'active', deletedAt: null } },
      select: { userId: true },
      distinct: ['userId'],
      take: 20,
    });
    await publish(tx, actor, {
      definition: events.aiDecisionSteppedDown,
      aggregateId: ctx.tenantId,
      payload: {
        purpose,
        from: 'auto',
        to: 'suggest',
        overridden: state.overridden,
        window: state.considered,
        audience: administrators.map((row) => ({ kind: 'user' as const, userId: row.userId })),
      },
    });
    return state;
  });

  if (!steppedDown) return false;
  // After the commit, so nobody re-reads `auto` into the cache in between.
  await invalidateSettings(ctx.tenantId, definition.modeSetting);
  metrics.increment('ai_decision_step_downs_total', { purpose });
  logger.warn('a decision purpose stepped down from auto to suggest', {
    tenantId: ctx.tenantId,
    purpose,
    overridden: steppedDown.overridden,
    window: steppedDown.considered,
  });
  return true;
}
