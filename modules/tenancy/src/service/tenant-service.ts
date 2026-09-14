import { z } from 'zod';
import {
  type TenantContext,
  ConflictError,
  NotFoundError,
  SYSTEM_PERMISSIONS,
  createContext,
  newId,
  platformDb,
  platformTransaction,
  publish,
  recordAudit,
  systemContext,
  withContext,
  logger,
} from '@itsm/platform';
import { events } from '@itsm/contracts';

/**
 * MOD-21 tenant lifecycle.
 *
 * Provisioning is a job with recorded steps so a partial failure can be
 * resumed rather than leaving a half-built tenant (docs/architecture/10 §4).
 * Every step is idempotent for the same reason.
 */

export const provisionTenantSchema = z.object({
  name: z.string().min(1).max(200),
  slug: z
    .string()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, 'lowercase letters, digits and hyphens only'),
  region: z.string().default('eu-west'),
  adminEmail: z.string().email().optional(),
  parentTenantId: z.string().uuid().optional(),
});
export type ProvisionTenantInput = z.infer<typeof provisionTenantSchema>;

export interface ProvisionStep {
  key: string;
  status: 'pending' | 'done' | 'failed';
  error?: string;
  at?: string;
}

export type SeedStep = (ctx: TenantContext) => Promise<void>;

/**
 * Modules register what a brand-new tenant needs: system roles, default
 * policies, templates. Registration rather than a hard-coded list keeps the
 * module boundary intact.
 */
const seedSteps: { key: string; run: SeedStep }[] = [];

export function registerSeedStep(key: string, run: SeedStep): void {
  if (!seedSteps.some((s) => s.key === key)) seedSteps.push({ key, run });
}

export function registeredSeedSteps(): string[] {
  return seedSteps.map((s) => s.key);
}

export async function provisionTenant(input: ProvisionTenantInput): Promise<{ tenantId: string; steps: ProvisionStep[] }> {
  const parsed = provisionTenantSchema.parse(input);
  const db = platformDb();

  const existing = await db.tenant.findFirst({ where: { slug: parsed.slug } });
  if (existing) throw new ConflictError(`a tenant with the slug ${parsed.slug} already exists`);

  const tenantId = newId();
  await db.tenant.create({
    data: {
      id: tenantId,
      name: parsed.name,
      slug: parsed.slug,
      region: parsed.region,
      status: 'provisioning',
      parentTenantId: parsed.parentTenantId ?? null,
    },
  });

  const jobId = newId();
  const steps: ProvisionStep[] = seedSteps.map((s) => ({ key: s.key, status: 'pending' as const }));
  const ctx = systemContext(tenantId, { permissions: SYSTEM_PERMISSIONS, region: parsed.region });

  // The provisioning job belongs to the tenant it is building, so it is written
  // inside that tenant's context. Row-level security refuses it otherwise, and
  // that refusal is the point: nothing tenant-scoped is written without a
  // tenant, not even by the platform role.
  const recordSteps = async (status: string, error?: string): Promise<void> => {
    await platformTransaction(ctx, async (tx) => {
      await tx.tenantProvisioningJob.upsert({
        where: { id: jobId },
        create: {
          id: jobId,
          tenantId,
          steps: steps as never,
          status,
          ...(error ? { error } : {}),
          startedAt: new Date(),
        },
        update: {
          steps: steps as never,
          status,
          ...(error ? { error } : {}),
          ...(status === 'done' || status === 'failed' ? { finishedAt: new Date() } : {}),
        },
      });
    });
  };

  await withContext(ctx, async () => {
    await recordSteps('running');

    for (const step of seedSteps) {
      const record = steps.find((s) => s.key === step.key)!;
      try {
        await step.run(ctx);
        record.status = 'done';
        record.at = new Date().toISOString();
      } catch (error) {
        record.status = 'failed';
        record.error = (error as Error).message;
        await recordSteps('failed', record.error);
        logger.error('tenant provisioning failed', { tenantId, step: step.key, error: record.error });
        throw error;
      }
      await recordSteps('running');
    }

    await recordSteps('done');
    await db.tenant.update({ where: { id: tenantId }, data: { status: 'active' } });

    // The audit row and the event go through the ordinary tenant-scoped path,
    // so a tenant's history starts with its own creation.
    await platformTransaction(ctx, async (tx) => {
      await recordAudit(tx, ctx, {
        action: 'tenant.created',
        targetType: 'tenant',
        targetId: tenantId,
        after: { name: parsed.name, slug: parsed.slug, region: parsed.region },
      });
      await publish(tx, ctx, {
        definition: events.tenantCreated,
        aggregateId: tenantId,
        payload: { tenantId, name: parsed.name, slug: parsed.slug, plan: null, region: parsed.region },
      });
    });
  });

  logger.info('tenant provisioned', { tenantId, slug: parsed.slug, steps: steps.length });
  return { tenantId, steps };
}

export async function suspendTenant(tenantId: string, reason?: string): Promise<void> {
  const db = platformDb();
  const tenant = await db.tenant.findFirst({ where: { id: tenantId } });
  if (!tenant) throw new NotFoundError('tenant', tenantId);
  if (tenant.status === 'suspended') return;

  await db.tenant.update({ where: { id: tenantId }, data: { status: 'suspended', suspendedAt: new Date() } });

  const ctx = systemContext(tenantId, { region: tenant.region });
  await withContext(ctx, async () => {
    await platformTransaction(ctx, async (tx) => {
      await recordAudit(tx, ctx, {
        action: 'tenant.suspended',
        targetType: 'tenant',
        targetId: tenantId,
        before: { status: tenant.status },
        after: { status: 'suspended' },
        reason: reason ?? null,
      });
      await publish(tx, ctx, {
        definition: events.tenantSuspended,
        aggregateId: tenantId,
        payload: { tenantId, reason: reason ?? null },
      });
    });
  });
}

export async function resumeTenant(tenantId: string): Promise<void> {
  const db = platformDb();
  await db.tenant.update({ where: { id: tenantId }, data: { status: 'active', suspendedAt: null } });
}

export async function findTenantBySlug(slug: string) {
  return platformDb().tenant.findFirst({ where: { slug, deletedAt: null } });
}

export async function findTenantById(id: string) {
  return platformDb().tenant.findFirst({ where: { id, deletedAt: null } });
}

/** Resolves a tenant from a request host, for branding the login page. */
export async function findTenantByHost(host: string) {
  const domain = await platformDb().tenantDomain.findFirst({ where: { host: host.toLowerCase() } });
  if (!domain) return null;
  return findTenantById(domain.tenantId);
}

export async function listTenants(limit = 50) {
  return platformDb().tenant.findMany({ where: { deletedAt: null }, orderBy: { createdAt: 'desc' }, take: limit });
}

export interface OrganisationInput {
  name: string;
  code: string;
  parentId?: string;
  type?: string;
}

/**
 * Organisations carry a materialised path so a subtree query is a prefix match
 * rather than a recursive walk: the permission checker does this on every
 * request, so it has to be cheap.
 */
export async function createOrganisation(ctx: TenantContext, input: OrganisationInput) {
  return platformTransaction(ctx, async (tx) => {
    const existing = await tx.organisation.findFirst({ where: { code: input.code, deletedAt: null } });
    if (existing) throw new ConflictError(`an organisation with the code ${input.code} already exists`);

    let path = `/${input.code}`;
    if (input.parentId) {
      const parent = await tx.organisation.findFirst({ where: { id: input.parentId, deletedAt: null } });
      if (!parent) throw new NotFoundError('organisation', input.parentId);
      path = `${parent.path}/${input.code}`;
    }

    const org = await tx.organisation.create({
      data: {
        id: newId(),
        tenantId: ctx.tenantId,
        parentId: input.parentId ?? null,
        name: input.name,
        code: input.code,
        type: input.type ?? 'business_unit',
        path,
        createdBy: ctx.actor.id,
      },
    });
    await recordAudit(tx, ctx, {
      action: 'organisation.created',
      targetType: 'organisation',
      targetId: org.id,
      after: { name: input.name, code: input.code, path },
    });
    return org;
  });
}

export async function listOrganisations(ctx: TenantContext) {
  return platformTransaction(ctx, (tx) => tx.organisation.findMany({ where: { deletedAt: null }, orderBy: { path: 'asc' } }));
}

/** A context for a tenant, used by the platform CLI and by seeding. */
export function contextForTenant(tenantId: string, region = 'eu-west'): TenantContext {
  return createContext({
    tenantId,
    region,
    actor: { type: 'system', id: null, displayName: 'platform' },
    permissions: SYSTEM_PERMISSIONS,
  });
}
