import { ValidationError } from '@itsm/platform';
import { z } from 'zod';

/**
 * Class-declared attributes.
 *
 * A server has a CPU count and a database has an engine. A schema holding both
 * would be a hundred nullable columns nobody could query, so the values live in
 * JSON and the *shape* lives on the class — which means the shape has to be
 * enforced somewhere, or the JSON becomes the write-only field every CMDB ends
 * up with.
 *
 * Enforced at write time, and refusing rather than coercing: `cpuCount: "eight"`
 * silently stored as a string is exactly the row that breaks a report six
 * months later, and by then nobody knows which of four hundred rows are wrong.
 */

export const ATTRIBUTE_TYPES = ['string', 'number', 'boolean', 'date', 'enum'] as const;
export type AttributeType = (typeof ATTRIBUTE_TYPES)[number];

export const attributeSchema = z.object({
  key: z.string().regex(/^[a-z][a-zA-Z0-9]*$/, 'lower camel case'),
  label: z.string().min(1).max(120),
  type: z.enum(ATTRIBUTE_TYPES),
  required: z.boolean().default(false),
  /** For `enum`, the values it may take. */
  options: z.array(z.string().min(1).max(120)).max(100).optional(),
});
export type AttributeDefinition = z.infer<typeof attributeSchema>;

export const attributeListSchema = z
  .array(attributeSchema)
  .max(100)
  .superRefine((attributes, ctx) => {
    const seen = new Set<string>();
    for (const attribute of attributes) {
      if (seen.has(attribute.key)) {
        ctx.addIssue({ code: 'custom', message: `${attribute.key} is declared twice` });
      }
      seen.add(attribute.key);
      if (attribute.type === 'enum' && (attribute.options?.length ?? 0) === 0) {
        // An enum with no options accepts nothing, which is a field that can
        // never be filled in and a required one that can never be satisfied.
        ctx.addIssue({ code: 'custom', message: `${attribute.key} is an enum with no options` });
      }
    }
  });

export interface AttributeProblem {
  key: string;
  message: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ]|$)/;

function typeOf(value: unknown, definition: AttributeDefinition): string {
  switch (definition.type) {
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? 'ok' : 'a number';
    case 'boolean':
      return typeof value === 'boolean' ? 'ok' : 'true or false';
    case 'date':
      return typeof value === 'string' && ISO_DATE.test(value) ? 'ok' : 'a date, as YYYY-MM-DD';
    case 'enum':
      return typeof value === 'string' && (definition.options ?? []).includes(value)
        ? 'ok'
        : `one of ${(definition.options ?? []).join(', ')}`;
    case 'string':
      return typeof value === 'string' ? 'ok' : 'text';
  }
}

/**
 * Checks a CI's attributes against its class.
 *
 * Returns the problems rather than throwing, so an importer can report every
 * bad row in one pass instead of stopping at the first — the difference between
 * a person fixing a spreadsheet once and fixing it forty times.
 */
export function checkAttributes(
  declared: AttributeDefinition[],
  values: Record<string, unknown>,
): AttributeProblem[] {
  const problems: AttributeProblem[] = [];
  const byKey = new Map(declared.map((attribute) => [attribute.key, attribute]));

  for (const attribute of declared) {
    const value = values[attribute.key];
    if (value === undefined || value === null || value === '') {
      if (attribute.required) problems.push({ key: attribute.key, message: `${attribute.label} is required` });
      continue;
    }
    const expected = typeOf(value, attribute);
    if (expected !== 'ok') problems.push({ key: attribute.key, message: `${attribute.label} must be ${expected}` });
  }

  for (const key of Object.keys(values)) {
    if (!byKey.has(key)) {
      // Refused rather than kept. An attribute the class does not declare is
      // almost always a typo, and keeping it means the report that reads
      // `cpuCount` silently misses every row that spelled it `cpus`.
      problems.push({ key, message: `${key} is not an attribute of this class` });
    }
  }

  return problems;
}

export function assertAttributes(declared: AttributeDefinition[], values: Record<string, unknown>): void {
  const problems = checkAttributes(declared, values);
  if (problems.length === 0) return;
  throw new ValidationError(
    `this configuration item does not match its class: ${problems.map((problem) => problem.message).join('; ')}`,
    problems.map((problem) => ({ field: `attributes.${problem.key}`, code: 'attribute', message: problem.message })),
  );
}

/** The attributes a class carries, including everything it inherits. */
export function inheritedAttributes(
  chain: { attributes: unknown }[],
): AttributeDefinition[] {
  const merged = new Map<string, AttributeDefinition>();
  // Walked from the most general to the most specific, so a subclass may
  // tighten what it inherits — "Server declares environment optional, Database
  // Server requires it" — rather than being stuck with the parent's decision.
  for (const level of chain) {
    const parsed = attributeListSchema.safeParse(level.attributes);
    if (!parsed.success) continue;
    for (const attribute of parsed.data) merged.set(attribute.key, attribute);
  }
  return [...merged.values()];
}
