import { z } from 'zod';
import { ValidationError, recordsFrom, valueAt } from '@itsm/platform';
import { RELATIONSHIP_TYPES } from './relationships.js';

// Re-exported: callers and the module's index knew them from here.
export { recordsFrom, valueAt };

/**
 * Turning somebody else's record into one of ours.
 *
 * Every feed calls things something different — `serialNumber`, `serial_no`,
 * `SerialNumber`, `hardwareInformation.serialNumber` — so the mapping is
 * configuration rather than code, and the three built-in sources in `src/sources/`
 * are mappings with the boxes already filled in.
 *
 * Two rules, both inherited from E1 and both about the same thing. **Nothing is
 * coerced**: a field the mapping says is a number and the feed says is `"n/a"`
 * is a problem, not a zero. And **one bad record does not lose the rest**: the
 * problems come back as a list against the record they came from, so a run over
 * four hundred devices reports the six it could not read and imports the other
 * three hundred and ninety-four.
 */

/** Configuration-item fields a mapping may set. Anything else is a typo. */
export const MAPPABLE_FIELDS = [
  'description',
  'criticality',
  'environment',
  'status',
  'externalKey',
  'name',
] as const;

const path = z.string().min(1).max(200);

export const relationshipMappingSchema = z.object({
  type: z.enum(RELATIONSHIP_TYPES),
  /** Where in the record the other end's external key is; a string or a list. */
  from: path,
  /** `outgoing` — this item points at what it finds; `incoming` — the reverse. */
  direction: z.enum(['outgoing', 'incoming']).default('outgoing'),
});

export const mappingSchema = z
  .object({
    /** The class every record becomes, unless `classFrom` says otherwise. */
    classKey: z.string().min(1).max(60).optional(),
    classFrom: path.optional(),
    /** The stable identifier reconciliation matches on. Required, always. */
    externalKeyFrom: path,
    nameFrom: path,
    /** Configuration-item field to a path in the record. */
    fields: z.record(z.enum(MAPPABLE_FIELDS), path).optional(),
    /** Class attribute key to a path in the record. */
    attributes: z.record(z.string().min(1).max(60), path).optional(),
    /** Values the feed does not carry: `{ "environment": "production" }`. */
    constants: z.record(z.string().min(1).max(60), z.union([z.string(), z.number(), z.boolean()])).optional(),
    relationships: z.array(relationshipMappingSchema).max(10).optional(),
  })
  .superRefine((mapping, ctx) => {
    if (!mapping.classKey && !mapping.classFrom) {
      // Without one of the two, every record would land in no class, and a
      // configuration item with no class carries no attributes anybody declared.
      ctx.addIssue({ code: 'custom', message: 'say which class these records become: classKey or classFrom' });
    }
  });
export type Mapping = z.infer<typeof mappingSchema>;

export interface MappedRecord {
  externalKey: string;
  name: string;
  classKey: string;
  fields: Record<string, string>;
  attributes: Record<string, unknown>;
  relationships: { type: string; externalKey: string; direction: 'outgoing' | 'incoming' }[];
  problems: string[];
}

function asText(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') return value.trim() === '' ? undefined : value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return undefined;
}

/** Applies a mapping to one record from a feed. */
export function mapRecord(mapping: Mapping, record: unknown): MappedRecord | { problems: string[] } {
  const problems: string[] = [];

  const externalKey = asText(valueAt(record, mapping.externalKeyFrom));
  if (!externalKey) {
    // Fatal for this record and only this record. Without a stable identifier
    // there is nothing to match on, so the next run would create it again, and
    // the run after that, until the register is a list of duplicates.
    problems.push(`no value at ${mapping.externalKeyFrom}, so there is nothing to match this record on`);
  }

  const name = asText(valueAt(record, mapping.nameFrom));
  if (!name) problems.push(`no value at ${mapping.nameFrom} to use as a name`);

  const classKey = mapping.classFrom ? asText(valueAt(record, mapping.classFrom)) ?? mapping.classKey : mapping.classKey;
  if (!classKey) problems.push(`no class: ${mapping.classFrom ?? 'classKey'} gave nothing`);

  if (!externalKey || !name || !classKey) return { problems };

  const fields: Record<string, string> = {};
  for (const [field, expression] of Object.entries(mapping.fields ?? {})) {
    const value = asText(valueAt(record, expression));
    if (value !== undefined) fields[field] = value;
  }

  const attributes: Record<string, unknown> = {};
  for (const [key, expression] of Object.entries(mapping.attributes ?? {})) {
    // Attributes keep their type: the class declares what each one is and
    // `checkAttributes` refuses a mismatch, which is where a `"eight"` in a
    // number column is caught rather than quietly stored.
    const value = valueAt(record, expression);
    if (value !== null && value !== undefined && value !== '') attributes[key] = value;
  }
  for (const [key, value] of Object.entries(mapping.constants ?? {})) attributes[key] = value;

  const relationships: MappedRecord['relationships'] = [];
  for (const rule of mapping.relationships ?? []) {
    const value = valueAt(record, rule.from);
    const targets = Array.isArray(value) ? value : [value];
    for (const target of targets) {
      const key = asText(target);
      if (key && key !== externalKey) {
        relationships.push({ type: rule.type, externalKey: key, direction: rule.direction });
      }
    }
  }

  return { externalKey, name, classKey, fields, attributes, relationships, problems };
}

export function isMapped(result: MappedRecord | { problems: string[] }): result is MappedRecord {
  return 'externalKey' in result;
}
