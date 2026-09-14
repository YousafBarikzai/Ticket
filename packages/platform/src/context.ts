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

export interface CreateContextInput {
  tenantId: string;
  region?: string;
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
