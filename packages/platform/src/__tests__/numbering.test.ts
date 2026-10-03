import { describe, expect, it } from 'vitest';
import { SYSTEM_PERMISSIONS, createContext } from '../context.js';
import type { Tx } from '../db.js';
import { ensureCounterAtLeast, nextNumber } from '../numbering.js';

/**
 * Number floors (A4 §1.15): the shared demo's history starts at INC-004101,
 * REQ-003201, PRB-0411 and CHG-1151, so the importer raises each counter
 * before its first row. A floor may only ever raise a counter — lowering one
 * would hand out a number twice.
 *
 * The counter lives in one table that both functions write with a single
 * statement. A fake transaction keeps that table in memory and applies each
 * statement's semantics, so the two functions are tested together as the
 * database runs them; `tests/integration/demo-lifecycle.test.ts` runs the
 * real SQL.
 */

interface Statement {
  readonly sql: string;
  readonly values: readonly unknown[];
}

function counterTable(): { tx: Tx; statements: Statement[]; next: (tenantId: string, type: string) => number | undefined } {
  const rows = new Map<string, number>();
  const statements: Statement[] = [];
  const tx = {
    $queryRaw(strings: TemplateStringsArray, ...values: unknown[]) {
      const sql = strings.join('?').replace(/\s+/g, ' ').trim();
      statements.push({ sql, values });
      const [tenantId, type] = values as [string, string];
      const key = `${tenantId}|${type}`;
      const current = rows.get(key);
      if (sql.includes('GREATEST')) {
        // INSERT (…, floor) ON CONFLICT DO UPDATE SET next = GREATEST(next, EXCLUDED.next)
        const floor = values[2] as number;
        const stored = current === undefined ? floor : Math.max(current, floor);
        rows.set(key, stored);
        return Promise.resolve([{ next: stored }]);
      }
      // nextNumber: INSERT (…, 2) ON CONFLICT DO UPDATE SET next = next + 1 RETURNING next - 1
      const stored = current === undefined ? 2 : current + 1;
      rows.set(key, stored);
      return Promise.resolve([{ allocated: stored - 1 }]);
    },
  } as unknown as Tx;
  return { tx, statements, next: (tenantId, type) => rows.get(`${tenantId}|${type}`) };
}

const TENANT = '0192f3a4-3333-7aaa-8bbb-000000000003';
const OTHER = '0192f3a4-4444-7aaa-8bbb-000000000004';
const ctx = createContext({ tenantId: TENANT, actor: { type: 'system', id: null }, permissions: SYSTEM_PERMISSIONS });
const otherCtx = createContext({ tenantId: OTHER, actor: { type: 'system', id: null }, permissions: SYSTEM_PERMISSIONS });

describe('ensureCounterAtLeast', () => {
  it('floors an untouched counter, so the first number allocated is the floor', async () => {
    const { tx } = counterTable();
    await expect(ensureCounterAtLeast(tx, ctx, 'incident', 4101)).resolves.toBe(4101);
    await expect(nextNumber(tx, ctx, 'incident', 'INC')).resolves.toBe('INC-004101');
    await expect(nextNumber(tx, ctx, 'incident', 'INC')).resolves.toBe('INC-004102');
  });

  it('pads to each type’s width, as the demo’s numbers read', async () => {
    const { tx } = counterTable();
    await ensureCounterAtLeast(tx, ctx, 'problem', 411);
    await ensureCounterAtLeast(tx, ctx, 'change', 1151);
    await ensureCounterAtLeast(tx, ctx, 'question', 301);
    await expect(nextNumber(tx, ctx, 'problem', 'PRB', 4)).resolves.toBe('PRB-0411');
    await expect(nextNumber(tx, ctx, 'change', 'CHG', 4)).resolves.toBe('CHG-1151');
    await expect(nextNumber(tx, ctx, 'question', 'QNA')).resolves.toBe('QNA-000301');
  });

  it('raises a counter that is below the floor', async () => {
    const { tx } = counterTable();
    await nextNumber(tx, ctx, 'request', 'REQ');
    await nextNumber(tx, ctx, 'request', 'REQ');
    await expect(ensureCounterAtLeast(tx, ctx, 'request', 3201)).resolves.toBe(3201);
    await expect(nextNumber(tx, ctx, 'request', 'REQ')).resolves.toBe('REQ-003201');
  });

  it('never lowers a counter that is already past the floor', async () => {
    const { tx, next } = counterTable();
    await ensureCounterAtLeast(tx, ctx, 'incident', 5000);
    await nextNumber(tx, ctx, 'incident', 'INC'); // INC-005000

    await expect(ensureCounterAtLeast(tx, ctx, 'incident', 4101)).resolves.toBe(5001);
    expect(next(TENANT, 'incident')).toBe(5001);
    await expect(nextNumber(tx, ctx, 'incident', 'INC')).resolves.toBe('INC-005001');
  });

  it('is a no-op when repeated, so a retried import step allocates nothing twice', async () => {
    const { tx } = counterTable();
    await ensureCounterAtLeast(tx, ctx, 'incident', 4101);
    await ensureCounterAtLeast(tx, ctx, 'incident', 4101);
    await expect(nextNumber(tx, ctx, 'incident', 'INC')).resolves.toBe('INC-004101');
  });

  it('floors one tenant’s counter, not another’s', async () => {
    const { tx } = counterTable();
    await ensureCounterAtLeast(tx, ctx, 'incident', 4101);
    await expect(nextNumber(tx, otherCtx, 'incident', 'INC')).resolves.toBe('INC-000001');
  });

  it('is one tenant-scoped statement that only ever takes the greater value', async () => {
    const { tx, statements } = counterTable();
    await ensureCounterAtLeast(tx, ctx, 'change', 1151);

    expect(statements).toHaveLength(1);
    const [statement] = statements;
    expect(statement!.sql).toMatch(/^INSERT INTO ticket_counter \(tenant_id, type, next\) VALUES/);
    expect(statement!.sql).toContain('ON CONFLICT (tenant_id, type) DO UPDATE SET next = GREATEST(ticket_counter.next, EXCLUDED.next)');
    expect(statement!.values).toEqual([TENANT, 'change', 1151]);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2_147_483_648])(
    'refuses a floor of %s before touching the table',
    async (floor) => {
      const { tx, statements } = counterTable();
      await expect(ensureCounterAtLeast(tx, ctx, 'incident', floor)).rejects.toBeInstanceOf(RangeError);
      expect(statements).toEqual([]);
    },
  );
});
