import { evaluate, type EvalContext, type Expr } from '@itsm/expr';

/**
 * Who may see a catalogue item (docs/architecture/04, MOD-05).
 *
 * Entitlement is an access-control decision, not a presentation one. A tile a
 * requester cannot raise must not appear on their portal — offering something
 * and then refusing it is a poor experience, and listing an item called
 * "Director expenses card" tells everyone that such a thing exists and who is
 * likely to have one.
 *
 * So the same predicate does both jobs: it filters the catalogue *and* it is
 * checked again when a request is submitted. Filtering alone would be a client
 * -side control, and anyone who guessed a key could raise the request anyway.
 */

export interface RequesterFacts {
  userId: string | null;
  orgId: string | null;
  primaryOrgId: string | null;
  teamKeys: string[];
  roleKeys: string[];
  vip: boolean;
  tier: string | null;
  isExternal: boolean;
}

/** The facts an entitlement expression may read. */
export const ENTITLEMENT_FACTS = [
  'requester.orgId',
  'requester.teamKeys',
  'requester.roleKeys',
  'requester.vip',
  'requester.tier',
  'requester.isExternal',
] as const;

export function entitlementContext(facts: RequesterFacts): EvalContext {
  return {
    requester: {
      orgId: facts.orgId ?? facts.primaryOrgId,
      teamKeys: facts.teamKeys,
      roleKeys: facts.roleKeys,
      vip: facts.vip,
      tier: facts.tier,
      isExternal: facts.isExternal,
    },
  };
}

/**
 * Whether this person is entitled to this item.
 *
 * An absent entitlement means everyone in the tenant, which is the common case
 * and should not need to be written out. An entitlement that cannot be
 * evaluated denies rather than allows: a broken predicate hiding an item is a
 * support ticket, and a broken predicate revealing one is an incident.
 */
export function isEntitled(entitlement: Expr | null | undefined, facts: RequesterFacts): boolean {
  if (!entitlement) return true;
  try {
    return evaluate(entitlement, entitlementContext(facts));
  } catch {
    return false;
  }
}
