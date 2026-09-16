import { randomBytes } from 'node:crypto';
import {
  NotFoundError,
  UnauthorisedError,
  authz,
  buildPermissionSet,
  digest,
  newId,
  recordAudit,
  systemContext,
  transaction,
  withContext,
  type TenantContext,
} from '@itsm/platform';
import { tenantService } from '@itsm/module-tenancy';

/**
 * The SCIM bearer token: one per tenant, issued by an administrator, shown
 * once, stored as a hash, rotated with a day's overlap so the provider can
 * be updated without a gap in which it is refused.
 *
 * The token carries the tenant's slug, so a request that arrives with no
 * session and no tenant is resolved the way every other pre-tenant request
 * is: through the tenant directory, and then as that tenant (ADR-0035). The
 * hash is compared inside the tenant's own rows; there is no cross-tenant
 * token table to enumerate.
 */

export const ROTATION_OVERLAP_HOURS = 24;

/** What a SCIM request runs as: enough to manage people and teams, and nothing else. */
export const SCIM_PERMISSIONS = ['identity.user.read', 'identity.user.manage', 'identity.org.read', 'identity.org.manage', 'identity.role.read', 'identity.role.manage', 'identity.session.manage'] as const;

function mint(slug: string): string {
  return `scim_${slug}_${randomBytes(32).toString('base64url')}`;
}

/** The tenant slug inside a token, or null for anything that is not one of ours. */
export function slugOf(token: string): string | null {
  const match = /^scim_([a-z0-9][a-z0-9-]{0,62})_([A-Za-z0-9_-]{40,})$/.exec(token);
  return match ? match[1]! : null;
}

/** Issues a new token. Any current token stays valid for the overlap, then expires. */
export async function rotateToken(ctx: TenantContext, now: Date = new Date()) {
  authz.require(ctx, 'identity.scim.manage');
  const tenant = await tenantService.findTenantById(ctx.tenantId);
  if (!tenant) throw new NotFoundError('tenant', ctx.tenantId);
  const token = mint(tenant.slug);
  const expiresAt = new Date(now.getTime() + ROTATION_OVERLAP_HOURS * 3600 * 1000);

  const issued = await transaction(ctx, async (tx) => {
    const current = await tx.scimToken.findMany({ where: { revokedAt: null, expiresAt: null } });
    for (const row of current) {
      await tx.scimToken.update({ where: { id: row.id }, data: { expiresAt } });
    }
    const row = await tx.scimToken.create({
      data: { id: newId(), tenantId: ctx.tenantId, tokenHash: digest(token), hint: token.slice(-4), createdBy: ctx.actor.id },
    });
    await recordAudit(tx, ctx, { action: 'scim.token.rotated', targetType: 'scim_token', targetId: row.id, after: { hint: row.hint, previousExpireAt: current.length > 0 ? expiresAt.toISOString() : null } });
    return row;
  });

  return { id: issued.id, token, hint: issued.hint, createdAt: issued.createdAt, previousValidUntil: expiresAt };
}

export async function revokeTokens(ctx: TenantContext, now: Date = new Date()): Promise<number> {
  authz.require(ctx, 'identity.scim.manage');
  return transaction(ctx, async (tx) => {
    const result = await tx.scimToken.updateMany({ where: { revokedAt: null }, data: { revokedAt: now } });
    await recordAudit(tx, ctx, { action: 'scim.token.revoked', targetType: 'scim_token', targetId: ctx.tenantId, after: { revoked: result.count } });
    return result.count;
  });
}

export async function describeTokens(ctx: TenantContext) {
  authz.require(ctx, 'identity.scim.manage');
  return transaction(ctx, (tx) => tx.scimToken.findMany({ where: { revokedAt: null }, orderBy: { createdAt: 'desc' } }));
}

/**
 * Turns a presented token into the tenant context a SCIM request runs as,
 * or refuses it. Last use is recorded at most every five minutes, so a
 * provider polling every thirty seconds does not write a row each time.
 */
export async function authenticate(presented: string, now: Date = new Date()): Promise<{ tenantId: string; region: string; permissions: ReturnType<typeof buildPermissionSet> }> {
  const slug = slugOf(presented);
  if (!slug) throw new UnauthorisedError('not a SCIM token');
  const tenant = await tenantService.findTenantBySlug(slug);
  if (!tenant || tenant.status !== 'active') throw new UnauthorisedError('not a SCIM token for a tenant that is active');

  const lookup = systemContext(tenant.id, { region: tenant.region });
  const hash = digest(presented);
  const row = await withContext(lookup, () =>
    transaction(lookup, async (tx) => {
      const found = await tx.scimToken.findFirst({
        where: { tokenHash: hash, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      });
      if (found && (!found.lastUsedAt || now.getTime() - found.lastUsedAt.getTime() > 5 * 60_000)) {
        await tx.scimToken.update({ where: { id: found.id }, data: { lastUsedAt: now } });
      }
      return found;
    }),
  );
  if (!row) throw new UnauthorisedError('this SCIM token is not valid');

  return {
    tenantId: tenant.id,
    region: tenant.region,
    permissions: buildPermissionSet(SCIM_PERMISSIONS.map((key) => ({ key, scope: 'any' as const }))),
  };
}
