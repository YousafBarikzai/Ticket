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

  await waitForSearchEngine();

  execFileSync('npx', ['tsx', 'infra/scripts/assemble-schema.ts'], { stdio: 'pipe' });
  execFileSync('npx', ['prisma', 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'], {
    stdio: 'pipe',
    env: { ...process.env, DATABASE_URL: url },
  });
}

/**
 * Waits for Meilisearch, when the run has one.
 *
 * The container image carries neither curl nor wget, so a Docker health check
 * would fail for the wrong reason and the suite would look broken. Polling from
 * here also keeps the suites honest about the unconfigured case: with no
 * MEILISEARCH_URL the search tests exercise the PostgreSQL projection, which is
 * a supported way to run the platform and therefore worth running green.
 */
async function waitForSearchEngine(): Promise<void> {
  const url = process.env.MEILISEARCH_URL;
  if (!url) return;

  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      const response = await fetch(`${url.replace(/\/+$/, '')}/health`);
      if (response.ok) return;
    } catch {
      // Not up yet.
    }
    if (Date.now() > deadline) {
      throw new Error(`MEILISEARCH_URL is set to ${url} but nothing answered /health within 60s`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
