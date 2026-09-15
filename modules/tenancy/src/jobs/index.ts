import { defineJob } from '@itsm/platform';
import { recompute } from '../service/usage-service.js';

/**
 * Rebuilds one tenant's meters from the source rows. Fanned out by the
 * worker's nightly sweep, one job per tenant, so a tenant with a large
 * attachment table cannot delay anybody else's figures.
 */
defineJob('retention', 'usage.recompute.tenant', async (_payload, { ctx }) => {
  await recompute(ctx);
});
