import type Redis from 'ioredis';

/**
 * Redis hygiene for integration files (SPEC §4.11, V-M2).
 *
 * The integration project shares one Redis that is never flushed, and its
 * files run one after another in an order Vitest chooses — so the isolation
 * suite's keyspace scan may run after any of them, and it fails on any `bff:`
 * key (a session record is tenant data). A file that writes BFF session
 * records or rate-limit keys therefore uses an app name of its own
 * (`it-<file>`, so its keys are `bff:it-<file>:…`), declares what it writes
 * with `trackRedisKeys`, and calls `deleteTracked()` in `afterAll`.
 *
 * A pattern is a `SCAN MATCH` glob, or an exact key (no `*`, `?`, `[` or
 * `\`), which is deleted without a scan. Patterns stay registered after a
 * clean-up, so `deleteTracked()` can be called mid-file and again at the end.
 * Each test file runs in its own module graph, so the registry is per file.
 */

interface Tracked {
  readonly redis: Redis;
  readonly patterns: Set<string>;
}

const tracked: Tracked[] = [];

const GLOB = /[*?[\\]/;

/**
 * Patterns that could match keys the file did not write are refused, so a
 * typo cannot empty the shared Redis: a glob must have a literal prefix of
 * at least eight characters (`demo:tok:*` passes, `demo:*` does not), and a
 * `bff:` key or glob must name a per-file app (`bff:it-…`), never a real one.
 */
function assertSafe(pattern: string): void {
  const literal = pattern.split(GLOB)[0] ?? '';
  if (pattern.length === 0 || (GLOB.test(pattern) && literal.length < 8)) {
    throw new RangeError(`refusing to track ${JSON.stringify(pattern)}: its literal prefix is too short to be specific`);
  }
  if (pattern.startsWith('bff:') && !pattern.startsWith('bff:it-')) {
    throw new RangeError(`refusing to track ${JSON.stringify(pattern)}: BFF keys in tests must use an app name "it-<file>"`);
  }
}

/** Records the keys (exact names or `SCAN` globs) this file will write with `redis`. */
export function trackRedisKeys(redis: Redis, patterns: readonly string[]): void {
  for (const pattern of patterns) assertSafe(pattern);
  let entry = tracked.find((item) => item.redis === redis);
  if (!entry) {
    entry = { redis, patterns: new Set() };
    tracked.push(entry);
  }
  for (const pattern of patterns) entry.patterns.add(pattern);
}

/** Every key matching a `SCAN` glob. */
export async function scanKeys(redis: Redis, pattern: string): Promise<string[]> {
  const found = new Set<string>();
  let cursor = '0';
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 1000);
    cursor = next;
    for (const key of keys) found.add(key);
  } while (cursor !== '0');
  return [...found];
}

async function deleteKeys(redis: Redis, keys: readonly string[]): Promise<number> {
  let deleted = 0;
  for (let start = 0; start < keys.length; start += 500) {
    const batch = keys.slice(start, start + 500);
    if (batch.length > 0) deleted += await redis.del(...batch);
  }
  return deleted;
}

/**
 * Deletes everything the tracked patterns match and returns how many keys
 * went. Exact keys are deleted directly; globs are scanned first.
 */
export async function deleteTracked(): Promise<number> {
  let deleted = 0;
  for (const { redis, patterns } of tracked) {
    const exact = [...patterns].filter((pattern) => !GLOB.test(pattern));
    deleted += await deleteKeys(redis, exact);
    for (const pattern of patterns) {
      if (!GLOB.test(pattern)) continue;
      deleted += await deleteKeys(redis, await scanKeys(redis, pattern));
    }
  }
  return deleted;
}

/**
 * Snapshots keys a file must overwrite but does not own — the demo's
 * singletons such as `demo:live` and `demo:active` — and returns a function
 * that puts them back exactly (value, type and time-to-live) or deletes them
 * when they did not exist. A file that writes `demo:live` for its own
 * fixture then leaves the next file, or a developer's running demo, the
 * Redis it found.
 */
export async function preserveRedisKeys(redis: Redis, keys: readonly string[]): Promise<() => Promise<void>> {
  const saved = await Promise.all(
    keys.map(async (key) => ({ key, dump: await redis.dumpBuffer(key), ttl: await redis.pttl(key) })),
  );
  return async () => {
    for (const { key, dump, ttl } of saved) {
      if (dump === null) {
        await redis.del(key);
      } else {
        await redis.restore(key, ttl > 0 ? ttl : 0, dump, 'REPLACE');
      }
    }
  };
}
