import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ForbiddenError, buildPermissionSet, createContext, type TenantContext } from '@itsm/platform';
import {
  QUERY_SETTLE_MS,
  QUERY_VERSION_TTL_SECONDS,
  bumpQueryVersion,
  bumpQueryVersionFor,
  canonicalJson,
  entryKey,
  queryHash,
  readThrough,
  scopeKeyFor,
  setQueryCacheClient,
  settleKey,
  versionKey,
} from '../service/query-cache.js';
import { MAX_BATCH_QUERIES, batchSchema, evaluateBatch, evaluateCached } from '../service/metric-service.js';

/**
 * The metric answer cache (A8 R4c), against an in-memory Redis.
 *
 * What matters is what can go wrong quietly: an answer handed to somebody it
 * was not computed for, an answer that outlives the facts it came from, and a
 * cache problem that turns into a failed request. The integration suite
 * proves the same against the real API and a real projection.
 */

/** Just enough Redis: strings with expiry, MGET and a MULTI that runs in order. */
class FakeRedis {
  now = 1_000_000;
  failing = false;
  private readonly store = new Map<string, { value: string; expiresAt: number | null }>();

  private check(): void {
    if (this.failing) throw new Error('connection refused');
  }

  private live(key: string): { value: string; expiresAt: number | null } | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt <= this.now) {
      this.store.delete(key);
      return null;
    }
    return entry;
  }

  private write(key: string, value: string, mode?: 'EX' | 'PX', ttl?: number): 'OK' {
    const expiresAt = mode === 'EX' ? this.now + ttl! * 1000 : mode === 'PX' ? this.now + ttl! : null;
    this.store.set(key, { value, expiresAt });
    return 'OK';
  }

  private incrNow(key: string): number {
    const entry = this.live(key);
    const next = Number(entry?.value ?? '0') + 1;
    this.store.set(key, { value: String(next), expiresAt: entry?.expiresAt ?? null });
    return next;
  }

  async get(key: string): Promise<string | null> {
    this.check();
    return this.live(key)?.value ?? null;
  }

  async mget(...keys: string[]): Promise<(string | null)[]> {
    this.check();
    return keys.map((key) => this.live(key)?.value ?? null);
  }

  async set(key: string, value: string, mode?: 'EX' | 'PX', ttl?: number): Promise<'OK'> {
    this.check();
    return this.write(key, value, mode, ttl);
  }

  multi() {
    const steps: (() => unknown)[] = [];
    const chain = {
      incr: (key: string) => {
        steps.push(() => this.incrNow(key));
        return chain;
      },
      expire: (key: string, seconds: number) => {
        steps.push(() => {
          const entry = this.live(key);
          if (entry) entry.expiresAt = this.now + seconds * 1000;
          return entry ? 1 : 0;
        });
        return chain;
      },
      set: (key: string, value: string, mode: 'EX' | 'PX', ttl: number) => {
        steps.push(() => this.write(key, value, mode, ttl));
        return chain;
      },
      exec: async () => {
        this.check();
        return steps.map((step) => [null, step()]);
      },
    };
    return chain;
  }

  /** Seconds or milliseconds left on a key, as `TTL`/`PTTL` would say; -1 for none, -2 for no key. */
  pttl(key: string): number {
    const entry = this.live(key);
    if (!entry) return -2;
    return entry.expiresAt === null ? -1 : entry.expiresAt - this.now;
  }

  keys(): string[] {
    return [...this.store.keys()].filter((key) => this.live(key) !== null).sort();
  }
}

const TENANT = '00000000-0000-4000-8000-000000000001';
const OTHER_TENANT = '00000000-0000-4000-8000-000000000002';
const TEAM_A = '00000000-0000-4000-8000-00000000000a';
const TEAM_B = '00000000-0000-4000-8000-00000000000b';

function reader(scope: 'any' | 'team' | null, teamIds: string[] = [], tenantId = TENANT): TenantContext {
  return createContext({
    tenantId,
    actor: { type: 'user', id: '00000000-0000-4000-8000-0000000000ff', displayName: 'Reader' },
    permissions: buildPermissionSet(scope ? [{ key: 'analytics.read', scope }] : [{ key: 'ticket.read', scope: 'any' }]),
    teamIds,
  });
}

const period = { from: new Date('2026-09-04T00:00:00Z'), to: new Date('2026-10-04T00:00:00Z') };
const question = { metricKey: 'tickets.created', filters: [], range: '30d', series: false };

function hashFor(ctx: TenantContext, overrides: Partial<{ query: unknown; period: typeof period; bucket: string }> = {}): string {
  return queryHash({ scope: scopeKeyFor(ctx)!, query: overrides.query ?? question, period: overrides.period ?? period, bucket: overrides.bucket ?? 'day' });
}

let redis: FakeRedis;
let evaluations: number;
const answer = { metric: { key: 'tickets.created' }, period: { from: period.from.toISOString(), to: period.to.toISOString() }, value: 12, source: 'rollup' };
const load = async () => {
  evaluations += 1;
  return { ...answer, value: 12 + evaluations - 1 };
};

beforeEach(() => {
  redis = new FakeRedis();
  evaluations = 0;
  setQueryCacheClient(redis as never);
});

afterEach(() => {
  setQueryCacheClient(null);
});

/** Lets the settle window after a bump run out, as if three seconds passed. */
function settle(): void {
  redis.now += QUERY_SETTLE_MS + 1;
}

describe('reading through the cache', () => {
  it('evaluates the same question once, and hands the second caller the same answer', async () => {
    const hash = hashFor(reader('any'));
    const first = await readThrough(TENANT, hash, 120, load);
    const second = await readThrough(TENANT, hash, 120, load);
    expect(evaluations).toBe(1);
    expect(second).toEqual(first);
  });

  it('keeps an answer for exactly the configured time, under the tenant\'s version', async () => {
    const hash = hashFor(reader('any'));
    await readThrough(TENANT, hash, 120, load);
    const key = entryKey(TENANT, '0', hash);
    expect(key).toBe(`t:${TENANT}:aq:0:${hash}`);
    expect(redis.pttl(key)).toBe(120_000);

    redis.now += 120_000;
    await readThrough(TENANT, hash, 120, load);
    expect(evaluations).toBe(2);
  });

  it('evaluates again after a version bump, and keeps the new answer once the bump has settled', async () => {
    const hash = hashFor(reader('any'));
    await readThrough(TENANT, hash, 120, load);
    await bumpQueryVersion(TENANT);
    settle();

    const fresh = await readThrough(TENANT, hash, 120, load);
    expect(evaluations).toBe(2);
    expect(fresh.value).toBe(13);
    expect(redis.keys()).toContain(entryKey(TENANT, '1', hash));

    await readThrough(TENANT, hash, 120, load);
    expect(evaluations).toBe(2);
  });

  it('answers, but keeps nothing, while a bump may not have committed', async () => {
    // The projection handlers bump a moment before their transaction commits.
    // An answer worked out in that moment may have read the old facts, so it
    // is served to the caller who asked and to nobody else.
    const hash = hashFor(reader('any'));
    await bumpQueryVersion(TENANT);
    await readThrough(TENANT, hash, 120, load);
    await readThrough(TENANT, hash, 120, load);
    expect(evaluations).toBe(2);
    expect(redis.keys().filter((key) => key.startsWith(`t:${TENANT}:aq:1:`))).toEqual([]);

    settle();
    await readThrough(TENANT, hash, 120, load);
    await readThrough(TENANT, hash, 120, load);
    expect(evaluations).toBe(3);
  });

  it('keeps nothing when the version moved while the answer was being worked out', async () => {
    const hash = hashFor(reader('any'));
    const racing = async () => {
      evaluations += 1;
      await bumpQueryVersion(TENANT);
      settle();
      return answer;
    };
    await readThrough(TENANT, hash, 120, racing);
    expect(redis.keys().filter((key) => key.includes(hash))).toEqual([]);
  });

  it('serves an answer kept before a bump started settling only to the version it was kept under', async () => {
    const hash = hashFor(reader('any'));
    await readThrough(TENANT, hash, 120, load);
    await bumpQueryVersion(TENANT);
    // Still settling: the old entry is under version 0 and the caller now
    // reads version 1, so the old answer is unreachable at once.
    await readThrough(TENANT, hash, 120, load);
    expect(evaluations).toBe(2);
  });

  it('touches no Redis at all when the cache is off', async () => {
    redis.failing = true; // any call would throw
    const hash = hashFor(reader('any'));
    await readThrough(TENANT, hash, 0, load);
    await readThrough(TENANT, hash, 0, load);
    expect(evaluations).toBe(2);
  });

  it('answers through a Redis outage, uncached', async () => {
    redis.failing = true;
    const hash = hashFor(reader('any'));
    await expect(readThrough(TENANT, hash, 120, load)).resolves.toMatchObject({ value: 12 });
    await expect(readThrough(TENANT, hash, 120, load)).resolves.toMatchObject({ value: 13 });
    expect(evaluations).toBe(2);
  });

  it('treats an unreadable entry as a miss and replaces it', async () => {
    const hash = hashFor(reader('any'));
    await redis.set(entryKey(TENANT, '0', hash), '{not json', 'EX', 120);
    await expect(readThrough(TENANT, hash, 120, load)).resolves.toMatchObject({ value: 12 });
    await readThrough(TENANT, hash, 120, load);
    expect(evaluations).toBe(1);
  });

  it('never shares an entry between tenants, and names every key after its tenant', async () => {
    const hash = hashFor(reader('any'));
    await readThrough(TENANT, hash, 120, load);
    await readThrough(OTHER_TENANT, hash, 120, load);
    expect(evaluations).toBe(2);
    await bumpQueryVersion(OTHER_TENANT);
    for (const key of redis.keys()) expect(key).toMatch(new RegExp(`^t:(${TENANT}|${OTHER_TENANT}):aq:`));
    // The other tenant's bump moved only its own version.
    await readThrough(TENANT, hash, 120, load);
    expect(evaluations).toBe(2);
  });
});

describe('who may share an answer', () => {
  it('keys a tenant-wide reader as "any" and a lead by their sorted teams', () => {
    expect(scopeKeyFor(reader('any', [TEAM_A]))).toBe('any');
    expect(scopeKeyFor(reader('team', [TEAM_B, TEAM_A]))).toBe(`team:${TEAM_A},${TEAM_B}`);
    expect(scopeKeyFor(reader('team', [TEAM_A, TEAM_A]))).toBe(`team:${TEAM_A}`);
  });

  it('has no key for a caller with no analytics at all', () => {
    expect(scopeKeyFor(reader(null))).toBeNull();
  });

  it('never lets a lead in one team read an answer a lead in another team caused', async () => {
    const leadA = reader('team', [TEAM_A]);
    const leadB = reader('team', [TEAM_B]);
    await readThrough(TENANT, hashFor(leadA), 120, load);
    await readThrough(TENANT, hashFor(leadB), 120, load);
    expect(evaluations).toBe(2);
  });

  it('never lets a lead read an administrator\'s answer, or the other way round', async () => {
    const admin = reader('any');
    const lead = reader('team', [TEAM_A]);
    expect(hashFor(admin)).not.toBe(hashFor(lead));
    await readThrough(TENANT, hashFor(admin), 120, load);
    await readThrough(TENANT, hashFor(lead), 120, load);
    expect(evaluations).toBe(2);
  });

  it('lets two leads of the same teams share, whatever order their teams come in', async () => {
    await readThrough(TENANT, hashFor(reader('team', [TEAM_A, TEAM_B])), 120, load);
    await readThrough(TENANT, hashFor(reader('team', [TEAM_B, TEAM_A])), 120, load);
    expect(evaluations).toBe(1);
  });
});

describe('the question\'s fingerprint', () => {
  it('ignores the order of an object\'s keys, not the order of a list', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, 1], c: 3 } })).toBe('{"a":{"c":3,"d":[2,1]},"b":1}');
    expect(canonicalJson({ a: 1, skipped: undefined })).toBe('{"a":1}');
    expect(canonicalJson({ at: new Date('2026-10-01T00:00:00Z') })).toBe('{"at":"2026-10-01T00:00:00.000Z"}');
  });

  it('is 32 hex digits, the same for the same question spelt differently', () => {
    const lead = reader('team', [TEAM_A]);
    const hash = hashFor(lead);
    expect(hash).toMatch(/^[0-9a-f]{32}$/);
    expect(hashFor(lead, { query: { series: false, range: '30d', filters: [], metricKey: 'tickets.created' } })).toBe(hash);
  });

  it('changes with the period, so a new day is a new key', () => {
    const admin = reader('any');
    const tomorrow = { from: new Date('2026-09-05T00:00:00Z'), to: new Date('2026-10-05T00:00:00Z') };
    expect(hashFor(admin, { period: tomorrow })).not.toBe(hashFor(admin));
  });

  it('changes with the bucket, the filters and the metric', () => {
    const admin = reader('any');
    const base = hashFor(admin);
    expect(hashFor(admin, { bucket: 'week' })).not.toBe(base);
    expect(hashFor(admin, { query: { ...question, filters: [{ field: 'priority', op: 'eq', value: 'P1' }] } })).not.toBe(base);
    expect(hashFor(admin, { query: { ...question, metricKey: 'tickets.resolved' } })).not.toBe(base);
  });
});

describe('moving the version on', () => {
  it('increments the version, keeps it for seven days from the latest bump, and opens the settle window', async () => {
    await bumpQueryVersion(TENANT);
    expect(await redis.get(versionKey(TENANT))).toBe('1');
    expect(redis.pttl(versionKey(TENANT))).toBe(QUERY_VERSION_TTL_SECONDS * 1000);
    expect(redis.pttl(settleKey(TENANT))).toBe(QUERY_SETTLE_MS);

    redis.now += 6 * 86_400_000;
    await bumpQueryVersion(TENANT);
    expect(await redis.get(versionKey(TENANT))).toBe('2');
    expect(redis.pttl(versionKey(TENANT))).toBe(QUERY_VERSION_TTL_SECONDS * 1000);
  });

  it('lets a purged tenant\'s version lapse a week after its last write', async () => {
    await bumpQueryVersion(TENANT);
    redis.now += QUERY_VERSION_TTL_SECONDS * 1000;
    expect(redis.keys()).toEqual([]);
  });

  it('never throws, so a write is never failed by the cache', async () => {
    redis.failing = true;
    await expect(bumpQueryVersion(TENANT)).resolves.toBeUndefined();
  });

  it('bumps once per transaction for the projection handlers', async () => {
    // A replay hands a batch of events to the handlers in one transaction.
    const batch = {};
    await bumpQueryVersionFor(batch, TENANT);
    await bumpQueryVersionFor(batch, TENANT);
    await bumpQueryVersionFor(batch, TENANT);
    expect(await redis.get(versionKey(TENANT))).toBe('1');

    // The dispatcher runs one event per transaction: one bump each.
    await bumpQueryVersionFor({}, TENANT);
    await bumpQueryVersionFor({}, TENANT);
    expect(await redis.get(versionKey(TENANT))).toBe('3');
  });
});

describe('the batch envelope (A8 R4)', () => {
  const entry = { metricKey: 'tickets.created' };

  it('takes one to thirty questions, each with an optional id', () => {
    expect(MAX_BATCH_QUERIES).toBe(30);
    expect(batchSchema.safeParse({ queries: [entry] }).success).toBe(true);
    expect(batchSchema.safeParse({ queries: Array.from({ length: 30 }, () => entry) }).success).toBe(true);
    expect(batchSchema.safeParse({ queries: [{ ...entry, id: 'open' }, entry] }).success).toBe(true);
  });

  it('refuses none, thirty-one, a non-list and an extra top-level key', () => {
    expect(batchSchema.safeParse({ queries: [] }).success).toBe(false);
    expect(batchSchema.safeParse({ queries: Array.from({ length: 31 }, () => entry) }).success).toBe(false);
    expect(batchSchema.safeParse({ queries: entry }).success).toBe(false);
    expect(batchSchema.safeParse({ queries: [entry], range: '7d' }).success).toBe(false);
    expect(batchSchema.safeParse({ queries: ['tickets.created'] }).success).toBe(false);
  });

  it('refuses an id used twice, naming the second', () => {
    const result = batchSchema.safeParse({ queries: [{ ...entry, id: 'a' }, { ...entry, id: 'b' }, { ...entry, id: 'a' }] });
    expect(result.success).toBe(false);
    expect(result.error!.issues.map((issue) => issue.path.join('.'))).toEqual(['queries.2.id']);
  });

  it('refuses an empty or overlong id', () => {
    expect(batchSchema.safeParse({ queries: [{ ...entry, id: '' }] }).success).toBe(false);
    expect(batchSchema.safeParse({ queries: [{ ...entry, id: 'x'.repeat(65) }] }).success).toBe(false);
  });

  it('leaves each question\'s own shape to that question, so a bad one is its own problem', () => {
    // A metric key that is not a string is not the envelope's business.
    expect(batchSchema.safeParse({ queries: [{ metricKey: 42 }] }).success).toBe(true);
  });
});

describe('who is refused before any cache is asked', () => {
  it('gives a reader with no analytics one 403 for a whole batch', async () => {
    const spy = vi.spyOn(redis, 'mget');
    await expect(evaluateBatch(reader(null), { queries: [{ metricKey: 'tickets.created' }, { metricKey: 'sla.attainment' }] })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it('refuses a single question the same way, before reading anything', async () => {
    const spy = vi.spyOn(redis, 'mget');
    await expect(evaluateCached(reader(null), { metricKey: 'tickets.created' })).rejects.toBeInstanceOf(ForbiddenError);
    expect(spy).not.toHaveBeenCalled();
  });
});
