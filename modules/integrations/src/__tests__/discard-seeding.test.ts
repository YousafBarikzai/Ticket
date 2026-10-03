import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `discardForSeedingTenant` (A4 §2.4 Q3): just before the swap makes a demo
 * build live, its unpublished events are deleted, so the publisher does not
 * deliver four months of imported history the moment the tenant turns
 * `active`. It deletes an outbox, so it must refuse every tenant but a demo
 * build that is still `seeding` — a real customer's unpublished events are
 * work the platform still owes them.
 *
 * The platform transaction is a recording stand-in: what is under test is
 * which statements run, and that the refusal comes before the delete.
 */

interface Statement {
  readonly kind: 'query' | 'execute';
  readonly sql: string;
  readonly values: readonly unknown[];
}

const db = vi.hoisted(() => ({
  tenant: null as { kind: string; status: string } | null,
  statements: [] as Statement[],
  deleted: 0,
  contexts: [] as { tenantId: string }[],
}));

vi.mock('@itsm/platform', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@itsm/platform')>();
  const sqlOf = (strings: TemplateStringsArray) => strings.join('?').replace(/\s+/g, ' ').trim();
  return {
    ...actual,
    platformTransaction: async (ctx: { tenantId: string }, fn: (tx: unknown) => Promise<unknown>) => {
      db.contexts.push({ tenantId: ctx.tenantId });
      return fn({
        $queryRaw(strings: TemplateStringsArray, ...values: unknown[]) {
          db.statements.push({ kind: 'query', sql: sqlOf(strings), values });
          return Promise.resolve(db.tenant ? [db.tenant] : []);
        },
        $executeRaw(strings: TemplateStringsArray, ...values: unknown[]) {
          db.statements.push({ kind: 'execute', sql: sqlOf(strings), values });
          return Promise.resolve(db.deleted);
        },
      });
    },
    metrics: { increment: vi.fn(), observe: vi.fn(), gauge: vi.fn() },
    logger: { ...actual.logger, info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  };
});

const { ConflictError, SYSTEM_PERMISSIONS, createContext } = await import('@itsm/platform');
const { discardForSeedingTenant } = await import('../service/outbox-publisher.js');

const TENANT = '0192f3a4-5555-7aaa-8bbb-000000000005';
const ctx = createContext({ tenantId: TENANT, actor: { type: 'system', id: null }, permissions: SYSTEM_PERMISSIONS });

beforeEach(() => {
  db.tenant = null;
  db.statements.length = 0;
  db.contexts.length = 0;
  db.deleted = 0;
});

describe('discardForSeedingTenant', () => {
  it('deletes a seeding demo build’s unpublished events and says how many', async () => {
    db.tenant = { kind: 'demo', status: 'seeding' };
    db.deleted = 31_204;

    await expect(discardForSeedingTenant(ctx)).resolves.toBe(31_204);
    expect(db.contexts).toEqual([{ tenantId: TENANT }]);
  });

  it('checks the tenant under a row lock, in the same transaction as the delete', async () => {
    db.tenant = { kind: 'demo', status: 'seeding' };
    await discardForSeedingTenant(ctx);

    expect(db.statements.map((s) => s.kind)).toEqual(['query', 'execute']);
    const [check, discard] = db.statements;
    expect(check!.sql).toBe('SELECT kind, status FROM tenant WHERE id = ?::uuid FOR UPDATE');
    expect(check!.values).toEqual([TENANT]);
    // Unpublished rows of this tenant only: a published event already has
    // its inbox claims, and the tenant predicate keeps the query log honest.
    expect(discard!.sql).toBe('DELETE FROM outbox_event WHERE tenant_id = ?::uuid AND published_at IS NULL');
    expect(discard!.values).toEqual([TENANT]);
  });

  it.each([
    ['a standard tenant', { kind: 'standard', status: 'active' }],
    ['a standard tenant still provisioning', { kind: 'standard', status: 'provisioning' }],
    ['a standard tenant that somehow reads seeding', { kind: 'standard', status: 'seeding' }],
    ['the live demo', { kind: 'demo', status: 'active' }],
    ['a retired demo generation', { kind: 'demo', status: 'retired' }],
  ])('refuses %s and deletes nothing', async (_label, tenant) => {
    db.tenant = tenant;
    const error = await discardForSeedingTenant(ctx).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConflictError);
    expect((error as Error).message).toContain('only a demo build that is still seeding');
    expect(db.statements.some((s) => s.kind === 'execute')).toBe(false);
  });

  it('refuses a tenant that does not exist', async () => {
    await expect(discardForSeedingTenant(ctx)).rejects.toBeInstanceOf(ConflictError);
    expect(db.statements.some((s) => s.kind === 'execute')).toBe(false);
  });
});
