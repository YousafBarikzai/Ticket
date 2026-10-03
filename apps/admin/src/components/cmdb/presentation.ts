import type { IconName, Tone } from '@itsm/ui';
import type { AssetFilter, AssetRow, AuditEventRow, CiAttribute, CiClassRow, CiFilter, CiRow, ImpactResult } from '@itsm/sdk';
import { formatDateTime, formatList } from '@itsm/ui/format';
import { keyFor, slugFor } from '../../keys.js';
import type { PersonRef } from '../PersonCell.js';

/**
 * Configuration items and assets in words and URLs (SPEC §6.1 `/cmdb`,
 * `/cmdb/assets`; B §3.12): the query strings both pages answer to, the class
 * tree, how an item, a relationship, an impact and an asset read, and the
 * typed class attributes as a form reads and writes them.
 *
 * Pure and server-safe — the pages build their rows with it, and the client
 * views and tests import the same functions — so the parts that can quietly go
 * wrong (a relationship read the wrong way round, a filter the API would
 * refuse, a date shown a day early) are tested once, here.
 */

type Params = URLSearchParams | Readonly<Record<string, string | string[] | undefined>>;

function get(params: Params, name: string): string | null {
  if (params instanceof URLSearchParams) return params.get(name);
  const value = params[name];
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string | null | undefined): value is string {
  return typeof value === 'string' && UUID.test(value);
}

/**
 * The drawer a URL names, `?open=<kind>:<key>` (SPEC §4.10), read on the
 * server. `client/useDrawer.ts` has the same reader, but it is a client
 * module and a server page cannot call it (it fails at run time, not at type
 * check), so the few lines live here too.
 */
export function drawerTarget(value: string | string[] | undefined | null, kind: string): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || !raw.startsWith(`${kind}:`)) return null;
  const key = raw.slice(kind.length + 1);
  return key === '' ? null : key;
}

/* =========================================================================
 * Vocabulary
 * ====================================================================== */

export interface Look {
  readonly label: string;
  readonly tone: Tone;
  readonly icon?: IconName;
}

export const CI_STATUSES = ['operational', 'degraded', 'down', 'retired'] as const;
export type CiStatus = (typeof CI_STATUSES)[number];
/** The statuses a person sets; retiring is its own, deliberate, action. */
export const SETTABLE_STATUSES = ['operational', 'degraded', 'down'] as const;
export type SettableStatus = (typeof SETTABLE_STATUSES)[number];

export const CI_STATUS_LOOK: Readonly<Record<string, Look>> = {
  operational: { label: 'Operational', tone: 'success', icon: 'circle-check' },
  // `high` orange, as a status-page component's degraded (X-B3); amber stays SLA risk (D5).
  degraded: { label: 'Degraded', tone: 'high', icon: 'triangle-alert' },
  down: { label: 'Down', tone: 'danger', icon: 'circle-x' },
  retired: { label: 'Retired', tone: 'neutral', icon: 'archive' },
};

export const CRITICALITIES = ['low', 'medium', 'high', 'critical'] as const;
export type Criticality = (typeof CRITICALITIES)[number];

/** Critical is danger and High warning; the rest are neutral, and the word always shows. */
export const CRITICALITY_LOOK: Readonly<Record<string, Look>> = {
  critical: { label: 'Critical', tone: 'danger' },
  high: { label: 'High', tone: 'high' },
  medium: { label: 'Medium', tone: 'neutral' },
  low: { label: 'Low', tone: 'neutral' },
};

export const CRITICALITY_RANK: Readonly<Record<string, number>> = { critical: 3, high: 2, medium: 1, low: 0 };

export const SOURCE_LOOK: Readonly<Record<string, Look>> = {
  manual: { label: 'Manual', tone: 'neutral', icon: 'user' },
  discovery: { label: 'Discovered', tone: 'info', icon: 'search' },
  import: { label: 'Imported', tone: 'neutral', icon: 'upload' },
};

export const ASSET_STATUSES = ['in_stock', 'assigned', 'in_repair', 'retired', 'disposed'] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

export const ASSET_STATUS_LOOK: Readonly<Record<string, Look>> = {
  in_stock: { label: 'In stock', tone: 'neutral', icon: 'dot' },
  assigned: { label: 'Assigned', tone: 'info', icon: 'user' },
  in_repair: { label: 'In repair', tone: 'hold', icon: 'settings-2' },
  retired: { label: 'Retired', tone: 'neutral', icon: 'archive' },
  disposed: { label: 'Disposed of', tone: 'neutral', icon: 'trash' },
};

/** A value the vocabulary does not know, in words rather than as its key. */
export function humanise(value: string): string {
  const words = value.replace(/[_.-]+/g, ' ').trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : value;
}

export function lookOf(map: Readonly<Record<string, Look>>, value: string): Look {
  return map[value] ?? { label: humanise(value), tone: 'neutral' };
}

/* =========================================================================
 * Relationships: which way round, in words
 * ====================================================================== */

export const RELATIONSHIP_TYPES = ['depends_on', 'runs_on', 'installed_on', 'member_of', 'connected_to'] as const;
export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];

const VERB: Readonly<Record<string, string>> = {
  depends_on: 'depends on',
  runs_on: 'runs on',
  installed_on: 'is installed on',
  member_of: 'is a member of',
  connected_to: 'is connected to',
};

/** "depends on", "is installed on" — the verb of `from <type> to`. */
export function verbOf(type: string): string {
  return VERB[type] ?? humanise(type).toLowerCase();
}

/**
 * The sentence a relationship reads as, the same one the API answers with
 * when it records one (`modules/assets` `describe`): `from type to`. The
 * direction is the part every CMDB gets wrong, so it is always read back.
 */
export function relationSentence(type: string, from: string, to: string): string {
  switch (type) {
    case 'depends_on':
      return `${from} depends on ${to}: if ${to} fails, ${from} is in trouble.`;
    case 'connected_to':
      return `${from} is connected to ${to}; neither depends on the other.`;
    default:
      return `${from} ${verbOf(type)} ${to}.`;
  }
}

/**
 * One edge as seen from an item, to sit beside the other item's name: what
 * it needs reads "Runs on · Host 01" (it is `from`); what needs it reads
 * "Web shop · depends on it" (it is `to`) — so each line is a sentence the
 * right way round.
 */
export function edgeLabel(type: string, direction: 'needs' | 'neededBy'): string {
  if (direction === 'needs') {
    const verb = verbOf(type).replace(/^is /, '');
    return verb[0]!.toUpperCase() + verb.slice(1);
  }
  return `${verbOf(type)} it`;
}

/**
 * What the Relate dialog offers: every type in both directions, phrased from
 * the open item, so nobody has to know which end is `from`. `connected_to`
 * has no direction and is offered once.
 */
export interface RelateChoice {
  readonly value: string;
  readonly type: RelationshipType;
  /** Whether the open item is the relationship's `from` end. */
  readonly thisIsFrom: boolean;
  readonly label: string;
}

export function relateChoices(name: string): RelateChoice[] {
  const out: RelateChoice[] = RELATIONSHIP_TYPES.map((type) => ({ value: `out:${type}`, type, thisIsFrom: true, label: `${name} ${verbOf(type)}…` }));
  for (const type of RELATIONSHIP_TYPES) {
    if (type === 'connected_to') continue;
    out.push({ value: `in:${type}`, type, thisIsFrom: false, label: `…${verbOf(type)} ${name}` });
  }
  return out;
}

/** The relationship a Relate choice records between the open item and the other. */
export function relationshipFor(choice: RelateChoice, thisId: string, otherId: string): { fromCi: string; toCi: string; type: RelationshipType } {
  return choice.thisIsFrom ? { fromCi: thisId, toCi: otherId, type: choice.type } : { fromCi: otherId, toCi: thisId, type: choice.type };
}

/* =========================================================================
 * Classes
 * ====================================================================== */

export interface ClassNode {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly parentId: string | null;
  readonly depth: number;
  readonly children: readonly ClassNode[];
}

/**
 * The classes as a tree, each level by name. A class whose parent is missing
 * (inactive, or out of the list) sits at the top rather than disappearing,
 * and a loop the API should have refused cannot recurse for ever.
 */
export function classTree(classes: readonly CiClassRow[]): ClassNode[] {
  const byId = new Map(classes.map((row) => [row.id, row]));
  const childrenOf = new Map<string | null, CiClassRow[]>();
  for (const row of classes) {
    const parent = row.parentId && byId.has(row.parentId) && row.parentId !== row.id ? row.parentId : null;
    const list = childrenOf.get(parent) ?? [];
    list.push(row);
    childrenOf.set(parent, list);
  }
  const seen = new Set<string>();
  const build = (parent: string | null, depth: number): ClassNode[] =>
    [...(childrenOf.get(parent) ?? [])]
      .sort((a, b) => a.name.localeCompare(b.name))
      .filter((row) => !seen.has(row.id))
      .map((row) => {
        seen.add(row.id);
        return { id: row.id, key: row.key, name: row.name, parentId: row.parentId, depth, children: depth < 12 ? build(row.id, depth + 1) : [] };
      });
  return build(null, 0);
}

export function flattenTree(tree: readonly ClassNode[]): ClassNode[] {
  return tree.flatMap((node) => [node, ...flattenTree(node.children)]);
}

/** A class and every class below it, by key: choosing "Server" lists database servers too. */
export function classAndDescendants(tree: readonly ClassNode[], key: string): string[] {
  const node = flattenTree(tree).find((entry) => entry.key === key);
  return node ? flattenTree([node]).map((entry) => entry.key) : [key];
}

/** "Server › Database server": where a class sits. */
export function classPath(classes: readonly CiClassRow[], classId: string): string | null {
  const byId = new Map(classes.map((row) => [row.id, row]));
  const names: string[] = [];
  let current = byId.get(classId);
  for (let guard = 0; current && guard < 12; guard += 1) {
    names.unshift(current.name);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return names.length > 0 ? names.join(' › ') : null;
}

/** The class `Select` on phones and in sheets: indented by depth, since a native option cannot nest. */
export function classOptions(tree: readonly ClassNode[]): { value: string; label: string }[] {
  return flattenTree(tree).map((node) => ({ value: node.key, label: `${' '.repeat(node.depth)}${node.name}` }));
}

/** `^[a-z][a-z0-9_]{1,60}$` — the key of a class (lower snake case). */
export const CLASS_KEY = /^[a-z][a-z0-9_]{1,60}$/;

/** "Database server" → `database_server`; empty when no valid key can be made. */
export function classKeyFor(name: string): string {
  const key = slugFor(name).replace(/-/g, '_').slice(0, 61).replace(/_+$/, '');
  return CLASS_KEY.test(key) ? key : '';
}

/** `^[a-z][a-zA-Z0-9]*$` — an attribute's key (lower camel case). */
export const ATTRIBUTE_KEY = /^[a-z][a-zA-Z0-9]{0,63}$/;

export function attributeKeyFor(label: string): string {
  return keyFor(label);
}

function sameAttribute(a: CiAttribute, b: CiAttribute): boolean {
  return (
    a.key === b.key &&
    a.label === b.label &&
    a.type === b.type &&
    a.required === b.required &&
    (a.options ?? []).join('\u0000') === (b.options ?? []).join('\u0000')
  );
}

/**
 * A class's own attributes, from what it carries (inheritance included) less
 * what its parent carries unchanged. The API answers only the merged list; a
 * subclass that tightens an inherited attribute ("required here") keeps that
 * attribute as its own.
 */
export function ownAttributes(carried: readonly CiAttribute[], inherited: readonly CiAttribute[]): CiAttribute[] {
  const parent = new Map(inherited.map((attribute) => [attribute.key, attribute]));
  return carried.filter((attribute) => {
    const from = parent.get(attribute.key);
    return !from || !sameAttribute(from, attribute);
  });
}

/* =========================================================================
 * The Configuration items query
 * ====================================================================== */

/** The API has no cursor for items: this many, then "search or filter to narrow". */
export const CI_LIMIT = 100;

export interface CiQuery {
  readonly classKey: string | null;
  readonly q: string;
  readonly status: CiStatus | null;
  readonly criticality: Criticality | null;
  /** Include retired items (they are left out by default, as the API leaves them out). */
  readonly retired: boolean;
}

export function readCiQuery(params: Params): CiQuery {
  const status = get(params, 'status');
  const criticality = get(params, 'criticality');
  const classKey = get(params, 'class');
  return {
    classKey: classKey && /^[a-z][a-z0-9_]{0,60}$/.test(classKey) ? classKey : null,
    q: (get(params, 'q') ?? '').trim().slice(0, 200),
    status: (CI_STATUSES as readonly string[]).includes(status ?? '') ? (status as CiStatus) : null,
    criticality: (CRITICALITIES as readonly string[]).includes(criticality ?? '') ? (criticality as Criticality) : null,
    retired: get(params, 'retired') === 'true',
  };
}

export function isCiFiltered(query: CiQuery): boolean {
  return query.q !== '' || query.status !== null || query.criticality !== null || query.retired;
}

/**
 * What to ask the API: one filter per class — the chosen class and those
 * below it, since the API matches one class exactly — or one for everything.
 * Asking for Retired includes retired items, or the answer would always be
 * empty.
 */
export function ciFilters(query: CiQuery, classKeys: readonly string[] | null): CiFilter[] {
  const base: CiFilter = {
    ...(query.q ? { search: query.q } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.criticality ? { criticality: query.criticality } : {}),
    ...(query.retired || query.status === 'retired' ? { includeRetired: true } : {}),
    limit: CI_LIMIT,
  };
  if (!classKeys || classKeys.length === 0) return [base];
  return classKeys.map((classKey) => ({ ...base, classKey }));
}

/** Several classes' answers as one list: each item once, by name, the first hundred. */
export function mergeCis(lists: readonly (readonly CiRow[])[], limit: number = CI_LIMIT): CiRow[] {
  const byId = new Map<string, CiRow>();
  for (const list of lists) for (const row of list) if (!byId.has(row.id)) byId.set(row.id, row);
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name)).slice(0, limit);
}

/** The class links keep the other filters: switching class does not clear a search. */
export function classHref(search: string, classKey: string | null): string {
  const params = new URLSearchParams(search);
  params.delete('open');
  params.delete('new');
  if (classKey) params.set('class', classKey);
  else params.delete('class');
  const query = params.toString();
  return query ? `/cmdb?${query}` : '/cmdb';
}

/* =========================================================================
 * An item, as a row and as facts
 * ====================================================================== */

export interface CiView extends Record<string, unknown> {
  readonly id: string;
  readonly name: string;
  readonly classId: string | null;
  readonly classKey: string | null;
  readonly className: string | null;
  readonly status: string;
  readonly criticality: string;
  readonly criticalityRank: number;
  readonly environment: string | null;
  readonly serviceId: string | null;
  /** The service's name, when this person can read the catalogue. */
  readonly serviceName: string | null;
  readonly owner: PersonRef | null;
  /** For sorting and searching the loaded rows. */
  readonly ownerName: string | null;
  readonly source: string;
  readonly externalKey: string | null;
  readonly description: string | null;
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly updatedAt: string;
  readonly retiredAt: string | null;
}

export interface CiContext {
  readonly classes: readonly CiClassRow[];
  serviceName(id: string): string | null;
  person(id: string | null): PersonRef | null;
}

export function ciView(row: CiRow, context: CiContext): CiView {
  const cls = row.classId ? context.classes.find((entry) => entry.id === row.classId) : undefined;
  const owner = context.person(row.ownerId);
  return {
    id: row.id,
    name: row.name,
    classId: row.classId ?? null,
    classKey: cls?.key ?? null,
    className: cls?.name ?? null,
    status: row.status,
    criticality: row.criticality,
    criticalityRank: CRITICALITY_RANK[row.criticality] ?? 1,
    environment: row.environment,
    serviceId: row.serviceId,
    serviceName: row.serviceId ? context.serviceName(row.serviceId) : null,
    owner,
    ownerName: owner?.name ?? null,
    source: row.source,
    externalKey: row.externalKey,
    description: row.description,
    attributes: isRecord(row.attributes) ? row.attributes : {},
    updatedAt: row.updatedAt,
    retiredAt: row.retiredAt,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Common environments, offered as suggestions; the API takes any short text. */
export const ENVIRONMENT_SUGGESTIONS = ['Production', 'Staging', 'Test', 'Development'] as const;

/* =========================================================================
 * Class attributes: shown, and edited as typed fields
 * ====================================================================== */

/** A date-only value (`2026-10-15`) as the reader's date — in UTC, so it never slips a day. */
export function formatDay(value: string, locale: string): string {
  const day = /^\d{4}-\d{2}-\d{2}/.exec(value)?.[0];
  if (!day) return value;
  return formatDateTime(`${day}T00:00:00Z`, { locale, timeZone: 'UTC', style: 'date' });
}

export function attributeText(definition: Pick<CiAttribute, 'type'> | undefined, value: unknown, locale: string): string {
  if (value === undefined || value === null || value === '') return '';
  switch (definition?.type) {
    case 'boolean':
      return value === true ? 'Yes' : value === false ? 'No' : String(value);
    case 'date':
      return typeof value === 'string' ? formatDay(value, locale) : String(value);
    case 'number':
      return typeof value === 'number' ? new Intl.NumberFormat(locale).format(value) : String(value);
    default:
      if (typeof value === 'string' || typeof value === 'number') return String(value);
      if (typeof value === 'boolean') return value ? 'Yes' : 'No';
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
  }
}

/** A form's attribute answers as text, by key: `''` is unanswered, booleans are `'true'`/`'false'`. */
export type AttributeDraft = Readonly<Record<string, string>>;

export function draftOf(definitions: readonly CiAttribute[], values: Readonly<Record<string, unknown>>): AttributeDraft {
  const draft: Record<string, string> = {};
  for (const definition of definitions) {
    const value = values[definition.key];
    if (value === undefined || value === null) draft[definition.key] = '';
    else if (typeof value === 'boolean') draft[definition.key] = value ? 'true' : 'false';
    else if (typeof value === 'string' || typeof value === 'number') draft[definition.key] = String(value);
    else draft[definition.key] = '';
  }
  return draft;
}

/**
 * The answers as the API wants them, and what is wrong with them — the same
 * checks the API makes (`modules/assets` `checkAttributes`), said per field
 * before anything is sent. For an edit (`previous` given) only changed
 * answers are sent, and a cleared one is sent as `null`, which the API reads
 * as "not set".
 */
export function attributeValues(
  definitions: readonly CiAttribute[],
  draft: AttributeDraft,
  previous?: Readonly<Record<string, unknown>>,
): { readonly values: Record<string, unknown>; readonly problems: Record<string, string> } {
  const values: Record<string, unknown> = {};
  const problems: Record<string, string> = {};
  for (const definition of definitions) {
    const raw = (draft[definition.key] ?? '').trim();
    let value: unknown = null;
    if (raw === '') {
      if (definition.required) problems[definition.key] = `${definition.label} is required.`;
    } else {
      switch (definition.type) {
        case 'number': {
          const number = Number(raw.replace(/,/g, ''));
          if (!Number.isFinite(number)) problems[definition.key] = `${definition.label} must be a number.`;
          else value = number;
          break;
        }
        case 'boolean':
          value = raw === 'true';
          break;
        case 'date':
          if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(Date.parse(`${raw}T00:00:00Z`))) problems[definition.key] = `${definition.label} must be a date.`;
          else value = raw;
          break;
        case 'enum':
          if (!(definition.options ?? []).includes(raw)) problems[definition.key] = `Choose one of the ${definition.label.toLowerCase()} options.`;
          else value = raw;
          break;
        default:
          value = raw;
      }
    }
    if (problems[definition.key]) continue;
    if (previous) {
      const before = previous[definition.key] ?? null;
      if (before === value) continue;
      values[definition.key] = value;
    } else if (value !== null) {
      values[definition.key] = value;
    }
  }
  return { values, problems };
}

/* =========================================================================
 * Impact: if this fails
 * ====================================================================== */

export function depthLabel(depth: number): string {
  if (depth <= 1) return 'Directly';
  const words = ['', '', 'Two', 'Three', 'Four', 'Five', 'Six'];
  return `${words[depth] ?? String(depth)} steps away`;
}

export interface ImpactGroup {
  readonly depth: number;
  readonly label: string;
  readonly items: ImpactResult['data'];
}

/** The reached items by how far away they are, nearest first; the API sorts each depth critical-first. */
export function impactGroups(nodes: ImpactResult['data']): ImpactGroup[] {
  const byDepth = new Map<number, ImpactResult['data'][number][]>();
  for (const node of nodes) {
    const list = byDepth.get(node.depth) ?? [];
    list.push(node);
    byDepth.set(node.depth, list);
  }
  return [...byDepth.entries()].sort(([a], [b]) => a - b).map(([depth, items]) => ({ depth, label: depthLabel(depth), items }));
}

/** "4 items are affected, 1 of them critical, across 2 services." — what somebody reads out on a bridge call. */
export function impactSentence(summary: ImpactResult['summary'], serviceNames: readonly string[]): string {
  if (summary.total === 0) return 'Nothing recorded depends on it.';
  const parts = [`${summary.total} ${summary.total === 1 ? 'item is' : 'items are'} affected`];
  const critical = summary.byCriticality.critical ?? 0;
  const high = summary.byCriticality.high ?? 0;
  if (critical > 0) parts.push(`${critical} of them critical`);
  else if (high > 0) parts.push(`${high} of them high criticality`);
  let sentence = parts.join(', ');
  const services = summary.services.length;
  if (services > 0) {
    sentence += serviceNames.length === services && services <= 3 ? `, across ${formatList(serviceNames, { locale: 'en-GB' })}` : `, across ${services} ${services === 1 ? 'service' : 'services'}`;
  }
  return `${sentence}.`;
}

/* =========================================================================
 * Linked records and history
 * ====================================================================== */

export const ENTITY_LOOK: Readonly<Record<string, { readonly one: string; readonly other: string; readonly icon: IconName }>> = {
  ticket: { one: 'Ticket', other: 'Tickets', icon: 'ticket' },
  major_incident: { one: 'Major incident', other: 'Major incidents', icon: 'triangle-alert' },
  problem: { one: 'Problem', other: 'Problems', icon: 'circle-alert' },
  change: { one: 'Change', other: 'Changes', icon: 'refresh-cw' },
};

/** What the record said about this item: it was affected, it was the cause, or the record changed it. */
export const LINK_ROLE_LABEL: Readonly<Record<string, string>> = {
  affected: 'Named it as affected',
  caused_by: 'Named it as the cause',
  changed: 'Changed it',
};

/**
 * One line of an item's audit trail, in words: what happened — a verb phrase,
 * since the timeline puts who did it first ("Alex recorded it") — and the
 * detail worth reading.
 */
export function historyEntry(event: Pick<AuditEventRow, 'action' | 'before' | 'after' | 'reason'>, locale: string): { title: string; body?: string; tone?: Tone } {
  const before = isRecord(event.before) ? event.before : {};
  const after = isRecord(event.after) ? event.after : {};
  const status = (value: unknown): string => (typeof value === 'string' ? lookOf(CI_STATUS_LOOK, value).label : 'unknown');
  switch (event.action) {
    case 'cmdb.ci.created':
      return { title: 'recorded it', ...(typeof after.criticality === 'string' ? { body: `${lookOf(CRITICALITY_LOOK, after.criticality).label} criticality` } : {}) };
    case 'cmdb.ci.updated': {
      const changes: string[] = [];
      if (before.name !== after.name && typeof after.name === 'string') changes.push(`renamed from “${String(before.name)}” to “${after.name}”`);
      if (before.criticality !== after.criticality && typeof after.criticality === 'string') {
        changes.push(`criticality ${typeof before.criticality === 'string' ? `from ${lookOf(CRITICALITY_LOOK, before.criticality).label} ` : ''}to ${lookOf(CRITICALITY_LOOK, after.criticality).label}`);
      }
      if (before.serviceId !== after.serviceId) changes.push('service changed');
      return { title: 'updated it', ...(changes.length > 0 ? { body: capitalise(formatList(changes, { locale })) } : {}) };
    }
    case 'cmdb.ci.status.changed': {
      const note = typeof after.note === 'string' && after.note ? after.note : null;
      const to = typeof after.status === 'string' ? after.status : '';
      return {
        title: `changed its status from ${status(before.status)} to ${status(to)}`,
        tone: lookOf(CI_STATUS_LOOK, to).tone,
        ...(note ? { body: note } : {}),
      };
    }
    case 'cmdb.ci.retired': {
      const reason = typeof after.reason === 'string' ? after.reason : event.reason;
      return { title: 'retired it', tone: 'neutral', ...(reason ? { body: reason } : {}) };
    }
    default:
      return { title: humanise(event.action.replace(/^cmdb\.ci\./, '')).toLowerCase() };
  }
}

function capitalise(text: string): string {
  return text ? text[0]!.toUpperCase() + text.slice(1) : text;
}

/* =========================================================================
 * Assets
 * ====================================================================== */

/** The register's first page; the API has no cursor for assets either. */
export const ASSET_LIMIT = 100;

/** The warranty filter: ending within 30 or 90 days (expired ones included), or already expired. */
export const WARRANTY_WINDOWS = [
  { value: '30', label: 'Ends within 30 days', days: 30 },
  { value: '90', label: 'Ends within 90 days', days: 90 },
  { value: 'expired', label: 'Already expired', days: 1 },
] as const;
export type WarrantyWindow = (typeof WARRANTY_WINDOWS)[number]['value'];

export interface AssetQuery {
  readonly q: string;
  readonly status: AssetStatus | null;
  readonly costCentre: string | null;
  readonly holder: string | null;
  readonly warranty: WarrantyWindow | null;
}

export function readAssetQuery(params: Params): AssetQuery {
  const status = get(params, 'status');
  const costCentre = (get(params, 'costCentre') ?? '').trim();
  const holder = get(params, 'holder');
  const warranty = get(params, 'warranty');
  return {
    q: (get(params, 'q') ?? '').trim().slice(0, 200),
    status: (ASSET_STATUSES as readonly string[]).includes(status ?? '') ? (status as AssetStatus) : null,
    costCentre: costCentre && costCentre.length <= 60 ? costCentre : null,
    holder: isUuid(holder) ? holder : null,
    warranty: WARRANTY_WINDOWS.some((entry) => entry.value === warranty) ? (warranty as WarrantyWindow) : null,
  };
}

export function isAssetFiltered(query: AssetQuery): boolean {
  return query.q !== '' || query.status !== null || query.costCentre !== null || query.holder !== null || query.warranty !== null;
}

export function assetFilter(query: AssetQuery): AssetFilter {
  return {
    ...(query.q ? { search: query.q } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.costCentre ? { costCentre: query.costCentre } : {}),
    ...(query.holder ? { userId: query.holder } : {}),
    limit: ASSET_LIMIT,
  };
}

export function warrantyDays(window: WarrantyWindow): number {
  return WARRANTY_WINDOWS.find((entry) => entry.value === window)?.days ?? 30;
}

/**
 * The warranty report answers every expiring and expired warranty and takes
 * no other filter, so the rest of the query is applied to its rows here — the
 * same matching the list endpoint does (tag or serial contains the search,
 * exact status and cost centre).
 */
export function narrowWarrantyRows<T extends AssetRow & { expired?: boolean }>(rows: readonly T[], query: AssetQuery): T[] {
  const search = query.q.toLowerCase();
  return rows.filter(
    (row) =>
      (query.warranty !== 'expired' || row.expired === true) &&
      (!search || row.tag.toLowerCase().includes(search) || (row.serial ?? '').toLowerCase().includes(search)) &&
      (!query.status || row.status === query.status) &&
      (!query.costCentre || row.costCentre === query.costCentre) &&
      (!query.holder || row.holderId === query.holder),
  );
}

/** Today's date where the reader is, `YYYY-MM-DD`. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
    const part = (type: string): string => parts.find((entry) => entry.type === type)?.value ?? '';
    return `${part('year')}-${part('month')}-${part('day')}`;
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

export interface WarrantyState {
  readonly kind: 'none' | 'ok' | 'soon' | 'expired';
  /** Whole days from today to the end date; negative once it has passed. */
  readonly days: number | null;
}

/** A warranty against today: over, ending within `soonDays`, fine, or not recorded. Worked out on the server, so no clock differs at hydration. */
export function warrantyState(endsOn: string | null, today: string, soonDays = 30): WarrantyState {
  if (!endsOn) return { kind: 'none', days: null };
  const end = Date.parse(`${endsOn.slice(0, 10)}T00:00:00Z`);
  const now = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(end) || Number.isNaN(now)) return { kind: 'none', days: null };
  const days = Math.round((end - now) / 86_400_000);
  if (days < 0) return { kind: 'expired', days };
  return { kind: days <= soonDays ? 'soon' : 'ok', days };
}

/** "Ends in 12 days" (warning) or "Expired" (danger); nothing while the end is further off. */
export function warrantyChip(state: WarrantyState): Look | null {
  if (state.kind === 'expired') return { label: 'Expired', tone: 'danger', icon: 'circle-x' };
  if (state.kind !== 'soon' || state.days === null) return null;
  const label = state.days === 0 ? 'Ends today' : state.days === 1 ? 'Ends tomorrow' : `Ends in ${state.days} days`;
  return { label, tone: 'warning', icon: 'clock' };
}

export interface AssetView extends Record<string, unknown> {
  readonly id: string;
  readonly tag: string;
  readonly serial: string | null;
  readonly status: string;
  /** Null when nobody holds it; undefined when the API does not say (an older API). */
  readonly holder: PersonRef | null | undefined;
  readonly holderName: string | null;
  readonly location: string | null;
  readonly costCentre: string | null;
  readonly supplier: string | null;
  readonly ciId: string | null;
  readonly purchasedOn: string | null;
  readonly warrantyEndsOn: string | null;
  /** The end date in the reader's words, worked out on the server. */
  readonly warrantyText: string | null;
  readonly warranty: WarrantyState;
  readonly retiredAt: string | null;
}

export function assetView(row: AssetRow, context: { person(id: string | null): PersonRef | null; today: string; locale: string }): AssetView {
  const holder = row.holderId === undefined ? undefined : context.person(row.holderId);
  return {
    id: row.id,
    tag: row.tag,
    serial: row.serial,
    status: row.status,
    holder,
    holderName: holder?.name ?? null,
    location: row.location,
    costCentre: row.costCentre,
    supplier: row.supplier,
    ciId: row.ciId,
    purchasedOn: row.purchasedOn,
    warrantyEndsOn: row.warrantyEndsOn,
    warrantyText: row.warrantyEndsOn ? formatDay(row.warrantyEndsOn, context.locale) : null,
    // A retired asset's warranty no longer needs anyone: the date stays, the warning does not.
    warranty: row.retiredAt ? { kind: row.warrantyEndsOn ? 'ok' : 'none', days: null } : warrantyState(row.warrantyEndsOn, context.today),
    retiredAt: row.retiredAt,
  };
}

/** Whether an asset can still be changed: the API refuses writes to a retired one. */
export function assetIsActive(status: string, retiredAt: string | null): boolean {
  return retiredAt === null && status !== 'retired' && status !== 'disposed';
}

/** Distinct cost centres, for the filter's choices. */
export function costCentres(rows: readonly Pick<AssetRow, 'costCentre'>[], current: string | null): string[] {
  const set = new Set(rows.map((row) => row.costCentre).filter((value): value is string => !!value));
  if (current) set.add(current);
  return [...set].sort((a, b) => a.localeCompare(b));
}

/** "AST-00012" → an asset's words for a toast or a title. */
export function assetTitle(asset: Pick<AssetView, 'tag' | 'serial'>): string {
  return asset.serial ? `${asset.tag} · ${asset.serial}` : asset.tag;
}
