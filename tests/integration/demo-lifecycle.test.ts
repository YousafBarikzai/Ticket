import { randomBytes } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ConflictError,
  SYSTEM_PERMISSIONS,
  createContext,
  ensureCounterAtLeast,
  newId,
  nextNumber,
  platformDb,
  platformTransaction,
  registerModule,
  transaction,
  withContext,
} from '@itsm/platform';
import { tenantService } from '@itsm/module-tenancy';
import { outboxPublisher } from '@itsm/module-integrations';
import { settingsService } from '@itsm/module-admin';
// Imported by path, not through the package barrels: WP-35's barrel lines are
// hand-offs the integrator commits (SPEC v3 §15.0 rule 4).
import { QuietTenantError, beginQuiet, endQuiet } from '../../packages/platform/src/quiet.js';
import {
  DemoPurgeRefusedError,
  DemoSwapRefusedError,
  countAttempts,
  findLiveDemoTenant,
  listDemoTenants,
  listGenerations,
  markGeneration,
  newestGeneration,
  openGeneration,
  purgeDemoGeneration,
  swapDemoGeneration,
} from '../../modules/tenancy/src/service/demo-lifecycle.js';
import { closeHarness, contextFor } from '../support/harness.js';

/**
 * The shared demo's lifecycle against the real database (D12, D19; SPEC v3
 * §5.3, A4 §2.4, §3.4–§3.6): the ledger migration, a demo build provisioned
 * `seeding` and quiet, the swap with its row locks, and the purge with its
 * guard. The unit suites prove each refusal as logic; this one proves the
 * SQL — the locks, the unique indexes, the grants and the counter floor — and
 * that nothing here can reach a standard tenant.
 *
 * Self-contained: its own live slug, its own generation numbers above
 * whatever the database already holds, and everything it creates is removed
 * in `afterAll`, ledger rows included.
 */

const RUN = randomBytes(3).toString('hex');
const LIVE_SLUG = `demo-lifecycle-${RUN}`;
const RACE_SLUG = `demo-lifecycle-race-${RUN}`;
const HELD_SLUG = `demo-lifecycle-held-${RUN}`;
const STANDARD_SLUG = `lifecycle-standard-${RUN}`;
const NOW = new Date('2026-10-03T23:00:30.000Z'); // 00:00:30 on 4 October, UK time

const created = new Set<string>();
let base = 0;
let standardId = '';

function buildSlug(generation: number): string {
  return `demo-build-g${generation}-${randomBytes(3).toString('hex')}`;
}

/** A demo build as the orchestrator makes one: quiet, ledgered, provisioned `seeding`. */
async function build(generation: number, reason: 'initial' | 'scheduled' | 'manual' = 'scheduled') {
  const id = newId();
  created.add(id);
  const ledger = await openGeneration({
    demoTenantId: id,
    reason,
    seed: 20261002,
    anchor: NOW,
    scale: 0.2,
    generatorVersion: 'wp35-test',
    generation,
    now: NOW,
  });
  beginQuiet(id);
  try {
    await tenantService.provisionTenant(
      { name: 'Northwind Traders (UK)', slug: buildSlug(generation), kind: 'demo' },
      { status: 'seeding', id, demo: { generation, seed: 20261002, anchor: NOW, scale: 0.2, generatorVersion: 'wp35-test' } },
    );
  } finally {
    endQuiet(id);
  }
  return { id, ledgerId: ledger.id };
}

async function tenantRow(id: string) {
  return platformDb().tenant.findUnique({ where: { id }, select: { id: true, slug: true, status: true, kind: true, settings: true } });
}

async function unpublished(tenantId: string): Promise<number> {
  const ctx = contextFor(tenantId);
  return withContext(ctx, () =>
    platformTransaction(ctx, async (tx) => {
      const [row] = await tx.$queryRaw<{ count: bigint }[]>`
        SELECT count(*) AS count FROM outbox_event WHERE tenant_id = ${tenantId}::uuid AND published_at IS NULL`;
      return Number(row!.count);
    }),
  );
}

beforeAll(async () => {
  base = await newestGeneration();
  standardId = (await tenantService.provisionTenant({ name: 'Lifecycle standard', slug: STANDARD_SLUG })).tenantId;
  created.add(standardId);
}, 180_000);

afterAll(async () => {
  for (const id of created) {
    if (await platformDb().tenant.findUnique({ where: { id }, select: { id: true } })) await tenantService.purgeTenant(id);
  }
  await platformDb().demoGeneration.deleteMany({ where: { demoTenantId: { in: [...created] } } });
  await closeHarness();
}, 180_000);

/* ------------------------------------------------------------ Migration */

describe('the ledger migration (20261002140000_v3_demo_generation)', () => {
  it('applies after 20261002130000, as the waves land', () => {
    const names = readdirSync(join(import.meta.dirname, '..', '..', 'prisma', 'migrations')).filter((n) => /^\d{14}_/.test(n)).sort();
    expect(names.indexOf('20261002140000_v3_demo_generation')).toBe(names.indexOf('20261002130000_v3_analytics_read_indexes') + 1);
  });

  it('creates the table with every ledger column', async () => {
    const columns = await platformDb().$queryRaw<{ column_name: string; data_type: string; is_nullable: string }[]>`
      SELECT column_name, data_type, is_nullable FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'demo_generation' ORDER BY ordinal_position`;
    expect(Object.fromEntries(columns.map((c) => [c.column_name, `${c.data_type}${c.is_nullable === 'NO' ? ' not null' : ''}`]))).toEqual({
      id: 'uuid not null',
      generation: 'integer not null',
      demo_tenant_id: 'uuid not null',
      status: 'text not null',
      reason: 'text not null',
      attempt: 'integer not null',
      seed: 'integer not null',
      anchor: 'timestamp with time zone not null',
      scale: 'numeric not null',
      generator_version: 'text not null',
      plan_hash: 'text',
      started_at: 'timestamp with time zone not null',
      finished_at: 'timestamp with time zone',
      swapped_at: 'timestamp with time zone',
      retired_at: 'timestamp with time zone',
      purged_at: 'timestamp with time zone',
      build_ms: 'integer',
      step_ms: 'jsonb not null',
      checks: 'jsonb not null',
      failure: 'jsonb',
      audit_retained: 'integer',
    });
  });

  it('has no tenant_id, so row-level security leaves it alone', async () => {
    const [table] = await platformDb().$queryRaw<{ forced: boolean }[]>`
      SELECT relforcerowsecurity AS forced FROM pg_class WHERE oid = 'public.demo_generation'::regclass`;
    expect(table!.forced).toBe(false);
  });

  it.each([
    ['an unknown status', { status: 'paused' }],
    ['an unknown reason', { reason: 'whim' }],
    ['attempt 0', { attempt: 0 }],
    ['generation 0', { generation: 0 }],
  ])('refuses %s', async (_label, change) => {
    const row = { status: 'failed', reason: 'manual', attempt: 1, generation: 1, ...change };
    await expect(
      platformDb().$executeRaw`
        INSERT INTO demo_generation (id, generation, demo_tenant_id, status, reason, attempt, seed, anchor, scale, generator_version)
        VALUES (${newId()}::uuid, ${row.generation}, ${newId()}::uuid, ${row.status}, ${row.reason}, ${row.attempt}, 1, now(), 0.2, 't')`,
    ).rejects.toThrow(/check constraint/);
  });

  it('keeps generation numbers unique among the generations that went live, but not among failures', async () => {
    const generation = base + 90;
    const tenant = newId();
    created.add(tenant);
    const insert = (status: string) => platformDb().$executeRaw`
      INSERT INTO demo_generation (id, generation, demo_tenant_id, status, reason, seed, anchor, scale, generator_version)
      VALUES (${newId()}::uuid, ${generation}, ${tenant}::uuid, ${status}, 'manual', 1, now(), 0.2, 't')`;
    await insert('failed');
    await insert('failed');
    await insert('purged');
    // 23505, unique_violation, from the partial index demo_generation_succeeded.
    await expect(insert('live')).rejects.toThrow(/23505|already exists/);
  });

  it('lets the application role read the ledger and not write it', async () => {
    const ctx = contextFor(standardId);
    await expect(withContext(ctx, () => transaction(ctx, (tx) => tx.demoGeneration.count()))).resolves.toBeGreaterThanOrEqual(0);
    await expect(
      withContext(ctx, () =>
        transaction(
          ctx,
          (tx) => tx.$executeRaw`
            INSERT INTO demo_generation (id, generation, demo_tenant_id, status, reason, seed, anchor, scale, generator_version)
            VALUES (gen_random_uuid(), 1, gen_random_uuid(), 'live', 'operator', 1, now(), 1, 'smuggled')`,
        ),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});

/* ------------------------------------------------------ Platform modules */

describe('a platform module (ModuleManifest.audience)', () => {
  it('is never installed for a tenant, listed to it, or switchable by it', async () => {
    registerModule({
      id: 'MOD-T35',
      key: 'demo-test',
      version: '1.0.0',
      phase: 'PH-1',
      name: 'Demo (test)',
      dependsOn: [],
      permissions: [],
      events: { publishes: [], consumes: [] },
      featureFlags: [],
      settings: [],
      jobs: [],
      enabledByDefault: false,
      optional: false,
      audience: 'platform',
    });
    const ctx = contextFor(standardId);
    await withContext(ctx, () => settingsService.syncInstalledModules(ctx));

    const installed = await withContext(ctx, () => settingsService.listInstalledModules(ctx));
    expect(installed.length).toBeGreaterThan(10);
    expect(installed.map((m) => m.moduleId)).not.toContain('MOD-T35');
    const recorded = await withContext(ctx, () =>
      transaction(ctx, (tx) => tx.installedModule.count({ where: { moduleId: 'MOD-T35' } })),
    );
    expect(recorded).toBe(0);
    await expect(withContext(ctx, () => settingsService.setModuleEnabled(ctx, 'MOD-T35', true))).rejects.toThrow(/not found/);
  });
});

/* ------------------------------------------------------- A demo build */

describe('provisioning a demo build', () => {
  let buildId = '';

  beforeAll(async () => {
    buildId = (await build(base + 1, 'initial')).id;
  }, 180_000);

  it('runs every seed step while quiet, so no seed step enqueues anything directly', async () => {
    // `build()` provisioned inside beginQuiet/endQuiet: had any seed step
    // called enqueue(), provisioning would have thrown QuietTenantError.
    const ctx = contextFor(buildId);
    const job = await withContext(ctx, () =>
      platformTransaction(ctx, (tx) => tx.tenantProvisioningJob.findFirst({ select: { status: true, steps: true } })),
    );
    expect(job?.status).toBe('done');
    expect((job?.steps as { status: string }[]).every((step) => step.status === 'done')).toBe(true);
  });

  it('inserts the row as seeding, with the managed demo record, and leaves it seeding', async () => {
    const row = await tenantRow(buildId);
    expect(row).toMatchObject({ id: buildId, kind: 'demo', status: 'seeding' });
    expect(row!.settings).toEqual({
      demo: {
        managed: true,
        generation: base + 1,
        seed: 20261002,
        anchor: NOW.toISOString(),
        scale: 0.2,
        generatorVersion: 'wp35-test',
      },
    });
  });

  it('still writes the tenant.created audit row and event, which stay unpublished', async () => {
    const ctx = contextFor(buildId);
    const audit = await withContext(ctx, () =>
      platformTransaction(ctx, (tx) => tx.auditEvent.count({ where: { action: 'tenant.created' } })),
    );
    expect(audit).toBe(1);
    expect(await unpublished(buildId)).toBeGreaterThan(0);
  });

  it('cannot be published even by a publisher that reached it while quiet', async () => {
    // Q1 keeps the publisher's scan away from `seeding` tenants; Q2 stops it
    // even when called for the tenant by name.
    beginQuiet(buildId);
    try {
      await expect(outboxPublisher.publishBatchForTenant(buildId)).rejects.toBeInstanceOf(QuietTenantError);
    } finally {
      endQuiet(buildId);
    }
    expect(await unpublished(buildId)).toBeGreaterThan(0);
  });

  it('floors its counters with the real statement: raises, never lowers', async () => {
    const ctx = contextFor(buildId);
    const number = await withContext(ctx, () =>
      platformTransaction(ctx, async (tx) => {
        expect(await ensureCounterAtLeast(tx, ctx, 'incident', 4101)).toBe(4101);
        expect(await nextNumber(tx, ctx, 'incident', 'INC')).toBe('INC-004101');
        expect(await ensureCounterAtLeast(tx, ctx, 'incident', 100)).toBe(4102);
        expect(await ensureCounterAtLeast(tx, ctx, 'change', 1151)).toBe(1151);
        return nextNumber(tx, ctx, 'incident', 'INC');
      }),
    );
    expect(number).toBe('INC-004102');
  });

  it('discards its unpublished events before the swap, and refuses a standard tenant’s', async () => {
    const standardBefore = await unpublished(standardId);
    expect(standardBefore).toBeGreaterThan(0);
    await expect(outboxPublisher.discardForSeedingTenant(contextFor(standardId))).rejects.toBeInstanceOf(ConflictError);
    expect(await unpublished(standardId)).toBe(standardBefore);

    const discarded = await outboxPublisher.discardForSeedingTenant(contextFor(buildId));
    expect(discarded).toBeGreaterThan(0);
    expect(await unpublished(buildId)).toBe(0);
  });

  it('refuses a seeding standard tenant, and a seeding demo tenant the purge could not recognise', async () => {
    const settings = { generation: base + 1, seed: 1, anchor: NOW, scale: 0.2, generatorVersion: 't' };
    await expect(
      tenantService.provisionTenant({ name: 'x', slug: `demo-build-g${base + 1}-abcdef`, kind: 'standard' }, { status: 'seeding', demo: settings }),
    ).rejects.toThrow(/only a demo tenant/);
    await expect(
      tenantService.provisionTenant({ name: 'x', slug: `northwind-${RUN}`, kind: 'demo' }, { status: 'seeding', demo: settings }),
    ).rejects.toThrow(/demo-build-g/);
    expect(await tenantService.findTenantBySlug(`northwind-${RUN}`)).toBeNull();
  });
});

/* ------------------------------------------------------------ The ledger */

describe('the ledger', () => {
  it('numbers attempts per key, on the UK day an attempt starts', async () => {
    const dateKey = '2026-10-04';
    const before = await countAttempts({ reason: 'scheduled', dateKey });
    const tenant = newId();
    created.add(tenant);
    const first = await openGeneration({
      demoTenantId: tenant,
      reason: 'catch-up',
      seed: 1,
      anchor: NOW,
      scale: 0.2,
      generatorVersion: 't',
      generation: base + 80,
      now: NOW,
    });
    expect(first.attempt).toBe(before + 1);
    // 23:00:30 UTC on the 3rd is the 4th in London; the scheduled and
    // catch-up builds of one day share their key.
    expect(await countAttempts({ reason: 'scheduled', dateKey })).toBe(before + 1);
    expect(await countAttempts({ reason: 'catch-up', dateKey: '2026-10-03' })).toBe(
      await countAttempts({ reason: 'scheduled', dateKey: '2026-10-03' }),
    );

    await markGeneration(first.id, { status: 'failed', failure: { step: 'history', message: 'boom' } });
    const second = await openGeneration({
      demoTenantId: tenant,
      reason: 'scheduled',
      seed: 1,
      anchor: NOW,
      scale: 0.2,
      generatorVersion: 't',
      generation: base + 80,
      now: NOW,
    });
    expect(second.attempt).toBe(before + 2);
  });

  it('records a failure once, and never over a generation that went live', async () => {
    const tenant = newId();
    created.add(tenant);
    const row = await openGeneration({
      demoTenantId: tenant,
      reason: 'operator',
      seed: 1,
      anchor: NOW,
      scale: 1,
      generatorVersion: 't',
      generation: base + 81,
      now: NOW,
    });
    const failed = await markGeneration(row.id, { status: 'failed', failure: { step: 'checks', message: 'V3 out of band' } });
    expect(failed).toMatchObject({ status: 'failed', failure: { step: 'checks', message: 'V3 out of band' } });
    await expect(markGeneration(row.id, { status: 'failed' })).rejects.toBeInstanceOf(ConflictError);
    expect((await listGenerations({ limit: 50, statuses: ['failed'] })).map((g) => g.id)).toContain(row.id);
  });
});

/* ------------------------------------------------------------- The swap */

describe('the swap and the purge', () => {
  let a: { id: string; ledgerId: string };
  let b: { id: string; ledgerId: string };

  beforeAll(async () => {
    a = await build(base + 2);
    b = await build(base + 3);
  }, 300_000);

  it('makes the first generation live with nothing to retire', async () => {
    await expect(
      swapDemoGeneration({ liveTenantId: null, nextTenantId: a.id, slug: LIVE_SLUG, expectedGeneration: null, reason: 'initial', ledgerId: a.ledgerId, now: NOW }),
    ).resolves.toEqual({ generation: base + 2, previousTenantId: null });

    const row = await tenantRow(a.id);
    expect(row).toMatchObject({ slug: LIVE_SLUG, status: 'active', kind: 'demo' });
    expect((row!.settings as { demo: Record<string, unknown> }).demo).toMatchObject({
      generation: base + 2,
      lastResetAt: NOW.toISOString(),
      lastResetReason: 'initial',
      lastResetKey: '2026-10-04',
    });
    expect((await findLiveDemoTenant(LIVE_SLUG))?.id).toBe(a.id);
    const [ledger] = await listGenerations({ limit: 200 }).then((rows) => rows.filter((r) => r.id === a.ledgerId));
    expect(ledger).toMatchObject({ status: 'live', swappedAt: NOW });
  });

  it('retires the live generation and activates the next in one transaction; readers never see none', async () => {
    const reads: Promise<{ id: string; status: string }[]>[] = [];
    const swap = swapDemoGeneration({
      liveTenantId: a.id,
      nextTenantId: b.id,
      slug: LIVE_SLUG,
      expectedGeneration: base + 2,
      reason: 'scheduled',
      ledgerId: b.ledgerId,
      now: NOW,
    });
    for (let i = 0; i < 40; i += 1) {
      reads.push(platformDb().tenant.findMany({ where: { slug: LIVE_SLUG }, select: { id: true, status: true } }));
    }
    await expect(swap).resolves.toEqual({ generation: base + 3, previousTenantId: a.id });

    for (const seen of await Promise.all(reads)) {
      expect(seen).toHaveLength(1);
      expect(seen[0]!.status).toBe('active');
      expect([a.id, b.id]).toContain(seen[0]!.id);
    }
    expect(await tenantRow(a.id)).toMatchObject({ slug: `demo-retired-g${base + 2}`, status: 'retired' });
    expect(await tenantRow(b.id)).toMatchObject({ slug: LIVE_SLUG, status: 'active' });
    const ledgers = (await listGenerations({ limit: 200 })).filter((r) => r.id === a.ledgerId || r.id === b.ledgerId);
    expect(Object.fromEntries(ledgers.map((r) => [r.id, r.status]))).toEqual({ [a.ledgerId]: 'retired', [b.ledgerId]: 'live' });
  });

  it('lets exactly one of two concurrent swaps against the same live generation win (I8a)', async () => {
    const c = await build(base + 4);
    const d = await build(base + 4);
    const swapFor = (next: { id: string; ledgerId: string }) =>
      swapDemoGeneration({ liveTenantId: b.id, nextTenantId: next.id, slug: LIVE_SLUG, expectedGeneration: base + 3, reason: 'manual', ledgerId: next.ledgerId, now: NOW });

    const results = await Promise.allSettled([swapFor(c), swapFor(d)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const [lost] = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(lost!.reason).toBeInstanceOf(DemoSwapRefusedError);
    expect(lost!.reason).toMatchObject({ refusal: 'superseded', status: 409 });

    const winner = results[0]!.status === 'fulfilled' ? c : d;
    const loser = winner === c ? d : c;
    expect(await tenantRow(winner.id)).toMatchObject({ slug: LIVE_SLUG, status: 'active' });
    expect(await tenantRow(loser.id)).toMatchObject({ status: 'seeding' });
    expect((await listDemoTenants({ statuses: ['active'] })).filter((t) => t.slug === LIVE_SLUG)).toHaveLength(1);

    // The loser is an abandoned build: the purge claims it, deletes it, and
    // closes its open ledger row as a failure.
    const purged = await purgeDemoGeneration(loser.id, winner.id, { liveSlug: LIVE_SLUG, now: NOW });
    expect(purged).toMatchObject({ purged: true, tenantId: loser.id });
    expect(await tenantRow(loser.id)).toBeNull();
    const [row] = (await listGenerations({ limit: 200 })).filter((r) => r.id === loser.ledgerId);
    expect(row).toMatchObject({ status: 'failed', failure: { message: expect.stringContaining('abandoned') } });
    b = winner;
  });

  it('lets exactly one of two first-generation swaps on a fresh slug win, through the unique indexes', async () => {
    const e = await build(base + 5);
    const f = await build(base + 5);
    const first = (next: { id: string; ledgerId: string }) =>
      swapDemoGeneration({ liveTenantId: null, nextTenantId: next.id, slug: RACE_SLUG, expectedGeneration: null, reason: 'initial', ledgerId: next.ledgerId, now: NOW });

    const results = await Promise.allSettled([first(e), first(f)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const [lost] = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(lost!.reason).toMatchObject({ refusal: 'superseded' });
  });

  it('refuses a slug held by a standard tenant, and touches neither tenant', async () => {
    const held = (await tenantService.provisionTenant({ name: 'Held', slug: HELD_SLUG })).tenantId;
    created.add(held);
    const g = await build(base + 6);

    await expect(
      swapDemoGeneration({ liveTenantId: null, nextTenantId: g.id, slug: HELD_SLUG, expectedGeneration: null, reason: 'initial', ledgerId: g.ledgerId, now: NOW }),
    ).rejects.toMatchObject({ refusal: 'slug-held' });
    expect(await tenantRow(held)).toMatchObject({ slug: HELD_SLUG, status: 'active', kind: 'standard' });
    expect(await tenantRow(g.id)).toMatchObject({ status: 'seeding' });
  });

  it('refuses to activate anything but a managed seeding demo build', async () => {
    const swapTo = (nextTenantId: string) =>
      swapDemoGeneration({ liveTenantId: b.id, nextTenantId, slug: LIVE_SLUG, expectedGeneration: base + 4, reason: 'manual', ledgerId: b.ledgerId, now: NOW });
    await expect(swapTo(standardId)).rejects.toMatchObject({ refusal: 'wrong-kind' });

    const unmanaged = newId();
    created.add(unmanaged);
    await platformDb().tenant.create({
      data: { id: unmanaged, name: 'Hand-made', slug: `demo-build-g${base + 7}-${RUN}`, kind: 'demo', status: 'seeding' },
    });
    await expect(swapTo(unmanaged)).rejects.toMatchObject({ refusal: 'unmanaged' });
    expect(await tenantRow(b.id)).toMatchObject({ slug: LIVE_SLUG, status: 'active' });
  });

  it('purges a retired generation and records the audit rows it had to keep (D19)', async () => {
    const ctx = createContext({ tenantId: a.id, actor: { type: 'system', id: null }, permissions: SYSTEM_PERMISSIONS });
    const audit = await withContext(ctx, () => platformTransaction(ctx, (tx) => tx.auditEvent.count()));
    expect(audit).toBeGreaterThan(0);

    const result = await purgeDemoGeneration(a.id, b.id, { liveSlug: LIVE_SLUG, now: NOW });
    expect(result).toMatchObject({ tenantId: a.id, slug: `demo-retired-g${base + 2}`, purged: true, auditRetained: audit });
    expect(result.retained).toContain('audit_event');
    expect(await tenantRow(a.id)).toBeNull();
    const tickets = await withContext(ctx, () => platformTransaction(ctx, (tx) => tx.ticket.count()));
    expect(tickets).toBe(0);
    const [row] = (await listGenerations({ limit: 200 })).filter((r) => r.id === a.ledgerId);
    expect(row).toMatchObject({ status: 'purged', purgedAt: NOW, auditRetained: audit });

    // A second purge of the same generation finds nothing to delete.
    await expect(purgeDemoGeneration(a.id, b.id, { liveSlug: LIVE_SLUG })).resolves.toMatchObject({ purged: false });
  });

  it.each([
    ['the live generation', () => b.id, 'wrong-status'],
    ['a standard tenant', () => standardId, 'wrong-kind'],
  ])('refuses to purge %s', async (_label, id, refusal) => {
    const error = await purgeDemoGeneration(id(), b.id, { liveSlug: LIVE_SLUG }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DemoPurgeRefusedError);
    expect(error).toMatchObject({ refusal });
    expect(await tenantRow(id())).not.toBeNull();
  });

  it('refuses a demo tenant without the managed mark, or with a hand-picked slug', async () => {
    const unmanaged = (await listDemoTenants({ statuses: ['seeding'] })).find((t) => !t.managed && created.has(t.id));
    expect(unmanaged).toBeDefined();
    await expect(purgeDemoGeneration(unmanaged!.id, b.id, { liveSlug: LIVE_SLUG })).rejects.toMatchObject({ refusal: 'unmanaged' });

    const picked = newId();
    created.add(picked);
    await platformDb().tenant.create({
      data: {
        id: picked,
        name: 'Sales demo',
        slug: `demo-sales-${RUN}`,
        kind: 'demo',
        status: 'retired',
        settings: { demo: { managed: true, generation: base + 8 } },
      },
    });
    await expect(purgeDemoGeneration(picked, b.id, { liveSlug: LIVE_SLUG })).rejects.toMatchObject({ refusal: 'slug-pattern' });
    expect(await tenantRow(picked)).not.toBeNull();
  });
});
