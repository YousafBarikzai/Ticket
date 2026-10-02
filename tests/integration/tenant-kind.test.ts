import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { platformDb } from '@itsm/platform';
import { tenantService } from '@itsm/module-tenancy';
import { closeHarness } from '../support/harness.js';

/**
 * `tenant.kind` (D25, ADR-0054): what makes the demo a demo.
 *
 * The API's interlock trusts this column absolutely — a demo token reaches
 * only a `demo` tenant, and a `demo` tenant accepts only demo tokens — and the
 * egress guards key on it whatever the tenant's status. That trust is only
 * sound if the value cannot drift after the tenant exists, so this suite
 * proves the column's three properties against the real database: it defaults
 * to `standard`, it holds one of two values, and nothing can change it once
 * written. Who may write the table at all is `tests/isolation/role-grants`.
 */

const STANDARD_SLUG = 'kind-standard';
// Not a `demo-build-…` slug: the demo lifecycle sweeps those, and this tenant is
// this suite's own.
const DEMO_SLUG = 'kind-demo';

let standardId: string;
let demoId: string;

async function purge(slug: string): Promise<void> {
  const tenant = await tenantService.findTenantBySlug(slug);
  if (tenant) await tenantService.purgeTenant(tenant.id);
}

beforeAll(async () => {
  await purge(STANDARD_SLUG);
  await purge(DEMO_SLUG);
  standardId = (await tenantService.provisionTenant({ name: 'Kind: standard', slug: STANDARD_SLUG })).tenantId;
  demoId = (await tenantService.provisionTenant({ name: 'Kind: demo', slug: DEMO_SLUG, kind: 'demo' })).tenantId;
}, 120_000);

afterAll(async () => {
  await purge(STANDARD_SLUG);
  await purge(DEMO_SLUG);
  await closeHarness();
});

async function kindOf(id: string): Promise<string | undefined> {
  const tenant = await platformDb().tenant.findUnique({ where: { id }, select: { kind: true } });
  return tenant?.kind;
}

describe('provisioning', () => {
  it('makes a standard tenant when nobody says otherwise', async () => {
    // Every caller that existed before v3 passes no kind; they must all go on
    // making real tenants.
    expect(await kindOf(standardId)).toBe('standard');
  });

  it('makes a demo tenant when asked', async () => {
    expect(await kindOf(demoId)).toBe('demo');
  });

  it('refuses a kind it does not know before touching the database', async () => {
    await expect(
      tenantService.provisionTenant({ name: 'Kind: sandbox', slug: 'kind-sandbox', kind: 'sandbox' as never }),
    ).rejects.toThrow();
    expect(await tenantService.findTenantBySlug('kind-sandbox')).toBeNull();
  });
});

describe('the column', () => {
  it('is NOT NULL with a constant default, so adding it rewrote nothing', async () => {
    const [column] = await platformDb().$queryRaw<{ is_nullable: string; column_default: string | null }[]>`
      SELECT is_nullable, column_default FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'tenant' AND column_name = 'kind'`;
    expect(column).toEqual({ is_nullable: 'NO', column_default: "'standard'::text" });
  });

  it('holds only standard or demo, whoever writes it', async () => {
    // The platform role is the only one that may insert tenants at all.
    await expect(
      platformDb().$executeRaw`
        INSERT INTO tenant (id, name, slug, kind, updated_at)
        VALUES (gen_random_uuid(), 'Kind: other', 'kind-other', 'sandbox', now())`,
    ).rejects.toThrow(/tenant_kind_check/);
  });

  it('indexes the demo tenants by status, and only them', async () => {
    const [index] = await platformDb().$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'tenant_kind_demo_idx'`;
    expect(index?.indexdef).toMatch(/\(status\) WHERE \(kind = 'demo'::text\)/);
  });
});

describe('once written, the kind is fixed', () => {
  it('refuses to turn a real tenant into a demo', async () => {
    // Doing so would silence its e-mail and lock its people out.
    await expect(platformDb().tenant.update({ where: { id: standardId }, data: { kind: 'demo' } })).rejects.toThrow(
      /tenant\.kind is immutable/,
    );
    expect(await kindOf(standardId)).toBe('standard');
  });

  it('refuses to turn the demo into a real tenant', async () => {
    // Doing so would open the demo's egress to every visitor.
    await expect(platformDb().tenant.update({ where: { id: demoId }, data: { kind: 'standard' } })).rejects.toThrow(
      /tenant\.kind is immutable/,
    );
    expect(await kindOf(demoId)).toBe('demo');
  });

  it('raises a check violation, so callers can tell it from a lost connection', async () => {
    await expect(platformDb().$executeRaw`UPDATE tenant SET kind = 'demo' WHERE id = ${standardId}::uuid`).rejects.toThrow(
      /23514|check_violation|immutable/,
    );
  });

  it('still lets the lifecycle move a demo tenant through its statuses', async () => {
    // The swap and the purge change `status` and `slug` on demo tenants every
    // night; the trigger fires only when `kind` is in the statement.
    await platformDb().tenant.update({ where: { id: demoId }, data: { status: 'retired' } });
    const tenant = await platformDb().tenant.findUnique({ where: { id: demoId } });
    expect(tenant).toMatchObject({ status: 'retired', kind: 'demo' });
  });

  it('allows a write that leaves the kind as it is', async () => {
    await expect(platformDb().$executeRaw`UPDATE tenant SET kind = kind WHERE id = ${demoId}::uuid`).resolves.toBe(1);
  });
});

describe('the migrations', () => {
  const root = join(import.meta.dirname, '..', '..', 'prisma', 'migrations');
  const files = ['20261002100000_v3_tenant_kind', '20261002110000_v3_sla_cycles_and_grants'];

  it.each(files)('%s only adds: no dropped column or table, no rename, no type change', (name) => {
    const sql = readFileSync(join(root, name, 'migration.sql'), 'utf8')
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n');
    expect(sql).not.toMatch(/DROP\s+(TABLE|COLUMN|INDEX)/i);
    expect(sql).not.toMatch(/RENAME/i);
    expect(sql).not.toMatch(/ALTER\s+COLUMN[^;]*\bTYPE\b/i);
    // A check may be replaced only by one of the same name, added after it
    // (a widened `fact_sla_timer` outcome check, for `cancelled`).
    for (const [, constraint] of sql.matchAll(/DROP\s+CONSTRAINT\s+"?(\w+)"?/gi)) {
      const dropped = sql.search(new RegExp(`DROP\\s+CONSTRAINT\\s+"?${constraint}"?`, 'i'));
      const added = sql.search(new RegExp(`ADD\\s+CONSTRAINT\\s+"?${constraint}"?`, 'i'));
      expect(added, `${constraint} is dropped and never added back`).toBeGreaterThan(dropped);
    }
  });
});
