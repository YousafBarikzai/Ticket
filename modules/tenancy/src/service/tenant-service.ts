import { z } from 'zod';
import {
  type TenantContext,
  type Tx,
  ConflictError,
  NotFoundError,
  ValidationError,
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
  /**
   * A real customer, or the shared demo (D25). Written once, here: the
   * database refuses any later change, because flipping a kind either
   * silences a real tenant's e-mail or opens the demo's egress.
   */
  kind: z.enum(['standard', 'demo']).default('standard'),
});
/** What a caller passes: fields with a default (`region`, `kind`) may be left out. */
export type ProvisionTenantInput = z.input<typeof provisionTenantSchema>;

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

/**
 * The slug of a demo generation while it is being built: `demo-build-g<n>`,
 * optionally with six hex digits. The purge guard recognises exactly this
 * shape (and `demo-retired-g<n>`), so a seeding tenant with any other slug
 * could never be cleaned up after a failed build.
 */
export const DEMO_BUILD_SLUG_PATTERN = /^demo-build-g\d+(-[0-9a-f]{6})?$/;

/**
 * What a demo build records on its tenant at insert (`settings.demo`). Written
 * with the row rather than after it, so a build that dies between the two
 * still leaves a tenant the purge guard recognises as managed: an unmanaged
 * `seeding` tenant is one the guard refuses to touch, and it would stay for
 * ever.
 */
export const demoBuildSettingsSchema = z.object({
  generation: z.number().int().min(1),
  seed: z.number().int(),
  /** T0, the instant the generation's story is told from. */
  anchor: z.date(),
  scale: z.number().min(0.1).max(1),
  generatorVersion: z.string().min(1).max(100),
});
export type DemoBuildSettings = z.infer<typeof demoBuildSettingsSchema>;

export interface ProvisionTenantOptions {
  /**
   * `active` (the default) is today's behaviour: inserted as `provisioning`,
   * seeded, then made `active`. `seeding` is for a demo build only: the row is
   * inserted as `seeding` and left there, because the swap is the one write
   * that may make a demo generation `active`. Inserting it as `provisioning`
   * instead would let the outbox publisher, which scans `active` and
   * `provisioning` tenants, dispatch the seed steps' events for a few seconds
   * (A4 §2.3, §2.4 Q1).
   */
  status?: 'active' | 'seeding';
  /**
   * The tenant's id, chosen by the caller, so the build can mark it quiet
   * (`beginQuiet`) before its first row exists.
   */
  id?: string;
  /** Required with `seeding`: the generation this tenant is being built as. */
  demo?: DemoBuildSettings;
}

function checkProvisionOptions(parsed: z.infer<typeof provisionTenantSchema>, options: ProvisionTenantOptions): void {
  if (options.id !== undefined && !z.string().uuid().safeParse(options.id).success) {
    throw new ValidationError('a chosen tenant id must be a UUID');
  }
  const seeding = options.status === 'seeding';
  if (!seeding && options.demo) {
    throw new ValidationError('demo build settings are written only on a tenant provisioned as seeding');
  }
  if (!seeding) return;
  // Each refusal here is a tenant that, once inserted, no swap could activate
  // and no purge could remove.
  if (parsed.kind !== 'demo') throw new ValidationError('only a demo tenant is provisioned as seeding');
  if (!DEMO_BUILD_SLUG_PATTERN.test(parsed.slug)) {
    throw new ValidationError('a seeding demo tenant needs a demo-build-g<n> slug, which the purge guard recognises');
  }
  if (!options.demo) throw new ValidationError('a seeding demo tenant needs its build settings (settings.demo)');
  const settings = demoBuildSettingsSchema.safeParse(options.demo);
  if (!settings.success) {
    throw new ValidationError(`the demo build settings are invalid: ${settings.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`).join('; ')}`);
  }
}

export async function provisionTenant(
  input: ProvisionTenantInput,
  options: ProvisionTenantOptions = {},
): Promise<{ tenantId: string; steps: ProvisionStep[] }> {
  const parsed = provisionTenantSchema.parse(input);
  checkProvisionOptions(parsed, options);
  const seeding = options.status === 'seeding';
  const db = platformDb();

  const existing = await db.tenant.findFirst({ where: { slug: parsed.slug } });
  if (existing) throw new ConflictError(`a tenant with the slug ${parsed.slug} already exists`);

  const tenantId = options.id ?? newId();
  if (options.id && (await db.tenant.findFirst({ where: { id: tenantId }, select: { id: true } }))) {
    throw new ConflictError(`a tenant with the id ${tenantId} already exists`);
  }
  const demo = options.demo
    ? {
        managed: true,
        generation: options.demo.generation,
        seed: options.demo.seed,
        anchor: options.demo.anchor.toISOString(),
        scale: options.demo.scale,
        generatorVersion: options.demo.generatorVersion,
      }
    : null;
  await db.tenant.create({
    data: {
      id: tenantId,
      name: parsed.name,
      slug: parsed.slug,
      region: parsed.region,
      kind: parsed.kind,
      status: seeding ? 'seeding' : 'provisioning',
      parentTenantId: parsed.parentTenantId ?? null,
      ...(demo ? { settings: { demo } } : {}),
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
    // A seeding tenant stays seeding: the demo swap activates it, or the purge
    // removes it, and nothing else may.
    if (!seeding) await db.tenant.update({ where: { id: tenantId }, data: { status: 'active' } });

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

  logger.info('tenant provisioned', { tenantId, slug: parsed.slug, steps: steps.length, status: seeding ? 'seeding' : 'active' });
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
