import { type Tx } from '@itsm/platform';
import { hashOf, selectorOf, type PackDefinition, type PackKind } from '../domain/pack.js';

/**
 * What the tenant actually has, in the shape a pack would have shipped it in.
 *
 * This module writes exclusively through the services that own each table —
 * and reads the rows directly, here, because "has somebody edited this?" is a
 * question no module exposes and none of them should have to. The read is
 * narrow, it takes the caller's transaction, and every field it touches is one
 * a pack can set.
 *
 * A workflow and an article are compared on their *current* version rather
 * than their newest, because that is the one a run picks up and a reader is
 * shown. An unpublished draft is somebody's work in progress, not the state of
 * the desk.
 */

export type Shapes = Map<string, string | null>;

async function serviceShape(tx: Tx, key: string): Promise<PackDefinition | null> {
  const row = await tx.service.findFirst({ where: { key } });
  return row ? { name: row.name, description: row.description } : null;
}

async function formShape(tx: Tx, key: string): Promise<PackDefinition | null> {
  const row = await tx.formDefinitionRecord.findFirst({ where: { key } });
  return row ? { name: row.name, description: row.description, document: row.document } : null;
}

async function requestTypeShape(tx: Tx, key: string): Promise<PackDefinition | null> {
  const row = await tx.requestType.findFirst({ where: { key } });
  if (!row) return null;
  const service = await tx.service.findFirst({ where: { id: row.serviceId } });
  return {
    serviceKey: service?.key ?? null,
    name: row.name,
    description: row.description,
    shortSummary: row.shortSummary,
    formKey: row.formKey,
    entitlement: row.entitlement ?? null,
    priority: row.priority,
    sortOrder: row.sortOrder,
  };
}

async function workflowShape(tx: Tx, key: string): Promise<PackDefinition | null> {
  const definition = await tx.workflowDefinition.findFirst({ where: { key } });
  if (!definition) return null;
  const version = definition.currentVersionId
    ? await tx.workflowVersion.findFirst({ where: { id: definition.currentVersionId } })
    : await tx.workflowVersion.findFirst({ where: { definitionId: definition.id }, orderBy: { version: 'desc' } });
  return { name: definition.name, description: definition.description, graph: version?.graph ?? null };
}

async function slaPolicyShape(tx: Tx, key: string): Promise<PackDefinition | null> {
  const policy = await tx.slaPolicy.findFirst({ where: { key } });
  if (!policy) return null;
  const targets = await tx.slaTarget.findMany({
    where: { policyId: policy.id },
    orderBy: [{ priority: 'asc' }, { targetType: 'asc' }],
  });
  return {
    name: policy.name,
    match: policy.match ?? { always: true },
    specificity: policy.specificity,
    calendarMode: policy.calendarMode,
    targets: targets.map((target) => ({
      priority: target.priority,
      targetType: target.targetType,
      minutes: target.minutes,
      warningThresholds: target.warningThresholds,
    })),
  };
}

async function articleShape(tx: Tx, key: string): Promise<PackDefinition | null> {
  const article = await tx.knowledgeArticle.findFirst({ where: { key } });
  if (!article) return null;
  const version = article.currentVersionId
    ? await tx.knowledgeArticleVersion.findFirst({ where: { id: article.currentVersionId } })
    : await tx.knowledgeArticleVersion.findFirst({ where: { articleId: article.id }, orderBy: { version: 'desc' } });
  return {
    title: version?.title ?? article.title,
    summary: version?.summary ?? null,
    body: version?.body ?? [],
    audience: article.audience,
    keywords: article.keywords,
  };
}

const READERS: Record<PackKind, (tx: Tx, key: string) => Promise<PackDefinition | null>> = {
  service: serviceShape,
  form: formShape,
  request_type: requestTypeShape,
  workflow: workflowShape,
  sla_policy: slaPolicyShape,
  article: articleShape,
};

/** Whether a key is already taken, for the collision check before an install. */
export async function exists(tx: Tx, kind: PackKind, key: string): Promise<boolean> {
  return (await READERS[kind](tx, key)) !== null;
}

/**
 * The hash of everything the tenant has, by `kind:key`.
 *
 * `null` for an item that is recorded as installed and is no longer there:
 * the difference between "you changed it" and "you deleted it" matters to
 * whoever reads the diff.
 */
export async function currentHashes(tx: Tx, items: { kind: PackKind; key: string }[]): Promise<Shapes> {
  const shapes: Shapes = new Map();
  for (const item of items) {
    const shape = await READERS[item.kind](tx, item.key);
    shapes.set(selectorOf(item.kind, item.key), shape === null ? null : hashOf(item.kind, shape));
  }
  return shapes;
}
