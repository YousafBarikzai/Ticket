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
import {
  validateForm,
  submissionValues,
  withDefaults,
  referencedVars,
  type FormDefinition,
  type FormValues,
} from '@itsm/contracts';

/**
 * MOD-02 forms.
 *
 * Validation on submission calls `validateForm` from `@itsm/contracts` — the
 * same function the browser ran to decide what to show and what to complain
 * about. That is the whole point of moving the form contract into a shared
 * package: a second implementation here would be a second set of rules, and the
 * two would disagree the first time either changed.
 *
 * The browser's validation is a convenience. This one is the control.
 */

export const formDocumentSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9-]{1,62}$/),
  version: z.number().int().min(1).optional(),
  title: z.string().max(200).optional(),
  description: z.string().max(1000).optional(),
  schema: z.object({
    type: z.literal('object'),
    properties: z.record(z.unknown()),
    required: z.array(z.string()).optional(),
  }),
  ui: z.object({ elements: z.array(z.unknown()) }),
});

export const createFormSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9-]{1,62}$/),
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  document: formDocumentSchema,
});

export async function listForms(ctx: TenantContext, filter: { status?: string } = {}) {
  authz.require(ctx, 'catalogue.form.read');
  return transaction(ctx, (tx) =>
    tx.formDefinitionRecord.findMany({
      where: filter.status ? { status: filter.status } : {},
      orderBy: { key: 'asc' },
    }),
  );
}

export async function createForm(ctx: TenantContext, input: unknown) {
  authz.require(ctx, 'catalogue.form.manage');
  const parsed = createFormSchema.parse(input);
  assertDocumentIsCoherent(parsed.document as unknown as FormDefinition);

  return transaction(ctx, async (tx) => {
    const existing = await tx.formDefinitionRecord.findFirst({ where: { key: parsed.key } });
    if (existing) throw new ConflictError(`a form with the key ${parsed.key} already exists`);

    const form = await tx.formDefinitionRecord.create({
      data: {
        id: newId(),
        tenantId: ctx.tenantId,
        key: parsed.key,
        name: parsed.name,
        description: parsed.description ?? null,
        document: parsed.document as never,
        status: 'draft',
      },
    });
    await recordAudit(tx, ctx, {
      action: 'form.created',
      targetType: 'form_definition',
      targetId: form.id,
      after: { key: form.key },
    });
    return form;
  });
}

export async function publishForm(ctx: TenantContext, key: string) {
  authz.require(ctx, 'catalogue.form.manage');
  return transaction(ctx, async (tx) => {
    const form = await loadForm(tx, key);
    assertDocumentIsCoherent(form.document as unknown as FormDefinition);

    const version = form.version + 1;
    const document = { ...(form.document as object), key: form.key, version } as never;
    await tx.formVersionRecord.create({
      data: {
        id: newId(),
        tenantId: ctx.tenantId,
        definitionId: form.id,
        version,
        document,
        publishedBy: ctx.actor.id,
      },
    });
    const published = await tx.formDefinitionRecord.update({
      where: { id: form.id },
      data: { status: 'published', version, document, publishedAt: new Date(), publishedBy: ctx.actor.id },
    });
    await recordAudit(tx, ctx, {
      action: 'form.published',
      targetType: 'form_definition',
      targetId: form.id,
      before: { version: form.version, status: form.status },
      after: { version, status: 'published' },
    });
    return published;
  });
}

/** The published version somebody is about to fill in. */
export async function currentVersion(tx: Tx, key: string) {
  const form = await tx.formDefinitionRecord.findFirst({ where: { key, status: 'published' } });
  if (!form) return null;
  const version = await tx.formVersionRecord.findFirst({
    where: { definitionId: form.id, version: form.version },
  });
  return version ? { form, version } : null;
}

export interface ValidationOutcome {
  ok: boolean;
  errors: Record<string, string>;
  /** Only the answers a visible field could hold, with defaults applied. */
  accepted: FormValues;
}

/**
 * Validates a submission against the version the person was shown.
 *
 * Two things matter beyond "are the required fields filled in".
 *
 * **Answers to invisible fields are dropped, not rejected.** A field hidden by
 * a condition may still carry a value the browser left behind, and a submission
 * that fails because of something the person could not see is impossible to
 * act on. `submissionValues` decides what survives, using the same visibility
 * rules the browser used.
 *
 * **The version is the one they were shown**, not the current one. A form
 * edited between opening and submitting must not make an answer look invalid,
 * or make it look as though they were asked something they never saw.
 */
export function validateSubmission(
  definition: FormDefinition,
  values: FormValues,
  extras: { user?: Record<string, unknown>; now?: string } = {},
): ValidationOutcome {
  const withApplied = withDefaults(definition, values);
  const errors = validateForm(definition, withApplied, extras);
  return {
    ok: Object.keys(errors).length === 0,
    errors: errors as Record<string, string>,
    accepted: submissionValues(definition, withApplied, extras),
  };
}

async function loadForm(tx: Tx, key: string) {
  const form = await tx.formDefinitionRecord.findFirst({ where: { key } });
  if (!form) throw new NotFoundError('form not found');
  return form;
}

/**
 * Refuses a document that would render but could never be filled in correctly.
 *
 * Both checks catch a form that looks fine in the builder: a UI element bound to
 * a property that does not exist silently renders nothing, and a required
 * property with no element asks for an answer the person is never shown a box
 * for — so the form can never be submitted and nobody can tell why.
 */
export function assertDocumentIsCoherent(document: FormDefinition): void {
  const properties = new Set(Object.keys(document.schema?.properties ?? {}));
  const bound = new Set<string>();

  const walk = (elements: readonly unknown[]): void => {
    for (const element of elements) {
      const node = element as { kind?: string; field?: string; elements?: unknown[] };
      if (node.kind === 'field' && node.field) bound.add(node.field);
      if (node.kind === 'section' && Array.isArray(node.elements)) walk(node.elements);
    }
  };
  walk(document.ui?.elements ?? []);

  const issues: { field: string; code: string; message: string }[] = [];

  // A condition reading a path nothing provides is the quiet failure: it never
  // matches, the field never appears, and nothing says why. Values live under
  // `form.`, so `values.accessLevel` — the obvious guess — is always undefined.
  const readable = (path: string): boolean =>
    path === 'now' || path.startsWith('form.') || path.startsWith('user.') || path.startsWith('requester.');

  const conditions: unknown[] = [];
  const collect = (elements: readonly unknown[]): void => {
    for (const element of elements) {
      const node = element as {
        kind?: string;
        visibleWhen?: unknown;
        requiredWhen?: unknown;
        readOnlyWhen?: unknown;
        elements?: unknown[];
      };
      for (const condition of [node.visibleWhen, node.requiredWhen, node.readOnlyWhen]) {
        if (condition) conditions.push(condition);
      }
      if (node.kind === 'section' && Array.isArray(node.elements)) collect(node.elements);
    }
  };
  collect(document.ui?.elements ?? []);

  for (const condition of conditions) {
    for (const path of referencedVars(condition as never)) {
      if (readable(path)) {
        // A `form.` path must name a property that exists, or the condition can
        // never become true.
        if (path.startsWith('form.') && !properties.has(path.slice('form.'.length))) {
          issues.push({
            field: path,
            code: 'unknown_property',
            message: `${path} names no property in the schema, so this condition never holds`,
          });
        }
        continue;
      }
      issues.push({
        field: path,
        code: 'unreadable_path',
        message: `${path} is not something a form condition can read; field values live under form.`,
      });
    }
  }

  for (const field of bound) {
    if (!properties.has(field)) {
      issues.push({ field, code: 'unknown_property', message: `no property called ${field} in the schema` });
    }
  }
  for (const field of document.schema?.required ?? []) {
    if (!bound.has(field)) {
      issues.push({
        field,
        code: 'required_without_field',
        message: `${field} is required but has no element, so nobody can answer it`,
      });
    }
  }

  if (issues.length > 0) {
    throw new ValidationError('this form could not be filled in as written', issues);
  }
}
