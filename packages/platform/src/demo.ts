import type { ProblemExtensions } from '@itsm/contracts';
import {
  DEMO_COPY,
  DEMO_PROBLEM_CODES,
  DEMO_TENANT_SLUG_PATTERN,
  demoDisabledSentence,
  demoFeatureForPermission,
  demoLimitSentence,
  type DemoFeature,
  type DemoLimitCategory,
  type DemoUnavailableReason,
} from '@itsm/contracts/demo';
import type { PermissionSet } from './authz.js';
import { loadConfig, type PlatformConfig } from './config.js';
import { platformDb } from './db.js';
import { DomainError, ForbiddenError } from './errors.js';
import { logger } from './telemetry.js';

/**
 * The shared demo's platform core (SPEC v3 §4.4, §4.7; annex A3 §4, §7).
 *
 * Everything here is keyed on facts the database or the verified token owns,
 * never on anything a visitor sends: `tenant.kind` is fixed at insert and no
 * application role can change it, and the demo context exists only after the
 * API has verified a demo token against the live record. So a forged request
 * can at worst reach the demo tenant, and inside the demo tenant these rules
 * hold whatever the request says.
 */

/* ------------------------------------------------------------------ Errors */

/**
 * The demo was rebuilt (a new generation) since this token was minted, or the
 * token's tenant is no longer the live, active one. 401 so the BFF re-mints
 * once and resends once; a visitor never sees it.
 */
export class DemoResetError extends DomainError {
  readonly status = 401;
  readonly code = DEMO_PROBLEM_CODES.reset;
  constructor(message = 'the demo data was reset since this session began') {
    super(message);
  }

  override problemExtensions(): ProblemExtensions {
    return { demo: true };
  }
}

/**
 * The visit is over: the token is missing, expired, revoked or malformed, its
 * persona no longer matches, or the demo is switched off. The BFF deletes the
 * session and the visitor is offered "Continue the demo".
 */
export class DemoSessionEndedError extends DomainError {
  readonly status = 401;
  readonly code = DEMO_PROBLEM_CODES.sessionEnded;
  constructor(message: string = DEMO_COPY.sessionEnded) {
    super(message);
  }

  override problemExtensions(): ProblemExtensions {
    return { demo: true };
  }
}

/**
 * The demo cannot answer now, and why. Never a fail-open: a Redis error is
 * `store`, an operator pause is `paused`, no live generation yet is
 * `preparing`, a persona the build has not repaired yet is `persona`, and a
 * deployment whose demo tenant slug failed the boot interlock is
 * `misconfigured`.
 */
export class DemoUnavailableError extends DomainError {
  readonly status = 503;
  readonly code = DEMO_PROBLEM_CODES.unavailable;
  constructor(
    readonly reason: DemoUnavailableReason,
    message: string = DEMO_COPY.unavailable,
  ) {
    super(message);
  }

  override problemExtensions(): ProblemExtensions {
    return { demo: true, reason: this.reason };
  }
}

/**
 * A feature the shared demo turns off. The detail is the canonical sentence,
 * and `feature` lets a client word it itself from `@itsm/contracts/demo`.
 */
export class DemoDisabledError extends DomainError {
  readonly status = 403;
  readonly code = DEMO_PROBLEM_CODES.disabled;
  constructor(
    readonly feature: DemoFeature,
    message: string = demoDisabledSentence(feature),
  ) {
    super(message);
  }

  override problemExtensions(): ProblemExtensions {
    return { demo: true, feature: this.feature };
  }

  override problemTitle(): string {
    return 'Not available in the demo';
  }
}

/**
 * A visit, or every visitor of this generation together, has used up a
 * high-visibility action or the per-visit write budget. No `Retry-After`:
 * waiting does not help, a new visit or the nightly reset does.
 */
export class DemoLimitError extends DomainError {
  readonly status = 429;
  readonly code = DEMO_PROBLEM_CODES.limit;
  constructor(
    readonly category: DemoLimitCategory,
    readonly limit: number,
    message: string = demoLimitSentence(category, { limit }),
  ) {
    super(message);
  }

  override problemExtensions(): ProblemExtensions {
    return { demo: true, category: this.category, limit: this.limit };
  }
}

/**
 * The `demo_disabled` answer for a permission failure, when the permission is
 * one the demo strips (A3 §7.2). The API's error handler calls this for a
 * demo context, so a visitor who reaches a stripped action through the API
 * reads why it is off rather than "permission … is required". `null` when the
 * error is anything else, or names a permission the demo keeps.
 */
export function demoDisabledForForbidden(error: unknown): DemoDisabledError | null {
  if (!(error instanceof ForbiddenError)) return null;
  const feature = demoFeatureForPermission(error.permission);
  return feature ? new DemoDisabledError(feature) : null;
}

/* ------------------------------------------------------------------ Layer 1: the strip-list */

const STRIPPED = Symbol('itsm.demo.stripped');

function isKeptInDemo(key: string): boolean {
  return demoFeatureForPermission(key) === null;
}

/**
 * The permissions of an actor in a `kind = 'demo'` tenant: the actor's own
 * set, behaving in every method as if the stripped keys (`DEMO_STRIPPED_
 * PERMISSIONS`, and every `platform.` key) had never been granted (§4.7.1).
 *
 * Applied to every actor of a demo tenant, whatever its roles, so `/me`
 * omits the keys and the write controls hide themselves exactly as they do
 * for a real person without the role. The result never claims `isSystem`:
 * the authorisation checks short-circuit on that flag, and nothing in the
 * shared demo may be above the strip-list. Stripping twice is stripping once.
 */
export function stripDemoPermissions(set: PermissionSet): PermissionSet {
  if ((set as { [STRIPPED]?: true })[STRIPPED]) return set;
  const grantsFor = set.grantsFor?.bind(set);
  const stripped: PermissionSet = {
    has: (key, scope) => isKeptInDemo(key) && set.has(key, scope),
    scopeFor: (key) => (isKeptInDemo(key) ? set.scopeFor(key) : undefined),
    keys: () => set.keys().filter(isKeptInDemo),
    ...(grantsFor ? { grantsFor: (key: string) => (isKeptInDemo(key) ? grantsFor(key) : []) } : {}),
  };
  Object.defineProperty(stripped, STRIPPED, { value: true });
  return stripped;
}

/* ------------------------------------------------------------------ Layer 2: which tenants are the demo */

/**
 * The id scheduled jobs carry before they fan out to tenants (`jobs.ts`
 * `schedule`). It names no tenant, and it must not read as "the demo": a
 * scheduler's own work is never egress.
 */
const SCHEDULER_TENANT_ID = '00000000-0000-0000-0000-000000000000';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The most tenants whose kind one process remembers. */
export const DEMO_TENANT_CACHE_SIZE = 10_000;

/** Reads a tenant's `kind`, or `null` when no row has that id. */
export type TenantKindReader = (tenantId: string) => Promise<string | null>;

const readTenantKindFromDatabase: TenantKindReader = async (tenantId) => {
  // The column is a UUID: anything else names no row, and asking would be a
  // database error rather than an answer.
  if (!UUID.test(tenantId)) return null;
  // Soft-deleted rows count: a deleted demo generation is still the demo.
  const row = await platformDb().tenant.findUnique({ where: { id: tenantId }, select: { kind: true } });
  return row?.kind ?? null;
};

let readTenantKind: TenantKindReader = readTenantKindFromDatabase;
const kinds = new Map<string, boolean>();
const pending = new Map<string, Promise<boolean>>();

function remember(tenantId: string, demo: boolean): void {
  if (kinds.size >= DEMO_TENANT_CACHE_SIZE && !kinds.has(tenantId)) {
    // Least recently used first: `Map` keeps insertion order, and a hit
    // re-inserts its key at the end.
    const oldest = kinds.keys().next().value;
    if (oldest !== undefined) kinds.delete(oldest);
  }
  kinds.set(tenantId, demo);
}

/**
 * Whether a tenant is the shared demo, for the egress guards (§4.7.2), which
 * run in jobs and handlers where no request context says so.
 *
 * - A tenant's kind is immutable (a trigger refuses any change), so a
 *   positive or negative answer is cached for the life of the process, in a
 *   bounded LRU of `DEMO_TENANT_CACHE_SIZE`.
 * - A missing row is never cached, and reads as `true`: a tenant that does
 *   not exist (a purged generation, a typo) must send nothing, and a row
 *   created later is read afresh. A malformed id is a missing row.
 * - The scheduler's nil id reads as `false` without a query.
 * - A kind other than `standard` reads as `true`: anything unexpected
 *   suppresses egress rather than opening it.
 * - A database error throws, so the job retries rather than guessing.
 */
export async function isDemoTenant(tenantId: string): Promise<boolean> {
  if (typeof tenantId !== 'string' || tenantId.length === 0) return true;
  if (tenantId === SCHEDULER_TENANT_ID) return false;
  const known = kinds.get(tenantId);
  if (known !== undefined) {
    kinds.delete(tenantId);
    kinds.set(tenantId, known);
    return known;
  }

  // Concurrent egress for one tenant shares one read.
  const inflight = pending.get(tenantId);
  if (inflight) return inflight;
  const reader = readTenantKind;
  const lookup = (async () => {
    const kind = await reader(tenantId);
    if (kind === null) return true;
    const demo = kind !== 'standard';
    // A reader swapped out meanwhile (a test) must not have its answer
    // overwritten by the one it replaced.
    if (reader === readTenantKind) remember(tenantId, demo);
    return demo;
  })().finally(() => {
    if (pending.get(tenantId) === lookup) pending.delete(tenantId);
  });
  pending.set(tenantId, lookup);
  return lookup;
}

/**
 * Replaces how `isDemoTenant` reads a kind, and forgets every cached answer.
 * For unit tests of the egress guards, which have no database; `null`
 * restores the database reader.
 */
export function setTenantKindReader(reader: TenantKindReader | null): void {
  readTenantKind = reader ?? readTenantKindFromDatabase;
  clearDemoTenantCache();
}

/** Test helper: forget every cached tenant kind. */
export function clearDemoTenantCache(): void {
  kinds.clear();
  pending.clear();
}

/* ------------------------------------------------------------------ The boot interlock */

/** Why the interlock refused the configured demo tenant slug. */
export type DemoInterlockProblem = 'slug_pattern' | 'bootstrap_slug';

export type DemoInterlock =
  | { readonly mode: 'off'; readonly ready: false }
  | { readonly mode: 'on'; readonly ready: true; readonly slug: string }
  | { readonly mode: 'on'; readonly ready: false; readonly slug: string; readonly problem: DemoInterlockProblem };

type InterlockConfig = Pick<PlatformConfig, 'DEMO_MODE' | 'DEMO_TENANT_SLUG' | 'BOOTSTRAP_TENANT_SLUG'>;

/**
 * The boot interlock (§4.9, A3 §9.1): with the demo on, its tenant slug must
 * look like a demo slug (`demo` or `demo-…`) and must not be the operator's
 * own bootstrap tenant. Either mistake would point the demo's anonymous
 * visitors, and its nightly rebuild, at a real organisation.
 *
 * It refuses the demo, never the process: a failed interlock ends every demo
 * token (`demo_session_ended`), makes the status route answer 503
 * `misconfigured`, and makes the worker skip its demo jobs, while production
 * keeps running (the same rule as D24).
 */
export function demoInterlock(config: InterlockConfig): DemoInterlock {
  if (config.DEMO_MODE !== 'on') return { mode: 'off', ready: false };
  const slug = config.DEMO_TENANT_SLUG;
  if (!DEMO_TENANT_SLUG_PATTERN.test(slug)) return { mode: 'on', ready: false, slug, problem: 'slug_pattern' };
  const bootstrap = config.BOOTSTRAP_TENANT_SLUG?.trim().toLowerCase();
  if (bootstrap && bootstrap === slug.toLowerCase()) return { mode: 'on', ready: false, slug, problem: 'bootstrap_slug' };
  return { mode: 'on', ready: true, slug };
}

const reported = new WeakSet<object>();

/**
 * `demoInterlock` for the running process, with the error logged the first
 * time a configuration fails it — at boot when the service checks it there,
 * otherwise on the first demo request — so a misconfigured demo is loud
 * without being repeated on every request.
 */
export function checkDemoInterlock(config: InterlockConfig = loadConfig()): DemoInterlock {
  const result = demoInterlock(config);
  if (result.mode === 'on' && !result.ready && !reported.has(config)) {
    reported.add(config);
    logger.error('the demo is switched on but its tenant slug failed the boot interlock; demo sessions are refused until it is fixed', {
      problem: result.problem,
      slug: result.slug,
      expected:
        result.problem === 'slug_pattern'
          ? 'DEMO_TENANT_SLUG must be "demo" or start with "demo-" (lower-case letters, digits and hyphens)'
          : 'DEMO_TENANT_SLUG must differ from BOOTSTRAP_TENANT_SLUG',
    });
  }
  return result;
}

/* ------------------------------------------------------------------ Jobs */

/**
 * Options for every `demo.reset` and `demo.purge` job (Y-B3). One attempt, and
 * nothing retained: the ids are deterministic (`demo-reset-manual-g41-a2`), and
 * BullMQ silently drops an `add` whose id names a job it still holds, so a
 * kept failed job would swallow the next build. The ledger's attempt number in
 * the id is what makes a retry a new job. Spread it: `{ ...demoJobOptions, jobId }`.
 */
export const demoJobOptions = Object.freeze({ attempts: 1, removeOnComplete: true, removeOnFail: true } as const);
