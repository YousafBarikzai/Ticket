import { z } from 'zod';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  type TenantContext,
  type Tx,
  authz,
  newId,
  recordAudit,
  transaction,
} from '@itsm/platform';
import { evaluate, exprSchema, ExprError, type Expr } from '@itsm/expr';

/**
 * Custom fields: the definitions, and the rules they impose.
 *
 * `field_definition` has existed since Phase 1 with a comment on it saying
 * "defined in PH-1 so the ticket API validates `custom` against them from the
 * start". Nothing read the table and nothing wrote it — not one reference in
 * the repository — and `createTicket` took `custom: z.record(z.unknown())`,
 * which accepts a megabyte of anything. Three columns describing who may see a
 * field were decorative, and `ticket.config.manage` ("Manage categories and
 * field definitions") granted access to nothing.
 *
 * So this file is not a new feature. It is the thing four phases of comments
 * have been describing.
 *
 * Two decisions run through it.
 *
 * **An unknown key is refused, not stored.** The same argument as the strict
 * request schemas (ADR-0044): a client that misspells `cost_centre` should be
 * told, not have its value silently land in a JSONB column that nothing will
 * ever read back. The alternative is a tenant discovering after six months
 * that half its tickets carry `costCentre` and half carry `cost_center`.
 *
 * **A definition is deactivated, never deleted.** Tickets hold values against
 * it, and a deleted definition turns those into orphaned keys that the rule
 * above would then refuse on the next edit. Deactivating stops new values
 * without rewriting anybody's history.
 */

/** What a field can hold. Deliberately small; each one has a checkable shape. */
export const FIELD_TYPES = ['text', 'textarea', 'number', 'date', 'select', 'multiselect', 'checkbox'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

/**
 * Who may see a field's value.
 *
 * `public` reaches the requester through the portal; `internal` is for anybody
 * who can work the ticket; `restricted` additionally needs the field to name
 * the reader's role in `visibleTo`. A classification the reader fails is
 * stripped from the response rather than blanked, because a key with no value
 * still tells them the field exists.
 */
export const CLASSIFICATIONS = ['public', 'internal', 'restricted'] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];

export const fieldSchema = z
  .object({
    key: z
      .string()
      .regex(/^[a-z][a-zA-Z0-9]{0,63}$/, 'a field key is camelCase, starts with a letter, and is at most 64 characters'),
    label: z.string().min(1).max(200),
    type: z.enum(FIELD_TYPES),
    /** For `select` and `multiselect`. Ignored, and refused, for everything else. */
    options: z.array(z.object({ value: z.string().min(1).max(200), label: z.string().min(1).max(200) })).max(200).default([]),
    /** `{ types: ['incident'] }` — empty means every type. */
    appliesTo: z.object({ types: z.array(z.string().min(1).max(40)).max(20).default([]) }).default({ types: [] }),
    /**
     * An expression over the ticket, or null for never required. Conditional
     * rather than a boolean because "required when the category is Hardware"
     * is the shape almost every desk actually wants, and a boolean forces them
     * to make a field required on every ticket or on none.
     */
    requiredWhen: exprSchema.nullable().default(null),
    /**
     * Permission keys that may read a `restricted` field, not role names.
     *
     * Permissions rather than roles for two reasons. The reader's permissions
     * are already on the context, so this costs no lookup on a path that runs
     * for every ticket read; and a role is a bundle of permissions anyway, so
     * naming the permission says what the field is actually protecting
     * ("whoever may write an internal note") rather than what somebody happened
     * to call a group of people this year.
     */
    visibleTo: z.array(z.string().min(1).max(60)).max(50).default([]),
    classification: z.enum(CLASSIFICATIONS).default('internal'),
    order: z.number().int().min(0).max(10_000).default(0),
  })
  .strict()
  .superRefine((value, context) => {
    const needsOptions = value.type === 'select' || value.type === 'multiselect';
    if (needsOptions && value.options.length === 0) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['options'], message: 'a select field needs at least one option' });
    }
    if (!needsOptions && value.options.length > 0) {
      // Refused rather than ignored: options on a text field mean somebody
      // believed they were building a dropdown, and a silent drop leaves them
      // wondering why it renders as a box.
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['options'], message: `a ${value.type} field takes no options` });
    }
    const values = value.options.map((option) => option.value);
    if (new Set(values).size !== values.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['options'], message: 'two options share a value' });
    }
    if (value.classification !== 'restricted' && value.visibleTo.length > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['visibleTo'],
        message: 'visibleTo only applies to a restricted field; an internal field is visible to anyone who can read the ticket',
      });
    }
    if (value.classification === 'restricted' && value.visibleTo.length === 0) {
      // A restricted field nobody is named on is a field nobody can read,
      // which is a configuration mistake rather than a strict setting.
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['visibleTo'], message: 'a restricted field must name the roles that may read it' });
    }
  });

export type FieldInput = z.input<typeof fieldSchema>;

export interface FieldRow {
  id: string;
  key: string;
  label: string;
  type: FieldType;
  options: { value: string; label: string }[];
  appliesTo: { types: string[] };
  requiredWhen: Expr | null;
  visibleTo: string[];
  classification: Classification;
  order: number;
  isActive: boolean;
}

function toRow(row: {
  id: string;
  key: string;
  label: string;
  type: string;
  options: unknown;
  appliesTo: unknown;
  requiredWhen: unknown;
  visibleTo: string[];
  classification: string;
  order: number;
  isActive: boolean;
}): FieldRow {
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    type: row.type as FieldType,
    options: (row.options as { value: string; label: string }[]) ?? [],
    appliesTo: (row.appliesTo as { types: string[] }) ?? { types: [] },
    requiredWhen: (row.requiredWhen as Expr | null) ?? null,
    visibleTo: row.visibleTo,
    classification: row.classification as Classification,
    order: row.order,
    isActive: row.isActive,
  };
}

/**
 * The definitions, read inside a transaction the caller already holds.
 *
 * Separate from `listFields` because the ticket write path must see the same
 * snapshot the rest of its transaction sees, and because it must not need
 * `ticket.read` — a channel adapter creating a ticket on somebody's behalf is
 * not a reader.
 */
export async function fieldsInTx(tx: Tx): Promise<FieldRow[]> {
  const rows = await tx.fieldDefinition.findMany({ orderBy: [{ order: 'asc' }, { key: 'asc' }] });
  return rows.map(toRow);
}

/** Every definition in the tenant, active first, in the order an editor set. */
export async function listFields(ctx: TenantContext, options: { includeInactive?: boolean } = {}): Promise<FieldRow[]> {
  authz.require(ctx, 'ticket.read');
  return transaction(ctx, async (tx) => {
    const rows = await tx.fieldDefinition.findMany({
      where: options.includeInactive ? {} : { isActive: true },
      orderBy: [{ order: 'asc' }, { key: 'asc' }],
    });
    return rows.map(toRow);
  });
}

/** Creates or replaces one. The key is the identity; it is never edited. */
export async function saveField(ctx: TenantContext, input: FieldInput): Promise<FieldRow> {
  authz.require(ctx, 'ticket.config.manage');
  const parsed = fieldSchema.parse(input);

  return transaction(ctx, async (tx) => {
    const existing = await tx.fieldDefinition.findFirst({ where: { key: parsed.key } });

    // Changing a live field's type would reinterpret every value already
    // stored against it — `"12"` as text is not 12 as a number, and a date
    // that was a string is neither. A new key is the honest way to change
    // shape, and the old one is deactivated.
    if (existing && existing.type !== parsed.type) {
      throw new ConflictError(
        `${parsed.key} is a ${existing.type} field and tickets already hold values for it. ` +
          'Deactivate it and add a new field rather than changing its type.',
      );
    }

    const data = {
      label: parsed.label,
      type: parsed.type,
      options: parsed.options as never,
      appliesTo: parsed.appliesTo as never,
      requiredWhen: (parsed.requiredWhen ?? null) as never,
      visibleTo: parsed.visibleTo,
      classification: parsed.classification,
      order: parsed.order,
    };

    const row = existing
      ? await tx.fieldDefinition.update({ where: { id: existing.id }, data: { ...data, version: { increment: 1 } } })
      : await tx.fieldDefinition.create({
          data: { id: newId(), tenantId: ctx.tenantId, key: parsed.key, isActive: true, ...data },
        });

    await recordAudit(tx, ctx, {
      action: existing ? 'ticket.field.updated' : 'ticket.field.created',
      targetType: 'field_definition',
      targetId: row.id,
      ...(existing ? { before: { label: existing.label, classification: existing.classification, order: existing.order } } : {}),
      after: { key: parsed.key, label: parsed.label, type: parsed.type, classification: parsed.classification },
    });

    return toRow(row);
  });
}

/**
 * Stops a field being set on new tickets, and leaves every value already
 * recorded exactly where it is.
 */
export async function deactivateField(ctx: TenantContext, key: string): Promise<FieldRow> {
  authz.require(ctx, 'ticket.config.manage');
  return transaction(ctx, async (tx) => {
    const existing = await tx.fieldDefinition.findFirst({ where: { key } });
    if (!existing) throw new NotFoundError('field definition', key);
    const row = await tx.fieldDefinition.update({ where: { id: existing.id }, data: { isActive: false } });
    await recordAudit(tx, ctx, {
      action: 'ticket.field.deactivated',
      targetType: 'field_definition',
      targetId: row.id,
      before: { isActive: true },
      after: { isActive: false },
    });
    return toRow(row);
  });
}

// ---------------------------------------------------------------------------
// What the ticket service uses
// ---------------------------------------------------------------------------

/** Whether a definition applies to a ticket of this type. */
export function appliesToType(field: FieldRow, ticketType: string): boolean {
  return field.appliesTo.types.length === 0 || field.appliesTo.types.includes(ticketType);
}

/** Whether a field is required, given the ticket it is being set on. */
export function isRequired(field: FieldRow, facts: Record<string, unknown>): boolean {
  if (!field.requiredWhen) return false;
  try {
    return evaluate(field.requiredWhen, facts);
  } catch (error) {
    // A malformed condition must not make the ticket unsaveable. It is a
    // configuration error, and treating it as "not required" fails towards
    // letting work continue; `saveField` parses the expression, so reaching
    // here means the row predates that or was written around it.
    if (error instanceof ExprError) return false;
    throw error;
  }
}

/** One value against one definition. Returns the value to store, or throws. */
function checkValue(field: FieldRow, value: unknown): unknown {
  const wrong = (expected: string): never => {
    throw new ValidationError(`${field.key} takes ${expected}`, [{ field: `custom.${field.key}`, code: 'invalid_type', message: `expected ${expected}` }]);
  };

  switch (field.type) {
    case 'text':
    case 'textarea':
      if (typeof value !== 'string') return wrong('text');
      if (value.length > 10_000) return wrong('text of at most 10000 characters');
      return value;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) return wrong('a number');
      return value;
    case 'checkbox':
      if (typeof value !== 'boolean') return wrong('true or false');
      return value;
    case 'date': {
      if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) return wrong('a date');
      return value;
    }
    case 'select': {
      if (typeof value !== 'string') return wrong('one of its options');
      if (!field.options.some((option) => option.value === value)) {
        throw new ValidationError(
          `${value} is not an option for ${field.key}; it takes ${field.options.map((option) => option.value).join(', ')}`,
        );
      }
      return value;
    }
    case 'multiselect': {
      if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) return wrong('a list of its options');
      const allowed = new Set(field.options.map((option) => option.value));
      const unknown = (value as string[]).filter((entry) => !allowed.has(entry));
      if (unknown.length > 0) throw new ValidationError(`${unknown.join(', ')} ${unknown.length === 1 ? 'is not an option' : 'are not options'} for ${field.key}`);
      return [...new Set(value as string[])];
    }
  }
}

/**
 * Checks a `custom` object against the tenant's definitions.
 *
 * Returns what to store. `null` clears a field, which is how a value is
 * removed — an absent key on an update means "unchanged", and the two need to
 * be distinguishable.
 */
export function validateCustom(
  fields: readonly FieldRow[],
  ticketType: string,
  custom: Record<string, unknown>,
  facts: Record<string, unknown>,
  /**
   * What the ticket already holds, on an update.
   *
   * The required check has to see the merged picture rather than the patch: a
   * client changing one field must not be told a different required field is
   * missing because this request did not mention it. Empty on create, where
   * the patch *is* the whole picture.
   */
  existing: Record<string, unknown> = {},
): Record<string, unknown> {
  const applicable = fields.filter((field) => appliesToType(field, ticketType));
  const byKey = new Map(applicable.map((field) => [field.key, field]));

  const unknownKeys = Object.keys(custom).filter((key) => !byKey.has(key));
  if (unknownKeys.length > 0) {
    const known = applicable.filter((field) => field.isActive).map((field) => field.key);
    throw new ValidationError(
      `${unknownKeys.join(', ')} ${unknownKeys.length === 1 ? 'is not a field' : 'are not fields'} on a ${ticketType}` +
        (known.length > 0 ? `; it takes ${known.join(', ')}` : ' and it has no custom fields'),
      unknownKeys.map((key) => ({ field: `custom.${key}`, code: 'unrecognized_key', message: 'no such field' })),
    );
  }

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(custom)) {
    const field = byKey.get(key)!;
    if (value === null) {
      out[key] = null;
      continue;
    }
    // An inactive field accepts no new value. Its existing values stay, which
    // is why this only runs over what the caller sent.
    if (!field.isActive) {
      throw new ValidationError(`${key} is no longer in use on this desk, so it cannot be set`);
    }
    out[key] = checkValue(field, value);
  }

  for (const field of applicable) {
    if (!field.isActive) continue;
    if (!isRequired(field, facts)) continue;
    // What the ticket will hold once this patch lands: the sent value when the
    // key was sent at all — including an explicit null, which is a clear and
    // must fail a required field — and the stored one otherwise.
    const supplied = field.key in out ? out[field.key] : existing[field.key];
    if (supplied === undefined || supplied === null || supplied === '') {
      throw new ValidationError(`${field.label} is required`, [
        { field: `custom.${field.key}`, code: 'required', message: `${field.label} is required` },
      ]);
    }
  }

  return out;
}

/**
 * Strips what this reader may not see.
 *
 * Stripped rather than blanked: a key with a null value still tells somebody
 * the field exists and that there is something in it they are not being shown,
 * which for a field classified `restricted` is most of what was being kept
 * from them.
 */
export interface Reader {
  /**
   * Whether this reader works the desk rather than raising tickets on it —
   * a `ticket.read` scope of `team` or `any` rather than `own`. A requester
   * sees `public` fields and nothing else.
   */
  readonly worksTheDesk: boolean;
  /** Whether the reader holds a given permission, for `restricted` fields. */
  readonly holds: (permission: string) => boolean;
}

export function visibleCustom(
  fields: readonly FieldRow[],
  custom: Record<string, unknown>,
  reader: Reader,
): Record<string, unknown> {
  const byKey = new Map(fields.map((field) => [field.key, field]));
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(custom)) {
    const field = byKey.get(key);
    // A value whose definition is gone — deleted directly, or migrated in — is
    // shown to the desk and not to a requester. It is data the desk once
    // collected and hiding it from them would lose it; showing it to a
    // requester would disclose something nobody has classified.
    if (!field) {
      if (reader.worksTheDesk) out[key] = value;
      continue;
    }
    if (field.classification === 'public') {
      out[key] = value;
      continue;
    }
    if (!reader.worksTheDesk) continue;
    if (field.classification === 'internal') {
      out[key] = value;
      continue;
    }
    if (field.visibleTo.some((permission) => reader.holds(permission))) out[key] = value;
  }

  return out;
}
