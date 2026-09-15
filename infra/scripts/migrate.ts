/**
 * Runs migrations as `app_owner` and verifies the result.
 *
 * Deployment runs this before traffic switches (docs/architecture/16 §4). It is
 * deliberately a thin wrapper around `prisma migrate deploy` plus the assertions
 * that matter: that every tenant-scoped table is protected, and that the
 * application role cannot escape its policies.
 */
import { execFileSync } from 'node:child_process';
import { Client } from 'pg';
import 'dotenv/config';

const reset = process.argv.includes('--reset');
const url = process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');

function prisma(args: string[]): void {
  execFileSync('npx', ['prisma', ...args], {
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

execFileSync('npx', ['tsx', 'infra/scripts/assemble-schema.ts'], { stdio: 'inherit' });
if (reset) prisma(['migrate', 'reset', '--force', '--skip-generate', '--skip-seed', '--schema', 'prisma/schema.prisma']);
prisma(['migrate', 'deploy', '--schema', 'prisma/schema.prisma']);
prisma(['generate', '--schema', 'prisma/schema.prisma']);
await verify();
