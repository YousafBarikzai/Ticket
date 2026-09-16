import { z } from 'zod';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  authz,
  newId,
  recordAudit,
  transaction,
  type TenantContext,
  type Tx,
} from '@itsm/platform';
import { exprSchema, checkExpr } from '@itsm/contracts';
import { assertDocumentIsCoherent, surveyDocumentSchema, type SurveyDocument } from '../domain/survey-document.js';

/**
 * Surveys: designed, published, and pointed at the events that send them.
 *
 * Publishing snapshots the document into an immutable version, exactly as
 * MOD-02 does for a form, and every invitation and response names the version
 * it was shown. Editing the working copy afterwards changes nothing that has
 * already been asked.
 */

export const TRIGGER_KINDS = ['ticket.resolved', 'request.fulfilled', 'incident.major.resolved'] as const;
export type TriggerKind = (typeof TRIGGER_KINDS)[number];

export const createSurveySchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9-]{1,62}$/),
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  document: surveyDocumentSchema,
});
export type CreateSurveyInput = z.input<typeof createSurveySchema>;

export const triggerSchema = z.object({
  kind: z.enum(TRIGGER_KINDS),
  conditions: exprSchema.optional(),
  throttleDays: z.number().int().min(0).max(365).default(7),
  expiryDays: z.number().int().min(1).max(90).default(14),
  isActive: z.boolean().default(true),
});
export type TriggerInput = z.input<typeof triggerSchema>;

/** What a trigger condition may refer to. Declared so a bad expression fails at save time. */
const CONDITION_TYPES = {
  'ticket.type': 'string',
  'ticket.priority': 'string',
  'ticket.serviceId': 'string',
  'ticket.categoryId': 'string',
  'ticket.groupId': 'string',
  'ticket.channel': 'string',
  'ticket.reopenCount': 'number',
  'incident.severity': 'string',
} as const;

async function loadSurvey(tx: Tx, key: string) {
  const survey = await tx.surveyDefinition.findFirst({ where: { key } });
  if (!survey) throw new NotFoundError('survey', key);
  return survey;
}

export async function listSurveys(ctx: TenantContext) {
  authz.require(ctx, 'feedback.read');
  return transaction(ctx, (tx) =>
    tx.surveyDefinition.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { triggers: true, versions: true } } } }),
  );
}

export async function getSurvey(ctx: TenantContext, key: string) {
  authz.require(ctx, 'feedback.read');
  return transaction(ctx, async (tx) => {
    const survey = await loadSurvey(tx, key);
    const triggers = await tx.surveyTrigger.findMany({ where: { surveyId: survey.id }, orderBy: { createdAt: 'asc' } });
    return { ...survey, triggers };
  });
}

export async function createSurvey(ctx: TenantContext, input: CreateSurveyInput) {
  authz.require(ctx, 'feedback.manage');
  const parsed = createSurveySchema.parse(input);
  return transaction(ctx, async (tx) => {
    const existing = await tx.surveyDefinition.findFirst({ where: { key: parsed.key } });
    if (existing) throw new ConflictError(`a survey with the key ${parsed.key} already exists`);
    const row = await tx.surveyDefinition.create({
      data: {
        id: newId(),
        tenantId: ctx.tenantId,
        key: parsed.key,
        name: parsed.name,
        description: parsed.description ?? null,
        document: parsed.document as never,
        createdBy: ctx.actor.id,
      },
    });
    await recordAudit(tx, ctx, { action: 'survey.created', targetType: 'survey_definition', targetId: row.id, after: { key: parsed.key, name: parsed.name } });
    return row;
  });
}

export async function updateSurvey(ctx: TenantContext, key: string, input: Partial<CreateSurveyInput>) {
  authz.require(ctx, 'feedback.manage');
  return transaction(ctx, async (tx) => {
    const survey = await loadSurvey(tx, key);
    const patch = createSurveySchema.omit({ key: true }).partial().parse(input);
    const row = await tx.surveyDefinition.update({
      where: { id: survey.id },
      data: {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined ? { description: patch.description ?? null } : {}),
        ...(patch.document !== undefined ? { document: patch.document as never } : {}),
      },
    });
    await recordAudit(tx, ctx, { action: 'survey.updated', targetType: 'survey_definition', targetId: survey.id, after: { changed: Object.keys(patch) } });
    return row;
  });
}

/** Snapshots the working copy as the next version and makes it the live one. */
export async function publishSurvey(ctx: TenantContext, key: string) {
  authz.require(ctx, 'feedback.manage');
  return transaction(ctx, async (tx) => {
    const survey = await loadSurvey(tx, key);
    const document = surveyDocumentSchema.parse(survey.document);
    assertDocumentIsCoherent(document);

    const version = survey.version + 1;
    await tx.surveyVersion.create({
      data: { id: newId(), tenantId: ctx.tenantId, definitionId: survey.id, version, document: document as never, publishedBy: ctx.actor.id },
    });
    const published = await tx.surveyDefinition.update({
      where: { id: survey.id },
      data: { status: 'published', version, publishedAt: new Date() },
    });
    await recordAudit(tx, ctx, {
      action: 'survey.published',
      targetType: 'survey_definition',
      targetId: survey.id,
      before: { version: survey.version, status: survey.status },
      after: { version, status: 'published' },
    });
    return published;
  });
}

export async function retireSurvey(ctx: TenantContext, key: string) {
  authz.require(ctx, 'feedback.manage');
  return transaction(ctx, async (tx) => {
    const survey = await loadSurvey(tx, key);
    const row = await tx.surveyDefinition.update({ where: { id: survey.id }, data: { status: 'retired' } });
    await tx.surveyTrigger.updateMany({ where: { surveyId: survey.id }, data: { isActive: false } });
    await recordAudit(tx, ctx, { action: 'survey.retired', targetType: 'survey_definition', targetId: survey.id });
    return row;
  });
}

/** The version people are being shown right now, or null while unpublished. */
export async function currentVersion(tx: Tx, surveyId: string) {
  const survey = await tx.surveyDefinition.findFirst({ where: { id: surveyId, status: 'published' } });
  if (!survey) return null;
  const version = await tx.surveyVersion.findFirst({ where: { definitionId: survey.id, version: survey.version } });
  return version ? { survey, version, document: version.document as unknown as SurveyDocument } : null;
}

export async function addTrigger(ctx: TenantContext, key: string, input: TriggerInput) {
  authz.require(ctx, 'feedback.manage');
  const parsed = triggerSchema.parse(input);
  if (parsed.conditions) {
    const conflicts = checkExpr(parsed.conditions, CONDITION_TYPES);
    if (conflicts.length > 0) throw new ValidationError(`the condition does not type-check: ${conflicts.map((c) => c.message).join('; ')}`);
  }
  return transaction(ctx, async (tx) => {
    const survey = await loadSurvey(tx, key);
    const row = await tx.surveyTrigger.create({
      data: {
        id: newId(),
        tenantId: ctx.tenantId,
        surveyId: survey.id,
        kind: parsed.kind,
        conditions: (parsed.conditions ?? null) as never,
        throttleDays: parsed.throttleDays,
        expiryDays: parsed.expiryDays,
        isActive: parsed.isActive,
      },
    });
    await recordAudit(tx, ctx, { action: 'survey.trigger.added', targetType: 'survey_trigger', targetId: row.id, after: parsed });
    return row;
  });
}

export async function updateTrigger(ctx: TenantContext, id: string, input: Partial<TriggerInput>) {
  authz.require(ctx, 'feedback.manage');
  return transaction(ctx, async (tx) => {
    const existing = await tx.surveyTrigger.findFirst({ where: { id } });
    if (!existing) throw new NotFoundError('survey trigger', id);
    const merged = triggerSchema.parse({
      kind: existing.kind,
      conditions: existing.conditions ?? undefined,
      throttleDays: existing.throttleDays,
      expiryDays: existing.expiryDays,
      isActive: existing.isActive,
      ...input,
    });
    const row = await tx.surveyTrigger.update({
      where: { id },
      data: {
        kind: merged.kind,
        conditions: (merged.conditions ?? null) as never,
        throttleDays: merged.throttleDays,
        expiryDays: merged.expiryDays,
        isActive: merged.isActive,
      },
    });
    await recordAudit(tx, ctx, { action: 'survey.trigger.updated', targetType: 'survey_trigger', targetId: id, after: merged });
    return row;
  });
}

export async function removeTrigger(ctx: TenantContext, id: string): Promise<void> {
  authz.require(ctx, 'feedback.manage');
  await transaction(ctx, async (tx) => {
    const existing = await tx.surveyTrigger.findFirst({ where: { id } });
    if (!existing) throw new NotFoundError('survey trigger', id);
    await tx.surveyTrigger.delete({ where: { id } });
    await recordAudit(tx, ctx, { action: 'survey.trigger.removed', targetType: 'survey_trigger', targetId: id });
  });
}
