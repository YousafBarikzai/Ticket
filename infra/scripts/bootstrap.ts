import 'dotenv/config';
import {
  SYSTEM_PERMISSIONS,
  createContext,
  disconnectDb,
  disconnectRedis,
  logger,
  withContext,
  type TenantContext,
} from '@itsm/platform';
import { bootstrapModules } from '@itsm/runtime';
import { tenantService } from '@itsm/module-tenancy';
import { userService } from '@itsm/module-identity';

/**
 * The first tenant and the first administrator, on a deployed environment.
 *
 * A migrated database is 185 empty tables. Nothing in the product is reachable
 * without a tenant, and the first person through the door is worse than that:
 * sign-in provisions them just in time (`user-service.ts:140`) with no role at
 * all, so they arrive authenticated, permissionless and looking at a service
 * desk that refuses them. Both are one-time facts about an environment, which
 * makes them deployment's job rather than a thing somebody remembers to do.
 *
 * This is not the seed, and the difference is the whole reason it is a separate
 * file. `seed.ts` makes two tenants with deliberately identical data so the
 * isolation suite has something to prove, and it *deletes* a tenant that is
 * already there so that running it twice is the same as running it once. Both
 * are right for a preview environment and catastrophic in a real one. This
 * writes only what is missing and removes nothing, ever.
 *
 * It also does not run as `app_owner`. The migration image carries it, but it
 * connects with the application role like every other deployable, so the rows
 * it writes are subject to the same row-level security as the rows the product
 * writes. A bootstrap that quietly ran as the migration role would be the one
 * write path in the system that RLS never saw.
 *
 * Unset `BOOTSTRAP_TENANT_SLUG` and it does nothing and says so. That is the
 * default, because a deploy that invents a tenant nobody asked for is a deploy
 * that has made a decision on the operator's behalf.
 */

export interface BootstrapRequest {
  readonly slug: string;
  readonly name: string;
  readonly region: string;
  readonly adminEmail: string;
  readonly adminName: string;
}

/**
 * What the environment is asking for, or nothing.
 *
 * Returning `null` rather than throwing on an unset slug is the difference
 * between "not configured" and "configured wrongly", and the two deserve
 * different exit codes. A missing admin address once the slug is set is the
 * second of those: a tenant whose only account is the next person to guess the
 * URL is not a useful thing to have created.
 */
export function requestFrom(env: NodeJS.ProcessEnv): BootstrapRequest | null {
  const slug = env.BOOTSTRAP_TENANT_SLUG?.trim();
  if (!slug) return null;

  const adminEmail = env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  if (!adminEmail) {
    throw new Error('BOOTSTRAP_TENANT_SLUG is set but BOOTSTRAP_ADMIN_EMAIL is not; the tenant would have no administrator');
  }
  if (!adminEmail.includes('@')) throw new Error('BOOTSTRAP_ADMIN_EMAIL is not an email address');

  return {
    slug,
    name: env.BOOTSTRAP_TENANT_NAME?.trim() || slug,
    region: env.BOOTSTRAP_TENANT_REGION?.trim() || 'eu-west',
    adminEmail,
    adminName: env.BOOTSTRAP_ADMIN_NAME?.trim() || adminEmail,
  };
}

export interface BootstrapResult {
  readonly tenantId: string;
  readonly tenantCreated: boolean;
  readonly adminCreated: boolean;
}

export async function bootstrap(request: BootstrapRequest): Promise<BootstrapResult> {
  const existing = await tenantService.findTenantBySlug(request.slug);
  const tenantId = existing
    ? existing.id
    : (await tenantService.provisionTenant({ name: request.name, slug: request.slug, region: request.region })).tenantId;

  if (existing) logger.info('tenant already exists; leaving it alone', { slug: request.slug });
  else logger.info('tenant provisioned', { slug: request.slug, tenantId });

  const ctx: TenantContext = createContext({
    tenantId,
    actor: { type: 'system', id: null, displayName: 'bootstrap' },
    permissions: SYSTEM_PERMISSIONS,
  });

  return withContext(ctx, async () => {
    // Scoped permissions and settings both read the organisations off the
    // context, so the root organisation has to exist before the administrator
    // is created against it rather than after.
    const organisations = await tenantService.listOrganisations(ctx);
    const root =
      organisations.find((organisation) => organisation.code === request.slug.toUpperCase()) ??
      (await tenantService.createOrganisation(ctx, { name: request.name, code: request.slug.toUpperCase(), type: 'group' }));

    const orgCtx: TenantContext = { ...ctx, organisationIds: [root.id], organisationPaths: [root.path] };

    // Found by address, not created blindly: running this twice must not fail,
    // and an operator who has already made this account by hand must not end up
    // with two people who are the same person.
    const found = await userService.listUsers(orgCtx, { search: request.adminEmail, limit: 5 });
    const already = found.find((user) => user.email === request.adminEmail);

    const admin =
      already ??
      (await userService.createUser(
        orgCtx,
        { email: request.adminEmail, displayName: request.adminName, primaryOrgId: root.id },
        'admin',
      ));

    // Deliberately no `idpSubject`. The account is left unlinked so that the
    // first sign-in through the identity provider *links* it by address
    // (`user-service.ts:125`) rather than provisioning a second, roleless one
    // beside it. That branch is the whole mechanism by which this works.
    await userService.assignRole(orgCtx, { userId: admin.id, roleKey: 'administrator' });

    if (already) logger.info('administrator already exists; role confirmed', { email: request.adminEmail });
    else logger.info('administrator created', { email: request.adminEmail, userId: admin.id });

    return { tenantId, tenantCreated: !existing, adminCreated: !already };
  });
}

async function main(): Promise<void> {
  const request = requestFrom(process.env);
  if (!request) {
    console.log('BOOTSTRAP_TENANT_SLUG is not set; nothing to bootstrap.');
    return;
  }

  bootstrapModules();
  try {
    const result = await bootstrap(request);
    console.log(
      `tenant ${request.slug} (${result.tenantId}): ${result.tenantCreated ? 'created' : 'already present'}; ` +
        `administrator ${request.adminEmail}: ${result.adminCreated ? 'created' : 'already present'}`,
    );
  } finally {
    await disconnectDb();
    await disconnectRedis();
  }
}

// Matches both extensions: bundled, this file is `dist/bootstrap.js`, and a
// guard naming only the `.ts` would be false there — a deployable that prints
// nothing, writes nothing and exits 0. `dist/seed.js` shipped exactly that bug
// once, which is why `bundle.ts` now refuses it.
if (/bootstrap\.(ts|js)$/.test(process.argv[1] ?? '')) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
