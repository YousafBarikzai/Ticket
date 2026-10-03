import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { platformDb, transaction, withContext } from '@itsm/platform';
import { tenantService } from '@itsm/module-tenancy';
import { closeHarness, contextFor } from '../support/harness.js';

/**
 * Which database role may write what (D25, ADR-0004, ADR-0014).
 *
 * Release-blocking, like the rest of this folder. The application role
 * (`app_user`) is the one every request runs as, so it is the one that must
 * not be able to write the tables that decide who a tenant is and what it may
 * do: the tenant directory, cross-tenant grants, event consumers, plans, the
 * isolation allow-list and the demo ledger. The audit trail is append-only for
 * everyone.
 *
 * These revokes were made once, in 2026-09, and every migration since undid
 * them with its blanket `GRANT … ON ALL TABLES`. Nothing exploitable came of
 * it, because nothing in the application writes those tables as `app_user`,
 * but nothing noticed either. `reassert_role_revokes()`
 * (20261002110000_v3_sla_cycles_and_grants) now runs after every blanket
 * grant, and this suite checks the privileges themselves, so a future
 * migration that forgets the call fails here rather than in production.
 *
 * `tenant.kind` gets three independent layers (D25, Y-M14): the grant (no
 * write privilege for `app_user`), row-level security (forced, with a
 * SELECT-only policy for `app_user`), and the immutability trigger (which
 * holds even for the platform role, which may write the table).
 */

const WRITES = ['INSERT', 'UPDATE', 'DELETE'] as const;

/** Written only by the platform role; read by the application role. */
const DIRECTORY = ['tenant', 'tenant_grant', 'consumer_registry', 'plan', 'plan_limit'];

const SLUG = 'role-grants';
let tenantId: string;
let demoLedgerExists = false;

async function privileges(role: string, table: string): Promise<Record<string, boolean>> {
  const result: Record<string, boolean> = {};
  for (const privilege of [...WRITES, 'SELECT']) {
    const [row] = await platformDb().$queryRaw<{ granted: boolean }[]>`
      SELECT has_table_privilege(${role}, ${`public.${table}`}, ${privilege}) AS granted`;
    result[privilege] = row!.granted;
  }
  return result;
}

beforeAll(async () => {
  const existing = await tenantService.findTenantBySlug(SLUG);
  if (existing) await tenantService.purgeTenant(existing.id);
  tenantId = (await tenantService.provisionTenant({ name: 'Role grants', slug: SLUG })).tenantId;

  const [row] = await platformDb().$queryRaw<{ present: boolean }[]>`
    SELECT to_regclass('public.demo_generation') IS NOT NULL AS present`;
  demoLedgerExists = row!.present;
}, 120_000);

afterAll(async () => {
  await tenantService.purgeTenant(tenantId);
  await closeHarness();
});

describe('the application role', () => {
  it.each(DIRECTORY)('reads %s and cannot write it', async (table) => {
    expect(await privileges('app_user', table)).toEqual({ SELECT: true, INSERT: false, UPDATE: false, DELETE: false });
  });

  it('cannot write the isolation allow-list', async () => {
    // The list of tables exempt from row-level security: whoever writes it
    // decides what the next migration leaves unprotected.
    const granted = await privileges('app_user', 'platform_table_allowlist');
    expect(granted).toMatchObject({ INSERT: false, UPDATE: false, DELETE: false });
  });

  it('cannot write the demo generation ledger', async (context) => {
    // Created in wave 2 by 20261002140000_v3_demo_generation; until then
    // there is nothing to check, and the test says so rather than passing.
    if (!demoLedgerExists) context.skip();
    expect(await privileges('app_user', 'demo_generation')).toMatchObject({ INSERT: false, UPDATE: false, DELETE: false });
  });

  it('may only append to the audit trail', async () => {
    expect(await privileges('app_user', 'audit_event')).toEqual({ SELECT: true, INSERT: true, UPDATE: false, DELETE: false });
  });

  it('still writes ordinary tenant data', async () => {
    // The revokes are a list, not a reset: a function that revoked too much
    // would take the product down rather than make it safer.
    expect(await privileges('app_user', 'ticket')).toEqual({ SELECT: true, INSERT: true, UPDATE: true, DELETE: true });
  });
});

describe('the platform role', () => {
  it.each(DIRECTORY)('still writes %s', async (table) => {
    expect(await privileges('app_platform', table)).toMatchObject({ INSERT: true, UPDATE: true, DELETE: true });
  });

  it('cannot change or delete the audit trail either', async () => {
    expect(await privileges('app_platform', 'audit_event')).toMatchObject({ UPDATE: false, DELETE: false });
  });

  it('cannot write the isolation allow-list', async () => {
    expect(await privileges('app_platform', 'platform_table_allowlist')).toMatchObject({
      INSERT: false,
      UPDATE: false,
      DELETE: false,
    });
  });
});

describe('the read-only role', () => {
  it('writes nothing at all', async () => {
    // By oid, not by name, so the check never resolves a name outside the schema.
    const writable = await platformDb().$queryRaw<{ table_name: string }[]>`
      SELECT c.relname AS table_name
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
        AND (has_table_privilege('app_readonly', c.oid, 'INSERT')
          OR has_table_privilege('app_readonly', c.oid, 'UPDATE')
          OR has_table_privilege('app_readonly', c.oid, 'DELETE'))`;
    expect(writable).toEqual([]);
  });
});

describe("a tenant's kind cannot be changed from inside a tenant (D25, Y-M14)", () => {
  it('refuses the application role an UPDATE of tenant.kind', async () => {
    const ctx = contextFor(tenantId);
    await expect(
      withContext(ctx, () =>
        transaction(ctx, (tx) => tx.$executeRaw`UPDATE tenant SET kind = 'demo' WHERE id = ${tenantId}::uuid`),
      ),
    ).rejects.toThrow(/permission denied/);

    const tenant = await platformDb().tenant.findUnique({ where: { id: tenantId }, select: { kind: true } });
    expect(tenant?.kind).toBe('standard');
  });

  it('refuses the application role an INSERT into tenant', async () => {
    const ctx = contextFor(tenantId);
    await expect(
      withContext(ctx, () =>
        transaction(
          ctx,
          (tx) => tx.$executeRaw`
            INSERT INTO tenant (id, name, slug, kind, updated_at)
            VALUES (gen_random_uuid(), 'Smuggled', 'role-grants-smuggled', 'demo', now())`,
        ),
      ),
    ).rejects.toThrow(/permission denied|row-level security/);
    expect(await tenantService.findTenantBySlug('role-grants-smuggled')).toBeNull();
  });

  it('would refuse both through row-level security alone, were the grant ever restored', async () => {
    // The second layer, checked structurally: security is forced on the
    // table, and every policy that applies to the application role is
    // SELECT-only. With an UPDATE grant, an UPDATE would match no row; an
    // INSERT would fail its policy check.
    const [table] = await platformDb().$queryRaw<{ enabled: boolean; forced: boolean }[]>`
      SELECT relrowsecurity AS enabled, relforcerowsecurity AS forced
      FROM pg_class WHERE oid = 'public.tenant'::regclass`;
    expect(table).toEqual({ enabled: true, forced: true });

    const policies = await platformDb().$queryRaw<{ policyname: string; cmd: string }[]>`
      SELECT policyname, cmd FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'tenant'
        AND ('app_user' = ANY (roles) OR 'public' = ANY (roles))`;
    expect(policies.length).toBeGreaterThan(0);
    expect(policies.every((policy) => policy.cmd === 'SELECT')).toBe(true);
  });

  it('refuses even the platform role, which may write the table, through the trigger', async () => {
    await expect(platformDb().tenant.update({ where: { id: tenantId }, data: { kind: 'demo' } })).rejects.toThrow(
      /tenant\.kind is immutable/,
    );
  });
});

describe('the migrations', () => {
  const root = join(import.meta.dirname, '..', '..', 'prisma', 'migrations');
  // From the migration that created the function on. Earlier migrations
  // cannot call it, and the first of these repairs everything they granted.
  const migrations = readdirSync(root)
    .filter((name) => /^\d{14}_/.test(name) && name >= '20261002110000')
    .sort();

  function code(name: string): string {
    return readFileSync(join(root, name, 'migration.sql'), 'utf8')
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n');
  }

  it('include the one that creates reassert_role_revokes()', () => {
    expect(migrations[0]).toBe('20261002110000_v3_sla_cycles_and_grants');
    expect(code(migrations[0]!)).toMatch(/CREATE OR REPLACE FUNCTION reassert_role_revokes\(\)/);
  });

  it.each(migrations)('%s reasserts the revokes after its last blanket grant', (name) => {
    const sql = code(name);
    const grant = /GRANT\s+SELECT\s*,\s*INSERT\s*,\s*UPDATE\s*,\s*DELETE\s+ON\s+ALL\s+TABLES/gi;
    let lastGrant = -1;
    for (let match = grant.exec(sql); match; match = grant.exec(sql)) lastGrant = match.index;
    if (lastGrant === -1) return; // grants nothing, so there is nothing to undo
    const reassert = sql.lastIndexOf('SELECT reassert_role_revokes()');
    expect(reassert, `${name} grants writes on every table and never calls reassert_role_revokes() after it`).toBeGreaterThan(
      lastGrant,
    );
  });
});
