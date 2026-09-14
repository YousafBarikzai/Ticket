import type { TenantContext } from './context.js';
import { ForbiddenError, NotFoundError } from './errors.js';

/**
 * Authorisation: permission keys declared by module manifests, roles as sets of
 * (key, scope) pairs, and checks that happen in the service layer only
 * (ADR-0013). Routes never authorise; the UI hiding an action is a convenience,
 * not a control.
 */

export type Scope = 'own' | 'team' | 'any';

const SCOPE_RANK: Record<Scope, number> = { own: 1, team: 2, any: 3 };

export interface PermissionDeclaration {
  key: string;
  scopes: Scope[];
  description?: string;
  /**
   * The phase in which this permission becomes usable. A permission may be
   * declared ahead of the feature that needs it, so that contracts and tests
   * are stable across the phase boundary; until then no system role holds it.
   */
  phase?: string;
}

export interface GrantedPermission {
  key: string;
  scope: Scope;
  /** Optional narrowing of a grant to an organisation subtree, team or service. */
  scopeType?: 'organisation' | 'team' | 'service' | null;
  scopeId?: string | null;
}

export interface PermissionSet {
  has(key: string, scope?: Scope): boolean;
  scopeFor(key: string): Scope | undefined;
  keys(): string[];
  grantsFor?(key: string): GrantedPermission[];
  isSystem?: boolean;
}

export function buildPermissionSet(granted: GrantedPermission[]): PermissionSet {
  const byKey = new Map<string, GrantedPermission[]>();
  for (const g of granted) {
    const list = byKey.get(g.key) ?? [];
    list.push(g);
    byKey.set(g.key, list);
  }
  const best = new Map<string, Scope>();
  for (const [key, list] of byKey) {
    let top: Scope = 'own';
    for (const g of list) if (SCOPE_RANK[g.scope] > SCOPE_RANK[top]) top = g.scope;
    best.set(key, top);
  }
  return {
    has(key, scope) {
      const have = best.get(key);
      if (!have) return false;
      if (!scope) return true;
      return SCOPE_RANK[have] >= SCOPE_RANK[scope];
    },
    scopeFor: (key) => best.get(key),
    keys: () => [...best.keys()].sort(),
    grantsFor: (key) => byKey.get(key) ?? [],
  };
}

export const EMPTY_PERMISSIONS: PermissionSet = buildPermissionSet([]);

/**
 * How "own" and "team" apply to one module's aggregate. Each module registers a
 * resolver for the records it owns, because only the owning module knows which
 * of its columns mean "the requester" or "my team".
 */
export interface ScopeResolver<T = unknown> {
  aggregate: string;
  isOwn(ctx: TenantContext, record: T): boolean;
  isTeam(ctx: TenantContext, record: T): boolean;
  /** Organisation of the record, used for organisation-scoped role grants. */
  orgId?(record: T): string | null | undefined;
}

const resolvers = new Map<string, ScopeResolver<never>>();

export function registerScopeResolver<T>(resolver: ScopeResolver<T>): void {
  resolvers.set(resolver.aggregate, resolver as ScopeResolver<never>);
}

export function getScopeResolver(aggregate: string): ScopeResolver<never> | undefined {
  return resolvers.get(aggregate);
}

/** Test helper: drop registered resolvers. */
export function clearScopeResolvers(): void {
  resolvers.clear();
}

export interface CheckTarget {
  aggregate: string;
  record: unknown;
}

export interface AuthzApi {
  can(ctx: TenantContext, key: string, target?: CheckTarget): boolean;
  require(ctx: TenantContext, key: string, target?: CheckTarget): void;
  /**
   * Raises NotFound rather than Forbidden, for use when the caller may not
   * learn that the record exists (specification §7).
   */
  requireVisible(ctx: TenantContext, key: string, target: CheckTarget, resourceName: string): void;
  effectiveScope(ctx: TenantContext, key: string): Scope | undefined;
}

function grantAppliesToRecord(ctx: TenantContext, grant: GrantedPermission, target: CheckTarget): boolean {
  if (!grant.scopeType || !grant.scopeId) return true;
  const resolver = getScopeResolver(target.aggregate);
  if (grant.scopeType === 'organisation') {
    const orgId = resolver?.orgId?.(target.record as never);
    return Boolean(orgId && ctx.organisationIds.includes(grant.scopeId) && orgId === grant.scopeId);
  }
  if (grant.scopeType === 'team') {
    const record = target.record as { groupId?: string | null };
    return record.groupId === grant.scopeId;
  }
  if (grant.scopeType === 'service') {
    const record = target.record as { serviceId?: string | null };
    return record.serviceId === grant.scopeId;
  }
  return false;
}

export const authz: AuthzApi = {
  can(ctx, key, target) {
    if (ctx.permissions.isSystem) return true;
    const scope = ctx.permissions.scopeFor(key);
    if (!scope) return false;
    if (!target) return true;

    const grants = ctx.permissions.grantsFor?.(key) ?? [];
    const applicable = grants.filter((g) => grantAppliesToRecord(ctx, g, target));
    if (grants.length > 0 && applicable.length === 0) return false;

    const bestScope = applicable.reduce<Scope>((acc, g) => (SCOPE_RANK[g.scope] > SCOPE_RANK[acc] ? g.scope : acc), 'own');
    if (bestScope === 'any') return true;

    const resolver = getScopeResolver(target.aggregate);
    if (!resolver) {
      // A module that has not declared how "own" applies to its aggregate must
      // not accidentally widen access: require tenant-wide permission.
      return false;
    }
    if (bestScope === 'team') return resolver.isTeam(ctx, target.record as never) || resolver.isOwn(ctx, target.record as never);
    return resolver.isOwn(ctx, target.record as never);
  },

  require(ctx, key, target) {
    if (!this.can(ctx, key, target)) throw new ForbiddenError(key);
  },

  requireVisible(ctx, key, target, resourceName) {
    if (!this.can(ctx, key, target)) throw new NotFoundError(resourceName);
  },

  effectiveScope(ctx, key) {
    if (ctx.permissions.isSystem) return 'any';
    return ctx.permissions.scopeFor(key);
  },
};
