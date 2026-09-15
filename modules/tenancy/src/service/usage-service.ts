import {
  cache,
  logger,
  metrics,
  newId,
  publish,
  recordAudit,
  registerLimitChecker,
  tenantKey,
  transaction,
  type LimitVerdict,
  type TenantContext,
  type Tx,
} from '@itsm/platform';
import { events } from '@itsm/contracts';
import {
  METERS,
  METER_CATALOGUE,
  crossings,
  describe,
  isMeter,
  periodFor,
  refusalMessage,
  stateFor,
  type Lines,
  type Meter,
  type State,
} from '../domain/meters.js';
import { linesFor } from './plan-service.js';
import { readVerdict, writeVerdict } from './verdict-cache.js';

/**
 * What a tenant is using, and what to do when it is using too much.
 *
 * The rule doc 10 set, and the one this module exists to keep: **limits are
 * never enforced by counting on the request path**. Counting is expensive
 * and gets slower exactly as a tenant grows, which is the worst possible
 * shape for a check that runs on every ticket. So the figure moves as
 * events land, is rebuilt from the source rows nightly, and the *verdict* —
 * one word — is cached. A request reads the word.
 *
 * The cache is allowed to be wrong for a minute. It is not allowed to be
 * missing: when it is, the verdict is loaded once and written back, and
 * when the cache itself is unreachable the platform's `assertWithinLimit`
 * lets the work through (see `packages/platform/src/limits.ts`).
 */

/**
 * One key per tenant, not one hash keyed by tenant.
 *
 * A single global key holding a field per tenant is exactly the shape the
 * isolation suite refuses, and it is right to: it cannot be dropped when a
 * tenant is purged, and it is one careless `hgetall` away from being read
 * across the boundary. The suite caught this on the first live run.
 */
function bufferKey(tenantId: string): string {
  return tenantKey(tenantId, 'usage', 'api-calls');
}

const BUFFER_PATTERN = 't:*:usage:api-calls';

// ---------------------------------------------------------------------------
// Reading the figure
// ---------------------------------------------------------------------------

export interface MeterRow {
  meter: Meter;
  value: bigint;
  state: State;
  periodKey: string;
  lines: Lines;
}

async function loadMeter(tx: Tx, meter: Meter, periodKey: string) {
  return tx.usageMeter.findFirst({ where: { meter, periodKey } });
}

/** Everything a tenant may see about its own usage. */
export async function usageFor(ctx: TenantContext, now: Date = new Date()): Promise<{ planKey: string; meters: MeterRow[] }> {
  const { planKey, lines } = await linesFor(ctx.tenantId);
  return transaction(ctx, async (tx) => {
    const meters: MeterRow[] = [];
    for (const meter of METERS) {
      const periodKey = periodFor(meter, now).key;
      const row = await loadMeter(tx, meter, periodKey);
      const value = row?.value ?? 0n;
      meters.push({ meter, value, state: stateFor(value, lines[meter]), periodKey, lines: lines[meter] });
    }
    return { planKey, meters };
  });
}

// ---------------------------------------------------------------------------
// The verdict a request reads
// ---------------------------------------------------------------------------

async function computeVerdict(ctx: TenantContext, meter: Meter, now: Date): Promise<LimitVerdict> {
  const { planKey, lines } = await linesFor(ctx.tenantId);
  const periodKey = periodFor(meter, now).key;
  const row = await transaction(ctx, (tx) => loadMeter(tx, meter, periodKey));
  const value = row?.value ?? 0n;
  const state = stateFor(value, lines[meter]);
  return state === 'blocked' && lines[meter].hard !== null
    ? { state, message: refusalMessage(meter, value, lines[meter].hard!, planKey) }
    : { state };
}

/**
 * The checker the platform calls. One cache read in the ordinary case; one
 * small query on a miss, which happens once a minute per meter per tenant.
 */
export async function verdictFor(ctx: TenantContext, meterKey: string, now: Date = new Date()): Promise<LimitVerdict> {
  if (!isMeter(meterKey)) return { state: 'ok' };
  const meter = meterKey;

  const hit = await readVerdict(ctx.tenantId, meter);
  if (hit) return hit;

  const verdict = await computeVerdict(ctx, meter, now);
  await writeVerdict(ctx.tenantId, meter, verdict);
  return verdict;
}

/** Called whenever a figure moves, so the next request reads the truth. */
async function refreshVerdict(ctx: TenantContext, meter: Meter, value: bigint, lines: Lines, planKey: string): Promise<void> {
  const state = stateFor(value, lines);
  const verdict: LimitVerdict =
    state === 'blocked' && lines.hard !== null ? { state, message: refusalMessage(meter, value, lines.hard, planKey) } : { state };
  await writeVerdict(ctx.tenantId, meter, verdict);
}

// ---------------------------------------------------------------------------
// Moving a figure
// ---------------------------------------------------------------------------

/**
 * Sets one meter to a figure, announces whatever lines that crosses, and
 * refreshes the verdict.
 *
 * `set` rather than `add` at the bottom, because every caller either knows
 * the new total (a recompute) or has just moved it by a known amount (an
 * event), and a function that only ever adds is a function that cannot be
 * rebuilt. The counted meters add through `note`, which reads the row
 * inside the same transaction.
 */
export async function set(ctx: TenantContext, tx: Tx, meter: Meter, value: bigint, now: Date = new Date()): Promise<MeterRow> {
  const { planKey, lines } = await linesFor(ctx.tenantId);
  const period = periodFor(meter, now);
  const existing = await loadMeter(tx, meter, period.key);
  const state = stateFor(value, lines[meter]);

  const already = { warned: Boolean(existing?.warnedAt), blocked: Boolean(existing?.blockedAt) };
  const crossed = crossings(value, lines[meter], already);
  // Coming back under a line arms it again, so a tenant that clears space
  // and fills it a second time is told a second time.
  const warnedAt = crossed.includes('warned') ? now : state === 'ok' ? null : (existing?.warnedAt ?? null);
  const blockedAt = crossed.includes('blocked') ? now : state === 'blocked' ? (existing?.blockedAt ?? now) : null;

  const data = { value, state, warnedAt, blockedAt };
  if (existing) {
    await tx.usageMeter.update({ where: { id: existing.id }, data });
  } else {
    await tx.usageMeter.create({
      data: {
        id: newId(),
        tenantId: ctx.tenantId,
        meter,
        periodKey: period.key,
        periodStart: period.start,
        periodEnd: period.end,
        ...data,
      },
    });
  }

  for (const threshold of crossed) {
    const limit = threshold === 'blocked' ? lines[meter].hard : lines[meter].soft;
    if (limit === null || limit === undefined) continue;
    const owners = await tx.roleAssignment.findMany({
      where: { role: { key: 'administrator' }, user: { status: 'active', deletedAt: null } },
      select: { userId: true },
      take: 20,
    });
    await publish(tx, ctx, {
      definition: events.usageLimitReached,
      aggregateId: ctx.tenantId,
      payload: {
        meter,
        threshold,
        planKey,
        value: Number(value),
        limit: Number(limit),
        periodStart: period.start ? period.start.toISOString().slice(0, 10) : null,
        audience: owners.map((owner) => ({ kind: 'user' as const, userId: owner.userId })),
      },
    });
    await recordAudit(tx, ctx, {
      action: 'usage.limit.reached',
      targetType: 'usage_meter',
      targetId: meter,
      after: { threshold, value: Number(value), limit: Number(limit), planKey },
    });
    metrics.increment('usage_limits_total', { meter, threshold });
    logger.info('a plan limit was crossed', { tenantId: ctx.tenantId, meter, threshold, value: describe(meter, value) });
  }

  await refreshVerdict(ctx, meter, value, lines[meter], planKey);
  return { meter, value, state, periodKey: period.key, lines: lines[meter] };
}

/** Moves a counted meter by a delta, inside a caller's transaction. */
export async function note(ctx: TenantContext, tx: Tx, meter: Meter, delta: number, now: Date = new Date()): Promise<void> {
  if (delta === 0) return;
  const period = periodFor(meter, now);
  const existing = await loadMeter(tx, meter, period.key);
  const next = (existing?.value ?? 0n) + BigInt(delta);
  await set(ctx, tx, meter, next < 0n ? 0n : next, now);
}

// ---------------------------------------------------------------------------
// Rebuilding from the source rows
// ---------------------------------------------------------------------------

/**
 * Counts one meter from the records that define it.
 *
 * `api_calls` is the exception and says so: there is no row anywhere that
 * remembers a request, so its figure is the counter and cannot be rebuilt.
 * That is a real difference between the meters and pretending otherwise
 * would be worse than admitting it.
 */
export async function measure(ctx: TenantContext, tx: Tx, meter: Meter, now: Date = new Date()): Promise<bigint | null> {
  switch (meter) {
    case 'agents': {
      const rows = await tx.roleAssignment.findMany({
        where: { role: { key: { not: 'requester' } }, user: { status: 'active', deletedAt: null } },
        select: { userId: true },
        distinct: ['userId'],
      });
      return BigInt(rows.length);
    }
    case 'storage': {
      const total = await tx.attachment.aggregate({ where: { deletedAt: null }, _sum: { size: true } });
      return BigInt(total._sum.size ?? 0);
    }
    case 'tickets': {
      const period = periodFor('tickets', now);
      const count = await tx.ticket.count({
        where: {
          deletedAt: null,
          // History brought in by MOD-24 is not this month's work, whenever
          // it was loaded (ADR-0038).
          sourceChannel: { not: 'import' },
          createdAt: { gte: period.start!, lt: new Date(Date.UTC(period.end!.getUTCFullYear(), period.end!.getUTCMonth(), period.end!.getUTCDate() + 1)) },
        },
      });
      return BigInt(count);
    }
    case 'api_calls':
      return null;
  }
}

/** Rebuilds every rebuildable meter, and reports what it corrected. */
export async function recompute(ctx: TenantContext, now: Date = new Date()): Promise<{ corrected: number }> {
  let corrected = 0;
  for (const meter of METERS) {
    await transaction(ctx, async (tx) => {
      const measured = await measure(ctx, tx, meter, now);
      if (measured === null) return;
      const period = periodFor(meter, now);
      const existing = await loadMeter(tx, meter, period.key);
      if (existing && existing.value === measured) {
        // Unchanged, but the cache may have expired while the tenant was
        // over a line: the verdict is refreshed either way.
        const { planKey, lines } = await linesFor(ctx.tenantId);
        await refreshVerdict(ctx, meter, measured, lines[meter], planKey);
        return;
      }
      if (existing) corrected += 1;
      await set(ctx, tx, meter, measured, now);
    });
  }
  return { corrected };
}

// ---------------------------------------------------------------------------
// API calls: counted in the cache, flushed in batches
// ---------------------------------------------------------------------------

/**
 * One increment in Redis per request, and one database write per tenant per
 * flush. A counter in the database per request would make the API's
 * throughput a function of how closely it is metered, which is the wrong way
 * round.
 */
export async function bumpApiCalls(tenantId: string, by = 1): Promise<void> {
  try {
    await cache().incrby(bufferKey(tenantId), by);
  } catch {
    // A request that was not counted is a request that was not counted.
    // Availability first; the figure is approximate by design.
  }
}

/** Empties each tenant's buffer into its meter. Run every minute by the worker. */
export async function flushApiCalls(contextFor: (tenantId: string) => TenantContext | null, now: Date = new Date()): Promise<number> {
  let flushed = 0;
  for (const tenantId of await tenantsAwaitingFlush()) {
    const ctx = contextFor(tenantId);
    if (!ctx) continue;
    // Taken out of the buffer before it is written down, and taken by
    // subtracting what was read rather than by deleting the key: a request
    // counted between the read and the write survives to the next flush
    // instead of being lost, and a flush that fails loses a minute of
    // counting rather than counting it twice.
    let delta: number;
    try {
      delta = Number(await cache().get(bufferKey(tenantId)));
    } catch (error) {
      logger.warn('a tenant\'s API-call buffer could not be read', { tenantId, error: (error as Error).message });
      continue;
    }
    if (!Number.isFinite(delta) || delta <= 0) continue;
    await cache().decrby(bufferKey(tenantId), delta);
    await transaction(ctx, (tx) => note(ctx, tx, 'api_calls', delta, now));
    flushed += delta;
  }
  return flushed;
}

/** Tenants with something waiting, so the sweep visits only them. */
export async function tenantsAwaitingFlush(): Promise<string[]> {
  const found: string[] = [];
  try {
    let cursor = '0';
    do {
      const [next, keys] = await cache().scan(cursor, 'MATCH', BUFFER_PATTERN, 'COUNT', 500);
      cursor = next;
      for (const key of keys) {
        const tenantId = key.split(':')[1];
        if (tenantId) found.push(tenantId);
      }
    } while (cursor !== '0');
  } catch (error) {
    logger.warn('the API-call buffers could not be listed', { error: (error as Error).message });
  }
  return found;
}

export { METERS, METER_CATALOGUE, type Meter };

// Registered at import, which is how the ticket module can be refused
// without knowing this module exists.
registerLimitChecker((ctx, meter) => verdictFor(ctx, meter));
