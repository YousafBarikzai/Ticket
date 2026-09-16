import { z } from 'zod';
import {
  type TenantContext,
  type Tx,
  ConflictError,
  NotFoundError,
  SYSTEM_PERMISSIONS,
  createContext,
  logger,
  newId,
  platformDb,
  platformTransaction,
  publish,
  recordAudit,
  systemContext,
  tenantPurgeHooks,
  transaction,
  withContext,
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

/**
 * The regions a tenant permits its prompts to be processed in.
 *
 * A platform operator's write, not a tenant's: residency is a contractual term
 * and a tenant that could widen its own would be a control it could remove.
 * Narrowing is equally the operator's, because a tenant that locked itself out
 * of every configured provider would be an outage nobody could explain from
 * inside the product.
 *
 * An empty list is meaningful and is allowed: it means "wherever this tenant's
 * own data lives", which is the default every tenant starts on and the one an
 * operator returns it to by clearing the list.
 */
export const aiRegionsSchema = z.object({
  regions: z.array(z.string().regex(/^[a-z][a-z0-9-]{1,30}$/)).max(10),
});

export async function setAiRegions(tenantId: string, input: z.input<typeof aiRegionsSchema>) {
  const parsed = aiRegionsSchema.parse(input);
  // De-duplicated and ordered, so two lists with the same members are the same
  // list — an audit diff that reports a change because somebody reordered a
  // dropdown is noise that hides the changes that matter.
  const regions = [...new Set(parsed.regions)].sort();

  const tenant = await platformDb().tenant.findFirst({ where: { id: tenantId, deletedAt: null } });
  if (!tenant) throw new NotFoundError('tenant', tenantId);

  const updated = await platformDb().tenant.update({
    where: { id: tenantId },
    data: { aiAllowedRegions: regions },
  });

  const ctx = systemContext(tenantId, { region: tenant.region });
  await withContext(ctx, async () => {
    await transaction(ctx, (tx) =>
      recordAudit(tx, ctx, {
        action: 'tenant.ai_regions.changed',
        targetType: 'tenant',
        targetId: tenantId,
        before: { regions: tenant.aiAllowedRegions },
        after: { regions },
      }),
    );
  });

  return { id: updated.id, aiAllowedRegions: updated.aiAllowedRegions };
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

/**
 * Deletes a tenant and everything belonging to it.
 *
 * Deleting the directory row alone is not deletion: every tenant-scoped table
 * still holds that tenant's rows, invisible only because no context names them
 * any more. That is wrong twice over — a customer who asks to be removed is
 * entitled to actual removal, and an orphaned row can still be *found* by any
 * lookup that searches across tenants. The channel directory is exactly such a
 * lookup: an orphaned mailbox from a deleted tenant went on receiving mail.
 *
 * Two things make this harder than a loop of DELETEs.
 *
 * **It must run inside the tenant's own context.** Row-level security is forced
 * on every tenant-scoped table, so a DELETE with no `app.tenant_id` set matches
 * nothing at all and reports success — the same silent no-op that a data
 * migration hits. Running in context also bounds the damage: this can only ever
 * delete the tenant it was asked to.
 *
 * **Some rows are meant to survive.** The audit trail is append-only by
 * database trigger (ADR-0014), so it refuses to be deleted here and is reported
 * as retained rather than treated as a failure. Whether a purged tenant's audit
 * trail is then removed is a retention decision with a legal dimension, not
 * something a delete helper should make on its own.
 */
export async function purgeTenant(tenantId: string): Promise<{ rows: number; passes: number; retained: string[] }> {
  const ctx = systemContext(tenantId);

  const tables = await platformDb().$queryRaw<{ table_name: string }[]>`
    SELECT c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relname <> 'tenant'
      AND EXISTS (
        SELECT 1 FROM information_schema.columns col
        WHERE col.table_schema = 'public' AND col.table_name = c.relname AND col.column_name = 'tenant_id'
      )
  `;

  let remaining = tables.map((row) => row.table_name);
  let rows = 0;
  let passes = 0;

  // Each table gets its own transaction. In PostgreSQL a failed statement
  // aborts the surrounding transaction, so one foreign-key violation inside a
  // shared transaction makes every statement after it fail too — the purge then
  // looks as though nothing could be deleted, and stops having deleted almost
  // nothing.
  //
  // Passes rather than a hand-maintained order: foreign keys between
  // tenant-scoped tables mean one pass cannot always succeed, and a
  // hand-maintained order is a list that goes stale the next time somebody adds
  // a table.
  while (remaining.length > 0 && passes < 10) {
    passes += 1;
    const failed: string[] = [];
    for (const table of remaining) {
      try {
        rows += await withContext(ctx, () =>
          platformTransaction(ctx, (tx) => tx.$executeRawUnsafe(`DELETE FROM "${table}"`), { timeout: 30_000 }),
        );
      } catch {
        failed.push(table);
      }
    }
    if (failed.length === remaining.length) break;
    remaining = failed;
  }

  // State this tenant left outside the database — a per-tenant search index on
  // another server, for instance. Each hook is tried and its failure recorded
  // rather than thrown: a search index that cannot be reached must not leave
  // the tenant's rows in place, and a purge that half-succeeded and said so is
  // more useful than one that stopped.
  const external: string[] = [];
  for (const { name, hook } of tenantPurgeHooks()) {
    try {
      await hook(tenantId);
    } catch (error) {
      external.push(name);
      logger.warn('a tenant purge hook failed; its state was left behind', {
        tenantId,
        hook: name,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const result = { rows, passes, retained: [...remaining, ...external.map((name) => `external:${name}`)] };

  await platformDb().tenant.deleteMany({ where: { id: tenantId } });
  logger.info('tenant purged', { tenantId, ...result });
  return result;
}
