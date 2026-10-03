import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The shared demo's swap and purge guards (A4 §3.5) and the ledger they
 * keep. These are the two writes in the demo that could hurt a real
 * customer — the swap renames a tenant and the purge deletes one — so every
 * refusal is proved here, against the guards as pure functions and against
 * the transactions that run them.
 *
 * The platform client is an in-memory stand-in that applies each write the
 * way the database would (unique slugs included) and keeps a transaction's
 * writes only if it commits. `tests/integration/demo-lifecycle.test.ts`
 * runs the same paths against PostgreSQL, with real row locks.
 */

interface TenantRow {
  id: string;
  slug: string;
  status: string;
  kind: string;
  settings: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

interface LedgerRow {
  id: string;
  generation: number;
  demoTenantId: string;
  status: string;
  reason: string;
  attempt: number;
  seed: number;
  anchor: Date;
  scale: number;
  generatorVersion: string;
  planHash: string | null;
  startedAt: Date;
  finishedAt: Date | null;
  swappedAt: Date | null;
  retiredAt: Date | null;
  purgedAt: Date | null;
  buildMs: number | null;
  stepMs: Record<string, number>;
  checks: Record<string, unknown>;
  failure: Record<string, unknown> | null;
  auditRetained: number | null;
}

interface State {
  tenants: Map<string, TenantRow>;
  ledger: Map<string, LedgerRow>;
}

const fake = vi.hoisted(() => ({
  state: { tenants: new Map(), ledger: new Map() } as unknown as State,
  calls: [] as string[],
  auditCount: 7,
  /** Runs inside a transaction right after the swap's row locks: another writer's commit. */
  afterLock: null as ((draft: State) => void) | null,
}));

const purgeTenant = vi.hoisted(() => vi.fn());

function clone(state: State): State {
  return {
    tenants: new Map([...state.tenants].map(([id, row]) => [id, { ...row, settings: structuredClone(row.settings) }])),
    ledger: new Map([...state.ledger].map(([id, row]) => [id, { ...row }])),
  };
}

function matches(row: Record<string, unknown>, where: Record<string, unknown> = {}): boolean {
  return Object.entries(where).every(([key, wanted]) => {
    if (wanted && typeof wanted === 'object' && 'in' in (wanted as object)) {
      return ((wanted as { in: unknown[] }).in).includes(row[key]);
    }
    return row[key] === wanted;
  });
}

async function uniqueViolation(): Promise<Error> {
  const { Prisma } = await import('@itsm/platform');
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`slug`)', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

/** A Prisma-shaped client over `state`. */
function clientOver(state: State) {
  const sqlOf = (strings: TemplateStringsArray) => strings.join('?').replace(/\s+/g, ' ').trim();
  return {
    async $queryRaw(strings: TemplateStringsArray, ...values: unknown[]) {
      const sql = sqlOf(strings);
      fake.calls.push(`query:${sql.slice(0, 40)}`);
      if (sql.includes('FROM tenant WHERE id = ANY')) {
        const [ids, slug] = values as [string[], string];
        const locked = [...state.tenants.values()]
          .filter((row) => ids.includes(row.id) || row.slug === slug)
          .sort((a, b) => a.id.localeCompare(b.id))
          .map(({ id, slug: s, status, kind, settings }) => ({ id, slug: s, status, kind, settings: structuredClone(settings) }));
        fake.afterLock?.(state);
        return locked;
      }
      if (sql.includes('FROM tenant WHERE id =')) {
        const row = state.tenants.get(values[0] as string);
        return row ? [{ id: row.id, slug: row.slug, status: row.status, kind: row.kind, settings: structuredClone(row.settings) }] : [];
      }
      if (sql.includes('FROM demo_generation WHERE id =')) {
        const row = state.ledger.get(values[0] as string);
        return row ? [{ id: row.id, generation: row.generation, status: row.status, demoTenantId: row.demoTenantId }] : [];
      }
      if (sql.includes('SELECT GREATEST(')) {
        const ledgerMax = Math.max(
          0,
          ...[...state.ledger.values()].filter((r) => ['live', 'retired', 'purged'].includes(r.status)).map((r) => r.generation),
        );
        const tenantMax = Math.max(
          0,
          ...[...state.tenants.values()]
            .filter((r) => r.kind === 'demo' && ['active', 'retired'].includes(r.status))
            .map((r) => Number((r.settings.demo as { generation?: number } | undefined)?.generation ?? 0)),
        );
        return [{ newest: Math.max(ledgerMax, tenantMax) || null }];
      }
      throw new Error(`unexpected query: ${sql}`);
    },
    async $executeRaw(strings: TemplateStringsArray, ...values: unknown[]) {
      const sql = sqlOf(strings);
      fake.calls.push(`execute:${sql.slice(0, 30)}`);
      if (!sql.startsWith('UPDATE demo_generation SET')) throw new Error(`unexpected statement: ${sql}`);
      const [abandoned, , now, auditRetained, tenantId] = values as [string, Date, Date, number | null, string];
      let count = 0;
      for (const row of state.ledger.values()) {
        if (row.demoTenantId !== tenantId || row.purgedAt) continue;
        if (row.status === 'building') {
          row.failure ??= JSON.parse(abandoned) as Record<string, unknown>;
          row.finishedAt ??= now;
          row.status = 'failed';
        } else if (row.status === 'live' || row.status === 'retired') {
          row.status = 'purged';
        }
        row.purgedAt = now;
        row.auditRetained = auditRetained ?? row.auditRetained;
        count += 1;
      }
      return count;
    },
    async $transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
      const draft = clone(state);
      const result = await fn(clientOver(draft));
      state.tenants = draft.tenants;
      state.ledger = draft.ledger;
      return result;
    },
    tenant: {
      async findFirst({ where, select }: { where: Record<string, unknown>; select?: Record<string, boolean> }) {
        fake.calls.push('tenant.findFirst');
        const row = [...state.tenants.values()].find((r) => matches(r as never, where));
        if (!row) return null;
        return select ? Object.fromEntries(Object.keys(select).map((key) => [key, row[key as keyof TenantRow]])) : row;
      },
      async findMany({ where }: { where: Record<string, unknown> }) {
        return [...state.tenants.values()].filter((r) => matches(r as never, where));
      },
      async create({ data }: { data: Partial<TenantRow> & { id: string } }) {
        fake.calls.push('tenant.create');
        state.tenants.set(data.id, {
          settings: {},
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
          ...data,
        } as TenantRow);
        return state.tenants.get(data.id);
      },
      async update({ where, data }: { where: { id: string }; data: Partial<TenantRow> }) {
        fake.calls.push(`tenant.update:${where.id}:${String(data.status)}`);
        const row = state.tenants.get(where.id);
        if (!row) throw new Error(`no tenant ${where.id}`);
        if (data.slug && [...state.tenants.values()].some((other) => other.id !== row.id && other.slug === data.slug)) {
          throw await uniqueViolation();
        }
        Object.assign(row, data, { updatedAt: new Date() });
        return row;
      },
    },
    demoGeneration: {
      async create({ data }: { data: Partial<LedgerRow> & { id: string; scale: unknown } }) {
        const row = {
          planHash: null,
          finishedAt: null,
          swappedAt: null,
          retiredAt: null,
          purgedAt: null,
          buildMs: null,
          stepMs: {},
          checks: {},
          failure: null,
          auditRetained: null,
          ...data,
          scale: Number(String(data.scale)),
        } as LedgerRow;
        state.ledger.set(row.id, row);
        return row;
      },
      async count({ where }: { where: Record<string, unknown> }) {
        return [...state.ledger.values()].filter((r) => matches(r as never, where)).length;
      },
      async updateMany({ where, data }: { where: Record<string, unknown>; data: Partial<LedgerRow> }) {
        fake.calls.push(`ledger.updateMany:${String(data.status)}`);
        let count = 0;
        for (const row of state.ledger.values()) {
          if (!matches(row as never, where)) continue;
          Object.assign(row, data);
          count += 1;
        }
        return { count };
      },
      async update({ where, data }: { where: { id: string }; data: Partial<LedgerRow> }) {
        fake.calls.push(`ledger.update:${String(data.status)}`);
        const row = state.ledger.get(where.id);
        if (!row) throw new Error(`no ledger row ${where.id}`);
        Object.assign(row, data);
        return row;
      },
      async findUnique({ where }: { where: { id: string } }) {
        return state.ledger.get(where.id) ?? null;
      },
      async findUniqueOrThrow({ where }: { where: { id: string } }) {
        const row = state.ledger.get(where.id);
        if (!row) throw new Error('not found');
        return row;
      },
      async findMany() {
        return [...state.ledger.values()].sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
      },
    },
  };
}

vi.mock('@itsm/platform', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@itsm/platform')>();
  return {
    ...actual,
    platformDb: () => clientOver(fake.state),
    platformTransaction: async (_ctx: unknown, fn: (tx: unknown) => Promise<unknown>) =>
      fn({ auditEvent: { count: async () => fake.auditCount } }),
    metrics: { increment: vi.fn(), observe: vi.fn(), gauge: vi.fn() },
    logger: { ...actual.logger, error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  };
});

vi.mock('../service/tenant-service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../service/tenant-service.js')>()),
  purgeTenant,
}));

const lifecycle = await import('../service/demo-lifecycle.js');
const { provisionTenant } = await import('../service/tenant-service.js');
const {
  DEMO_PURGEABLE_SLUG_PATTERN,
  DemoPurgeRefusedError,
  DemoSwapRefusedError,
  attemptKeyFor,
  decidePurge,
  decideSwap,
  demoMarkOf,
  demoSettingsOf,
  markGeneration,
  openGeneration,
  purgeDemoGeneration,
  retiredSlugFor,
  swapDemoGeneration,
} = lifecycle;
const { ConflictError, ValidationError } = await import('@itsm/platform');

const LIVE = '0192f3a4-aaaa-7aaa-8bbb-00000000000a';
const NEXT = '0192f3a4-bbbb-7aaa-8bbb-00000000000b';
const STANDARD = '0192f3a4-cccc-7aaa-8bbb-00000000000c';
const LEDGER_LIVE = '0192f3a4-dddd-7aaa-8bbb-00000000000d';
const LEDGER_NEXT = '0192f3a4-eeee-7aaa-8bbb-00000000000e';
const NOW = new Date('2026-10-03T23:00:30.000Z'); // 00:00:30 on 4 October, UK time (BST)

function demoSettings(generation: number, extra: Record<string, unknown> = {}) {
  return {
    theme: 'kept',
    demo: { managed: true, generation, seed: 20261002, anchor: '2026-10-02T09:40:00.000Z', scale: 0.2, generatorVersion: 'test-1', ...extra },
  };
}

function tenant(row: Partial<TenantRow> & Pick<TenantRow, 'id' | 'slug' | 'status' | 'kind'>): TenantRow {
  return { settings: {}, createdAt: new Date('2026-10-02T00:00:00Z'), updatedAt: new Date('2026-10-02T00:00:00Z'), deletedAt: null, ...row };
}

function ledger(row: Partial<LedgerRow> & Pick<LedgerRow, 'id' | 'generation' | 'demoTenantId' | 'status'>): LedgerRow {
  return {
    reason: 'scheduled',
    attempt: 1,
    seed: 20261002,
    anchor: new Date('2026-10-02T23:00:00Z'),
    scale: 0.2,
    generatorVersion: 'test-1',
    planHash: null,
    startedAt: new Date('2026-10-02T23:00:00Z'),
    finishedAt: null,
    swappedAt: null,
    retiredAt: null,
    purgedAt: null,
    buildMs: null,
    stepMs: {},
    checks: {},
    failure: null,
    auditRetained: null,
    ...row,
  };
}

/** Generation 4 live behind `demo`, generation 5 built and waiting, and a real customer beside them. */
function seedWorld(): void {
  fake.state = {
    tenants: new Map([
      [LIVE, tenant({ id: LIVE, slug: 'demo', status: 'active', kind: 'demo', settings: demoSettings(4) })],
      [NEXT, tenant({ id: NEXT, slug: 'demo-build-g5-1a2b3c', status: 'seeding', kind: 'demo', settings: demoSettings(5) })],
      [STANDARD, tenant({ id: STANDARD, slug: 'acme', status: 'active', kind: 'standard', settings: {} })],
    ]),
    ledger: new Map([
      [LEDGER_LIVE, ledger({ id: LEDGER_LIVE, generation: 4, demoTenantId: LIVE, status: 'live' })],
      [LEDGER_NEXT, ledger({ id: LEDGER_NEXT, generation: 5, demoTenantId: NEXT, status: 'building' })],
    ]),
  };
}

const SWAP = {
  liveTenantId: LIVE,
  nextTenantId: NEXT,
  slug: 'demo',
  expectedGeneration: 4,
  reason: 'scheduled',
  ledgerId: LEDGER_NEXT,
  now: NOW,
} as const;

beforeEach(() => {
  fake.calls.length = 0;
  fake.auditCount = 7;
  fake.afterLock = null;
  purgeTenant.mockReset().mockResolvedValue({ rows: 1234, passes: 2, retained: ['audit_event'] });
  seedWorld();
});

afterEach(() => vi.clearAllMocks());

/* ------------------------------------------------------------ The guards */

describe('the swap guard (decideSwap)', () => {
  const live = { id: LIVE, slug: 'demo', status: 'active', kind: 'demo', settings: demoSettings(4) };
  const next = { id: NEXT, slug: 'demo-build-g5-1a2b3c', status: 'seeding', kind: 'demo', settings: demoSettings(5) };
  const open = { id: LEDGER_NEXT, generation: 5, status: 'building', demoTenantId: NEXT };

  it('activates a managed seeding build over the live generation it expected', () => {
    expect(decideSwap(SWAP, [live, next], open)).toEqual({ live, next, generation: 5 });
  });

  it('activates the first generation when nothing holds the slug', () => {
    const first = { ...next, settings: demoSettings(1) };
    const input = { ...SWAP, liveTenantId: null, expectedGeneration: null };
    expect(decideSwap(input, [first], { ...open, generation: 1 })).toEqual({ live: null, next: first, generation: 1 });
  });

  it.each([
    ['missing', [live], 'missing'],
    ['a standard tenant', [live, { ...next, kind: 'standard' }], 'wrong-kind'],
    ['an active tenant', [live, { ...next, status: 'active' }], 'wrong-status'],
    ['a retired tenant', [live, { ...next, status: 'retired' }], 'wrong-status'],
    ['an unmanaged demo tenant', [live, { ...next, settings: { demo: { generation: 5 } } }], 'unmanaged'],
    ['a demo tenant with no generation', [live, { ...next, settings: { demo: { managed: true } } }], 'unmanaged'],
  ] as const)('refuses to activate %s', (_label, rows, refusal) => {
    expect(decideSwap(SWAP, rows, open)).toMatchObject({ refusal });
  });

  it('refuses when a standard tenant holds the slug (slug-held), for the first generation too', () => {
    const squatter = { id: STANDARD, slug: 'demo', status: 'active', kind: 'standard', settings: {} };
    const input = { ...SWAP, liveTenantId: null, expectedGeneration: null };
    expect(decideSwap(input, [next, squatter], open)).toMatchObject({
      refusal: 'slug-held',
      message: 'the slug demo is held by a standard tenant',
    });
  });

  it('refuses when another demo generation already took the slug (superseded)', () => {
    const winner = { ...next, id: '0192f3a4-ffff-7aaa-8bbb-00000000000f', slug: 'demo', status: 'active' };
    expect(decideSwap({ ...SWAP, liveTenantId: null, expectedGeneration: null }, [next, winner], open)).toMatchObject({
      refusal: 'superseded',
    });
  });

  it.each([
    ['retired by a concurrent swap', { ...live, slug: 'demo-retired-g4', status: 'retired' }],
    ['at another generation', { ...live, settings: demoSettings(6) }],
  ])('refuses when the live tenant was %s (superseded)', (_label, current) => {
    expect(decideSwap(SWAP, [current, next], open)).toMatchObject({ refusal: 'superseded' });
  });

  it('refuses when the live tenant it expected is gone', () => {
    expect(decideSwap(SWAP, [next], open)).toMatchObject({ refusal: 'superseded' });
  });

  it('never retires a tenant that is not a demo tenant', () => {
    const notDemo = { ...live, kind: 'standard' };
    expect(decideSwap(SWAP, [notDemo, next], open)).toMatchObject({ refusal: 'wrong-kind' });
  });

  it('refuses a build whose generation would not move the demo forward', () => {
    const stale = { ...next, settings: demoSettings(4) };
    expect(decideSwap(SWAP, [live, stale], { ...open, generation: 4 })).toMatchObject({ refusal: 'superseded' });
  });

  it.each([
    ['missing', null],
    ['already failed', { ...open, status: 'failed' }],
    ['another tenant’s', { ...open, demoTenantId: LIVE }],
    ['for another generation', { ...open, generation: 6 }],
  ])('refuses when the ledger row is %s', (_label, row) => {
    expect(decideSwap(SWAP, [live, next], row)).toMatchObject({ refusal: 'ledger' });
  });
});

describe('the purge guard (decidePurge)', () => {
  const live = { liveTenantId: LIVE, liveSlug: 'demo' };
  const retired = { id: NEXT, slug: 'demo-retired-g4', status: 'retired', kind: 'demo', settings: demoSettings(4) };

  it.each([
    ['a retired generation', retired],
    ['a retired generation with a suffix', { ...retired, slug: 'demo-retired-g4-0a1b2c' }],
    ['an abandoned build', { ...retired, slug: 'demo-build-g5-1a2b3c', status: 'seeding' }],
    ['an abandoned build without a suffix', { ...retired, slug: 'demo-build-g12', status: 'seeding' }],
  ])('allows %s', (_label, row) => {
    expect(decidePurge(row, live)).toBeNull();
  });

  it.each([
    ['a standard tenant, whatever its slug', { ...retired, kind: 'standard' }, 'wrong-kind'],
    ['a hand-made demo tenant without the managed mark', { ...retired, settings: { demo: { generation: 4 } } }, 'unmanaged'],
    ['a demo tenant with no settings at all', { ...retired, settings: {} }, 'unmanaged'],
    ['an active demo tenant', { ...retired, status: 'active' }, 'wrong-status'],
    ['a suspended demo tenant', { ...retired, status: 'suspended' }, 'wrong-status'],
    ['a demo tenant with a hand-picked slug', { ...retired, slug: 'demo-sales' }, 'slug-pattern'],
    ['a slug with the wrong suffix', { ...retired, slug: 'demo-retired-g4-xyz123' }, 'slug-pattern'],
    ['the live tenant', { ...retired, id: LIVE }, 'live-id'],
  ] as const)('refuses %s', (_label, row, refusal) => {
    expect(decidePurge(row, live)).toMatchObject({ refusal });
  });

  it('refuses the configured live slug even when it happens to match the pattern', () => {
    expect(decidePurge(retired, { liveTenantId: null, liveSlug: 'demo-retired-g4' })).toMatchObject({ refusal: 'live-slug' });
  });

  it('recognises exactly the build and retired slugs', () => {
    for (const slug of ['demo-build-g1', 'demo-build-g20-abcdef', 'demo-retired-g3', 'demo-retired-g3-012345']) {
      expect(DEMO_PURGEABLE_SLUG_PATTERN.test(slug)).toBe(true);
    }
    for (const slug of ['demo', 'acme', 'demo-build', 'demo-build-g', 'demo-built-g1', 'demo-build-g1-ABCDEF', 'demo-build-g1-abcdef0', 'x-demo-build-g1']) {
      expect(DEMO_PURGEABLE_SLUG_PATTERN.test(slug)).toBe(false);
    }
    expect(retiredSlugFor(41)).toBe('demo-retired-g41');
  });
});

describe('reading settings.demo', () => {
  it('reads the managed mark and generation leniently, so a guard can refuse a half-written record', () => {
    expect(demoMarkOf(demoSettings(3))).toEqual({ managed: true, generation: 3 });
    expect(demoMarkOf({ demo: { managed: 'yes', generation: '3' } })).toEqual({ managed: false, generation: null });
    expect(demoMarkOf(null)).toEqual({ managed: false, generation: null });
    expect(demoMarkOf([])).toEqual({ managed: false, generation: null });
  });

  it('returns the whole record only when it is complete', () => {
    expect(demoSettingsOf(demoSettings(3, { lastResetReason: 'manual', lastResetKey: '2026-10-03' }))).toMatchObject({
      managed: true,
      generation: 3,
      scale: 0.2,
      lastResetReason: 'manual',
      lastResetKey: '2026-10-03',
    });
    expect(demoSettingsOf(demoSettings(3, { anchor: 'yesterday' }))).toBeNull();
    expect(demoSettingsOf(demoSettings(0))).toBeNull();
    expect(demoSettingsOf({ demo: { generation: 3 } })).toBeNull();
    // An unknown reason is dropped rather than trusted.
    expect(demoSettingsOf(demoSettings(3, { lastResetReason: 'whim' }))).not.toHaveProperty('lastResetReason');
  });
});

describe('attempt keys (job ids carry -a<attempt>, Y-B3)', () => {
  it('keys a scheduled or catch-up build on the UK day it starts, not the UTC one', () => {
    // 23:00:30 UTC on 3 October is 00:00:30 on 4 October in London (BST).
    expect(attemptKeyFor('scheduled', { now: NOW, generation: 5 })).toEqual({ reason: 'scheduled', dateKey: '2026-10-04' });
    expect(attemptKeyFor('catch-up', { now: new Date('2026-12-01T03:10:00Z'), generation: 5 })).toEqual({
      reason: 'catch-up',
      dateKey: '2026-12-01',
    });
  });

  it('keys a visitor’s reset on the generation it asked to replace', () => {
    expect(attemptKeyFor('manual', { now: NOW, generation: 5 })).toEqual({ reason: 'manual', requestedGeneration: 4 });
  });

  it('keys the initial and operator builds on their reason alone', () => {
    expect(attemptKeyFor('initial', { now: NOW, generation: 1 })).toEqual({ reason: 'initial' });
    expect(attemptKeyFor('operator', { now: NOW, generation: 9 })).toEqual({ reason: 'operator' });
  });
});

/* -------------------------------------------------------------- The swap */

describe('swapDemoGeneration', () => {
  it('retires the live generation, then activates the build under the slug, then moves the ledger', async () => {
    await expect(swapDemoGeneration(SWAP)).resolves.toEqual({ generation: 5, previousTenantId: LIVE });

    const live = fake.state.tenants.get(LIVE)!;
    const next = fake.state.tenants.get(NEXT)!;
    expect(live).toMatchObject({ slug: 'demo-retired-g4', status: 'retired' });
    expect(next).toMatchObject({ slug: 'demo', status: 'active' });
    // The slug index is checked per statement, so the order is the point.
    const writes = fake.calls.filter((call) => call.startsWith('tenant.update') || call.startsWith('ledger.'));
    expect(writes).toEqual([
      `tenant.update:${LIVE}:retired`,
      `tenant.update:${NEXT}:active`,
      'ledger.updateMany:retired',
      'ledger.update:live',
    ]);
    expect(fake.state.ledger.get(LEDGER_LIVE)).toMatchObject({ status: 'retired', retiredAt: NOW });
    expect(fake.state.ledger.get(LEDGER_NEXT)).toMatchObject({ status: 'live', swappedAt: NOW });
  });

  it('stamps the reset on the new generation and keeps its other settings', async () => {
    await swapDemoGeneration({ ...SWAP, reason: 'manual' });
    expect(fake.state.tenants.get(NEXT)!.settings).toEqual({
      theme: 'kept',
      demo: {
        ...demoSettings(5).demo,
        lastResetAt: NOW.toISOString(),
        lastResetReason: 'manual',
        lastResetKey: '2026-10-04',
      },
    });
  });

  it('makes the first generation live with nothing to retire', async () => {
    fake.state.tenants.delete(LIVE);
    fake.state.ledger.delete(LEDGER_LIVE);
    await expect(swapDemoGeneration({ ...SWAP, liveTenantId: null, expectedGeneration: null })).resolves.toEqual({
      generation: 5,
      previousTenantId: null,
    });
    expect(fake.calls).not.toContain('ledger.updateMany:retired');
  });

  it('writes nothing when it refuses', async () => {
    fake.state.tenants.set(STANDARD, { ...fake.state.tenants.get(STANDARD)!, slug: 'demo' });
    fake.state.tenants.get(LIVE)!.slug = 'demo-old';
    const before = structuredClone([...fake.state.tenants.values()]);

    const error = await swapDemoGeneration(SWAP).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DemoSwapRefusedError);
    expect(error).toBeInstanceOf(ConflictError);
    expect(error).toMatchObject({ refusal: 'slug-held', status: 409 });
    expect([...fake.state.tenants.values()]).toEqual(before);
    expect(fake.state.ledger.get(LEDGER_NEXT)!.status).toBe('building');
  });

  it('refuses a second swap against the same live generation (superseded)', async () => {
    await swapDemoGeneration(SWAP);
    const rival = '0192f3a4-9999-7aaa-8bbb-000000000099';
    const rivalLedger = '0192f3a4-9998-7aaa-8bbb-000000000098';
    fake.state.tenants.set(rival, tenant({ id: rival, slug: 'demo-build-g5-ffffff', status: 'seeding', kind: 'demo', settings: demoSettings(5) }));
    fake.state.ledger.set(rivalLedger, ledger({ id: rivalLedger, generation: 5, demoTenantId: rival, status: 'building' }));

    await expect(swapDemoGeneration({ ...SWAP, nextTenantId: rival, ledgerId: rivalLedger })).rejects.toMatchObject({
      refusal: 'superseded',
    });
    expect(fake.state.tenants.get(rival)!.status).toBe('seeding');
  });

  it('reports a lost race on the unique slug as superseded, not as a crash', async () => {
    // Two first-generation swaps share no row to lock, so the slug index
    // decides: here the rival commits just after this swap took its locks.
    fake.state.tenants.delete(LIVE);
    fake.state.ledger.delete(LEDGER_LIVE);
    const rival = '0192f3a4-9997-7aaa-8bbb-000000000097';
    fake.afterLock = (state) => {
      state.tenants.set(rival, tenant({ id: rival, slug: 'demo', status: 'active', kind: 'demo', settings: demoSettings(5) }));
    };

    const error = await swapDemoGeneration({ ...SWAP, liveTenantId: null, expectedGeneration: null }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DemoSwapRefusedError);
    expect(error).toMatchObject({ refusal: 'superseded' });
    // Rolled back: the build is still seeding, its ledger row still open.
    expect(fake.state.tenants.get(NEXT)!.status).toBe('seeding');
    expect(fake.state.ledger.get(LEDGER_NEXT)!.status).toBe('building');
  });

  it('retires to a suffixed slug when a leftover already holds demo-retired-g<n>', async () => {
    const leftover = '0192f3a4-9996-7aaa-8bbb-000000000096';
    fake.state.tenants.set(leftover, tenant({ id: leftover, slug: 'demo-retired-g4', status: 'retired', kind: 'demo', settings: demoSettings(4) }));
    await swapDemoGeneration(SWAP);
    expect(fake.state.tenants.get(LIVE)!.slug).toBe('demo-retired-g4-00000a');
    expect(DEMO_PURGEABLE_SLUG_PATTERN.test('demo-retired-g4-00000a')).toBe(true);
  });

  it.each([
    ['a live tenant without an expected generation', { expectedGeneration: null }],
    ['an expected generation without a live tenant', { liveTenantId: null }],
    ['a build replacing itself', { liveTenantId: NEXT }],
    ['a live slug the purge would remove', { slug: 'demo-retired-g4' }],
    ['an unknown reason', { reason: 'whim' }],
  ])('refuses %s before locking anything', async (_label, change) => {
    await expect(swapDemoGeneration({ ...SWAP, ...(change as object) } as never)).rejects.toBeInstanceOf(ValidationError);
    expect(fake.calls).toEqual([]);
  });
});

/* ------------------------------------------------------------- The purge */

describe('purgeDemoGeneration', () => {
  it('purges a retired generation, records the retained audit rows and marks the ledger purged', async () => {
    Object.assign(fake.state.tenants.get(LIVE)!, { slug: 'demo-retired-g4', status: 'retired' });
    fake.state.ledger.get(LEDGER_LIVE)!.status = 'retired';

    await expect(purgeDemoGeneration(LIVE, NEXT, { liveSlug: 'demo', now: NOW })).resolves.toEqual({
      tenantId: LIVE,
      slug: 'demo-retired-g4',
      purged: true,
      rows: 1234,
      auditRetained: 7,
      retained: ['audit_event'],
    });
    expect(purgeTenant).toHaveBeenCalledWith(LIVE);
    expect(fake.state.ledger.get(LEDGER_LIVE)).toMatchObject({ status: 'purged', purgedAt: NOW, auditRetained: 7 });
  });

  it('claims an abandoned build before deleting it, and records why its ledger row failed', async () => {
    await purgeDemoGeneration(NEXT, LIVE, { liveSlug: 'demo', now: NOW });

    // Retired under the lock, so a swap that has not run yet now refuses it.
    expect(fake.state.tenants.get(NEXT)!.status).toBe('retired');
    expect(fake.state.ledger.get(LEDGER_NEXT)).toMatchObject({
      status: 'failed',
      finishedAt: NOW,
      purgedAt: NOW,
      failure: { step: null, message: expect.stringContaining('abandoned'), at: NOW.toISOString() },
    });
  });

  it('keeps a failed attempt failed, so a retry that went live as the same generation never collides with it', async () => {
    Object.assign(fake.state.ledger.get(LEDGER_NEXT)!, { status: 'failed', failure: { step: 'history', message: 'boom', at: 'x' } });
    await purgeDemoGeneration(NEXT, LIVE, { liveSlug: 'demo', now: NOW });
    expect(fake.state.ledger.get(LEDGER_NEXT)).toMatchObject({ status: 'failed', failure: { step: 'history' }, purgedAt: NOW });
  });

  it.each([
    ['the live demo', LIVE, 'wrong-status'],
    ['a standard tenant', STANDARD, 'wrong-kind'],
  ])('refuses %s and deletes nothing', async (_label, id, refusal) => {
    const error = await purgeDemoGeneration(id, LIVE, { liveSlug: 'demo', now: NOW }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DemoPurgeRefusedError);
    expect(error).toMatchObject({ refusal });
    expect(purgeTenant).not.toHaveBeenCalled();
    expect(fake.calls.some((call) => call.startsWith('tenant.update'))).toBe(false);
  });

  it('refuses the live tenant by id even when the caller passes it as a candidate', async () => {
    Object.assign(fake.state.tenants.get(NEXT)!, { status: 'retired', slug: 'demo-retired-g5' });
    await expect(purgeDemoGeneration(NEXT, NEXT, { liveSlug: 'demo', now: NOW })).rejects.toMatchObject({ refusal: 'live-id' });
    expect(purgeTenant).not.toHaveBeenCalled();
  });

  it('only brings the ledger up to date when the tenant is already gone', async () => {
    fake.state.tenants.delete(NEXT);
    await expect(purgeDemoGeneration(NEXT, LIVE, { liveSlug: 'demo', now: NOW })).resolves.toMatchObject({
      purged: false,
      slug: null,
      rows: 0,
      auditRetained: null,
    });
    expect(purgeTenant).not.toHaveBeenCalled();
    expect(fake.state.ledger.get(LEDGER_NEXT)).toMatchObject({ status: 'failed', purgedAt: NOW });
  });
});

/* ------------------------------------------------------------ The ledger */

describe('the ledger', () => {
  it('opens a build as one more than the newest generation that went live, attempt 1', async () => {
    const record = await openGeneration({
      demoTenantId: NEXT,
      reason: 'manual',
      seed: 20261002,
      anchor: NOW,
      scale: 0.2,
      generatorVersion: 'test-1',
      now: NOW,
    });
    expect(record).toMatchObject({ generation: 5, status: 'building', reason: 'manual', attempt: 1, scale: 0.2, startedAt: NOW });
    expect(fake.state.ledger.get(record.id)).toMatchObject({ demoTenantId: NEXT, status: 'building' });
  });

  it('counts earlier attempts at the same key into the attempt number', async () => {
    // A visitor's earlier reset of generation 4 failed as generation 5: this is the second attempt.
    Object.assign(fake.state.ledger.get(LEDGER_NEXT)!, { reason: 'manual', status: 'failed' });
    const record = await openGeneration({
      demoTenantId: NEXT,
      reason: 'manual',
      seed: 1,
      anchor: NOW,
      scale: 1,
      generatorVersion: 'test-1',
      now: NOW,
    });
    expect(record.attempt).toBe(2);
  });

  it.each([
    ['a tenant id that is not a UUID', { demoTenantId: 'demo' }],
    ['an unknown reason', { reason: 'whim' }],
    ['a scale above 1', { scale: 2 }],
    ['an invalid anchor', { anchor: new Date('nope') }],
  ])('refuses %s', async (_label, change) => {
    const input = { demoTenantId: NEXT, reason: 'initial', seed: 1, anchor: NOW, scale: 0.2, generatorVersion: 'v', ...change };
    await expect(openGeneration(input as never)).rejects.toBeInstanceOf(ValidationError);
  });

  it('marks a building row failed with its step, and refuses to demote a live one', async () => {
    const failed = await markGeneration(LEDGER_NEXT, {
      status: 'failed',
      failure: { step: 'history', message: 'a part threw', at: NOW },
      stepMs: { prepare: 1200 },
    });
    expect(failed).toMatchObject({
      status: 'failed',
      failure: { step: 'history', message: 'a part threw', at: NOW.toISOString() },
      finishedAt: NOW,
      stepMs: { prepare: 1200 },
    });

    await expect(markGeneration(LEDGER_LIVE, { status: 'failed' })).rejects.toBeInstanceOf(ConflictError);
    expect(fake.state.ledger.get(LEDGER_LIVE)!.status).toBe('live');
  });

  it('records timings and checks on a live row without touching its status', async () => {
    const record = await markGeneration(LEDGER_LIVE, { buildMs: 201_000, checks: { V3: 'pass' }, planHash: 'abc' });
    expect(record).toMatchObject({ status: 'live', buildMs: 201_000, checks: { V3: 'pass' }, planHash: 'abc' });
  });

  it('refuses a failure without the failed status', async () => {
    await expect(markGeneration(LEDGER_NEXT, { failure: { step: null, message: 'x' } })).rejects.toBeInstanceOf(ValidationError);
  });
});

/* -------------------------------------------------- Provisioning a build */

describe('provisionTenant for a demo build', () => {
  const build = { name: 'Northwind Traders (UK)', slug: 'demo-build-g5-1a2b3c', kind: 'demo' as const };
  const settings = { generation: 5, seed: 20261002, anchor: NOW, scale: 0.2, generatorVersion: 'test-1' };

  it.each([
    ['a standard tenant as seeding', { ...build, kind: 'standard' as const }, { status: 'seeding' as const, demo: settings }],
    ['a seeding tenant without its build settings', build, { status: 'seeding' as const }],
    ['a seeding tenant whose slug the purge would not recognise', { ...build, slug: 'northwind' }, { status: 'seeding' as const, demo: settings }],
    ['build settings on an active tenant', build, { demo: settings }],
    ['a chosen id that is not a UUID', build, { status: 'seeding' as const, id: 'next', demo: settings }],
    ['a generation of 0', build, { status: 'seeding' as const, demo: { ...settings, generation: 0 } }],
  ])('refuses %s before writing anything', async (_label, input, options) => {
    await expect(provisionTenant(input, options as never)).rejects.toBeInstanceOf(ValidationError);
    expect(fake.calls).not.toContain('tenant.create');
  });

  it('refuses a chosen id that is already taken', async () => {
    await expect(provisionTenant(build, { status: 'seeding', id: LIVE, demo: settings })).rejects.toBeInstanceOf(ConflictError);
    expect(fake.calls).not.toContain('tenant.create');
  });
});
