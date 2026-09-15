import {
  type TenantContext,
  type Tx,
  buildPermissionSet,
  cached,
  tenantKey,
  transaction,
  type GrantedPermission,
  type PermissionSet,
  type Scope,
} from '@itsm/platform';

/**
 * Resolves a user's effective permissions.
 *
 * Roles live in the platform's own tables rather than in identity-provider
 * tokens (ADR-0013): a token would go stale and could not express the scope
 * narrowing that lets group IT see every subsidiary while a local agent sees
 * only their own.
 */

const PERMISSION_TTL_SECONDS = 300;

export interface ResolvedActor {
  userId: string;
  permissions: PermissionSet;
  organisationIds: string[];
  organisationPaths: string[];
  teamIds: string[];
  primaryOrgId: string | null;
  locale: string;
  timeZone: string;
  displayName: string;
  email: string;
  status: string;
}

/** Reads role assignments, team memberships and organisation subtrees in one pass. */
export async function loadActor(tx: Tx, tenantId: string, userId: string): Promise<ResolvedActor | null> {
  const user = await tx.user.findFirst({ where: { id: userId, deletedAt: null } });
  if (!user) return null;

  const [assignments, memberships] = await Promise.all([
    tx.roleAssignment.findMany({
      where: { userId, OR: [{ validTo: null }, { validTo: { gt: new Date() } }] },
      include: { role: { include: { permissions: true } } },
    }),
    tx.teamMembership.findMany({
      where: { userId, OR: [{ validTo: null }, { validTo: { gt: new Date() } }] },
      include: { team: true },
    }),
  ]);

  const granted: GrantedPermission[] = [];
  for (const assignment of assignments) {
    for (const permission of assignment.role.permissions) {
      granted.push({
        key: permission.permissionKey,
        scope: permission.scope as Scope,
        scopeType: (assignment.scopeType as GrantedPermission['scopeType']) ?? null,
        scopeId: assignment.scopeId,
      });
    }
  }

  // Organisation-scoped grants apply to the whole subtree beneath the named
  // organisation, which is what "group IT sees all subsidiaries" means.
  const scopedOrgIds = assignments.filter((a) => a.scopeType === 'organisation' && a.scopeId).map((a) => a.scopeId!);
  const orgIds = new Set<string>([...scopedOrgIds, ...(user.primaryOrgId ? [user.primaryOrgId] : [])]);
  const teamOrgIds = memberships.map((m) => m.team.orgId);
  teamOrgIds.forEach((id) => orgIds.add(id));

  const organisations = orgIds.size
    ? await tx.organisation.findMany({ where: { id: { in: [...orgIds] }, deletedAt: null } })
    : [];
  const subtrees = organisations.length
    ? await tx.organisation.findMany({
        where: { OR: organisations.map((o) => ({ path: { startsWith: o.path } })), deletedAt: null },
      })
    : [];

  return {
    userId,
    permissions: buildPermissionSet(granted),
    organisationIds: [...new Set(subtrees.map((o) => o.id))],
    organisationPaths: [...new Set(subtrees.map((o) => o.path))],
    teamIds: memberships.map((m) => m.teamId),
    primaryOrgId: user.primaryOrgId,
    locale: user.locale,
    timeZone: user.timeZone,
    displayName: user.displayName,
    email: user.email,
    status: user.status,
  };
}

interface CachedActor extends Omit<ResolvedActor, 'permissions'> {
  granted: GrantedPermission[];
}

/**
 * Cached for five minutes, but invalidated by `role.assignment.changed` and
 * `user.updated`, so the specification's "effective within 5 seconds"
 * requirement is met by the event rather than by a short time-to-live.
 */
export async function resolveActor(ctx: TenantContext, userId: string): Promise<ResolvedActor | null> {
  const key = tenantKey(ctx.tenantId, 'perm', userId);
  const cachedValue = await cached<CachedActor | null>(key, PERMISSION_TTL_SECONDS, async () => {
    const actor = await transaction(ctx, (tx) => loadActor(tx, ctx.tenantId, userId));
    if (!actor) return null;
    const granted = actor.permissions.keys().flatMap((k) => actor.permissions.grantsFor?.(k) ?? []);
    return { ...actor, permissions: undefined as never, granted };
  });
  if (!cachedValue) return null;
  return { ...cachedValue, permissions: buildPermissionSet(cachedValue.granted) };
}
