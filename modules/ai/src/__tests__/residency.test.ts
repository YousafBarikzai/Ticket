import { describe, expect, it } from 'vitest';
import { residencyPermits } from '../service/gateway.js';

/**
 * Where a tenant's prompts may be processed.
 *
 * The decision is pure and lives in one function so it can be read in one
 * sitting, because the failure this guards against is not a crash — it is a
 * prompt quietly arriving in a jurisdiction somebody promised a customer it
 * would not. Nothing about that is visible afterwards.
 */

describe('what a policy permits', () => {
  it('allows a provider in a permitted region', () => {
    expect(residencyPermits('eu-west', ['eu-west'])).toBe(true);
    expect(residencyPermits('us-east', ['eu-west', 'us-east'])).toBe(true);
  });

  it('refuses a provider outside it', () => {
    expect(residencyPermits('us-east', ['eu-west'])).toBe(false);
  });

  it('refuses everything when the list is empty', () => {
    // An empty list never reaches here: `aiRegions` resolves it to the
    // tenant's own region first. If one ever did, refusing is the safe
    // reading — an empty permission list permitting everything is the shape of
    // a great many security bugs.
    expect(residencyPermits('eu-west', [])).toBe(false);
  });

  it('is exact, never a prefix match', () => {
    // `eu-west` must not be satisfied by `eu-west-2`, and `us` must not open
    // `us-east`. Jurisdictions are not string prefixes of one another.
    expect(residencyPermits('eu-west-2', ['eu-west'])).toBe(false);
    expect(residencyPermits('us-east', ['us'])).toBe(false);
  });

  it('permits a provider that makes no external call', () => {
    // The stub. Residency is a question about data leaving, and a provider
    // that leaves nothing has no jurisdiction to be outside of.
    expect(residencyPermits(null, ['eu-west'])).toBe(true);
    expect(residencyPermits(null, [])).toBe(true);
  });
});
