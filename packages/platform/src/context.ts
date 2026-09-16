import { AsyncLocalStorage } from 'node:async_hooks';
import type { Actor } from '@itsm/contracts';
import { MissingTenantContextError } from './errors.js';
import { newCorrelationId } from './ids.js';
import type { PermissionSet } from './authz.js';

/**
 * The tenant context. Every public service method takes one as its first
 * argument, and there is no way to reach the data layer without it
 * (docs/architecture/05 §1).
 */
export interface TenantContext {
  tenantId: string;
  region: string;
  /**
   * Where this tenant permits its prompts to be processed.
   *
   * Carried on the context rather than looked up by the AI module, for two
   * reasons. It is a property of the tenant exactly as `region` is, and the
   * context is already built from the tenant row — so this costs no extra
   * query. And it keeps MOD-09 from taking a dependency on MOD-00 to ask one
   * question about a row it does not own.
   *
   * Empty means "wherever this tenant's own data lives", resolved by
   * `aiRegions` below. Two meanings for one empty value would be a bug; one
   * meaning and one resolver is not.
   */
  aiAllowedRegions: readonly string[];
  actor: Actor;
  /** Organisation subtree paths the actor belongs to, resolved once per request. */
  organisationIds: string[];
  organisationPaths: string[];
  teamIds: string[];
  permissions: PermissionSet;
  correlationId: string;
  causationId?: string;
  locale: string;
  timeZone: string;
  requestedAt: Date;
  impersonation?: { byUserId: string; reason: string };
  /** Set when an MSP tenant is acting inside a client tenant under a grant. */
  granteeTenantId?: string;
  ip?: string;
  userAgent?: string;
}

/**
 * The regions a tenant's prompts may be processed in.
 *
 * An empty policy inherits the tenant's own data region, which is the safe
 * reading and the one that needs no backfill: a tenant provisioned before the
 * policy existed already stated where its data lives, and that answer is the
 * conservative one. An operator who wants more says so explicitly.
 */
export function aiRegions(ctx: TenantContext): readonly string[] {
  return ctx.aiAllowedRegions.length > 0 ? ctx.aiAllowedRegions : [ctx.region];
}

const storage = new AsyncLocalStorage<TenantContext>();

/** The context of the current request, job or event handler, if any. */
export function currentContext(): TenantContext | undefined {
  return storage.getStore();
}

export function requireContext(detail = 'no active request or job'): TenantContext {
  const ctx = storage.getStore();
  if (!ctx) throw new MissingTenantContextError(detail);
  return ctx;
}

/** Runs `fn` with `ctx` as the ambient context for everything it awaits. */
export function withContext<T>(ctx: TenantContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/**
 * Sets the context for the rest of the current execution, including everything
 * awaited after it.
 *
 * `withContext` cannot be used from a web-framework hook, because a hook
 * returns before the route handler runs and so the handler would fall outside
 * the callback. `enterWith` is the primitive designed for exactly that shape.
 */
export function enterContext(ctx: TenantContext): void {
  storage.enterWith(ctx);
}

export interface CreateContextInput {
  tenantId: string;
  region?: string;
  aiAllowedRegions?: readonly string[];
  actor: Actor;
  permissions: PermissionSet;
  organisationIds?: string[];
  organisationPaths?: string[];
  teamIds?: string[];
  correlationId?: string;
  causationId?: string;
  locale?: string;
  timeZone?: string;
  impersonation?: { byUserId: string; reason: string };
  granteeTenantId?: string;
  ip?: string;
  userAgent?: string;
}

export function createContext(input: CreateContextInput): TenantContext {
  return {
    tenantId: input.tenantId,
    region: input.region ?? 'eu-west',
    aiAllowedRegions: input.aiAllowedRegions ?? [],
    actor: input.actor,
    organisationIds: input.organisationIds ?? [],
    organisationPaths: input.organisationPaths ?? [],
    teamIds: input.teamIds ?? [],
    permissions: input.permissions,
    correlationId: input.correlationId ?? newCorrelationId(),
    ...(input.causationId ? { causationId: input.causationId } : {}),
    locale: input.locale ?? 'en-GB',
    timeZone: input.timeZone ?? 'Europe/London',
    requestedAt: new Date(),
    ...(input.impersonation ? { impersonation: input.impersonation } : {}),
    ...(input.granteeTenantId ? { granteeTenantId: input.granteeTenantId } : {}),
    ...(input.ip ? { ip: input.ip } : {}),
    ...(input.userAgent ? { userAgent: input.userAgent } : {}),
  };
}

/**
 * A context for platform-owned background work (schedulers, provisioning,
 * reconcilers) acting inside one tenant. It still carries a tenant and is still
 * subject to row-level security: there is no "no tenant" mode.
 */
/**
 * The context fields that come from the tenant row, in one place.
 *
 * There are eleven places that build a context from a tenant, and every one of
 * them used to spell `region: tenant.region` by hand. Adding a second
 * tenant-derived field to that arrangement means eleven edits and one silent
 * failure wherever somebody misses one — a residency policy that is simply
 * absent in the worker reads exactly like a residency policy that allows
 * everything.
 *
 * So the set is named rather than repeated. A twelfth field later is one edit
 * here, and a twelfth call site gets all of them by construction.
 */
export function tenantFacts(tenant: { region: string; aiAllowedRegions?: readonly string[] }): {
  region: string;
  aiAllowedRegions: readonly string[];
} {
  return { region: tenant.region, aiAllowedRegions: tenant.aiAllowedRegions ?? [] };
}

export function systemContext(tenantId: string, options: Partial<CreateContextInput> = {}): TenantContext {
  return createContext({
    tenantId,
    actor: { type: options.actor?.type ?? 'system', id: null, displayName: options.actor?.displayName ?? 'platform' },
    permissions: options.permissions ?? SYSTEM_PERMISSIONS,
    ...options,
  });
}

/**
 * Background work runs with full permissions inside its tenant. It never
 * crosses a tenant boundary, because the boundary is enforced by the database,
 * not by this set.
 */
export const SYSTEM_PERMISSIONS: PermissionSet = {
  has: () => true,
  scopeFor: () => 'any',
  keys: () => ['*'],
  isSystem: true,
};
