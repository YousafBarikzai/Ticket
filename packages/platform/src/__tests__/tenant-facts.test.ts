import { describe, expect, it } from 'vitest';
import { aiRegions, createContext, tenantFacts, EMPTY_PERMISSIONS } from '../index.js';

/**
 * The tenant-derived half of a context.
 *
 * Small, and worth its own test for a reason that is about process rather than
 * logic: eleven places build a context from a tenant row, and the way a policy
 * goes missing is one of them being written by hand and forgetting a field. A
 * residency policy that is simply absent in the worker reads exactly like a
 * residency policy that allows everything.
 */

function contextWith(region: string, allowed: readonly string[] = []) {
  return createContext({
    tenantId: '00000000-0000-4000-8000-000000000000',
    actor: { type: 'system', id: null },
    permissions: EMPTY_PERMISSIONS,
    ...tenantFacts({ region, aiAllowedRegions: allowed }),
  });
}

describe('the fields a tenant row contributes', () => {
  it('carries both, so a caller cannot take one and miss the other', () => {
    expect(tenantFacts({ region: 'eu-west', aiAllowedRegions: ['eu-west', 'us-east'] })).toEqual({
      region: 'eu-west',
      aiAllowedRegions: ['eu-west', 'us-east'],
    });
  });

  it('treats a missing policy as no policy, not as an error', () => {
    // A row selected without the column, which is a mistake worth surviving
    // rather than crashing on: the resolver below turns it into the safe
    // answer.
    expect(tenantFacts({ region: 'eu-west' })).toEqual({ region: 'eu-west', aiAllowedRegions: [] });
  });
});

describe('resolving the policy', () => {
  it('inherits the tenant’s own data region when nothing is set', () => {
    // The safe reading, and the one that needs no backfill: a tenant
    // provisioned before the policy existed already said where its data lives.
    expect(aiRegions(contextWith('eu-west'))).toEqual(['eu-west']);
  });

  it('uses the policy when there is one', () => {
    expect(aiRegions(contextWith('eu-west', ['eu-west', 'us-east']))).toEqual(['eu-west', 'us-east']);
  });

  it('lets a policy exclude the tenant’s own region, because that is a real choice', () => {
    // A tenant whose data lives in the EU may still decide no AI processing
    // happens there — for instance because its only approved provider is
    // elsewhere and it has a transfer agreement covering it.
    expect(aiRegions(contextWith('eu-west', ['us-east']))).toEqual(['us-east']);
  });
});
