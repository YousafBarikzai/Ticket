import { z } from 'zod';
import type { Scope, PermissionDeclaration } from './authz.js';
import type { QueueName } from './jobs.js';

/**
 * A module manifest (docs/architecture/04 §4).
 *
 * The manifest is data, read at start-up by the API (to mount routes), the
 * worker (to register jobs), the administration module (to render settings and
 * enable or disable the module per tenant) and the permission registry (to seed
 * keys and generate the permission-matrix tests).
 */
export interface ModuleSettingDeclaration {
  key: string;
  schema: z.ZodTypeAny;
  default: unknown;
  scopes: ('platform' | 'tenant' | 'organisation')[];
  description?: string;
}

export interface ModuleFlagDeclaration {
  key: string;
  default: boolean;
  owner: string;
  /** Phase by which the flag must be removed; a lint check enforces it. */
  expires: string | 'permanent';
  description?: string;
}

export interface ModuleJobDeclaration {
  name: string;
  queue: QueueName;
  schedule?: string;
  description?: string;
}

export interface ModuleManifest {
  id: string;
  key: string;
  version: string;
  phase: string;
  name: string;
  dependsOn: string[];
  permissions: PermissionDeclaration[];
  events: { publishes: string[]; consumes: string[] };
  featureFlags: ModuleFlagDeclaration[];
  settings: ModuleSettingDeclaration[];
  jobs: ModuleJobDeclaration[];
  routesPrefix?: string;
  enabledByDefault: boolean;
  /** Can this module be turned off for a tenant? Foundations cannot. */
  optional: boolean;
  /**
   * Whom the module serves. `tenant` (the default) is a product feature: each
   * tenant records it, lists it and may turn it on or off. `platform` is the
   * deployment's own machinery — the shared demo's nightly rebuild is the
   * first — which registers jobs like any module but is no tenant's to see:
   * a customer's module list that read "Demo" would be describing our
   * operations to them, and a toggle for it would be a switch they could not
   * meaningfully use (A4 §2.3).
   */
  audience?: 'tenant' | 'platform';
}

/** Whether a tenant records, lists and may toggle this module; false for the platform's own. */
export function isTenantModule(manifest: Pick<ModuleManifest, 'audience'>): boolean {
  return (manifest.audience ?? 'tenant') === 'tenant';
}

const registry = new Map<string, ModuleManifest>();

export function registerModule(manifest: ModuleManifest): ModuleManifest {
  registry.set(manifest.id, manifest);
  return manifest;
}

export function modules(): ModuleManifest[] {
  return [...registry.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** The modules a tenant can have: every registered module except the platform's own. */
export function tenantModules(): ModuleManifest[] {
  return modules().filter(isTenantModule);
}

export function moduleById(id: string): ModuleManifest | undefined {
  return registry.get(id);
}

export function clearModules(): void {
  registry.clear();
}

/** Every permission key any module declares, with the scopes it supports. */
export function permissionRegistry(): (PermissionDeclaration & { module: string })[] {
  return modules()
    .flatMap((m) => m.permissions.map((p) => ({ ...p, module: m.id })))
    .sort((a, b) => a.key.localeCompare(b.key));
}

export function isKnownPermission(key: string): boolean {
  return permissionRegistry().some((p) => p.key === key);
}

export function scopesFor(key: string): Scope[] {
  return permissionRegistry().find((p) => p.key === key)?.scopes ?? [];
}

/**
 * Validates the registry as a whole: dependencies exist, every consumed event
 * is published by someone, and no two modules claim the same permission key.
 */
export function validateRegistry(): string[] {
  const problems: string[] = [];
  const all = modules();
  const ids = new Set(all.map((m) => m.id));
  const published = new Set(all.flatMap((m) => m.events.publishes));

  for (const module of all) {
    for (const dependency of module.dependsOn) {
      if (!ids.has(dependency)) problems.push(`${module.id} depends on ${dependency}, which is not registered`);
    }
    for (const consumed of module.events.consumes) {
      const isWildcard = consumed.endsWith('*');
      const matched = isWildcard
        ? [...published].some((p) => p.startsWith(consumed.slice(0, -1)))
        : published.has(consumed);
      if (!matched) problems.push(`${module.id} consumes ${consumed}, which no module publishes`);
    }
  }

  const seen = new Map<string, string>();
  for (const permission of permissionRegistry()) {
    const owner = seen.get(permission.key);
    if (owner && owner !== permission.module) {
      problems.push(`permission ${permission.key} is declared by both ${owner} and ${permission.module}`);
    }
    seen.set(permission.key, permission.module);
  }

  return problems;
}

/**
 * Work a module must do when a tenant is purged, beyond deleting its rows.
 *
 * Phase 2 found that deleting a tenant left all its data behind; the fix was to
 * delete every tenant-scoped table. Phase 3 adds state that is not in a table
 * at all — a per-tenant search index on another server — and the same defect
 * would recur silently, because nothing in the database would look wrong.
 *
 * A registry rather than a call from the tenancy module: tenancy must not
 * depend on search, storage or any other module in order to clean up after
 * them. Each module declares what it leaves outside the database, and the purge
 * asks.
 */
export type TenantPurgeHook = (tenantId: string) => Promise<void>;

const purgeHooks = new Map<string, TenantPurgeHook>();

export function registerTenantPurgeHook(name: string, hook: TenantPurgeHook): void {
  purgeHooks.set(name, hook);
}

export function tenantPurgeHooks(): { name: string; hook: TenantPurgeHook }[] {
  return [...purgeHooks].map(([name, hook]) => ({ name, hook }));
}

/** Test helper: forget registered hooks. */
export function resetTenantPurgeHooks(): void {
  purgeHooks.clear();
}
