/**
 * What to do when the feed and the register disagree.
 *
 * The default is **propose**, for every field, and that is the decision this
 * whole epic turns on. A feed that writes straight through can rewrite four
 * hundred rows at three in the morning because somebody renamed a column
 * upstream, and the first anybody hears of it is an impact answer that is
 * quietly wrong — which is precisely the failure E1 was built to avoid
 * (ADR-0027). Discovery proposes; a person confirms.
 *
 * A tenant loosens that field by field once it trusts a source, and loosening is
 * the interesting direction. A serial number read from the device is better than
 * one typed by a person, so `source_wins` on `attributes.serial` is right almost
 * immediately. Criticality is the exact opposite: no feed knows what matters to
 * the business, and a source that overwrote it would be destroying the one
 * column the register exists to hold.
 */

export const POLICIES = ['propose', 'source_wins', 'ignore'] as const;
export type Policy = (typeof POLICIES)[number];

export interface Rule {
  /** Null applies to every source. */
  sourceId: string | null;
  field: string;
  policy: Policy;
}

/**
 * The policy for one field from one source.
 *
 * A rule naming the source beats a rule naming every source, so a tenant can
 * say "trust Intune's serials, nothing else's" without writing a rule per
 * source for every other field.
 */
export function policyFor(rules: Rule[], field: string, sourceId: string): Policy {
  const specific = rules.find((rule) => rule.sourceId === sourceId && rule.field === field);
  if (specific) return specific.policy;
  const general = rules.find((rule) => rule.sourceId === null && rule.field === field);
  return general?.policy ?? 'propose';
}

export interface FieldChange {
  field: string;
  from: unknown;
  to: unknown;
}

export interface Reconciliation {
  /** Fields a rule says the source owns; written without asking. */
  apply: Record<string, unknown>;
  /** Fields a person has to decide about. */
  propose: FieldChange[];
  /** Fields that already agreed. */
  unchanged: string[];
  /** Fields a rule says to leave alone, so the count adds up. */
  ignored: string[];
}

/**
 * A stable string for a value, whatever order its keys arrived in.
 *
 * `JSON.stringify` alone is wrong here, and wrong in a way that only shows
 * against a real database: PostgreSQL JSONB does not preserve key order, so a
 * value written as `{name, serial}` reads back as `{name, serial}` sorted by
 * JSONB's own rules. Comparing the two raw strings says "different" every time,
 * which turns "has this proposal already been rejected?" into "no" for ever.
 */
export function fingerprint(value: unknown): string {
  return JSON.stringify(canonical(value));
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    // Order is not information here: two objects with the same entries are the
    // same value, and only the database's storage order differs.
    return Object.fromEntries(Object.keys(source).sort().map((key) => [key, canonical(source[key])]));
  }
  return value;
}

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (typeof a !== typeof b) return false;
  // Same reasoning as `fingerprint`: an attribute holding an object or a list
  // would otherwise look changed on every run purely because it came back from
  // JSONB with its keys in a different order.
  if (typeof a === 'object') return fingerprint(a) === fingerprint(b);
  return false;
}

/**
 * Works out what a record from a feed would change, and who gets to decide.
 *
 * **A field the feed does not carry is not a change.** It is the trap that
 * matters most here: a source that stops sending a column — a permission lost,
 * an API version bumped, a filter somebody added — would otherwise look like
 * every device in the estate losing its serial number at once, and under
 * `source_wins` it would blank them. Absence is silence, not an instruction.
 */
export function reconcile(
  current: Record<string, unknown>,
  incoming: Record<string, unknown>,
  rules: Rule[],
  sourceId: string,
): Reconciliation {
  const result: Reconciliation = { apply: {}, propose: [], unchanged: [], ignored: [] };

  for (const [field, to] of Object.entries(incoming)) {
    if (to === undefined || to === null || to === '') continue;

    const from = current[field];
    if (same(from, to)) {
      result.unchanged.push(field);
      continue;
    }

    switch (policyFor(rules, field, sourceId)) {
      case 'ignore':
        result.ignored.push(field);
        break;
      case 'source_wins':
        result.apply[field] = to;
        break;
      case 'propose':
        result.propose.push({ field, from: from ?? null, to });
        break;
    }
  }

  return result;
}

/** True when a run found nothing worth a person's attention. */
export function agrees(reconciliation: Reconciliation): boolean {
  return reconciliation.propose.length === 0 && Object.keys(reconciliation.apply).length === 0;
}

/**
 * Flattens a mapped record into the fields reconciliation compares.
 *
 * Attributes are namespaced so a rule can name one — `attributes.serial` — and
 * so an attribute called `name` cannot collide with the item's own name.
 */
export function flatten(fields: Record<string, unknown>, attributes: Record<string, unknown>): Record<string, unknown> {
  const flat: Record<string, unknown> = { ...fields };
  for (const [key, value] of Object.entries(attributes)) flat[`attributes.${key}`] = value;
  return flat;
}

/** The inverse, for writing an accepted proposal back. */
export function unflatten(flat: Record<string, unknown>): {
  fields: Record<string, unknown>;
  attributes: Record<string, unknown>;
} {
  const fields: Record<string, unknown> = {};
  const attributes: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(flat)) {
    if (key.startsWith('attributes.')) attributes[key.slice('attributes.'.length)] = value;
    else fields[key] = value;
  }
  return { fields, attributes };
}
