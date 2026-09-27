import { NotFoundError, aiRegions, tenantFacts, type TenantContext } from '@itsm/platform';
import { tenantService } from '@itsm/module-tenancy';

/**
 * Where this tenant's prompts may be processed, read from the tenant row.
 *
 * A request's context carries the tenant's regions because the API builds it
 * from the row (`tenantFacts`). A queued job's does not: it is rebuilt from a
 * job envelope, which names the tenant and nothing else, so its region is a
 * default and its allowed list is empty — and `aiRegions` reads that as "the
 * default region", a policy nobody agreed to. Every worker path that reaches
 * the gateway asks here instead, so the check the gateway makes last is the
 * tenant's own (ADR-0047).
 */
export async function tenantAiRegions(ctx: TenantContext): Promise<readonly string[]> {
  const tenant = await tenantService.findTenantById(ctx.tenantId);
  if (!tenant) throw new NotFoundError('tenant', ctx.tenantId);
  return aiRegions({ ...ctx, ...tenantFacts(tenant) });
}
