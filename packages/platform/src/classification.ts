import type { TenantContext } from './context.js';
import type { Classification } from '@itsm/contracts';
import { clearClassifiedFields, registerClassifiedField } from './telemetry.js';

/**
 * Data classification (docs/architecture/09 §6).
 *
 * One registry drives masking in serialisers, redaction in logs and the audit
 * trail, and exclusion from AI context in PH-4. Pulled forward into PH-1
 * because audit redaction depends on it.
 */
export interface FieldClassification {
  entity: string;
  field: string;
  level: Classification;
  /** Permission that lifts the mask; without it the field is omitted. */
  unlockedBy?: string;
  mask?: (value: unknown) => unknown;
}

const registry = new Map<string, FieldClassification>();

function key(entity: string, field: string): string {
  return `${entity}.${field}`.toLowerCase();
}

export function classifyField(declaration: FieldClassification): void {
  registry.set(key(declaration.entity, declaration.field), declaration);
  if (declaration.level === 'restricted' || declaration.level === 'confidential') {
    registerClassifiedField(declaration.field);
  }
}

export function classificationOf(entity: string, field: string): FieldClassification | undefined {
  return registry.get(key(entity, field));
}

export function clearClassifications(): void {
  registry.clear();
  clearClassifiedFields();
}

const DEFAULT_MASK = (value: unknown): unknown => {
  if (typeof value !== 'string' || value.length === 0) return null;
  if (value.includes('@')) {
    const [local = '', domain = ''] = value.split('@');
    return `${local.slice(0, 2)}***@${domain}`;
  }
  return `${value.slice(0, 2)}${'*'.repeat(Math.max(0, value.length - 2))}`;
};

/**
 * Masks one field for one actor. `restricted` fields are removed entirely
 * unless the actor holds the unlocking permission; `confidential` fields are
 * masked but their presence is visible.
 */
export function maskField(ctx: TenantContext, entity: string, field: string, value: unknown): { include: boolean; value: unknown } {
  const declaration = classificationOf(entity, field);
  if (!declaration) return { include: true, value };
  if (declaration.unlockedBy && ctx.permissions.has(declaration.unlockedBy)) return { include: true, value };

  if (declaration.level === 'restricted') return { include: false, value: undefined };
  if (declaration.level === 'confidential') return { include: true, value: (declaration.mask ?? DEFAULT_MASK)(value) };
  return { include: true, value };
}

/** Applies field masking across a whole record before it is serialised. */
export function maskRecord<T extends Record<string, unknown>>(ctx: TenantContext, entity: string, record: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(record)) {
    const result = maskField(ctx, entity, field, value);
    if (result.include) out[field] = result.value;
  }
  return out as Partial<T>;
}
