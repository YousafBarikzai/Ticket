import {
  type TenantContext,
  authz,
  describeSetting,
  invalidateFlags,
  invalidatePermissions,
  invalidateSettings,
  modules,
  newId,
  NotFoundError,
  publish,
  recordAudit,
  transaction,
  ValidationError,
  writeSettingVersion,
} from '@itsm/platform';
import { events } from '@itsm/contracts';

/**
 * MOD-13 configuration control plane (ADR-0018).
 *
 * Every configurable item in every module comes through here: validated
 * against the declaring manifest's schema, versioned, published as an event so
 * caches drop, and reversible in one call.
 */

export function listDeclaredSettings() {
  return modules().flatMap((module) =>
    module.settings.map((setting) => ({
      key: setting.key,
      module: module.id,
      scopes: setting.scopes,
      default: setting.default,
      description: setting.description ?? null,
    })),
  );
}

export function listDeclaredFlags() {
  return modules().flatMap((module) =>
    module.featureFlags.map((flag) => ({
      key: flag.key,
      module: module.id,
      default: flag.default,
      owner: flag.owner,
      expires: flag.expires,
      description: flag.description ?? null,
    })),
  );
}

export async function getSettingWithProvenance(ctx: TenantContext, key: string) {
  authz.require(ctx, 'admin.setting.read');
  return describeSetting(ctx, key);
}

export async function publishSetting(
  ctx: TenantContext,
  input: { key: string; value: unknown; scopeType?: 'tenant' | 'organisation'; scopeId?: string; reason?: string },
) {
  authz.require(ctx, 'admin.setting.manage');
  const declaration = listDeclaredSettings().find((s) => s.key === input.key);
  if (!declaration) throw new NotFoundError('setting', input.key);

  const scopeType = input.scopeType ?? 'tenant';
  if (!declaration.scopes.includes(scopeType)) {
    throw new ValidationError(`${input.key} cannot be set at ${scopeType} scope; allowed: ${declaration.scopes.join(', ')}`);
  }
  if (scopeType === 'organisation' && !input.scopeId) {
    throw new ValidationError('an organisation scope needs a scopeId');
  }

  const before = await describeSetting(ctx, input.key);

  const result = await transaction(ctx, async (tx) => {
    const written = await writeSettingVersion(tx, ctx, {
      key: input.key,
      scopeType,
      scopeId: input.scopeId ?? null,
      value: input.value,
      ...(input.reason ? { reason: input.reason } : {}),
    });

    await recordAudit(tx, ctx, {
      action: 'config.published',
      targetType: 'setting',
      targetId: input.key,
      before: { value: before.value, source: before.source },
      after: { value: input.value, scopeType, scopeId: input.scopeId ?? null, version: written.version },
      reason: input.reason ?? null,
    });
    await publish(tx, ctx, {
      definition: events.configPublished,
      aggregateId: input.key,
      payload: { key: input.key, scopeType, scopeId: input.scopeId ?? null, version: written.version },
    });
    return written;
  });

  await invalidateSettings(ctx.tenantId, input.key);
  return result;
}

export async function rollbackSetting(
  ctx: TenantContext,
  input: { key: string; toVersion: number; scopeType?: 'tenant' | 'organisation'; scopeId?: string; reason?: string },
) {
  authz.require(ctx, 'admin.setting.manage');
  const scopeType = input.scopeType ?? 'tenant';

  const result = await transaction(ctx, async (tx) => {
    const setting = await tx.setting.findFirst({
      where: { key: input.key, scopeType, scopeId: input.scopeId ?? null },
    });
    if (!setting) throw new NotFoundError('setting', input.key);

    const target = await tx.settingVersion.findFirst({ where: { settingId: setting.id, version: input.toVersion } });
    if (!target) throw new NotFoundError('setting version', String(input.toVersion));

    // Rolling back publishes the old value as a NEW version, so history stays
    // linear and an auditor can see that a rollback happened.
    const nextVersion = setting.currentVersion + 1;
    await tx.settingVersion.create({
      data: {
        id: newId(),
        tenantId: ctx.tenantId,
        settingId: setting.id,
        version: nextVersion,
        value: target.value as never,
        reason: input.reason ?? `rolled back to version ${input.toVersion}`,
        publishedBy: ctx.actor.id,
      },
    });
    await tx.setting.update({ where: { id: setting.id }, data: { currentVersion: nextVersion } });

    await recordAudit(tx, ctx, {
      action: 'config.rolled_back',
      targetType: 'setting',
      targetId: input.key,
      after: { toVersion: input.toVersion, newVersion: nextVersion },
      reason: input.reason ?? null,
    });
    await publish(tx, ctx, {
      definition: events.configRolledBack,
      aggregateId: input.key,
      payload: { key: input.key, scopeType, scopeId: input.scopeId ?? null, toVersion: input.toVersion },
    });
    return { version: nextVersion, restoredFrom: input.toVersion };
  });

  await invalidateSettings(ctx.tenantId, input.key);
  return result;
}

export async function listSettingVersions(ctx: TenantContext, key: string, scopeType: 'tenant' | 'organisation' = 'tenant', scopeId?: string) {
  authz.require(ctx, 'admin.setting.read');
  return transaction(ctx, async (tx) => {
    const setting = await tx.setting.findFirst({ where: { key, scopeType, scopeId: scopeId ?? null } });
    if (!setting) return [];
    return tx.settingVersion.findMany({ where: { settingId: setting.id }, orderBy: { version: 'desc' }, take: 50 });
  });
}

export async function setFlag(
  ctx: TenantContext,
  input: { key: string; value: boolean; scopeType?: 'tenant' | 'organisation'; scopeId?: string; reason?: string },
) {
  authz.require(ctx, 'admin.flag.manage');
  const declaration = listDeclaredFlags().find((f) => f.key === input.key);
  if (!declaration) throw new NotFoundError('feature flag', input.key);

  const scopeType = input.scopeType ?? 'tenant';
  const result = await transaction(ctx, async (tx) => {
    const existing = await tx.featureFlagOverride.findFirst({
      where: { key: input.key, scopeType, scopeId: input.scopeId ?? null },
    });
    const override = existing
      ? await tx.featureFlagOverride.update({ where: { id: existing.id }, data: { value: input.value, reason: input.reason ?? null } })
      : await tx.featureFlagOverride.create({
          data: {
            id: newId(),
            tenantId: ctx.tenantId,
            key: input.key,
            scopeType,
            scopeId: input.scopeId ?? null,
            value: input.value,
            reason: input.reason ?? null,
            createdBy: ctx.actor.id,
          },
        });

    await recordAudit(tx, ctx, {
      action: 'feature_flag.set',
      targetType: 'feature_flag',
      targetId: input.key,
      before: existing ? { value: existing.value } : null,
      after: { value: input.value, scopeType, scopeId: input.scopeId ?? null },
      reason: input.reason ?? null,
    });
    return override;
  });

  await invalidateFlags(ctx.tenantId);
  return result;
}

/** Reconciles the modules recorded for a tenant with the manifests in the image. */
export async function syncInstalledModules(ctx: TenantContext): Promise<{ added: number; updated: number }> {
  let added = 0;
  let updated = 0;

  await transaction(ctx, async (tx) => {
    for (const module of modules()) {
      const existing = await tx.installedModule.findFirst({ where: { moduleId: module.id } });
      if (!existing) {
        await tx.installedModule.create({
          data: {
            id: newId(),
            tenantId: ctx.tenantId,
            moduleId: module.id,
            version: module.version,
            enabled: module.enabledByDefault,
          },
        });
        added += 1;
      } else if (existing.version !== module.version) {
        await tx.installedModule.update({ where: { id: existing.id }, data: { version: module.version } });
        updated += 1;
      }
    }
  });

  return { added, updated };
}

export async function setModuleEnabled(ctx: TenantContext, moduleId: string, enabled: boolean) {
  authz.require(ctx, 'admin.module.manage');
  const manifest = modules().find((m) => m.id === moduleId);
  if (!manifest) throw new NotFoundError('module', moduleId);
  if (!manifest.optional && !enabled) {
    throw new ValidationError(`${moduleId} is a foundation module and cannot be disabled`);
  }

  // A module cannot be turned off while another enabled module depends on it.
  if (!enabled) {
    const dependents = modules().filter((m) => m.dependsOn.includes(moduleId));
    if (dependents.length > 0) {
      throw new ValidationError(`${moduleId} is required by ${dependents.map((d) => d.id).join(', ')}`);
    }
  }

  const result = await transaction(ctx, async (tx) => {
    const existing = await tx.installedModule.findFirst({ where: { moduleId } });
    if (!existing) throw new NotFoundError('installed module', moduleId);
    const record = await tx.installedModule.update({ where: { id: existing.id }, data: { enabled } });

    await recordAudit(tx, ctx, {
      action: enabled ? 'module.enabled' : 'module.disabled',
      targetType: 'module',
      targetId: moduleId,
      before: { enabled: existing.enabled },
      after: { enabled },
    });
    // Two event definitions with different payloads, so publish each branch
    // explicitly rather than widening the payload type.
    if (enabled) {
      await publish(tx, ctx, {
        definition: events.moduleEnabled,
        aggregateId: moduleId,
        payload: { moduleId, version: manifest.version },
      });
    } else {
      await publish(tx, ctx, { definition: events.moduleDisabled, aggregateId: moduleId, payload: { moduleId } });
    }
    return record;
  });

  await invalidateSettings(ctx.tenantId);
  await invalidatePermissions(ctx.tenantId);
  return result;
}

export async function listInstalledModules(ctx: TenantContext) {
  authz.require(ctx, 'admin.setting.read');
  return transaction(ctx, async (tx) => {
    const installed = await tx.installedModule.findMany({ orderBy: { moduleId: 'asc' } });
    return installed.map((record) => {
      const manifest = modules().find((m) => m.id === record.moduleId);
      return {
        ...record,
        name: manifest?.name ?? record.moduleId,
        phase: manifest?.phase ?? null,
        optional: manifest?.optional ?? true,
        dependsOn: manifest?.dependsOn ?? [],
      };
    });
  });
}

/** The admin activity log: the audit trail filtered to configuration actions. */
export async function listAdminActivity(ctx: TenantContext, limit = 100) {
  authz.require(ctx, 'admin.activity.read');
  return transaction(ctx, (tx) =>
    tx.auditEvent.findMany({
      where: {
        OR: [
          { action: { startsWith: 'config.' } },
          { action: { startsWith: 'feature_flag.' } },
          { action: { startsWith: 'module.' } },
          { action: { startsWith: 'role.' } },
          { action: { startsWith: 'webhook.' } },
        ],
      },
      orderBy: { seq: 'desc' },
      take: limit,
    }),
  );
}
