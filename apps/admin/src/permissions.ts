import type { Me } from '@itsm/sdk';

/**
 * What the signed-in person may do.
 *
 * A pure predicate in a file of its own, deliberately apart from
 * `server/session.ts`. That module imports `server-only`, which is a module
 * that throws if it is ever pulled into a client bundle — exactly the property
 * that makes it useful there and the reason a test cannot import anything
 * beside it. A permission check that cannot be tested is a permission check
 * nobody has checked.
 */

/**
 * Exact match, at any scope.
 *
 * Never a prefix: `platform.tenant.read` must not satisfy
 * `platform.tenant.manage`, and a bare `platform` must satisfy nothing. The
 * scope is deliberately ignored here — every use in this console is "may this
 * person reach this screen at all", and a screen that needs a particular scope
 * says so where it needs it.
 */
export function holds(me: Me, permission: string): boolean {
  return me.permissions.some((granted) => granted.key === permission);
}
