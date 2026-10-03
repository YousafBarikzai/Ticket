import {
  ConflictError,
  NotFoundError,
  Prisma,
  ValidationError,
  loadConfig,
  logger,
  metrics,
  newId,
  platformDb,
  platformTransaction,
  systemContext,
  withContext,
} from '@itsm/platform';
import { DEMO_RESET, DEMO_RESET_REASONS, ukDateKey, type DemoResetReason } from '@itsm/contracts/demo';
import { purgeTenant } from './tenant-service.js';

/**
 * The shared demo's generations: the ledger, the swap and the purge (D12,
 * D19; SPEC v3 §5.3, A4 §3.4–§3.6).
 *
 * The demo is rebuilt every night into a brand-new tenant, which is swapped
 * in only once it has checked itself; yesterday's tenant is retired, then
 * purged two minutes later. Every step that touches the tenant directory or
 * the ledger lives here, in the module that owns both tables, because the
 * generator writes no table of its own (A4 W1) and because these are the
 * steps that could hurt a real customer if they were wrong: the swap renames
 * a tenant and the purge deletes one.
 *
 * So both carry guards that do not trust their caller. The swap refuses
 * unless the tenant it activates is a managed demo build still `seeding`, the
 * tenant it retires is the live generation the caller expected, and no
 * standard tenant holds the slug. The purge refuses anything that is not a
 * managed, non-live demo generation with a generated slug. A standard tenant
 * fails both on its first predicate, `kind`, which no write can change
 * (20261002100000_v3_tenant_kind).
 *
 * Everything runs as the platform role (`platformDb()`): the application
 * role may read the ledger and its own tenant row, and write neither.
 */

export type DemoGenerationStatus = 'building' | 'failed' | 'live' | 'retired' | 'purged';
export const DEMO_GENERATION_STATUSES: readonly DemoGenerationStatus[] = Object.freeze([
  'building',
  'failed',
  'live',
  'retired',
  'purged',
] as const);

/**
 * The slugs a demo generation carries while it is not live: `demo-build-g<n>`
 * while it is built, `demo-retired-g<n>` once replaced, either optionally
 * followed by six hex digits. The purge removes nothing else (A4 §3.5).
 */
export const DEMO_PURGEABLE_SLUG_PATTERN = /^demo-(build|retired)-g\d+(-[0-9a-f]{6})?$/;

/** The slug a live generation takes when the next one replaces it. */
export function retiredSlugFor(generation: number): string {
  return `demo-retired-g${generation}`;
}

/* ------------------------------------------------------------- Settings */

/** `tenant.settings.demo` on a managed demo generation. */
export interface DemoTenantSettings {
  readonly managed: true;
  readonly generation: number;
  readonly seed: number;
  /** T0, ISO 8601. */
  readonly anchor: string;
  readonly scale: number;
  readonly generatorVersion: string;
  /** Written by the swap. */
  readonly lastResetAt?: string;
  readonly lastResetReason?: DemoResetReason;
  /** The UK date of the swap, `YYYY-MM-DD`. */
  readonly lastResetKey?: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function wholeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
}

/**
 * The managed-demo facts the guards rely on, read leniently: whether the
 * tenant says it is managed, and which generation it is. A guard must be able
 * to recognise (and refuse) a half-written record, so this never throws.
 */
export function demoMarkOf(settings: unknown): { managed: boolean; generation: number | null } {
  const demo = asRecord(asRecord(settings)?.demo);
  return { managed: demo?.managed === true, generation: wholeNumber(demo?.generation) };
}

/** The whole `settings.demo` record, or null when it is missing or incomplete. */
export function demoSettingsOf(settings: unknown): DemoTenantSettings | null {
  const demo = asRecord(asRecord(settings)?.demo);
  if (!demo || demo.managed !== true) return null;
  const generation = wholeNumber(demo.generation);
  const seed = wholeNumber(demo.seed);
  const { anchor, scale, generatorVersion, lastResetAt, lastResetReason, lastResetKey } = demo;
  if (generation === null || generation < 1 || seed === null) return null;
  if (typeof anchor !== 'string' || Number.isNaN(Date.parse(anchor))) return null;
  if (typeof scale !== 'number' || !(scale > 0)) return null;
  if (typeof generatorVersion !== 'string' || generatorVersion.length === 0) return null;
  return {
    managed: true,
    generation,
    seed,
    anchor,
    scale,
    generatorVersion,
    ...(typeof lastResetAt === 'string' ? { lastResetAt } : {}),
    ...(DEMO_RESET_REASONS.includes(lastResetReason as DemoResetReason)
      ? { lastResetReason: lastResetReason as DemoResetReason }
      : {}),
    ...(typeof lastResetKey === 'string' ? { lastResetKey } : {}),
  };
}

/* --------------------------------------------------------------- Ledger */

export interface DemoGenerationFailure {
  /** The build step that failed (A4 §3.3's names), or null when nobody recorded one. */
  readonly step: string | null;
  readonly message: string;
  readonly at: string;
}

export interface DemoGenerationRecord {
  readonly id: string;
  readonly generation: number;
  readonly demoTenantId: string;
  readonly status: DemoGenerationStatus;
  readonly reason: DemoResetReason;
  readonly attempt: number;
  readonly seed: number;
  readonly anchor: Date;
  readonly scale: number;
  readonly generatorVersion: string;
  readonly planHash: string | null;
  readonly startedAt: Date;
  readonly finishedAt: Date | null;
  readonly swappedAt: Date | null;
  readonly retiredAt: Date | null;
  readonly purgedAt: Date | null;
  readonly buildMs: number | null;
  readonly stepMs: Readonly<Record<string, number>>;
  readonly checks: Readonly<Record<string, unknown>>;
  readonly failure: DemoGenerationFailure | null;
  readonly auditRetained: number | null;
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
  scale: Prisma.Decimal | number | string;
  generatorVersion: string;
  planHash: string | null;
  startedAt: Date;
  finishedAt: Date | null;
  swappedAt: Date | null;
  retiredAt: Date | null;
  purgedAt: Date | null;
  buildMs: number | null;
  stepMs: Prisma.JsonValue;
  checks: Prisma.JsonValue;
  failure: Prisma.JsonValue | null;
  auditRetained: number | null;
}

function toRecord(row: LedgerRow): DemoGenerationRecord {
  const stepMs: Record<string, number> = {};
  for (const [key, value] of Object.entries(asRecord(row.stepMs) ?? {})) {
    if (typeof value === 'number') stepMs[key] = value;
  }
  const failure = asRecord(row.failure);
  return {
    id: row.id,
    generation: row.generation,
    demoTenantId: row.demoTenantId,
    status: row.status as DemoGenerationStatus,
    reason: row.reason as DemoResetReason,
    attempt: row.attempt,
    seed: row.seed,
    anchor: row.anchor,
    scale: Number(row.scale),
    generatorVersion: row.generatorVersion,
    planHash: row.planHash,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    swappedAt: row.swappedAt,
    retiredAt: row.retiredAt,
    purgedAt: row.purgedAt,
    buildMs: row.buildMs,
    stepMs,
    checks: asRecord(row.checks) ?? {},
    failure: failure
      ? {
          step: typeof failure.step === 'string' ? failure.step : null,
          message: typeof failure.message === 'string' ? failure.message : 'unknown',
          at: typeof failure.at === 'string' ? failure.at : row.finishedAt?.toISOString() ?? row.startedAt.toISOString(),
        }
      : null,
    auditRetained: row.auditRetained,
  };
}

/**
 * What identifies "the same build" for job ids (SPEC v3 §5.3, Y-B3): every
 * initial build is one key; the scheduled and catch-up builds of one UK day
 * share a key; a visitor's reset is keyed on the generation it asked to
 * replace; an operator's reset is never retried under the same id (its job id
 * carries the second it was asked for), so its count is informational.
 */
export type DemoAttemptKey =
  | { readonly reason: 'initial' }
  | { readonly reason: 'scheduled' | 'catch-up'; readonly dateKey: string }
  | { readonly reason: 'manual'; readonly requestedGeneration: number }
  | { readonly reason: 'operator' };

/**
 * The attempt key of a build that starts at `now` for `generation`. A
 * scheduled or catch-up build belongs to the UK day it starts on; a manual
 * reset to the generation it replaces, which is the one before it.
 */
export function attemptKeyFor(reason: DemoResetReason, at: { now: Date; generation: number }): DemoAttemptKey {
  switch (reason) {
    case 'scheduled':
    case 'catch-up':
      return { reason, dateKey: ukDateKey(at.now.getTime()) };
    case 'manual':
      return { reason, requestedGeneration: at.generation - 1 };
    default:
      return { reason };
  }
}

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * How many attempts the ledger already records for a build key. The next
 * attempt's job id carries `-a<count + 1>`: BullMQ refuses a duplicate id only
 * while the earlier job is still stored, and every demo job is removed when it
 * finishes, so a number that only goes up is all a retry needs (Y-B3).
 */
export async function countAttempts(key: DemoAttemptKey): Promise<number> {
  const db = platformDb();
  switch (key.reason) {
    case 'scheduled':
    case 'catch-up': {
      if (!DATE_KEY.test(key.dateKey)) throw new ValidationError(`not a UK date key: ${key.dateKey}`);
      // The UK day the attempt started on, the same calendar `ukDateKey` keeps.
      const [row] = await db.$queryRaw<{ count: bigint }[]>`
        SELECT count(*) AS count FROM demo_generation
        WHERE reason IN ('scheduled', 'catch-up')
          AND to_char(started_at AT TIME ZONE ${DEMO_RESET.timeZone}, 'YYYY-MM-DD') = ${key.dateKey}`;
      return Number(row?.count ?? 0);
    }
    case 'manual':
      if (!Number.isSafeInteger(key.requestedGeneration) || key.requestedGeneration < 1) {
        throw new ValidationError('a manual reset replaces a generation from 1');
      }
      return db.demoGeneration.count({ where: { reason: 'manual', generation: key.requestedGeneration + 1 } });
    default:
      return db.demoGeneration.count({ where: { reason: key.reason } });
  }
}

/**
 * The newest generation that ever went live, or 0. The ledger is the record,
 * and the tenants' own `settings.demo.generation` is read as well, so a demo
 * tenant written without a ledger row (a test fixture, a restored backup)
 * still never sees its number reused.
 */
export async function newestGeneration(): Promise<number> {
  const [row] = await platformDb().$queryRaw<{ newest: number | null }[]>`
    SELECT GREATEST(
      (SELECT max(generation) FROM demo_generation WHERE status IN ('live', 'retired', 'purged')),
      (SELECT max((settings -> 'demo' ->> 'generation')::numeric)::int FROM tenant
        WHERE kind = 'demo' AND status IN ('active', 'retired')
          AND jsonb_typeof(settings -> 'demo' -> 'generation') = 'number')
    ) AS newest`;
  return Number(row?.newest ?? 0);
}

export interface OpenGenerationInput {
  /** The tenant the build will create; chosen up front (S2's `buildId`). */
  readonly demoTenantId: string;
  readonly reason: DemoResetReason;
  readonly seed: number;
  readonly anchor: Date;
  readonly scale: number;
  readonly generatorVersion: string;
  /** Defaults to one more than the newest generation that went live. */
  readonly generation?: number;
  /** Defaults to 1 + `countAttempts` for this build's key. */
  readonly attempt?: number;
  readonly now?: Date;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Records the start of a build (S0): a `building` row for the generation
 * about to be made. Returns the row, whose `generation` and `attempt` the
 * build carries from here on.
 */
export async function openGeneration(input: OpenGenerationInput): Promise<DemoGenerationRecord> {
  if (!UUID.test(input.demoTenantId)) throw new ValidationError('demoTenantId must be a UUID');
  if (!DEMO_RESET_REASONS.includes(input.reason)) throw new ValidationError(`unknown reset reason: ${String(input.reason)}`);
  if (!Number.isSafeInteger(input.seed)) throw new ValidationError('seed must be a whole number');
  if (Number.isNaN(input.anchor.getTime())) throw new ValidationError('anchor must be a valid instant');
  if (!(input.scale >= 0.1 && input.scale <= 1)) throw new ValidationError('scale must be from 0.1 to 1');
  if (!input.generatorVersion) throw new ValidationError('generatorVersion is required');

  const now = input.now ?? new Date();
  const generation = input.generation ?? (await newestGeneration()) + 1;
  if (!Number.isSafeInteger(generation) || generation < 1) throw new ValidationError('generation must be from 1');
  const attempt = input.attempt ?? (await countAttempts(attemptKeyFor(input.reason, { now, generation }))) + 1;
  if (!Number.isSafeInteger(attempt) || attempt < 1) throw new ValidationError('attempt must be from 1');

  const row = await platformDb().demoGeneration.create({
    data: {
      id: newId(now),
      generation,
      demoTenantId: input.demoTenantId,
      status: 'building',
      reason: input.reason,
      attempt,
      seed: input.seed,
      anchor: input.anchor,
      scale: new Prisma.Decimal(input.scale.toFixed(2)),
      generatorVersion: input.generatorVersion,
      startedAt: now,
    },
  });
  logger.info('demo generation build opened', { generation, reason: input.reason, attempt, demoTenantId: input.demoTenantId });
  return toRecord(row as LedgerRow);
}

export interface GenerationUpdate {
  /** Only `failed`, and only from `building`: the swap and the purge write every other status. */
  readonly status?: 'failed';
  readonly failure?: { readonly step: string | null; readonly message: string; readonly at?: Date };
  readonly planHash?: string;
  readonly stepMs?: Readonly<Record<string, number>>;
  readonly checks?: Readonly<Record<string, unknown>>;
  readonly buildMs?: number;
  readonly finishedAt?: Date;
}

/**
 * Records what a build learned: its plan hash, its step timings and checks,
 * and — for a build that failed — why. A status change is limited to
 * `building` → `failed`, so a late failure report can never demote a
 * generation the swap already made live.
 */
export async function markGeneration(id: string, update: GenerationUpdate): Promise<DemoGenerationRecord> {
  if (update.failure && update.status !== 'failed') throw new ValidationError('a failure is recorded with status failed');
  if (update.buildMs !== undefined && !(Number.isSafeInteger(update.buildMs) && update.buildMs >= 0)) {
    throw new ValidationError('buildMs must be a whole number of milliseconds');
  }
  const db = platformDb();
  const data: Prisma.DemoGenerationUpdateManyMutationInput = {
    ...(update.planHash !== undefined ? { planHash: update.planHash } : {}),
    ...(update.stepMs !== undefined ? { stepMs: { ...update.stepMs } } : {}),
    ...(update.checks !== undefined ? { checks: update.checks as Prisma.InputJsonObject } : {}),
    ...(update.buildMs !== undefined ? { buildMs: update.buildMs } : {}),
    ...(update.finishedAt !== undefined ? { finishedAt: update.finishedAt } : {}),
  };

  if (update.status === 'failed') {
    const at = update.failure?.at ?? update.finishedAt ?? new Date();
    const failure = {
      step: update.failure?.step ?? null,
      message: update.failure?.message ?? 'failed',
      at: at.toISOString(),
    };
    const { count } = await db.demoGeneration.updateMany({
      where: { id, status: 'building' },
      data: { ...data, status: 'failed', failure, finishedAt: update.finishedAt ?? at },
    });
    if (count === 0) {
      const existing = await db.demoGeneration.findUnique({ where: { id }, select: { status: true } });
      if (!existing) throw new NotFoundError('demo generation', id);
      throw new ConflictError(`demo generation ${id} is ${existing.status}, so it cannot be marked failed`);
    }
  } else {
    const { count } = await db.demoGeneration.updateMany({ where: { id }, data });
    if (count === 0) throw new NotFoundError('demo generation', id);
  }

  const row = await db.demoGeneration.findUniqueOrThrow({ where: { id } });
  return toRecord(row as LedgerRow);
}

/** The ledger, newest first: the operator's status view, and the build's duration estimate. */
export async function listGenerations(
  options: { limit?: number; statuses?: readonly DemoGenerationStatus[] } = {},
): Promise<DemoGenerationRecord[]> {
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 5), 1), 200);
  const rows = await platformDb().demoGeneration.findMany({
    where: options.statuses ? { status: { in: [...options.statuses] } } : {},
    orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
    take: limit,
  });
  return rows.map((row) => toRecord(row as LedgerRow));
}

/* -------------------------------------------------------------- Tenants */

export interface DemoTenantSummary {
  readonly id: string;
  readonly slug: string;
  readonly status: string;
  readonly managed: boolean;
  readonly generation: number | null;
  readonly settings: DemoTenantSettings | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

function toSummary(row: {
  id: string;
  slug: string;
  status: string;
  settings: Prisma.JsonValue;
  createdAt: Date;
  updatedAt: Date;
}): DemoTenantSummary {
  const mark = demoMarkOf(row.settings);
  return {
    id: row.id,
    slug: row.slug,
    status: row.status,
    managed: mark.managed,
    generation: mark.generation,
    settings: demoSettingsOf(row.settings),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const SUMMARY_SELECT = { id: true, slug: true, status: true, settings: true, createdAt: true, updatedAt: true } as const;

/**
 * Every demo tenant, oldest first, optionally narrowed by status: the check
 * job sweeps the `retired` and stale `seeding` ones from this list.
 */
export async function listDemoTenants(options: { statuses?: readonly string[] } = {}): Promise<DemoTenantSummary[]> {
  const rows = await platformDb().tenant.findMany({
    where: { kind: 'demo', ...(options.statuses ? { status: { in: [...options.statuses] } } : {}) },
    select: SUMMARY_SELECT,
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  return rows.map(toSummary);
}

/** The live generation's tenant: the `active` demo tenant behind the configured slug, if any. */
export async function findLiveDemoTenant(slug: string = loadConfig().DEMO_TENANT_SLUG): Promise<DemoTenantSummary | null> {
  const row = await platformDb().tenant.findFirst({
    where: { slug, kind: 'demo', status: 'active', deletedAt: null },
    select: SUMMARY_SELECT,
  });
  return row ? toSummary(row) : null;
}

/* ----------------------------------------------------------------- Swap */

export type DemoSwapRefusal =
  /** The build's tenant is gone. */
  | 'missing'
  /** A tenant involved is not a demo tenant. */
  | 'wrong-kind'
  /** The build's tenant is not `seeding`. */
  | 'wrong-status'
  /** The build's tenant carries no managed `settings.demo`. */
  | 'unmanaged'
  /** A non-demo tenant holds the demo's slug: an operator must decide. */
  | 'slug-held'
  /** Another swap won: the live generation is not the one this build expected to replace. */
  | 'superseded'
  /** The ledger row is not this build's open row. */
  | 'ledger';

export class DemoSwapRefusedError extends ConflictError {
  constructor(
    readonly refusal: DemoSwapRefusal,
    message: string,
  ) {
    super(message, { refusal });
  }
}

export interface SwapDemoGenerationInput {
  /** The tenant behind the slug now, or null for the first generation. */
  readonly liveTenantId: string | null;
  /** The build's tenant, `seeding`. */
  readonly nextTenantId: string;
  /** `DEMO_TENANT_SLUG`. */
  readonly slug: string;
  /** The live tenant's generation as the build saw it; null exactly when `liveTenantId` is. */
  readonly expectedGeneration: number | null;
  readonly reason: DemoResetReason;
  /** The build's open ledger row (`openGeneration`). */
  readonly ledgerId: string;
  readonly now: Date;
}

/** A tenant row as the swap locks it. */
export interface LockedTenant {
  readonly id: string;
  readonly slug: string;
  readonly status: string;
  readonly kind: string;
  readonly settings: unknown;
}

/** The build's ledger row as the swap locks it. */
export interface LockedLedger {
  readonly id: string;
  readonly generation: number;
  readonly status: string;
  readonly demoTenantId: string;
}

export type SwapDecision =
  | { readonly refusal: DemoSwapRefusal; readonly message: string }
  | { readonly live: LockedTenant | null; readonly next: LockedTenant; readonly generation: number };

/**
 * The swap's guard (A4 §3.5 row 1), as a pure function of the rows the
 * transaction locked, so every refusal can be proved without a database.
 */
export function decideSwap(input: SwapDemoGenerationInput, rows: readonly LockedTenant[], ledger: LockedLedger | null): SwapDecision {
  const next = rows.find((row) => row.id === input.nextTenantId);
  if (!next) return { refusal: 'missing', message: `the demo build tenant ${input.nextTenantId} no longer exists` };
  if (next.kind !== 'demo') return { refusal: 'wrong-kind', message: `tenant ${next.slug} is not a demo tenant` };
  if (next.status !== 'seeding') {
    return { refusal: 'wrong-status', message: `the demo build ${next.slug} is ${next.status}, not seeding` };
  }
  const mark = demoMarkOf(next.settings);
  if (!mark.managed || mark.generation === null || mark.generation < 1) {
    return { refusal: 'unmanaged', message: `the demo build ${next.slug} is not a managed demo generation` };
  }

  const holder = rows.find((row) => row.slug === input.slug);
  if (holder && holder.id !== input.liveTenantId) {
    return holder.kind === 'demo'
      ? { refusal: 'superseded', message: `another demo generation already holds the slug ${input.slug}` }
      : { refusal: 'slug-held', message: `the slug ${input.slug} is held by a ${holder.kind} tenant` };
  }

  let live: LockedTenant | null = null;
  if (input.liveTenantId) {
    live = rows.find((row) => row.id === input.liveTenantId) ?? null;
    if (!live) return { refusal: 'superseded', message: 'the live demo tenant this build expected to replace is gone' };
    if (live.kind !== 'demo') return { refusal: 'wrong-kind', message: `tenant ${live.slug} is not a demo tenant` };
    const liveGeneration = demoMarkOf(live.settings).generation;
    if (live.status !== 'active' || liveGeneration !== input.expectedGeneration) {
      return {
        refusal: 'superseded',
        message: `the live demo is no longer generation ${String(input.expectedGeneration)} (${live.status}, ${String(liveGeneration)})`,
      };
    }
  }

  if (mark.generation <= (input.expectedGeneration ?? 0)) {
    return {
      refusal: 'superseded',
      message: `generation ${mark.generation} would not replace generation ${String(input.expectedGeneration)}`,
    };
  }

  if (!ledger || ledger.status !== 'building' || ledger.demoTenantId !== next.id || ledger.generation !== mark.generation) {
    return {
      refusal: 'ledger',
      message: ledger
        ? `ledger row ${ledger.id} is ${ledger.status} for generation ${ledger.generation}, not this build's`
        : `ledger row ${input.ledgerId} does not exist`,
    };
  }

  return { live, next, generation: mark.generation };
}

function checkSwapInput(input: SwapDemoGenerationInput): void {
  if ((input.liveTenantId === null) !== (input.expectedGeneration === null)) {
    throw new ValidationError('expectedGeneration is null exactly when there is no live tenant');
  }
  if (input.liveTenantId !== null && input.liveTenantId === input.nextTenantId) {
    throw new ValidationError('a generation cannot replace itself');
  }
  if (!input.slug) throw new ValidationError('the demo slug is required');
  if (DEMO_PURGEABLE_SLUG_PATTERN.test(input.slug)) {
    throw new ValidationError('the live demo slug cannot be one the purge removes');
  }
  if (!DEMO_RESET_REASONS.includes(input.reason)) throw new ValidationError(`unknown reset reason: ${String(input.reason)}`);
  if (Number.isNaN(input.now.getTime())) throw new ValidationError('now must be a valid instant');
}

function isUniqueViolation(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === 'P2002' || (error.code === 'P2010' && (error.meta as { code?: string } | undefined)?.code === '23505');
  }
  return false;
}

/**
 * Makes the build's tenant the live demo, in ONE platform transaction (S12,
 * A4 §3.5): the live tenant retires (`demo-retired-g<n>`), the build takes the
 * slug and turns `active`, and the ledger follows. Every reader sees either
 * the old generation live and the new one seeding, or the old one retired and
 * the new one live — never two live tenants behind the slug, never none.
 *
 * Rows are locked in id order, so two swaps cannot deadlock; the second waits
 * and then finds the live tenant it expected already retired (`superseded`).
 * Two first-generation swaps share no row to lock, so the unique slug index
 * and the ledger's unique `generation` decide between them; that loss is
 * reported as `superseded` too.
 *
 * The Redis writes (`demo:live`, the cooldown, `swapped`) belong to the
 * caller, after this returns: a reader must never be pointed at a generation
 * the database could still roll back.
 */
export async function swapDemoGeneration(
  input: SwapDemoGenerationInput,
): Promise<{ generation: number; previousTenantId: string | null }> {
  checkSwapInput(input);
  const ids = input.liveTenantId ? [input.nextTenantId, input.liveTenantId] : [input.nextTenantId];

  try {
    const result = await platformDb().$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<LockedTenant[]>`
          SELECT id::text AS id, slug, status, kind, settings
          FROM tenant
          WHERE id = ANY(${ids}::uuid[]) OR slug = ${input.slug}
          ORDER BY id
          FOR UPDATE`;
        const [ledger] = await tx.$queryRaw<LockedLedger[]>`
          SELECT id::text AS id, generation, status, demo_tenant_id::text AS "demoTenantId"
          FROM demo_generation
          WHERE id = ${input.ledgerId}::uuid
          FOR UPDATE`;

        const decision = decideSwap(input, rows, ledger ?? null);
        if ('refusal' in decision) throw new DemoSwapRefusedError(decision.refusal, decision.message);
        const { live, next, generation } = decision;

        if (live) {
          // Before the activation: the slug index is checked per statement,
          // so the live tenant must give the slug up first.
          let retiredSlug = retiredSlugFor(input.expectedGeneration!);
          const taken = await tx.tenant.findFirst({ where: { slug: retiredSlug }, select: { id: true } });
          // Only a leftover nobody purged can hold it (generation numbers do
          // not repeat); the guard's pattern also admits a six-digit suffix,
          // and refusing here would fail every build until an operator came.
          if (taken) retiredSlug = `${retiredSlug}-${live.id.replace(/-/g, '').slice(-6)}`;
          await tx.tenant.update({ where: { id: live.id }, data: { slug: retiredSlug, status: 'retired' } });
        }

        const nextSettings = asRecord(next.settings) ?? {};
        const demo = {
          ...(asRecord(nextSettings.demo) ?? {}),
          lastResetAt: input.now.toISOString(),
          lastResetReason: input.reason,
          lastResetKey: ukDateKey(input.now.getTime()),
        };
        await tx.tenant.update({
          where: { id: next.id },
          data: { slug: input.slug, status: 'active', settings: { ...nextSettings, demo } as Prisma.InputJsonObject },
        });

        if (input.expectedGeneration !== null) {
          await tx.demoGeneration.updateMany({
            where: { generation: input.expectedGeneration, status: 'live' },
            data: { status: 'retired', retiredAt: input.now },
          });
        }
        await tx.demoGeneration.update({
          where: { id: input.ledgerId },
          data: { status: 'live', swappedAt: input.now },
        });

        return { generation, previousTenantId: live?.id ?? null };
      },
      { maxWait: 10_000, timeout: 15_000 },
    );

    metrics.increment('demo_swaps_total', { result: 'swapped' });
    logger.info('demo generation swapped in', {
      generation: result.generation,
      previousTenantId: result.previousTenantId,
      tenantId: input.nextTenantId,
      reason: input.reason,
    });
    return result;
  } catch (error) {
    const refused = isUniqueViolation(error)
      ? new DemoSwapRefusedError('superseded', 'another demo generation went live first')
      : error;
    if (refused instanceof DemoSwapRefusedError) {
      metrics.increment('demo_swaps_total', { result: refused.refusal });
      logger.warn('demo generation swap refused', { refusal: refused.refusal, reason: refused.message, tenantId: input.nextTenantId });
    }
    throw refused;
  }
}

/* ---------------------------------------------------------------- Purge */

export type DemoPurgeRefusal =
  | 'wrong-kind'
  | 'unmanaged'
  | 'wrong-status'
  | 'slug-pattern'
  | 'live-slug'
  | 'live-id';

export class DemoPurgeRefusedError extends ConflictError {
  constructor(
    readonly refusal: DemoPurgeRefusal,
    message: string,
  ) {
    super(message, { refusal });
  }
}

/**
 * The purge guard (A4 §3.5), as a pure function of the tenant row: null when
 * the row may be purged. Every predicate must hold; the first that does not
 * is the refusal.
 */
export function decidePurge(
  row: LockedTenant,
  live: { readonly liveTenantId: string | null; readonly liveSlug: string },
): { refusal: DemoPurgeRefusal; message: string } | null {
  if (row.kind !== 'demo') return { refusal: 'wrong-kind', message: `tenant ${row.slug} is not a demo tenant` };
  if (!demoMarkOf(row.settings).managed) {
    return { refusal: 'unmanaged', message: `tenant ${row.slug} is not a managed demo generation` };
  }
  if (row.status !== 'seeding' && row.status !== 'retired') {
    return { refusal: 'wrong-status', message: `demo tenant ${row.slug} is ${row.status}; only seeding or retired ones are purged` };
  }
  if (!DEMO_PURGEABLE_SLUG_PATTERN.test(row.slug)) {
    return { refusal: 'slug-pattern', message: `demo tenant ${row.slug} does not carry a build or retired slug` };
  }
  if (row.slug === live.liveSlug) return { refusal: 'live-slug', message: `${row.slug} is the live demo slug` };
  if (row.id === live.liveTenantId) return { refusal: 'live-id', message: `tenant ${row.slug} is the live demo` };
  return null;
}

export interface DemoPurgeResult {
  readonly tenantId: string;
  /** Null when the tenant was already gone (a repeated purge): only the ledger was brought up to date. */
  readonly slug: string | null;
  readonly purged: boolean;
  readonly rows: number;
  /** Audit rows left behind: the trail is append-only (D19, ADR-0014). */
  readonly auditRetained: number | null;
  /** Tables (and `external:` hooks) the purge could not empty, as `purgeTenant` reports them. */
  readonly retained: readonly string[];
}

/**
 * Deletes a retired or abandoned demo generation (S14, the sweeps of S1 and
 * the check job), after re-reading its row under a lock and refusing anything
 * the guard does not recognise (A4 §3.5).
 *
 * A `seeding` tenant is first moved to `retired` in the same locked
 * transaction as the guard, so a swap that has not yet run can no longer
 * activate the tenant being deleted under it.
 *
 * The ledger then records the purge: a retired generation becomes `purged`;
 * an open `building` row, whose build died without saying why, becomes
 * `failed` ("abandoned"); a `failed` row keeps its status. A failed attempt
 * must never become `purged`, because the ledger's unique index on succeeded
 * generations would then collide with the retry that did go live.
 */
export async function purgeDemoGeneration(
  tenantId: string,
  liveTenantId: string | null,
  options: { liveSlug?: string; now?: Date } = {},
): Promise<DemoPurgeResult> {
  const liveSlug = options.liveSlug ?? loadConfig().DEMO_TENANT_SLUG;
  const now = options.now ?? new Date();

  const claimed = await platformDb().$transaction(async (tx) => {
    const [row] = await tx.$queryRaw<LockedTenant[]>`
      SELECT id::text AS id, slug, status, kind, settings FROM tenant WHERE id = ${tenantId}::uuid FOR UPDATE`;
    if (!row) return null;
    const refusal = decidePurge(row, { liveTenantId, liveSlug });
    if (refusal) throw new DemoPurgeRefusedError(refusal.refusal, refusal.message);
    if (row.status === 'seeding') await tx.tenant.update({ where: { id: row.id }, data: { status: 'retired' } });
    return row;
  });

  if (!claimed) {
    // Already gone (the purge ran before, or the build never inserted its
    // row): nothing to delete, but the ledger may still be behind.
    await recordPurge(tenantId, null, now);
    return { tenantId, slug: null, purged: false, rows: 0, auditRetained: null, retained: [] };
  }

  const ctx = systemContext(tenantId);
  const auditRetained = await withContext(ctx, () => platformTransaction(ctx, (tx) => tx.auditEvent.count()));
  const result = await purgeTenant(tenantId);
  await recordPurge(tenantId, auditRetained, now);

  metrics.increment('demo_purges_total');
  logger.info('demo generation purged', { tenantId, slug: claimed.slug, rows: result.rows, auditRetained, retained: result.retained });
  return { tenantId, slug: claimed.slug, purged: true, rows: result.rows, auditRetained, retained: result.retained };
}

async function recordPurge(tenantId: string, auditRetained: number | null, now: Date): Promise<void> {
  const abandoned = { step: null, message: 'abandoned: the build stopped without recording a failure', at: now.toISOString() };
  await platformDb().$executeRaw`
    UPDATE demo_generation SET
      status = CASE WHEN status IN ('live', 'retired') THEN 'purged'
                    WHEN status = 'building' THEN 'failed'
                    ELSE status END,
      failure = CASE WHEN status = 'building' AND failure IS NULL THEN ${JSON.stringify(abandoned)}::jsonb ELSE failure END,
      finished_at = CASE WHEN status = 'building' THEN COALESCE(finished_at, ${now}) ELSE finished_at END,
      purged_at = ${now},
      audit_retained = COALESCE(${auditRetained}::int, audit_retained)
    WHERE demo_tenant_id = ${tenantId}::uuid AND purged_at IS NULL`;
}
