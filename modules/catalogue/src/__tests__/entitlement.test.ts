import { describe, expect, it } from 'vitest';
import { isEntitled, type RequesterFacts } from '../domain/entitlement.js';

/**
 * Entitlement decides what a requester can see *and* what they can raise. These
 * are the cases where getting it wrong either leaks the existence of something
 * or lets somebody raise a request they are not entitled to.
 */

const base: RequesterFacts = {
  userId: '00000000-0000-0000-0000-0000000000aa',
  orgId: 'org-1',
  primaryOrgId: 'org-1',
  teamKeys: ['service-desk'],
  roleKeys: ['requester'],
  vip: false,
  tier: 'standard',
  isExternal: false,
};

describe('isEntitled', () => {
  it('lets everyone through when no entitlement is set', () => {
    // The common case, which should not need writing out.
    expect(isEntitled(null, base)).toBe(true);
    expect(isEntitled(undefined, base)).toBe(true);
  });

  it('matches on a role', () => {
    const managersOnly = { in: ['manager', { var: 'requester.roleKeys' }] } as never;
    expect(isEntitled(managersOnly, base)).toBe(false);
    expect(isEntitled(managersOnly, { ...base, roleKeys: ['requester', 'manager'] })).toBe(true);
  });

  it('matches on an organisation', () => {
    const oneOrg = { eq: [{ var: 'requester.orgId' }, 'org-2'] } as never;
    expect(isEntitled(oneOrg, base)).toBe(false);
    expect(isEntitled(oneOrg, { ...base, orgId: 'org-2' })).toBe(true);
  });

  it('can exclude external people', () => {
    const staffOnly = { eq: [{ var: 'requester.isExternal' }, false] } as never;
    expect(isEntitled(staffOnly, base)).toBe(true);
    expect(isEntitled(staffOnly, { ...base, isExternal: true })).toBe(false);
  });

  it('falls back to the primary organisation when no current one is set', () => {
    const oneOrg = { eq: [{ var: 'requester.orgId' }, 'org-1'] } as never;
    expect(isEntitled(oneOrg, { ...base, orgId: null })).toBe(true);
  });

  it('denies when the expression cannot be evaluated', () => {
    // A broken predicate that hides an item is a support ticket. One that
    // reveals an item nobody should see is an incident, so this fails closed.
    const broken = { matches: [{ var: 'requester.tier' }, '([unclosed'] } as never;
    expect(isEntitled(broken, base)).toBe(false);
  });
});
