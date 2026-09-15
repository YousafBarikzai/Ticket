/**
 * Comparing JSON that has been through the database.
 *
 * `JSON.stringify(a) === JSON.stringify(b)` looks like a value comparison and
 * is not one. It is a comparison of *writing order*, and writing order does not
 * survive a round trip: PostgreSQL `jsonb` stores an object's keys in its own
 * order (by key length, then bytewise), so a value written as
 * `{"name":…,"serial":…}` can come back as `{"serial":…,"name":…}` and the two
 * strings differ while the two values do not.
 *
 * The failure is never a crash. It is a comparison that silently answers
 * "different" for ever, and what that means depends on which side of a
 * condition it sits:
 *
 *   - "has this already been rejected?" becomes no, every time (MOD-10-E2)
 *   - "did this field actually change?" becomes yes, every time (MOD-04)
 *
 * The second is the nastier one, because a spurious change is not quiet: it
 * writes an audit row, bumps a version, publishes an event, and fires whatever
 * rules and notifications were waiting on that event.
 *
 * So the comparison lives here, once, and `infra/scripts/check-boundaries.ts`
 * fails the build on a hand-rolled one.
 */

/**
 * A stable string for a value: object keys sorted, arrays left alone.
 *
 * Arrays keep their order because order *is* information in a list — `[a, b]`
 * and `[b, a]` are different values — where in an object it is only storage.
 * `undefined` reads as `null`, and an object entry whose value is `undefined`
 * is dropped, so an absent key and an explicitly-undefined one agree.
 */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`;
}

/** Whether two values are the same once storage order is discounted. */
export function jsonEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  return canonicalJson(a) === canonicalJson(b);
}
