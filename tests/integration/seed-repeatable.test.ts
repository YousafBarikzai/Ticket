import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { transaction, withContext } from '@itsm/platform';
import { tenantService } from '@itsm/module-tenancy';
import { ticketService } from '@itsm/module-ticket';
import { closeHarness, contextFor, drainEvents } from '../support/harness.js';

/**
 * `pnpm seed` can be run twice (A4 §5.6, demo-data F6).
 *
 * The seed is repeatable by design: it removes a tenant it finds under its own
 * slug and builds it again. It used to remove only the directory row, which
 * left every tenant-scoped row of the old tenant behind — invisible, because
 * no context names that id any more, and findable by anything that looks
 * across tenants. Each re-seed added another set. This runs the real script,
 * twice, against the test database, and then looks for the old tenant's rows
 * the only way they can still be seen: in a context that names its id, which
 * row-level security admits whether or not the tenant row exists.
 */

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL('../..', import.meta.url));
const SLUGS = ['acme', 'beta'] as const;

/** What the script logs when it purges a tenant it is about to seed again. */
interface PurgeLine {
  message: string;
  slug?: string;
  rows?: number;
  retained?: string[];
}

/** Runs `tsx infra/scripts/seed.ts` against the test database and returns its log lines. */
async function runSeed(): Promise<PurgeLine[]> {
  const owner = process.env.TEST_DATABASE_URL ?? '';
  const { stdout } = await execFileAsync('npx', ['tsx', 'infra/scripts/seed.ts'], {
    cwd: root,
    env: {
      ...process.env,
      DATABASE_URL: owner,
      DATABASE_URL_APP: process.env.TEST_DATABASE_URL_APP ?? owner,
      DATABASE_URL_PLATFORM: process.env.TEST_DATABASE_URL_PLATFORM ?? owner,
      NODE_ENV: 'test',
      // The purge reports what it kept in its log line, so this run is heard.
      LOG_SILENT: '0',
      LOG_LEVEL: 'info',
    },
    maxBuffer: 32 * 1024 * 1024,
    timeout: 240_000,
  });
  return stdout
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map((line) => {
      try {
        return JSON.parse(line) as PurgeLine;
      } catch {
        return { message: '' };
      }
    });
}

async function tenantIdOf(slug: string): Promise<string> {
  const tenant = await tenantService.findTenantBySlug(slug);
  expect(tenant, `the seed should have created ${slug}`).toBeTruthy();
  return tenant!.id;
}

/** Rows the old tenant still holds, read in a context naming its id. */
async function leftovers(tenantId: string) {
  const ctx = contextFor(tenantId);
  return withContext(ctx, () =>
    transaction(ctx, async (tx) => ({
      ticket: await tx.ticket.count(),
      user: await tx.user.count(),
      ticket_comment: await tx.ticketComment.count(),
      outbox_event: await tx.outboxEvent.count(),
      fact_ticket: await tx.factTicket.count(),
      audit_event: await tx.auditEvent.count(),
    })),
  );
}

let firstAcme: string;
let secondRun: PurgeLine[];

beforeAll(async () => {
  await runSeed();
  firstAcme = await tenantIdOf('acme');

  // Give the first generation a row in each table the purge must empty. The
  // seed raises tickets but writes no comment and runs no projector, so a
  // zero after the second run would otherwise prove nothing for those two.
  const ctx = contextFor(firstAcme);
  await withContext(ctx, async () => {
    const ticket = await transaction(ctx, (tx) => tx.ticket.findFirst({ select: { id: true } }));
    await ticketService.importComments(ctx, ticket!.id, [{ body: 'A comment the purge must remove.' }]);
  });
  await drainEvents(firstAcme);

  const before = await leftovers(firstAcme);
  for (const [table, count] of Object.entries(before)) {
    expect(count, `the first seed should have written ${table} rows`).toBeGreaterThan(0);
  }

  secondRun = await runSeed();
}, 600_000);

afterAll(async () => {
  // The seed's tenants are not the suite's: purge them so nothing that looks
  // across tenants later in the run finds them.
  for (const slug of SLUGS) {
    const tenant = await tenantService.findTenantBySlug(slug);
    if (tenant) await tenantService.purgeTenant(tenant.id);
  }
  await closeHarness();
}, 120_000);

describe('a second pnpm seed', () => {
  it('builds acme again under a new id', async () => {
    const secondAcme = await tenantIdOf('acme');
    expect(secondAcme).not.toBe(firstAcme);
    expect(await tenantService.findTenantBySlug('beta')).toBeTruthy();
  });

  it('leaves no orphaned rows of the tenant it replaced', async () => {
    const after = await leftovers(firstAcme);
    expect({
      ticket: after.ticket,
      user: after.user,
      ticket_comment: after.ticket_comment,
      outbox_event: after.outbox_event,
      fact_ticket: after.fact_ticket,
    }).toEqual({ ticket: 0, user: 0, ticket_comment: 0, outbox_event: 0, fact_ticket: 0 });
  });

  it('keeps the audit trail, and says so', async () => {
    // Append-only by trigger (ADR-0014): retained by design, reported rather
    // than treated as a failure, and left for a retention decision to remove.
    expect((await leftovers(firstAcme)).audit_event).toBeGreaterThan(0);
    const purge = secondRun.find((line) => line.slug === 'acme' && /purged/.test(line.message));
    expect(purge, 'the second run should log the purge of acme').toBeTruthy();
    expect(purge!.retained).toContain('audit_event');
    expect(purge!.rows).toBeGreaterThan(0);
  });
});
