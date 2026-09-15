import { getSetting, type TenantContext } from '@itsm/platform';
import { catalogueService, formService } from '@itsm/module-catalogue';
import { workflowService } from '@itsm/module-workflow';
import { slaPolicyService } from '@itsm/module-sla';
import { articleService } from '@itsm/module-knowledge';
import type { PackDefinition, PackEntry, PackKind } from '../domain/pack.js';

/**
 * Writing one shipped item into a tenant, through the module that owns it.
 *
 * Never a direct insert. A pack that wrote catalogue rows itself would skip
 * the form-is-published check, the audit row and the
 * `catalogue.item.published` event — and would leave behind configuration that
 * looks like everybody else's and behaves differently. Going through the
 * service is also what makes the result ordinary: after an install there is
 * nothing here that a desk could not have typed in itself.
 *
 * The cost is that an install is *resumable* rather than atomic. Each service
 * opens its own transaction, so a pack cannot be installed in one; what is
 * written is recorded item by item as it lands, and running the install again
 * picks up where it stopped.
 */

export type ApplyMode = 'install' | 'update';

/**
 * Whether this tenant reviews articles before they go live.
 *
 * A pack does not overrule that. Where review is required the article is left
 * in draft for somebody to read and publish, and the install result says so —
 * quietly publishing into a tenant that asked for review would be the pack
 * deciding it outranks the desk's own governance.
 */
async function mayPublishArticles(ctx: TenantContext): Promise<boolean> {
  return !(await getSetting<boolean>(ctx, 'knowledge.requireApprovalToPublish'));
}

async function applyService(ctx: TenantContext, key: string, d: PackDefinition, mode: ApplyMode): Promise<void> {
  if (mode === 'install') {
    await catalogueService.createService(ctx, { key, name: d.name, description: d.description });
    return;
  }
  await catalogueService.updateService(ctx, key, { name: d.name, description: d.description ?? null });
}

async function applyForm(ctx: TenantContext, key: string, d: PackDefinition, mode: ApplyMode): Promise<void> {
  if (mode === 'install') {
    await formService.createForm(ctx, { key, name: d.name, description: d.description, document: d.document });
  } else {
    await formService.updateForm(ctx, key, {
      name: d.name,
      description: d.description ?? null,
      document: d.document,
    });
  }
  // A form nobody published cannot be filled in, and a request type pointing
  // at one is refused — so publishing is part of installing it, not a later
  // step somebody has to remember.
  await formService.publishForm(ctx, key);
}

async function applyRequestType(ctx: TenantContext, key: string, d: PackDefinition, mode: ApplyMode): Promise<void> {
  const shared = {
    serviceKey: d.serviceKey,
    name: d.name,
    description: d.description,
    shortSummary: d.shortSummary,
    formKey: d.formKey,
    entitlement: d.entitlement ?? null,
    priority: d.priority ?? 'P3',
    sortOrder: d.sortOrder ?? 100,
  };
  if (mode === 'install') {
    await catalogueService.createRequestType(ctx, { key, ...shared });
    await catalogueService.publishRequestType(ctx, key);
    return;
  }
  await catalogueService.updateRequestType(ctx, key, {
    ...shared,
    description: d.description ?? null,
    shortSummary: d.shortSummary ?? null,
    formKey: d.formKey ?? null,
  });
}

async function applyWorkflow(ctx: TenantContext, key: string, d: PackDefinition, mode: ApplyMode): Promise<void> {
  if (mode === 'install') {
    await workflowService.createWorkflow(ctx, { key, name: d.name, description: d.description, graph: d.graph });
  } else {
    await workflowService.updateWorkflow(ctx, key, { name: d.name, description: d.description ?? null });
    await workflowService.saveDraft(ctx, key, d.graph, 'brought forward from the pack');
  }
  await workflowService.publishWorkflow(ctx, key);
}

async function applySlaPolicy(ctx: TenantContext, key: string, d: PackDefinition, mode: ApplyMode): Promise<void> {
  const fields = {
    name: d.name,
    match: d.match ?? { always: true },
    specificity: d.specificity ?? 0,
    calendarMode: d.calendarMode ?? 'group',
  };
  if (mode === 'install') {
    await slaPolicyService.createPolicy(ctx, { key, ...fields, targets: d.targets, escalations: [] });
    return;
  }
  await slaPolicyService.updatePolicy(ctx, key, fields);
  await slaPolicyService.updateTargets(ctx, key, d.targets);
}

async function applyArticle(ctx: TenantContext, key: string, d: PackDefinition, mode: ApplyMode): Promise<void> {
  const fields = {
    title: d.title,
    summary: d.summary,
    body: d.body ?? [],
    audience: d.audience ?? 'internal',
    keywords: d.keywords ?? [],
  };
  if (mode === 'install') {
    await articleService.createArticle(ctx, { key, ...fields, changeNote: 'installed from a pack' });
  } else {
    await articleService.saveDraft(ctx, key, { ...fields, changeNote: 'brought forward from the pack' });
  }
  if (await mayPublishArticles(ctx)) await articleService.publishArticle(ctx, key);
}

const APPLIERS: Record<PackKind, (ctx: TenantContext, key: string, d: PackDefinition, mode: ApplyMode) => Promise<void>> = {
  service: applyService,
  form: applyForm,
  request_type: applyRequestType,
  workflow: applyWorkflow,
  sla_policy: applySlaPolicy,
  article: applyArticle,
};

export async function applyEntry(ctx: TenantContext, entry: PackEntry, mode: ApplyMode): Promise<void> {
  await APPLIERS[entry.kind](ctx, entry.key, entry.definition, mode);
}

/** What installing leaves in draft rather than published, for the result. */
export async function articlesStayDraft(ctx: TenantContext): Promise<boolean> {
  return !(await mayPublishArticles(ctx));
}
