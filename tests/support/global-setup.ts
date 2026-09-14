import { execFileSync } from 'node:child_process';
import 'dotenv/config';

/**
 * Prepares the test database once for the whole integration run.
 *
 * The suites below need a real PostgreSQL, because the guarantees they check —
 * row-level security, transactional audit, optimistic locking, the outbox —
 * live in the database. A mocked data layer would prove nothing about any of
 * them (docs/architecture/18 §3).
 */
export default async function setup(): Promise<void> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is not set');

  process.env.DATABASE_URL = url;
  process.env.DATABASE_URL_APP = process.env.TEST_DATABASE_URL_APP ?? url;
  process.env.DATABASE_URL_PLATFORM = process.env.TEST_DATABASE_URL_PLATFORM ?? url;
  process.env.NODE_ENV = 'test';
  process.env.LOG_SILENT = '1';

  execFileSync('npx', ['tsx', 'infra/scripts/assemble-schema.ts'], { stdio: 'pipe' });
  execFileSync('npx', ['prisma', 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'], {
    stdio: 'pipe',
    env: { ...process.env, DATABASE_URL: url },
  });
}
