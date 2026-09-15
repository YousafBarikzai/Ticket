import { registerTenantPurgeHook } from '@itsm/platform';
import { externalBackend } from './backend/index.js';

/**
 * A purged tenant's search index goes with it.
 *
 * Phase 2 found that deleting a tenant left every tenant-scoped table behind.
 * An external index is the same defect with nothing in the database to show for
 * it: the rows would be gone, the platform would look clean, and a full copy of
 * the tenant's ticket titles and descriptions would sit on the search server
 * indefinitely. Registered here rather than called from the tenancy module, so
 * that tenancy does not have to know which modules keep state elsewhere.
 */
registerTenantPurgeHook('search-index', async (tenantId) => {
  await externalBackend()?.dropTenant(tenantId);
});
