import type { TenantContext } from './context.js';
import { transaction, type Tx } from './db.js';
import { cache, cached, invalidatePrefix, tenantKey } from './redis.js';
import { modules } from './manifest.js';
import { logger } from './telemetry.js';

/**
 * Settings and feature flags (ADR-0018).
 *
 * One framework for every configurable item in every module: declared in a
 * manifest with a schema and a default, stored with versions, resolved
 * organisation → parent organisations → tenant → platform default, cached, and
 * invalidated by the `config.published` event.
 */

const SETTING_TTL_SECONDS = 600;

function declarationFor(key: string) {
  for (const module of modules()) {
    const found = module.settings.find((s) => s.key === key);
    if (found) return found;
  }
  return undefined;
}

function flagDeclarationFor(key: string) {
  for (const module of modules()) {
    const found = module.featureFlags.find((f) => f.key === key);
    if (found) return found;
  }
  return undefined;
}

export interface ResolvedSetting<T = unknown> {
  key: string;
  value: T;
  source: 'organisation' | 'tenant' | 'platform-default';
  scopeId: string | null;
  version: number | null;
}

async function loadSetting(ctx: TenantContext, key: string): Promise<ResolvedSetting> {
  const declaration = declarationFor(key);
  if (!declaration) throw new Error(`setting ${key} is not declared by any module manifest`);

  return transaction(ctx, async (tx) => {
    // Organisation first (most specific), walking up the actor's subtree, then
    // the tenant, then the manifest default.
    const rows = await tx.setting.findMany({
      where: { key, OR: [{ scopeType: 'organisation', scopeId: { in: ctx.organisationIds } }, { scopeType: 'tenant' }] },
      include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
    });

    const organisation = rows.find((r) => r.scopeType === 'organisation');
    const tenant = rows.find((r) => r.scopeType === 'tenant');
    const chosen = organisation ?? tenant;
    const version = chosen?.versions[0];

    if (!chosen || !version) {
      return { key, value: declaration.default, source: 'platform-default' as const, scopeId: null, version: null };
    }
    const parsed = declaration.schema.safeParse(version.value);
    if (!parsed.success) {
      logger.warn('stored setting failed validation; using the default', { key, scopeType: chosen.scopeType });
      return { key, value: declaration.default, source: 'platform-default' as const, scopeId: null, version: null };
    }
    return {
      key,
      value: parsed.data,
      source: chosen.scopeType === 'organisation' ? ('organisation' as const) : ('tenant' as const),
      scopeId: chosen.scopeId,
      version: version.version,
    };
  });
}

export async function getSetting<T>(ctx: TenantContext, key: string): Promise<T> {
  const cacheKey = tenantKey(ctx.tenantId, 'cfg', key, ctx.organisationIds.join('|') || 'none');
  const resolved = await cached<ResolvedSetting>(cacheKey, SETTING_TTL_SECONDS, () => loadSetting(ctx, key));
  return resolved.value as T;
}

export async function describeSetting(ctx: TenantContext, key: string): Promise<ResolvedSetting> {
  return loadSetting(ctx, key);
}

/** Writes a new version of a setting. Publishing is MOD-13's responsibility. */
export async function writeSettingVersion(
  tx: Tx,
  ctx: TenantContext,
  input: { key: string; scopeType: 'tenant' | 'organisation'; scopeId: string | null; value: unknown; reason?: string },
): Promise<{ settingId: string; version: number }> {
  const declaration = declarationFor(input.key);
  if (!declaration) throw new Error(`setting ${input.key} is not declared by any module manifest`);
  declaration.schema.parse(input.value);

  const existing = await tx.setting.findFirst({
    where: { key: input.key, scopeType: input.scopeType, scopeId: input.scopeId },
  });

  const { newId } = await import('./ids.js');
  const settingId = existing?.id ?? newId();
  const nextVersion = (existing?.currentVersion ?? 0) + 1;

  if (existing) {
    await tx.setting.update({ where: { id: settingId }, data: { currentVersion: nextVersion } });
  } else {
    await tx.setting.create({
      data: {
        id: settingId,
        tenantId: ctx.tenantId,
        key: input.key,
        scopeType: input.scopeType,
        scopeId: input.scopeId,
        ownerId: ctx.actor.id,
        currentVersion: nextVersion,
      },
    });
  }

  await tx.settingVersion.create({
    data: {
      id: newId(),
      tenantId: ctx.tenantId,
      settingId,
      version: nextVersion,
      value: input.value as never,
      reason: input.reason ?? null,
      publishedBy: ctx.actor.id,
    },
  });

  return { settingId, version: nextVersion };
}

export async function invalidateSettings(tenantId: string, key?: string): Promise<void> {
  await invalidatePrefix(key ? tenantKey(tenantId, 'cfg', key) : tenantKey(tenantId, 'cfg'));
}

/**
 * Feature flags resolve platform default → tenant override → organisation
 * override. Plan gates arrive with MOD-21 in PH-3 and slot in between the first
 * two.
 */
export async function isEnabled(ctx: TenantContext, key: string): Promise<boolean> {
  const declaration = flagDeclarationFor(key);
  if (!declaration) throw new Error(`feature flag ${key} is not declared by any module manifest`);

  const cacheKey = tenantKey(ctx.tenantId, 'flag', key, ctx.organisationIds.join('|') || 'none');
  return cached<boolean>(cacheKey, SETTING_TTL_SECONDS, async () =>
    transaction(ctx, async (tx) => {
      const overrides = await tx.featureFlagOverride.findMany({
        where: { key, OR: [{ scopeType: 'organisation', scopeId: { in: ctx.organisationIds } }, { scopeType: 'tenant' }] },
      });
      const organisation = overrides.find((o) => o.scopeType === 'organisation');
      const tenant = overrides.find((o) => o.scopeType === 'tenant');
      return organisation?.value ?? tenant?.value ?? declaration.default;
    }),
  );
}

export async function invalidateFlags(tenantId: string): Promise<void> {
  await invalidatePrefix(tenantKey(tenantId, 'flag'));
}

/** Drops every cached permission set for a tenant, after a role change. */
export async function invalidatePermissions(tenantId: string, userId?: string): Promise<void> {
  await invalidatePrefix(userId ? tenantKey(tenantId, 'perm', userId) : tenantKey(tenantId, 'perm'));
}

export { cache };
