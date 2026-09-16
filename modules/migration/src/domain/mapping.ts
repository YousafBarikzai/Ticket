import { z } from 'zod';
import { ValidationError, valueAt } from '@itsm/platform';

/**
 * Turning somebody else's record into one of ours, for the four things a desk
 * move brings: the people, the teams, the services and the tickets — and the
 * conversation on each ticket.
 *
 * The same two rules as discovery (MOD-10), for the same reasons. **Nothing is
 * coerced**: a status the mapping does not name is a problem, not a guess, so
 * a ticket is never quietly closed because "Cancelled" was not in the table.
 * And **one bad row does not lose the rest**: problems are returned against
 * the row they came from, so a file of fifty thousand tickets imports the
 * ones it can and reports the ones it cannot, by row number.
 *
 * A third rule is this module's own: a row with only *warnings* is imported.
 * A comment whose author cannot be found is still worth having, attributed
 * to nobody, and the warning says so on the record.
 */

export const ENTITIES = ['users', 'teams', 'services', 'tickets', 'comments'] as const;
export type Entity = (typeof ENTITIES)[number];

export type FieldKind = 'text' | 'date' | 'bool' | 'list' | 'ref' | 'enum';

export interface FieldDefinition {
  kind: FieldKind;
  required?: boolean;
  /** For `enum`: what the value must be, after the value map has run. */
  values?: readonly string[];
  /** For `ref`: which entity the value names. */
  refEntity?: Entity;
  /** For `ref`: the natural key to try when the link table has nothing. */
  naturalKey?: 'email' | 'key';
  description: string;
}

/** Ticket states as MOD-04 knows them; the mapping's job is to reach one. */
export const TICKET_STATES = [
  'new',
  'in_progress',
  'pending_requester',
  'pending_third_party',
  'pending_approval',
  'resolved',
  'reopened',
  'closed',
  'cancelled',
] as const;
export const TICKET_TYPES = ['incident', 'request', 'problem', 'change', 'task', 'question'] as const;
export const PRIORITIES = ['P1', 'P2', 'P3', 'P4'] as const;

/**
 * What each entity accepts. Anything not here is a typo in the mapping, and
 * the mapping is refused when it is saved rather than when it runs.
 */
export const FIELD_CATALOGUE: Record<Entity, Record<string, FieldDefinition>> = {
  users: {
    email: { kind: 'text', required: true, description: 'The address; also how an existing user is found.' },
    displayName: { kind: 'text', required: true, description: 'Shown everywhere. Two paths joined with a space is fine.' },
    locale: { kind: 'text', description: 'en-GB, fr-FR.' },
    timeZone: { kind: 'text', description: 'Europe/London.' },
    isExternal: { kind: 'bool', description: 'A contractor or customer rather than staff.' },
    teams: { kind: 'list', description: 'Team keys, or the source\'s ids for teams a previous job imported.' },
  },
  teams: {
    key: { kind: 'text', description: 'Ours; derived from the name when absent.' },
    name: { kind: 'text', required: true, description: 'The team\'s name.' },
    description: { kind: 'text', description: 'What it does.' },
    orgCode: { kind: 'text', description: 'The organisation\'s code; the tenant\'s first organisation when absent.' },
  },
  services: {
    key: { kind: 'text', description: 'Ours; derived from the name when absent.' },
    name: { kind: 'text', required: true, description: 'The service\'s name.' },
    description: { kind: 'text', description: 'What it is.' },
    owner: { kind: 'ref', refEntity: 'users', naturalKey: 'email', description: 'Who answers for it.' },
  },
  tickets: {
    title: { kind: 'text', required: true, description: 'The subject line.' },
    description: { kind: 'text', description: 'The body.' },
    reference: { kind: 'text', description: 'The human number (INC0012345); the external key when absent.' },
    type: { kind: 'enum', values: TICKET_TYPES, description: 'incident, request, problem, change, task, question.' },
    status: { kind: 'enum', required: true, values: TICKET_STATES, description: 'Mapped from the source\'s words through valueMaps.status.' },
    priority: { kind: 'enum', values: PRIORITIES, description: 'P1 to P4, through valueMaps.priority; P3 when absent.' },
    requester: { kind: 'ref', refEntity: 'users', naturalKey: 'email', description: 'Who raised it.' },
    assignee: { kind: 'ref', refEntity: 'users', naturalKey: 'email', description: 'Who had it.' },
    team: { kind: 'ref', refEntity: 'teams', naturalKey: 'key', description: 'Whose queue it was in.' },
    service: { kind: 'ref', refEntity: 'services', naturalKey: 'key', description: 'What it was about.' },
    createdAt: { kind: 'date', required: true, description: 'When it was raised, there.' },
    resolvedAt: { kind: 'date', description: 'When it was resolved.' },
    closedAt: { kind: 'date', description: 'When it was closed.' },
  },
  comments: {
    ticket: { kind: 'ref', required: true, refEntity: 'tickets', description: 'The source\'s id for the ticket, from a tickets job.' },
    body: { kind: 'text', required: true, description: 'What was said.' },
    author: { kind: 'ref', refEntity: 'users', naturalKey: 'email', description: 'Who said it; nobody, with a warning, when unknown.' },
    createdAt: { kind: 'date', description: 'When.' },
    visibility: { kind: 'enum', values: ['public', 'internal'], description: 'public or internal, through valueMaps.visibility; public when absent.' },
    bodyFormat: { kind: 'enum', values: ['text', 'html'], description: 'text or html.' },
  },
};

const path = z.string().min(1).max(200);
/** One path, or several: joined with a space for text, tried in order for a reference. */
const pathOrPaths = z.union([path, z.array(path).min(1).max(5)]);
const valueMap = z.record(z.string().max(200), z.string().max(60));
const constant = z.union([z.string(), z.number(), z.boolean()]);

export const commentsMappingSchema = z.object({
  /** Where the list of comments is inside a ticket record. */
  from: path,
  externalKeyFrom: path.optional(),
  fields: z.record(z.string().min(1).max(60), pathOrPaths).default({}),
  constants: z.record(z.string().min(1).max(60), constant).default({}),
  valueMaps: z.record(z.string().min(1).max(60), valueMap).default({}),
});

export const mappingSchema = z.object({
  /** The source's stable identifier for the record. Required, always. */
  externalKeyFrom: path,
  fields: z.record(z.string().min(1).max(60), pathOrPaths).default({}),
  /** Values the source does not carry: `{ "type": "incident" }`. */
  constants: z.record(z.string().min(1).max(60), constant).default({}),
  /** Per field, the source's value to ours: `{ "status": { "6": "resolved" } }`. */
  valueMaps: z.record(z.string().min(1).max(60), valueMap).default({}),
  /** Tickets only: the conversation, when the source keeps it on the ticket. */
  comments: commentsMappingSchema.optional(),
  options: z
    .object({
      /** A requester or author named by an email nobody has: create them, external. */
      createMissingUsers: z.boolean().default(true),
      /** A row whose external key was imported before: update it rather than leave it. */
      overwrite: z.boolean().default(false),
    })
    .default({}),
});
export type Mapping = z.infer<typeof mappingSchema>;
export type MappingInput = z.input<typeof mappingSchema>;
export type CommentsMapping = z.infer<typeof commentsMappingSchema>;

/** Parses and checks a mapping against what its entity accepts. */
export function parseMapping(entity: Entity, input: unknown): Mapping {
  const mapping = mappingSchema.parse(input);
  const catalogue = FIELD_CATALOGUE[entity];
  const named = [...Object.keys(mapping.fields), ...Object.keys(mapping.constants), ...Object.keys(mapping.valueMaps)];
  const unknown = [...new Set(named.filter((field) => !(field in catalogue)))];
  if (unknown.length > 0) {
    throw new ValidationError(`${entity} do not have: ${unknown.join(', ')}. They have: ${Object.keys(catalogue).join(', ')}`);
  }
  for (const [field, definition] of Object.entries(catalogue)) {
    if (definition.required && !(field in mapping.fields) && !(field in mapping.constants)) {
      throw new ValidationError(`${entity} need ${field}; say where it is in fields.${field}`);
    }
  }
  if (mapping.comments) {
    if (entity !== 'tickets') throw new ValidationError('only a tickets mapping can carry comments');
    const commentFields = [...Object.keys(mapping.comments.fields), ...Object.keys(mapping.comments.constants)];
    const bad = commentFields.filter((field) => !(field in FIELD_CATALOGUE.comments) || field === 'ticket');
    if (bad.length > 0) throw new ValidationError(`comments do not have: ${bad.join(', ')}`);
    if (!('body' in mapping.comments.fields) && !('body' in mapping.comments.constants)) {
      throw new ValidationError('comments need body; say where it is in comments.fields.body');
    }
  }
  return mapping;
}

// ---------------------------------------------------------------------------
// Reading values
// ---------------------------------------------------------------------------

/** A reference before it is resolved: the candidates, in the order to try. */
export interface Reference {
  candidates: string[];
}

export interface MappedRecord {
  externalKey: string;
  values: Record<string, string | boolean | Date | string[] | Reference | undefined>;
  comments: MappedComment[];
  problems: string[];
  warnings: string[];
}

export interface MappedComment {
  externalKey: string | null;
  values: Record<string, string | boolean | Date | string[] | Reference | undefined>;
  problems: string[];
}

function asText(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') return value.trim() === '' ? undefined : value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return undefined;
}

function readText(record: unknown, from: string | string[]): string | undefined {
  const paths = Array.isArray(from) ? from : [from];
  const parts = paths.map((one) => asText(valueAt(record, one))).filter((part): part is string => part !== undefined);
  return parts.length > 0 ? parts.join(' ') : undefined;
}

function readCandidates(record: unknown, from: string | string[]): string[] {
  const paths = Array.isArray(from) ? from : [from];
  return paths.map((one) => asText(valueAt(record, one))).filter((part): part is string => part !== undefined);
}

/**
 * A date, strictly. ISO 8601 as anything sensible emits it, and the
 * `YYYY-MM-DD HH:MM:SS` that ServiceNow emits (in UTC, when display values
 * are off). Anything else is a problem: a date read wrongly is a ticket
 * resolved before it was raised, and nobody notices until the SLA report.
 */
export function parseDate(text: string): Date | undefined {
  const normalised = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text) ? `${text.replace(' ', 'T')}Z` : text;
  if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(normalised)) return undefined;
  const date = new Date(normalised);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function parseBool(text: string): boolean | undefined {
  const lower = text.toLowerCase();
  if (['true', 'yes', 'y', '1', 'active'].includes(lower)) return true;
  if (['false', 'no', 'n', '0', 'inactive'].includes(lower)) return false;
  return undefined;
}

function parseList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => asText(item)).filter((item): item is string => item !== undefined);
  const text = asText(value);
  return text ? text.split(/[,;]/).map((part) => part.trim()).filter(Boolean) : [];
}

function applyValueMap(mapping: { valueMaps: Record<string, Record<string, string>> }, field: string, raw: string): string | undefined {
  const table = mapping.valueMaps[field];
  if (!table) return raw;
  if (raw in table) return table[raw];
  const relaxed = Object.keys(table).find((key) => key.toLowerCase() === raw.toLowerCase());
  return relaxed !== undefined ? table[relaxed] : undefined;
}

function readField(
  catalogue: Record<string, FieldDefinition>,
  mapping: { fields: Record<string, string | string[]>; constants: Record<string, string | number | boolean>; valueMaps: Record<string, Record<string, string>> },
  field: string,
  record: unknown,
  problems: string[],
): MappedRecord['values'][string] {
  const definition = catalogue[field]!;
  const from = mapping.fields[field];

  if (definition.kind === 'ref') {
    const constant = mapping.constants[field];
    const candidates = from ? readCandidates(record, from) : constant !== undefined ? [String(constant)] : [];
    if (candidates.length === 0) {
      if (definition.required) problems.push(`no value for ${field} at ${Array.isArray(from) ? from.join(' or ') : from ?? '(unmapped)'}`);
      return undefined;
    }
    return { candidates };
  }

  if (definition.kind === 'list') {
    const constant = mapping.constants[field];
    const items = from ? parseList(valueAt(record, Array.isArray(from) ? from[0]! : from)) : constant !== undefined ? parseList(constant) : [];
    return items;
  }

  const rawText = from ? readText(record, from) : undefined;
  const text = rawText ?? (mapping.constants[field] !== undefined ? String(mapping.constants[field]) : undefined);
  if (text === undefined) {
    if (definition.required) problems.push(`no value for ${field} at ${Array.isArray(from) ? from.join(' + ') : from ?? '(unmapped)'}`);
    return undefined;
  }

  const mappedText = applyValueMap(mapping, field, text);
  if (mappedText === undefined) {
    problems.push(`${field} "${text}" is not in valueMaps.${field}; add it, so nothing is guessed`);
    return undefined;
  }

  switch (definition.kind) {
    case 'text':
      return mappedText;
    case 'enum':
      if (!definition.values!.includes(mappedText)) {
        problems.push(`${field} "${mappedText}" is not one of ${definition.values!.join(', ')}; map it in valueMaps.${field}`);
        return undefined;
      }
      return mappedText;
    case 'date': {
      const date = parseDate(mappedText);
      if (!date) problems.push(`${field} "${mappedText}" is not a date this reads (ISO 8601, or YYYY-MM-DD HH:MM:SS in UTC)`);
      return date;
    }
    case 'bool': {
      const bool = parseBool(mappedText);
      if (bool === undefined) problems.push(`${field} "${mappedText}" is not yes or no`);
      return bool;
    }
    default:
      return mappedText;
  }
}

/** Applies a mapping to one record from a source. Pure: references stay unresolved. */
export function mapRecord(entity: Entity, mapping: Mapping, record: unknown): MappedRecord {
  const problems: string[] = [];
  const warnings: string[] = [];
  const catalogue = FIELD_CATALOGUE[entity];

  const externalKey = asText(valueAt(record, mapping.externalKeyFrom));
  if (!externalKey) {
    // Fatal for this row and only this row. Without an identifier the next
    // run would create it again, and the run after that.
    problems.push(`no value at ${mapping.externalKeyFrom}, so there is nothing to remember this row by`);
  }

  const values: MappedRecord['values'] = {};
  for (const field of Object.keys(catalogue)) {
    if (!(field in mapping.fields) && !(field in mapping.constants)) continue;
    values[field] = readField(catalogue, mapping, field, record, problems);
  }

  const comments: MappedComment[] = [];
  if (entity === 'tickets' && mapping.comments) {
    const list = valueAt(record, mapping.comments.from);
    if (list !== undefined && list !== null && !Array.isArray(list)) {
      warnings.push(`${mapping.comments.from} is not a list, so no comments were read`);
    }
    for (const item of Array.isArray(list) ? list : []) {
      const commentProblems: string[] = [];
      const commentValues: MappedComment['values'] = {};
      for (const field of Object.keys(FIELD_CATALOGUE.comments)) {
        if (field === 'ticket') continue;
        if (!(field in mapping.comments.fields) && !(field in mapping.comments.constants)) continue;
        commentValues[field] = readField(FIELD_CATALOGUE.comments, mapping.comments, field, item, commentProblems);
      }
      comments.push({
        externalKey: mapping.comments.externalKeyFrom ? (asText(valueAt(item, mapping.comments.externalKeyFrom)) ?? null) : null,
        values: commentValues,
        problems: commentProblems,
      });
    }
  }

  return { externalKey: externalKey ?? '', values, comments, problems, warnings };
}

/** A key of ours from a name of theirs: `Service Desk (EMEA)` → `service-desk-emea`. */
export function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return /^[a-z]/.test(slug) ? slug : `x-${slug}`.slice(0, 60);
}

export function looksLikeEmail(text: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text);
}
