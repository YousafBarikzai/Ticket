import type { IconName, Tone } from '@itsm/ui';
import type { PermissionRow, RoleRow, SecurityAlertRow } from '@itsm/sdk';
import { permissionLabel } from '../../permissions.js';

/**
 * Security in words (SPEC §6.1 `/security/**`, B §3.15): alerts the audit
 * pipeline raised, read as sentences rather than as a type string and a JSON
 * blob; and who can do what, as a matrix of roles against the areas of the
 * product and a registry of every permission. Pure and server-safe, so both
 * the wording and the arithmetic behind "Work · their teams" have tests.
 */

/* =========================================================================
 * Alerts
 * ====================================================================== */

export type Severity = 'critical' | 'high' | 'medium' | 'low';

export const SEVERITIES: readonly Severity[] = ['critical', 'high', 'medium', 'low'];

export const SEVERITY_LOOK: Readonly<Record<Severity, { readonly label: string; readonly tone: Tone; readonly icon: IconName; readonly rank: number }>> = {
  critical: { label: 'Critical', tone: 'danger', icon: 'circle-x', rank: 0 },
  high: { label: 'High', tone: 'danger', icon: 'triangle-alert', rank: 1 },
  medium: { label: 'Medium', tone: 'warning', icon: 'circle-alert', rank: 2 },
  low: { label: 'Low', tone: 'neutral', icon: 'info', rank: 3 },
};

export function severityOf(value: string): Severity {
  return (SEVERITIES as readonly string[]).includes(value) ? (value as Severity) : 'low';
}

/** What each kind of alert is, in the words an administrator would use for it. */
const ALERT_TITLES: Readonly<Record<string, string>> = {
  'auth.login.failed.burst': 'Repeated failed sign-ins',
  'privilege.administrator.granted': 'Administrator role granted',
  'attachment.infected': 'Infected attachment blocked',
  'audit.chain.broken': 'Audit trail chain broken',
};

/** `data.export.unusual` → "Data export unusual": every alert has a readable title, known or not. */
export function alertTitle(type: string): string {
  const known = ALERT_TITLES[type];
  if (known) return known;
  const words = type.replace(/[._-]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Security alert';
}

type Details = Readonly<Record<string, unknown>>;

function detailsOf(alert: Pick<SecurityAlertRow, 'details'>): Details {
  return alert.details && typeof alert.details === 'object' && !Array.isArray(alert.details) ? (alert.details as Details) : {};
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : typeof value === 'number' && Number.isFinite(value) ? String(value) : null;
}

/** A person named in an alert: their name, or "someone" when the directory could not say. */
export type NameOf = (id: string) => string | null;

function person(value: unknown, nameOf: NameOf): string | null {
  const id = text(value);
  if (!id) return null;
  return nameOf(id) ?? 'someone the directory can’t name';
}

/** The sequence number of an event, from a chain-break alert's `brokenAt`. */
export function brokenAtSeq(alert: Pick<SecurityAlertRow, 'type' | 'details'>): string | null {
  if (alert.type !== 'audit.chain.broken') return null;
  const at = detailsOf(alert).brokenAt;
  if (!at || typeof at !== 'object') return null;
  const seq = text((at as Record<string, unknown>).seq);
  return seq && /^\d+$/.test(seq) ? seq : null;
}

/**
 * The alert in one sentence, from its `details` (B §3.15: "5 attempts for
 * sam@acme from 203.0.113.9"). Never a JSON dump: an unknown alert says how
 * many details it carries and leaves them to the drawer.
 */
export function alertSummary(alert: Pick<SecurityAlertRow, 'type' | 'details'>, nameOf: NameOf): string {
  const d = detailsOf(alert);
  switch (alert.type) {
    case 'auth.login.failed.burst': {
      const attempts = text(d.attempts);
      const who = text(d.subject);
      const from = text(d.ip);
      const minutes = text(d.windowMinutes);
      return [
        attempts ? `${attempts} failed attempts` : 'Failed attempts',
        who ? `for ${who}` : null,
        from ? `from ${from}` : null,
        minutes ? `within ${minutes} minutes` : null,
      ]
        .filter(Boolean)
        .join(' ');
    }
    case 'privilege.administrator.granted': {
      const to = person(d.userId, nameOf);
      const by = person(d.grantedBy, nameOf);
      if (to && by) return `${capitalise(by)} made ${to} an administrator`;
      if (to) return `${capitalise(to)} was made an administrator`;
      return 'Someone was made an administrator';
    }
    case 'attachment.infected': {
      const file = text(d.filename);
      const signature = text(d.signature);
      return `${file ? `“${file}”` : 'An attachment'} was held back${signature && signature !== 'unknown' ? ` · ${signature}` : ''}`;
    }
    case 'audit.chain.broken': {
      const seq = brokenAtSeq(alert);
      const checked = text(d.checked);
      return `The nightly check found the chain broken${seq ? ` at #${seq}` : ''}${checked ? ` after checking ${Number(checked).toLocaleString('en-GB')} events` : ''}`;
    }
    default: {
      const count = Object.keys(d).length;
      return count === 0 ? 'No further details' : `${count} ${count === 1 ? 'detail' : 'details'} recorded`;
    }
  }
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

const DETAIL_LABELS: Readonly<Record<string, string>> = {
  subject: 'Account',
  ip: 'From address',
  attempts: 'Attempts',
  windowMinutes: 'Within (minutes)',
  userId: 'Person',
  grantedBy: 'Granted by',
  roleKey: 'Role',
  attachmentId: 'Attachment',
  filename: 'File',
  signature: 'Signature',
  checked: 'Events checked',
  brokenAt: 'Broken at',
};

/** `windowMinutes` → "Window minutes" for a detail the page has no label for. */
function detailLabel(key: string): string {
  const known = DETAIL_LABELS[key];
  if (known) return known;
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[._-]+/g, ' ')
    .trim()
    .toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : key;
}

/** Keys whose value is a person's id, named instead of printed. */
const PERSON_KEYS = new Set(['userId', 'grantedBy', 'actorId', 'revokedBy']);

export interface AlertDetail {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  /** Monospaced: an address, a signature, an id nobody can name. */
  readonly mono?: boolean;
}

/**
 * The drawer's key/value grid: every detail the alert carries, labelled in
 * words, people named, nested values written out plainly.
 */
export function alertDetails(alert: Pick<SecurityAlertRow, 'type' | 'details'>, nameOf: NameOf, roleNames: ReadonlyMap<string, string> = new Map()): AlertDetail[] {
  const d = detailsOf(alert);
  return Object.entries(d).map(([key, value]) => {
    if (PERSON_KEYS.has(key)) {
      const id = text(value);
      const name = id ? nameOf(id) : null;
      return name ? { id: key, label: detailLabel(key), value: name } : { id: key, label: detailLabel(key), value: id ?? '—', mono: true };
    }
    if (key === 'roleKey' && typeof value === 'string') return { id: key, label: detailLabel(key), value: roleNames.get(value) ?? permissionLabelFree(value) };
    if (key === 'brokenAt' && value && typeof value === 'object') {
      const at = value as Record<string, unknown>;
      const seq = text(at.seq);
      const reason = text(at.reason);
      return { id: key, label: detailLabel(key), value: [seq ? `#${seq}` : null, reason].filter(Boolean).join(' · ') || '—' };
    }
    if (value === null || value === undefined || value === '') return { id: key, label: detailLabel(key), value: '—' };
    if (typeof value === 'object') return { id: key, label: detailLabel(key), value: JSON.stringify(value), mono: true };
    if (typeof value === 'number') return { id: key, label: detailLabel(key), value: value.toLocaleString('en-GB') };
    if (typeof value === 'boolean') return { id: key, label: detailLabel(key), value: value ? 'Yes' : 'No' };
    const mono = key === 'ip' || key === 'signature' || key === 'attachmentId';
    return { id: key, label: detailLabel(key), value: String(value), ...(mono ? { mono: true } : {}) };
  });
}

/** `service_owner` → "Service owner", for a role the page could not look up. */
function permissionLabelFree(key: string): string {
  const words = key.replace(/[._-]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : key;
}

/** Every person id an alert names, so the page asks the directory once. */
export function alertPeople(alerts: readonly Pick<SecurityAlertRow, 'details'>[]): string[] {
  const ids = new Set<string>();
  for (const alert of alerts) {
    const d = detailsOf(alert);
    for (const key of PERSON_KEYS) {
      const id = text(d[key]);
      if (id) ids.add(id);
    }
  }
  return [...ids];
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * "2 high · 5 medium in the last 7 days" (B §3.15), most severe first. The
 * API lists open alerts only, so this is what is still open from the week.
 */
export function alertSummaryLine(alerts: readonly Pick<SecurityAlertRow, 'severity' | 'createdAt'>[], now: number): string {
  const recent = alerts.filter((alert) => now - Date.parse(alert.createdAt) <= WEEK_MS);
  if (recent.length === 0) {
    return alerts.length === 0 ? 'Nothing open' : `Nothing new in the last 7 days · ${alerts.length} older ${alerts.length === 1 ? 'alert' : 'alerts'} still open`;
  }
  const counts = new Map<Severity, number>();
  for (const alert of recent) counts.set(severityOf(alert.severity), (counts.get(severityOf(alert.severity)) ?? 0) + 1);
  const parts = SEVERITIES.filter((severity) => counts.has(severity)).map((severity) => `${counts.get(severity)} ${SEVERITY_LOOK[severity].label.toLowerCase()}`);
  return `${parts.join(' · ')} in the last 7 days`;
}

/** Alerts most severe first, then newest. */
export function sortAlerts<T extends Pick<SecurityAlertRow, 'severity' | 'createdAt'>>(alerts: readonly T[]): T[] {
  return [...alerts].sort(
    (a, b) => SEVERITY_LOOK[severityOf(a.severity)].rank - SEVERITY_LOOK[severityOf(b.severity)].rank || Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );
}

/* =========================================================================
 * Access: areas, levels and the role matrix
 * ====================================================================== */

/**
 * The areas of the product a permission belongs to, named as the console
 * names its sections. Grouped by the permission's first word, which is how
 * the modules name them — so a module that adds `ticket.something` lands in
 * Tickets without a change here, and an unknown word still gets a readable
 * area of its own.
 */
const AREA_OF_PREFIX: Readonly<Record<string, string>> = {
  ticket: 'tickets',
  sla: 'service-levels',
  workload: 'workforce',
  catalogue: 'catalogue',
  approval: 'approvals',
  knowledge: 'knowledge',
  search: 'knowledge',
  rules: 'automation',
  workflow: 'automation',
  integration: 'integrations',
  webhook: 'integrations',
  ai: 'ai',
  analytics: 'insights',
  cmdb: 'cmdb',
  asset: 'cmdb',
  contract: 'cmdb',
  discovery: 'cmdb',
  incident: 'incidents',
  problem: 'incidents',
  change: 'incidents',
  statuspage: 'incidents',
  identity: 'people',
  audit: 'security',
  security: 'security',
  admin: 'settings',
  tenant: 'settings',
  notification: 'communication',
  channel: 'communication',
  feedback: 'communication',
  time: 'time',
  pack: 'platform',
  migration: 'platform',
  platform: 'platform',
};

const AREA_LABELS: Readonly<Record<string, string>> = {
  tickets: 'Tickets',
  'service-levels': 'Service levels',
  workforce: 'Workforce',
  catalogue: 'Services & requests',
  approvals: 'Approvals',
  knowledge: 'Knowledge & search',
  automation: 'Rules & workflows',
  integrations: 'Integrations',
  ai: 'AI',
  insights: 'Insights',
  cmdb: 'Configuration & assets',
  incidents: 'Incidents, problems & changes',
  people: 'People & access',
  security: 'Security & audit',
  settings: 'Settings & plan',
  communication: 'Notifications & channels',
  time: 'Time & cost',
  platform: 'Platform',
};

/** Areas in the order the console lists its sections. */
const AREA_ORDER = Object.keys(AREA_LABELS);

export interface Area {
  readonly id: string;
  readonly label: string;
}

export function areaOf(permissionKey: string): Area {
  const prefix = permissionKey.split('.')[0] ?? permissionKey;
  const id = AREA_OF_PREFIX[prefix] ?? prefix;
  return { id, label: AREA_LABELS[id] ?? permissionLabelFree(prefix) };
}

function areaRank(id: string): number {
  const index = AREA_ORDER.indexOf(id);
  return index === -1 ? AREA_ORDER.length : index;
}

export type Level = 'read' | 'work' | 'manage';

/** Verbs that only look. */
const READ_VERBS = new Set(['read', 'query', 'export']);
/** Verbs that change how the desk behaves, rather than doing the desk's work. */
const MANAGE_VERBS = new Set(['manage', 'publish', 'admin', 'install', 'prompt', 'impersonate', 'override']);

/**
 * How much a permission lets someone do, in three words: *Read* (look),
 * *Work* (do the desk's work: raise, reply, assign, decide) and *Manage*
 * (change how the desk behaves). `ticket.config.manage` is Manage;
 * `ticket.comment.internal` is Work; `audit.export` is Read.
 */
export function levelOf(permissionKey: string): Level {
  const parts = permissionKey.split('.');
  const verb = parts[parts.length - 1] ?? '';
  if (READ_VERBS.has(verb)) return 'read';
  if (MANAGE_VERBS.has(verb) || parts.includes('config') || parts.includes('policy')) return 'manage';
  return 'work';
}

const LEVEL_RANK: Readonly<Record<Level, number>> = { read: 1, work: 2, manage: 3 };
const LEVEL_WORD: Readonly<Record<Level, string>> = { read: 'Read', work: 'Work', manage: 'Manage' };

export type ScopeWord = 'own' | 'team' | 'any';
const SCOPE_RANK: Readonly<Record<string, number>> = { own: 1, team: 2, any: 3 };

/** Scopes in words, for chips and the matrix. */
export const SCOPE_WORDS: Readonly<Record<string, string>> = {
  own: 'Their own',
  team: 'Their teams',
  any: 'Everything',
};

export function scopeWords(scope: string | null | undefined): string {
  if (!scope) return 'Everything';
  return SCOPE_WORDS[scope] ?? permissionLabelFree(scope);
}

export interface MatrixCell {
  readonly level: Level | null;
  /** The widest scope held in the area, among the permissions at the cell's level. */
  readonly scope: ScopeWord | null;
  /** Permissions held in the area, of those the registry lists there. */
  readonly held: number;
  readonly of: number;
}

export interface MatrixRole {
  readonly key: string;
  readonly name: string;
  readonly description: string | null;
  readonly count: number;
}

export interface RoleMatrix {
  readonly areas: readonly Area[];
  readonly roles: readonly MatrixRole[];
  /** `cells[area][role]`. */
  readonly cells: Readonly<Record<string, Readonly<Record<string, MatrixCell>>>>;
}

/**
 * Roles against the areas of the product: in each cell the most a role may do
 * there, and how widely — "Manage", "Work · their teams", "Read · their own"
 * or nothing. Built from the roles' grants and the registry, so it cannot
 * disagree with what the API checks. Areas nobody holds anything in are left
 * out: a row of dashes answers no question.
 */
export function roleMatrix(roles: readonly RoleRow[], permissions: readonly PermissionRow[]): RoleMatrix {
  const areaById = new Map<string, Area>();
  const inArea = new Map<string, number>();
  for (const permission of permissions) {
    const area = areaOf(permission.key);
    areaById.set(area.id, area);
    inArea.set(area.id, (inArea.get(area.id) ?? 0) + 1);
  }

  const cells: Record<string, Record<string, MatrixCell>> = {};
  for (const role of roles) {
    const byArea = new Map<string, { level: Level; scope: ScopeWord | null; keys: Set<string> }>();
    for (const grant of role.permissions) {
      const area = areaOf(grant.key);
      if (!areaById.has(area.id)) {
        areaById.set(area.id, area);
        inArea.set(area.id, 0);
      }
      const scope = (grant.scope in SCOPE_RANK ? grant.scope : 'any') as ScopeWord;
      // Managing only your own things (your sessions) is doing your own work, not changing how the desk behaves.
      const level: Level = levelOf(grant.key) === 'manage' && scope === 'own' ? 'work' : levelOf(grant.key);
      const current = byArea.get(area.id);
      if (!current) {
        byArea.set(area.id, { level, scope, keys: new Set([grant.key]) });
        continue;
      }
      current.keys.add(grant.key);
      if (LEVEL_RANK[level] > LEVEL_RANK[current.level]) {
        current.level = level;
        current.scope = scope;
      } else if (level === current.level && SCOPE_RANK[scope]! > SCOPE_RANK[current.scope ?? 'own']!) {
        current.scope = scope;
      }
    }
    for (const [areaId, entry] of byArea) {
      cells[areaId] ??= {};
      cells[areaId]![role.key] = { level: entry.level, scope: entry.scope, held: entry.keys.size, of: Math.max(inArea.get(areaId) ?? 0, entry.keys.size) };
    }
  }

  const areas = [...areaById.values()].filter((area) => cells[area.id] !== undefined).sort((a, b) => areaRank(a.id) - areaRank(b.id) || a.label.localeCompare(b.label));
  for (const area of areas) {
    for (const role of roles) {
      cells[area.id]![role.key] ??= { level: null, scope: null, held: 0, of: inArea.get(area.id) ?? 0 };
    }
  }
  return {
    areas,
    roles: roles.map((role) => ({ key: role.key, name: role.name, description: role.description, count: new Set(role.permissions.map((grant) => grant.key)).size })),
    cells,
  };
}

/** A cell in words: "Manage", "Work · their teams", "Read · their own", or "No access". */
export function cellWords(cell: MatrixCell): string {
  if (!cell.level) return 'No access';
  const level = LEVEL_WORD[cell.level];
  return cell.scope && cell.scope !== 'any' ? `${level} · ${SCOPE_WORDS[cell.scope]!.toLowerCase()}` : level;
}

/* =========================================================================
 * Access: the permission registry
 * ====================================================================== */

export interface PermissionView extends Record<string, unknown> {
  readonly key: string;
  /** What it is called: the console's name for it, or one built from the key. */
  readonly label: string;
  /** What it allows, from the declaring module. */
  readonly description: string;
  readonly area: string;
  readonly areaLabel: string;
  readonly level: Level;
  readonly levelLabel: string;
  /** The scopes it can be granted at, in words. */
  readonly scopes: string;
  /** Role keys that grant it: the role filter reads this. */
  readonly roles: readonly string[];
  /** Whether the signed-in person holds it (the "Held by me" filter). */
  readonly held: boolean;
  /** How widely they hold it, in words, or null. */
  readonly you: string | null;
}

export function permissionViews(
  permissions: readonly PermissionRow[],
  roles: readonly RoleRow[],
  mine: readonly { readonly key: string; readonly scope?: string | null }[],
): PermissionView[] {
  const holders = new Map<string, string[]>();
  for (const role of roles) {
    for (const key of new Set(role.permissions.map((grant) => grant.key))) {
      const list = holders.get(key) ?? [];
      list.push(role.key);
      holders.set(key, list);
    }
  }
  const myScope = new Map<string, string | null>();
  for (const grant of mine) {
    const before = myScope.get(grant.key);
    const scope = grant.scope ?? null;
    if (before === undefined || (SCOPE_RANK[scope ?? 'any'] ?? 0) > (SCOPE_RANK[before ?? 'any'] ?? 0)) myScope.set(grant.key, scope);
  }
  return permissions
    .map((permission) => {
      const area = areaOf(permission.key);
      const level = levelOf(permission.key);
      const held = myScope.has(permission.key);
      return {
        key: permission.key,
        label: permissionLabel(permission.key),
        description: permission.description?.replace(/\.$/, '') ?? '',
        area: area.id,
        areaLabel: area.label,
        level,
        levelLabel: LEVEL_WORD[level],
        scopes: permission.scopes.length === 0 ? '—' : permission.scopes.map((scope) => scopeWords(scope)).join(', '),
        roles: holders.get(permission.key) ?? [],
        held,
        you: held ? scopeWords(myScope.get(permission.key)) : null,
      };
    })
    .sort((a, b) => areaRank(a.area) - areaRank(b.area) || a.areaLabel.localeCompare(b.areaLabel) || LEVEL_RANK[a.level] - LEVEL_RANK[b.level] || a.label.localeCompare(b.label));
}

/** The areas that have permissions, in order, for the area filter. */
export function areaOptions(views: readonly Pick<PermissionView, 'area' | 'areaLabel'>[]): { value: string; label: string }[] {
  const seen = new Map<string, string>();
  for (const view of views) if (!seen.has(view.area)) seen.set(view.area, view.areaLabel);
  return [...seen.entries()].map(([value, label]) => ({ value, label }));
}
