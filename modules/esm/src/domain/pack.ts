import { z } from 'zod';
import { canonicalJson, digest } from '@itsm/platform';
import { exprSchema } from '@itsm/contracts';
import { formDocumentSchema } from '@itsm/module-catalogue';
import { graphSchema } from '@itsm/module-workflow';
import { targetSchema } from '@itsm/module-sla';

/**
 * What a pack is made of, and how two versions of it are compared.
 *
 * A pack is written once, with the deployment, and read by every tenant. It
 * carries no identifiers — no team, no owner, no calendar — because it cannot
 * know what any particular tenant has. Everything a pack names, it also
 * ships: a request type points at a service and a form from the same pack, and
 * at nothing else.
 *
 * `shapeOf` is the load-bearing function here. Both sides of an upgrade go
 * through it — the definition the deployment ships and the record the tenant
 * actually has — so the hashes are comparable only because the normalisation
 * is literally the same code. Defaults applied on one side and not the other
 * would report every item as edited, which is the same as reporting nothing.
 */

export const PACK_KINDS = ['service', 'form', 'request_type', 'workflow', 'sla_policy', 'article'] as const;
export type PackKind = (typeof PACK_KINDS)[number];

/**
 * Install order, and it is not cosmetic: a request type is refused if its form
 * is not published or its service does not exist, so forms and services have
 * to land first.
 */
export const KIND_ORDER: readonly PackKind[] = ['service', 'form', 'request_type', 'workflow', 'sla_policy', 'article'];

const itemKey = z.string().regex(/^[a-z][a-z0-9-]{1,62}$/);

export const packServiceSchema = z
  .object({
    key: itemKey,
    name: z.string().min(1).max(120),
    description: z.string().max(1000).optional(),
  })
  .strict();

export const packFormSchema = z
  .object({
    key: itemKey,
    name: z.string().min(1).max(120),
    description: z.string().max(500).optional(),
    document: formDocumentSchema,
  })
  .strict();

export const packRequestTypeSchema = z
  .object({
    key: itemKey,
    serviceKey: itemKey,
    name: z.string().min(1).max(120),
    description: z.string().max(2000).optional(),
    shortSummary: z.string().max(200).optional(),
    formKey: itemKey.optional(),
    entitlement: exprSchema.nullable().optional(),
    priority: z.enum(['P1', 'P2', 'P3', 'P4']).optional(),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
  })
  .strict();

export const packWorkflowSchema = z
  .object({
    key: itemKey,
    name: z.string().min(1).max(120),
    description: z.string().max(2000).optional(),
    graph: graphSchema,
  })
  .strict();

/**
 * An SLA policy without its escalations.
 *
 * An escalation names a notification template or a team, and a pack knows
 * neither. Shipping one that pointed at nothing would put a policy in place
 * that looks like it escalates and does not — worse than shipping targets and
 * saying plainly that the desk adds its own escalations.
 */
export const packSlaPolicySchema = z
  .object({
    key: itemKey,
    name: z.string().min(1).max(120),
    match: exprSchema.optional(),
    specificity: z.number().int().min(0).max(1000).optional(),
    calendarMode: z.enum(['group', 'requester', 'fixed']).optional(),
    targets: z.array(targetSchema).min(1).max(24),
  })
  .strict();

export const packArticleSchema = z
  .object({
    key: itemKey,
    title: z.string().min(1).max(200),
    summary: z.string().max(500).optional(),
    body: z.array(z.unknown()).default([]),
    // The three MOD-09 actually has. The first draft of this line invented
    // `public` and `agent` and left out `tenant`, which parsed happily here
    // and would have been refused by `createArticle` at install — the shipped
    // packs all use `internal`, so nothing hit it. A vocabulary copied by hand
    // from memory rather than from the module that owns it.
    audience: z.enum(['internal', 'tenant', 'organisation']).optional(),
    keywords: z.array(z.string().max(60)).max(20).optional(),
  })
  .strict();

export const packSchema = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9-]{1,30}$/),
    name: z.string().min(1).max(120),
    /** Bumped by whoever edits the pack. The tenant's diff is against this. */
    version: z.number().int().min(1),
    desk: z.string().min(1).max(60),
    description: z.string().min(1).max(1000),
    /** What installing leaves for the desk to do itself. */
    nextSteps: z.array(z.string().max(200)).max(10).default([]),
    services: z.array(packServiceSchema).max(20).default([]),
    forms: z.array(packFormSchema).max(40).default([]),
    requestTypes: z.array(packRequestTypeSchema).max(40).default([]),
    workflows: z.array(packWorkflowSchema).max(20).default([]),
    slaPolicies: z.array(packSlaPolicySchema).max(10).default([]),
    articles: z.array(packArticleSchema).max(40).default([]),
  })
  .strict();

export type Pack = z.infer<typeof packSchema>;
export type PackDefinition = Record<string, unknown>;

/** One shipped thing, flattened out of the pack's six lists. */
export interface PackEntry {
  kind: PackKind;
  key: string;
  definition: PackDefinition;
}

const LISTS: Record<PackKind, keyof Pack> = {
  service: 'services',
  form: 'forms',
  request_type: 'requestTypes',
  workflow: 'workflows',
  sla_policy: 'slaPolicies',
  article: 'articles',
};

/** Everything in the pack, in the order it has to be installed. */
export function entriesOf(pack: Pack): PackEntry[] {
  const entries: PackEntry[] = [];
  for (const kind of KIND_ORDER) {
    const list = pack[LISTS[kind]] as { key: string }[];
    for (const definition of list) {
      entries.push({ kind, key: definition.key, definition: definition as PackDefinition });
    }
  }
  return entries;
}

// ---------------------------------------------------------------------------
// The comparable shape
// ---------------------------------------------------------------------------

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * The document without the two fields the form service maintains itself.
 *
 * `publishForm` writes the key and the version number into the stored
 * document, so a document that came straight out of the database differs from
 * the one the pack shipped in exactly those two places, every time.
 */
function formDocument(value: unknown): unknown {
  if (!value || typeof value !== 'object') return {};
  const { key: _key, version: _version, ...rest } = value as Record<string, unknown>;
  return rest;
}

/** Targets in a fixed order, identified the way the SLA module identifies them. */
function sorted(targets: Record<string, unknown>[]): Record<string, unknown>[] {
  return targets
    .map((target) => ({
      priority: target.priority,
      targetType: target.targetType,
      minutes: target.minutes,
      warningThresholds: target.warningThresholds ?? [50, 75, 90],
    }))
    // Bytewise, not `localeCompare`: an order that depends on the machine's
    // locale is an order two deployments can disagree about, and this one
    // decides whether an item reads as edited.
    .sort((a, b) => {
      const left = `${String(a.priority)}:${String(a.targetType)}`;
      const right = `${String(b.priority)}:${String(b.targetType)}`;
      return left < right ? -1 : left > right ? 1 : 0;
    });
}

/**
 * The fields that decide whether two versions of an item are the same thing.
 *
 * Deliberately not "every column": a service's identifier, its creation time
 * and the team a desk assigned to it are not the pack's business, and
 * including them would report an edit the tenant never made to the pack's
 * content.
 */
export function shapeOf(kind: PackKind, definition: PackDefinition): Record<string, unknown> {
  switch (kind) {
    case 'service':
      return { name: definition.name, description: text(definition.description) };
    case 'form':
      return {
        name: definition.name,
        description: text(definition.description),
        document: formDocument(definition.document),
      };
    case 'request_type':
      return {
        serviceKey: definition.serviceKey,
        name: definition.name,
        description: text(definition.description),
        shortSummary: text(definition.shortSummary),
        formKey: text(definition.formKey),
        entitlement: definition.entitlement ?? null,
        priority: definition.priority ?? 'P3',
        sortOrder: definition.sortOrder ?? 100,
      };
    case 'workflow':
      return { name: definition.name, description: text(definition.description), graph: definition.graph };
    case 'sla_policy':
      return {
        name: definition.name,
        match: definition.match ?? { always: true },
        specificity: definition.specificity ?? 0,
        calendarMode: definition.calendarMode ?? 'group',
        // Sorted, because a target has no key of its own: it is identified by
        // its priority and type, so the two sides of a comparison have to
        // agree on an order rather than on the order somebody typed. Leaving
        // this to the reader's `orderBy` reported every shipped policy as
        // edited, because a pack is written P1, P2, P3, P4 and the database
        // hands back P3/fulfilment before P3/response.
        targets: sorted((definition.targets as Record<string, unknown>[] | undefined) ?? []),
      };
    case 'article':
      return {
        title: definition.title,
        summary: text(definition.summary),
        body: definition.body ?? [],
        audience: definition.audience ?? 'internal',
        keywords: definition.keywords ?? [],
      };
  }
}

/** SHA-256 of the comparable shape. What `pack_item.source_hash` holds. */
export function hashOf(kind: PackKind, definition: PackDefinition): string {
  return digest(canonicalJson(shapeOf(kind, definition)));
}

/** `service:hr`, the selector an administrator names when taking one item. */
export function selectorOf(kind: PackKind, key: string): string {
  return `${kind}:${key}`;
}
