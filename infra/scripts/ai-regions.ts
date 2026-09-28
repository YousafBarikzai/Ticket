import 'dotenv/config';

// Output is read by a person at a console. Structured logs would bury it.
process.env.LOG_SILENT ??= '1';
import { disconnectDb, disconnectRedis, platformDb } from '@itsm/platform';
import { tenantService } from '@itsm/module-tenancy';

/**
 * Where a tenant's AI calls may be processed, from a deployed console.
 *
 * The same `setAiRegions` the platform API's `PUT /tenants/:id/ai-regions`
 * calls, so the change is validated and audited (`tenant.ai_regions.changed`)
 * exactly as it would be there. It exists because that door needs a platform
 * operator's token, and the running images have no `pnpm` to run the platform
 * CLI with: this is bundled to `dist/ai-regions.js` and runs from the Railway
 * console of any service that carries `DATABASE_URL_PLATFORM`.
 *
 *   node dist/ai-regions.js <tenant-slug>                 show the current list
 *   node dist/ai-regions.js <tenant-slug> eu-west us      replace it
 *   node dist/ai-regions.js <tenant-slug> --clear         back to the home region
 *
 * The list replaces what is there; it never merges. A residency change should
 * say in full what it allows, so the command line is the whole policy.
 */

export type RegionsCommand =
  | { readonly kind: 'show'; readonly slug: string }
  | { readonly kind: 'set'; readonly slug: string; readonly regions: readonly string[] };

export const USAGE =
  'usage: node dist/ai-regions.js <tenant-slug> [region ...] | <tenant-slug> --clear';

/** What the arguments ask for, or an error naming what is wrong. */
export function commandFrom(args: readonly string[]): RegionsCommand {
  const [slug, ...rest] = args;
  if (!slug || slug.startsWith('-')) throw new Error(USAGE);
  if (rest.length === 0) return { kind: 'show', slug };
  if (rest.length === 1 && rest[0] === '--clear') return { kind: 'set', slug, regions: [] };
  if (rest.some((region) => region.startsWith('-'))) throw new Error(USAGE);
  return { kind: 'set', slug, regions: rest.map((region) => region.trim().toLowerCase()) };
}

/** One line a person can read: what is allowed, and what that means in practice. */
export function describe(tenant: { slug: string; region: string; aiAllowedRegions: readonly string[] }): string {
  const effective = tenant.aiAllowedRegions.length > 0 ? tenant.aiAllowedRegions : [tenant.region];
  const listed = tenant.aiAllowedRegions.length > 0 ? tenant.aiAllowedRegions.join(', ') : '(none set)';
  return `${tenant.slug}: home region ${tenant.region}; allowed AI regions ${listed}; AI may process in ${effective.join(', ')}`;
}

export async function run(command: RegionsCommand): Promise<string> {
  const tenant = await tenantService.findTenantBySlug(command.slug);
  if (!tenant) throw new Error(`no tenant with the slug "${command.slug}"`);
  if (command.kind === 'show') return describe(tenant);

  const before = describe(tenant);
  const updated = await tenantService.setAiRegions(tenant.id, { regions: [...command.regions] });
  return `before: ${before}\nafter:  ${describe({ ...tenant, aiAllowedRegions: updated.aiAllowedRegions })}`;
}

async function main(): Promise<void> {
  const command = commandFrom(process.argv.slice(2));
  try {
    console.log(await run(command));
  } finally {
    await platformDb().$disconnect().catch(() => undefined);
    await disconnectDb();
    await disconnectRedis();
  }
}

// Matches both extensions: bundled, this is `dist/ai-regions.js` (see `bundle.ts`).
if (/ai-regions\.(ts|js)$/.test(process.argv[1] ?? '')) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
