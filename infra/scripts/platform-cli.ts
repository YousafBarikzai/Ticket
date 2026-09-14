import 'dotenv/config';
import {
  SYSTEM_PERMISSIONS,
  createContext,
  disconnectDb,
  disconnectRedis,
  logger,
  modules,
  platformDb,
  withContext,
} from '@itsm/platform';
import { bootstrapModules } from '@itsm/runtime';
import { tenantService } from '@itsm/module-tenancy';
import { auditService } from '@itsm/module-security';
import { signDevelopmentToken } from '../../apps/api/src/auth/verify.js';

/**
 * The platform console as a command-line tool (MOD-21-E1).
 *
 * Tenant provisioning, health and the development sign-in helper. It is the
 * same service layer the platform API uses, so anything possible here is
 * possible through the API and is audited the same way.
 */

const [, , command, ...args] = process.argv;

function usage(): void {
  console.log(`
Platform console

  pnpm platform tenants                     List tenants
  pnpm platform provision <name> <slug>     Provision a tenant and seed its defaults
  pnpm platform suspend <slug> [reason]     Suspend a tenant
  pnpm platform resume <slug>               Resume a suspended tenant
  pnpm platform token <slug> <email>        Mint a development access token
  pnpm platform verify-audit <slug>         Verify a tenant's audit hash chain
  pnpm platform modules                     List registered modules
`);
}

async function tenantBySlugOrFail(slug: string) {
  const tenant = await tenantService.findTenantBySlug(slug);
  if (!tenant) {
    console.error(`no tenant with the slug "${slug}"`);
    process.exit(1);
  }
  return tenant;
}

try {
  bootstrapModules();

  switch (command) {
    case 'tenants': {
      const tenants = await tenantService.listTenants();
      if (tenants.length === 0) {
        console.log('no tenants yet; run `pnpm seed` or `pnpm platform provision`');
        break;
      }
      console.log('\nslug'.padEnd(14) + 'status'.padEnd(14) + 'region'.padEnd(10) + 'id');
      for (const tenant of tenants) {
        console.log(tenant.slug.padEnd(13) + ' ' + tenant.status.padEnd(13) + ' ' + tenant.region.padEnd(9) + ' ' + tenant.id);
      }
      console.log('');
      break;
    }

    case 'provision': {
      const [name, slug] = args;
      if (!name || !slug) {
        console.error('usage: pnpm platform provision <name> <slug>');
        process.exit(1);
      }
      const result = await tenantService.provisionTenant({ name, slug, region: 'eu-west' });
      console.log(`provisioned ${slug} (${result.tenantId})`);
      for (const step of result.steps) console.log(`  ${step.status === 'done' ? '✓' : '✗'} ${step.key}`);
      break;
    }

    case 'suspend': {
      const [slug, ...reason] = args;
      if (!slug) {
        console.error('usage: pnpm platform suspend <slug> [reason]');
        process.exit(1);
      }
      const tenant = await tenantBySlugOrFail(slug);
      await tenantService.suspendTenant(tenant.id, reason.join(' ') || undefined);
      console.log(`suspended ${slug}`);
      break;
    }

    case 'resume': {
      const [slug] = args;
      if (!slug) {
        console.error('usage: pnpm platform resume <slug>');
        process.exit(1);
      }
      const tenant = await tenantBySlugOrFail(slug);
      await tenantService.resumeTenant(tenant.id);
      console.log(`resumed ${slug}`);
      break;
    }

    case 'token': {
      const [slug, email] = args;
      if (!slug || !email) {
        console.error('usage: pnpm platform token <slug> <email>');
        process.exit(1);
      }
      if (process.env.OIDC_ISSUER) {
        // A deployed environment must not be able to mint its own tokens.
        console.error('OIDC_ISSUER is set: tokens come from the identity provider, not from this tool');
        process.exit(1);
      }
      const tenant = await tenantBySlugOrFail(slug);
      const ctx = createContext({ tenantId: tenant.id, actor: { type: 'system', id: null }, permissions: SYSTEM_PERMISSIONS });
      const user = await withContext(ctx, async () => {
        const { db } = await import('@itsm/platform');
        return db().user.findFirst({ where: { email: email.toLowerCase(), deletedAt: null } });
      });
      if (!user) {
        console.error(`no user ${email} in tenant ${slug}`);
        process.exit(1);
      }
      const token = signDevelopmentToken({
        sub: user.idpSubject ?? user.id,
        itsm_user_id: user.id,
        tenant_id: tenant.id,
        email: user.email,
        name: user.displayName,
        sid: `dev-${user.id}`,
      });
      console.log(token);
      break;
    }

    case 'verify-audit': {
      const [slug] = args;
      if (!slug) {
        console.error('usage: pnpm platform verify-audit <slug>');
        process.exit(1);
      }
      const tenant = await tenantBySlugOrFail(slug);
      const ctx = createContext({ tenantId: tenant.id, actor: { type: 'system', id: null }, permissions: SYSTEM_PERMISSIONS });
      const result = await withContext(ctx, () => auditService.verifyTenantChain(ctx));
      console.log(result.valid ? `audit chain intact (${result.checked} events)` : `AUDIT CHAIN BROKEN after ${result.checked} events`);
      if (!result.valid) process.exitCode = 1;
      break;
    }

    case 'modules': {
      console.log('\nid'.padEnd(10) + 'phase'.padEnd(8) + 'version'.padEnd(10) + 'name');
      for (const module of modules()) {
        console.log(module.id.padEnd(9) + ' ' + module.phase.padEnd(7) + ' ' + module.version.padEnd(9) + ' ' + module.name);
      }
      console.log('');
      break;
    }

    default:
      usage();
      if (command) process.exitCode = 1;
  }
} catch (error) {
  logger.error('platform command failed', { command, error: (error as Error).message });
  console.error((error as Error).message);
  process.exitCode = 1;
} finally {
  await platformDb().$disconnect().catch(() => undefined);
  await disconnectDb();
  await disconnectRedis();
}
