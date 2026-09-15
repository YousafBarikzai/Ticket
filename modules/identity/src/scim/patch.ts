import { ScimError } from './errors.js';

/**
 * PATCH, as providers send it rather than as the RFC writes it.
 *
 * The RFC says `op` is lower-case, `value` matches the attribute's type and
 * `path` names the attribute. Entra ID sends `Replace`, sends `"False"` for
 * a boolean, and sends a whole object with no path; Okta sends `replace`
 * with `{ active: false }` in the value and no path. Both are right about
 * what they mean, so both are accepted, and everything is normalised into
 * one shape before the service sees it: an op, an attribute, an optional
 * selector, and a value of the type the attribute has.
 */

export type PatchOp = 'add' | 'remove' | 'replace';

export interface Operation {
  op: PatchOp;
  /** The attribute, in the canonical case: `active`, `name.givenName`, `members`. */
  path: string;
  /** For `members[value eq "id"]`: the id in the selector. */
  selector?: { attribute: string; value: string };
  value?: unknown;
}

const CANONICAL_PATHS: Record<string, string> = {
  username: 'userName',
  externalid: 'externalId',
  displayname: 'displayName',
  active: 'active',
  'name.givenname': 'name.givenName',
  'name.familyname': 'name.familyName',
  'name.formatted': 'name.formatted',
  emails: 'emails',
  'emails.value': 'emails.value',
  members: 'members',
  locale: 'locale',
  timezone: 'timezone',
  title: 'title',
};

function canonicalPath(path: string): { path: string; selector?: { attribute: string; value: string } } {
  let text = path.trim().replace(/^urn:ietf:params:scim:schemas:core:2\.0:(user|group):/i, '');
  let selector: { attribute: string; value: string } | undefined;
  const selected = /^([A-Za-z.]+)\[([A-Za-z.]+)\s+eq\s+"((?:[^"\\]|\\.)*)"\](?:\.([A-Za-z]+))?$/.exec(text);
  if (selected) {
    selector = { attribute: selected[2]!.toLowerCase(), value: selected[3]!.replace(/\\(.)/g, '$1') };
    text = selected[4] ? `${selected[1]}.${selected[4]}` : selected[1]!;
  }
  const canonical = CANONICAL_PATHS[text.toLowerCase()];
  if (!canonical) throw new ScimError(400, `${path} cannot be patched`, 'invalidPath');
  return selector ? { path: canonical, selector } : { path: canonical };
}

/** `"False"`, `"true"`, `false`: providers disagree, the meaning does not. */
export function asBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }
  throw new ScimError(400, `expected true or false, got ${JSON.stringify(value)}`, 'invalidValue');
}

/** Flattens `{ name: { givenName: 'x' }, active: false }` to path/value pairs. */
function flatten(value: unknown, prefix = ''): { path: string; value: unknown }[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return [{ path: prefix, value }];
  const out: { path: string; value: unknown }[] = [];
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    if (key === 'schemas') continue;
    const path = prefix ? `${prefix}.${key}` : key;
    if (inner !== null && typeof inner === 'object' && !Array.isArray(inner) && (key === 'name')) out.push(...flatten(inner, path));
    else out.push({ path, value: inner });
  }
  return out;
}

export function normalisePatch(body: unknown): Operation[] {
  const document = body as { Operations?: unknown; operations?: unknown };
  const raw = document?.Operations ?? document?.operations;
  if (!Array.isArray(raw) || raw.length === 0) throw new ScimError(400, 'a PATCH needs an Operations list', 'invalidSyntax');

  const operations: Operation[] = [];
  for (const entry of raw as { op?: unknown; path?: unknown; value?: unknown }[]) {
    const op = String(entry.op ?? '').toLowerCase();
    if (op !== 'add' && op !== 'remove' && op !== 'replace') throw new ScimError(400, `unknown op ${String(entry.op)}`, 'invalidSyntax');

    if (typeof entry.path === 'string' && entry.path.trim() !== '') {
      const { path, selector } = canonicalPath(entry.path);
      operations.push({ op, path, ...(selector ? { selector } : {}), value: entry.value });
      continue;
    }
    // No path: the value is an object of attributes to apply.
    if (op === 'remove') throw new ScimError(400, 'remove needs a path', 'noTarget');
    for (const flat of flatten(entry.value)) {
      const { path } = canonicalPath(flat.path);
      operations.push({ op, path, value: flat.value });
    }
  }
  return operations;
}

/** The member ids named by an add/remove/replace on `members`. */
export function memberIds(operation: Operation): string[] {
  if (operation.selector) return [operation.selector.value];
  const list = Array.isArray(operation.value) ? operation.value : operation.value === undefined ? [] : [operation.value];
  return list
    .map((item) => (typeof item === 'string' ? item : (item as { value?: unknown })?.value))
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
}
