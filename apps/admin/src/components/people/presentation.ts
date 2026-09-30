import type { IconName, Tone } from '@itsm/ui';
import type { OrganisationRow, RoleAssignmentRow, RoleRow, TeamListRow, UserRow } from '@itsm/sdk';

/**
 * People in words (SPEC §6.1 `/people/**`, B §3.16): statuses, the list's
 * scope and its honest cap, organisations as a tree, role grants with their
 * scope spelled out. Pure and server-safe, so the pages can shape rows on the
 * server and the client can reuse the same wording — and so the rules (what
 * "Showing the first 200" means, when a grant has expired) have tests.
 */

/** The directory's page: the API's own ceiling for one `GET /users`. */
export const PEOPLE_LIMIT = 200;

/* =========================================================================
 * The list: scope, query, caption
 * ====================================================================== */

export type PeopleScope = 'active' | 'inactive' | 'all';

export const PEOPLE_SCOPES: readonly { readonly value: PeopleScope; readonly label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Deactivated' },
  { value: 'all', label: 'All' },
];

export interface PeopleQuery {
  readonly q: string;
  readonly scope: PeopleScope;
}

type Params = Readonly<Record<string, string | string[] | undefined>>;

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * `?status=` (Active by default; `deactivated` is read as `inactive`, the
 * word the API stores) and `?q=`. Anything else is the default rather than
 * an error: a hand-edited link still lands on a list.
 */
export function readPeopleQuery(params: Params): PeopleQuery {
  const raw = one(params.status)?.trim().toLowerCase();
  const scope: PeopleScope = raw === 'inactive' || raw === 'deactivated' ? 'inactive' : raw === 'all' ? 'all' : 'active';
  const q = (one(params.q) ?? '').trim().slice(0, 200);
  return { q, scope };
}

/** What `GET /users` is asked: all 200 the API allows, the scope's status unless All. */
export function usersQuery(query: PeopleQuery): { q?: string; limit: number; status?: string } {
  return { limit: PEOPLE_LIMIT, ...(query.q ? { q: query.q } : {}), ...(query.scope === 'all' ? {} : { status: query.scope }) };
}

/** A scope link that keeps the search and drops a drawer or a sheet (they belong to the old list). */
export function peopleScopeHref(pathname: string, search: URLSearchParams, scope: PeopleScope): string {
  const params = new URLSearchParams(search);
  params.delete('open');
  params.delete('new');
  if (scope === 'active') params.delete('status');
  else params.set('status', scope);
  const text = params.toString();
  return text ? `${pathname}?${text}` : pathname;
}

/**
 * The caption a full page earns (F31). The API answers at most 200 people
 * and has no total, so a list of exactly 200 may be all of them or the first
 * 200 of many — the page says which it cannot tell, and how to narrow it,
 * rather than letting a silent cap pass for the whole directory.
 */
export function cappedCaption(count: number, query: PeopleQuery, limit: number = PEOPLE_LIMIT): string | null {
  if (count < limit) return null;
  return query.q
    ? `Showing the first ${limit} matches, A to Z — add more words to narrow them.`
    : `Showing the first ${limit} people, A to Z — search to find others.`;
}

/* =========================================================================
 * A person
 * ====================================================================== */

export interface StatusLook {
  readonly label: string;
  readonly tone: Tone;
  readonly icon: IconName;
}

const STATUS_LOOK: Readonly<Record<string, StatusLook>> = {
  active: { label: 'Active', tone: 'success', icon: 'circle-check' },
  inactive: { label: 'Deactivated', tone: 'neutral', icon: 'circle-dashed' },
};

/** Words for a status the page does not know: `pending_invite` → "Pending invite". */
export function humanise(value: string): string {
  const text = value.replace(/[._-]+/g, ' ').trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : value;
}

export function userStatusLook(status: string): StatusLook {
  return STATUS_LOOK[status] ?? { label: humanise(status), tone: 'neutral', icon: 'dot' };
}

export function isActive(status: string): boolean {
  return status === 'active';
}

/** A person as the table and the drawer show them: names, never ids. */
export interface PersonRowView extends Record<string, unknown> {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly status: string;
  readonly statusLabel: string;
  readonly external: boolean;
  readonly typeLabel: 'Internal' | 'External';
  readonly orgId: string | null;
  /** Null when the person has none, or the organisation list cannot be read. */
  readonly orgName: string | null;
  /** The signed-in person: nobody deactivates themselves by accident. */
  readonly you: boolean;
}

export function personRow(user: UserRow, orgNames: ReadonlyMap<string, string>, meId: string | null): PersonRowView {
  const external = user.isExternal === true;
  return {
    id: user.id,
    name: user.displayName || user.email,
    email: user.email,
    status: user.status,
    statusLabel: userStatusLook(user.status).label,
    external,
    typeLabel: external ? 'External' : 'Internal',
    orgId: user.primaryOrgId,
    orgName: user.primaryOrgId ? (orgNames.get(user.primaryOrgId) ?? null) : null,
    you: meId !== null && user.id === meId,
  };
}

/** The part of an address a person would recognise it by, for a name typed nowhere: `sam.lee@acme.test` → "Sam Lee". */
export function nameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? '';
  return local
    .split(/[._+-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/** The first name, for toasts: "Sam added". */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

/** A deliberately plain check: the API is the judge, this only catches the typo before the round trip. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function personProblems(input: { readonly name: string; readonly email: string }, takenEmails: readonly string[] = []): Record<string, string> {
  const errors: Record<string, string> = {};
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  if (name === '') errors.displayName = 'Enter their name.';
  else if (name.length > 200) errors.displayName = 'Keep the name to 200 characters.';
  if (email === '') errors.email = 'Enter their email address.';
  else if (email.length > 320 || !EMAIL.test(email)) errors.email = 'Enter an email address like sam@example.com.';
  else if (takenEmails.some((taken) => taken.toLowerCase() === email)) errors.email = 'Someone on this desk already has that email address.';
  return errors;
}

/* =========================================================================
 * Roles
 * ====================================================================== */

export type GrantScopeType = 'organisation' | 'team' | 'service';

/** Names the page could resolve, by id, for scopes and organisations. */
export interface ScopeNames {
  readonly organisations: ReadonlyMap<string, string>;
  readonly teams: ReadonlyMap<string, string>;
}

/** Where a grant applies, in words: "Whole workspace", "Network Team (team)". */
export function grantScopeWords(scopeType: string | null, scopeId: string | null, names: ScopeNames): string {
  if (!scopeType || !scopeId) return 'Whole workspace';
  if (scopeType === 'organisation') {
    const name = names.organisations.get(scopeId);
    return name ? `${name} (organisation)` : 'One organisation';
  }
  if (scopeType === 'team') {
    const name = names.teams.get(scopeId);
    return name ? `${name} (team)` : 'One team';
  }
  if (scopeType === 'service') return 'One service';
  return `One ${humanise(scopeType).toLowerCase()}`;
}

export interface GrantView {
  readonly id: string;
  readonly roleKey: string;
  readonly roleName: string;
  readonly scope: string;
  readonly scoped: boolean;
  /** Granted by the identity provider: removing it lasts until the next sync. */
  readonly viaScim: boolean;
  /** Past its `validTo`: kept in the list because it still occupies its slot. */
  readonly expired: boolean;
}

export function grantView(assignment: RoleAssignmentRow, names: ScopeNames, now: number): GrantView {
  const ends = assignment.validTo ? Date.parse(assignment.validTo) : Number.NaN;
  return {
    id: assignment.id,
    roleKey: assignment.roleKey,
    roleName: assignment.roleName || humanise(assignment.roleKey),
    scope: grantScopeWords(assignment.scopeType, assignment.scopeId, names),
    scoped: Boolean(assignment.scopeType && assignment.scopeId),
    viaScim: assignment.viaScim,
    expired: Number.isFinite(ends) && ends <= now,
  };
}

/** Grants in the order a person reads them: current before expired, then by role name. */
export function sortGrants(grants: readonly GrantView[]): GrantView[] {
  return [...grants].sort((a, b) => Number(a.expired) - Number(b.expired) || a.roleName.localeCompare(b.roleName) || a.scope.localeCompare(b.scope));
}

/**
 * Whether granting this role at this scope would repeat one the person
 * already holds. The API answers a repeat with the existing grant (a
 * success that changes nothing), so the form says so before asking.
 */
export function holdsGrant(assignments: readonly Pick<RoleAssignmentRow, 'roleKey' | 'scopeType' | 'scopeId'>[], roleKey: string, scopeType: string | null, scopeId: string | null): boolean {
  return assignments.some((row) => row.roleKey === roleKey && (row.scopeType ?? null) === scopeType && (row.scopeId ?? null) === scopeId);
}

/** A role to choose, least access to most (the API's order), with what it is for. */
export interface RoleChoice {
  readonly value: string;
  readonly label: string;
  readonly description?: string;
  readonly count: number;
}

export function roleChoices(roles: readonly RoleRow[]): RoleChoice[] {
  return roles.map((role) => ({
    value: role.key,
    label: role.name,
    ...(role.description ? { description: role.description } : {}),
    count: new Set(role.permissions.map((permission) => permission.key)).size,
  }));
}

/* =========================================================================
 * Organisations
 * ====================================================================== */

export interface OrgNode {
  readonly id: string;
  readonly name: string;
  readonly code: string | null;
  readonly path: string;
  readonly parentId: string | null;
  readonly depth: number;
  readonly children: readonly OrgNode[];
}

/**
 * The organisation structure as a tree, from `parentId` (SPEC: "nested list
 * from path/parentId"). Siblings by name. An organisation whose parent is not
 * in the list — outside the reader's view — becomes a root rather than
 * disappearing, and a cycle (which the API should never produce) cannot hang
 * the page: each organisation is placed once.
 */
export function organisationTree(rows: readonly OrganisationRow[]): OrgNode[] {
  const ids = new Set(rows.map((row) => row.id));
  const byParent = new Map<string | null, OrganisationRow[]>();
  for (const row of rows) {
    const parent = row.parentId && ids.has(row.parentId) && row.parentId !== row.id ? row.parentId : null;
    const list = byParent.get(parent) ?? [];
    list.push(row);
    byParent.set(parent, list);
  }
  const placed = new Set<string>();
  const build = (parent: string | null, depth: number): OrgNode[] =>
    (byParent.get(parent) ?? [])
      .filter((row) => !placed.has(row.id))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((row) => {
        placed.add(row.id);
        return { id: row.id, name: row.name, code: row.code, path: row.path, parentId: row.parentId, depth, children: build(row.id, depth + 1) };
      });
  const roots = build(null, 0);
  // Whatever a cycle kept out of the tree still appears, at the top.
  const stranded = rows.filter((row) => !placed.has(row.id)).map((row) => ({ ...row, parentId: null }));
  return stranded.length > 0 ? [...roots, ...organisationTree(stranded)] : roots;
}

/** The tree in reading order, each node with its depth: for selects and flat lists. */
export function flattenTree(nodes: readonly OrgNode[]): OrgNode[] {
  return nodes.flatMap((node) => [node, ...flattenTree(node.children)]);
}

/** Organisation choices for a select, indented by depth so the structure shows in a native list. */
export function organisationOptions(rows: readonly OrganisationRow[]): { value: string; label: string }[] {
  return flattenTree(organisationTree(rows)).map((node) => ({ value: node.id, label: `${' '.repeat(node.depth)}${node.name}` }));
}

/** Organisation codes are how integrations and SCIM name an organisation: short, unique, no spaces. */
export function organisationProblems(input: { readonly name: string; readonly code: string }, takenCodes: readonly (string | null)[]): Record<string, string> {
  const errors: Record<string, string> = {};
  const name = input.name.trim();
  const code = input.code.trim();
  if (name === '') errors.name = 'Enter the organisation’s name.';
  else if (name.length > 200) errors.name = 'Keep the name to 200 characters.';
  if (code === '') errors.code = 'Enter a short code, such as ACME-UK.';
  else if (code.length > 60) errors.code = 'Keep the code to 60 characters.';
  else if (/\s/.test(code)) errors.code = 'Use letters, numbers and hyphens — no spaces.';
  else if (takenCodes.some((taken) => taken !== null && taken.toLowerCase() === code.toLowerCase())) errors.code = 'Another organisation already uses that code.';
  return errors;
}

/** A code made from a name: "Acme Group UK" → "ACME-GROUP-UK". Only a suggestion; the person can change it. */
export function codeFromName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/* =========================================================================
 * Teams
 * ====================================================================== */

export interface TeamRowView extends Record<string, unknown> {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly orgId: string;
  readonly orgName: string | null;
  readonly memberCount: number;
  readonly membersLabel: string;
  /** Leads' names, when the page read the members; null when it did not. */
  readonly leads: readonly string[] | null;
}

export function teamRow(team: TeamListRow, orgNames: ReadonlyMap<string, string>, leads: readonly string[] | null): TeamRowView {
  return {
    id: team.id,
    key: team.key,
    name: team.name,
    orgId: team.orgId,
    orgName: orgNames.get(team.orgId) ?? null,
    memberCount: team.memberCount,
    membersLabel: team.memberCount === 1 ? '1 person' : `${team.memberCount} people`,
    leads,
  };
}

/** "Priya Shah", "Priya Shah and Tom Ng", "Priya Shah and 2 others"; "No lead" for none. */
export function leadsLabel(leads: readonly string[] | null): string {
  if (leads === null) return '—';
  if (leads.length === 0) return 'No lead';
  if (leads.length <= 2) return leads.join(' and ');
  return `${leads[0]} and ${leads.length - 1} others`;
}
