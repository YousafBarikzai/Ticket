/**
 * Runs migrations as `app_owner` and verifies the result.
 *
 * Deployment runs this before traffic switches (docs/architecture/16 §4). It is
 * deliberately a thin wrapper around `prisma migrate deploy` plus the assertions
 * that matter: that every tenant-scoped table is protected, and that the
 * application role cannot escape its policies.
 *
 * It is also a deployable, bundled to `dist/migrate.js` and shipped in an image
 * built on the same runtime base as the API and the worker — which is why it
 * spawns neither `npx` nor `tsx`.
 *
 * That is not tidiness. The migration image used to be built `FROM build`, so
 * it carried the whole toolchain: pnpm, its bundled `tar`, and esbuild's Go
 * binary. Scanning it turned up two CRITICAL advisories in code nothing here
 * executes — in the one image that runs with `app_owner`, the most privileged
 * credential in the system. The Dockerfile had already made this argument twice,
 * for npm and for pnpm, and stopped one image short.
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { Client } from 'pg';
import 'dotenv/config';

const reset = process.argv.includes('--reset');
const url = process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');

/**
 * The Prisma CLI, run by this Node rather than found on a PATH.
 *
 * `npx` would reach the network on a miss, which is not a thing a migration
 * step should be able to do, and it does not exist in the runtime image at all
 * — npm is deleted from it on purpose.
 */
const prismaCli = createRequire(import.meta.url).resolve('prisma/build/index.js');

function prisma(args: string[]): void {
  execFileSync(process.execPath, [prismaCli, ...args], {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: url },
  });
}

async function verify(): Promise<void> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('SELECT assert_tenant_rls_complete()');
    const { rows } = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity AND c.relforcerowsecurity`,
    );
    console.log(`row-level security forced on ${rows[0]?.count} tables`);
  } finally {
    await client.end();
  }
}

/**
 * Two steps that are a convenience on a developer's machine and wrong in a
 * deployed one.
 *
 * Assembling regenerates `prisma/schema.prisma` from the module fragments,
 * which is what somebody who has just edited a fragment wants. In an image it
 * is redundant and worse than redundant: the build stage already ran
 * `assemble-schema --check`, which *asserts* the committed schema matches and
 * fails the build if it does not, so the file in the image is verified before
 * it gets there. Re-deriving it at deploy time would replace a verified file
 * with an unverified one, and needs `tsx` to do it.
 *
 * `generate` writes the Prisma client. The image's client was generated against
 * the packages actually installed in it; regenerating needs a writable
 * `node_modules` and could only produce the same thing.
 */
const deployed = process.env.NODE_ENV === 'production';

if (!deployed) {
  execFileSync(process.execPath, [createRequire(import.meta.url).resolve('tsx/cli'), 'infra/scripts/assemble-schema.ts'], {
    stdio: 'inherit',
  });
}
if (reset) prisma(['migrate', 'reset', '--force', '--skip-generate', '--skip-seed', '--schema', 'prisma/schema.prisma']);
prisma(['migrate', 'deploy', '--schema', 'prisma/schema.prisma']);
if (!deployed) prisma(['generate', '--schema', 'prisma/schema.prisma']);
await verify();
