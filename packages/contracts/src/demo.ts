/**
 * `@itsm/contracts/demo` — the one-click demo's shared vocabulary (ADR-0054).
 *
 * The persona table, the reset clock, the Redis key names, the record shapes,
 * the lockdown lists, the caps and the sentences visitors read. One file,
 * because every one of them is read by more than one process — each app's
 * BFF mints from the persona table, the API verifies against the same record
 * shapes, the worker writes the records and the site and the frames print the
 * same sentences — and two copies of a rule like "the portal mints Emma only"
 * would disagree the first time either changed.
 *
 * It is zod-free and has no imports at all, on purpose. The demo bar, the
 * countdown and the `/demo` pages run in the browser, and the contracts root
 * carries every schema the API has: a page that wanted a persona's name used
 * to download zod with it (Y-B2). The strict schemas that parse these records
 * live beside it in `demo-schemas.ts` (`@itsm/contracts/demo/schemas`), which
 * only server code imports. `__tests__/client-safe.test.ts` keeps it that way.
 *
 * Nothing here reads `process.env` or a Node API: defaults that a deployment
 * may change (the cooldown, the write budgets) belong to the platform and BFF
 * configuration, and are passed in where they matter.
 *
 * Every module-level table is built by calls marked `#__PURE__`, so a
 * bundle that imports one name (the areas map's persona lookup, say) does
 * not keep the rest: `Object.freeze` is otherwise a call a minifier must
 * assume has side effects (WP-42b measured +7 kB on five admin routes).
 */

/* ------------------------------------------------------------------ Areas and personas */

/** The three product areas a demo persona can sign in to. Equal to `AreaId` in `./areas.ts`. */
export type DemoArea = 'portal' | 'workbench' | 'admin';
export type DemoPersonaKey = 'employee' | 'agent' | 'admin';
export type DemoRole = 'requester' | 'agent' | 'team_lead' | 'service_owner' | 'administrator';

export const DEMO_AREAS: readonly DemoArea[] = /*#__PURE__*/ Object.freeze(['portal', 'workbench', 'admin'] as const);

export interface DemoPersona {
  readonly key: DemoPersonaKey;
  /** The landing page's role button (D1). */
  readonly button: 'Employee' | 'Agent' | 'Admin';
  /** The only app that mints this persona (D11). */
  readonly area: DemoArea;
  readonly name: string;
  readonly title: string;
  /** An RFC 2606 domain, so no message to a persona can ever be delivered. */
  readonly email: string;
  readonly initials: string;
  readonly site: string;
  /** What the generator grants and the worker's check repairs. */
  readonly roles: readonly DemoRole[];
  /** Team membership the roles need: `team_lead` reads analytics at team scope only. */
  readonly team?: { readonly key: string; readonly lead: boolean };
}

/** The fictional company every demo generation is built for (D16). */
export const DEMO_COMPANY = /*#__PURE__*/ Object.freeze({
  name: 'Northwind Traders (UK)',
  emailDomain: 'northwind.example',
  plan: 'professional',
  vendorLine: 'Powered by VNE Technologies',
} as const);

function frozenPersona(value: DemoPersona): DemoPersona {
  return /*#__PURE__*/ Object.freeze({
    ...value,
    roles: /*#__PURE__*/ Object.freeze([...value.roles]),
    ...(value.team ? { team: /*#__PURE__*/ Object.freeze({ ...value.team }) } : {}),
  });
}

/**
 * The persona table: the single source for names, titles, areas, the mint
 * allow-list and the landing's role buttons. Frozen, because client code
 * receives the same objects and a mutation would change every later reader.
 */
export const DEMO_PERSONAS: readonly DemoPersona[] = /*#__PURE__*/ Object.freeze([
  /*#__PURE__*/ frozenPersona({
    key: 'employee',
    button: 'Employee',
    area: 'portal',
    name: 'Emma Clarke',
    title: 'Finance Manager',
    email: 'emma.clarke@northwind.example',
    initials: 'EC',
    site: 'London HQ',
    roles: ['requester'],
  }),
  /*#__PURE__*/ frozenPersona({
    key: 'agent',
    button: 'Agent',
    area: 'workbench',
    name: 'Alex Morgan',
    title: 'Service Desk team lead',
    email: 'alex.morgan@northwind.example',
    initials: 'AM',
    site: 'London HQ',
    roles: ['agent', 'team_lead'],
    team: { key: 'service-desk', lead: true },
  }),
  /*#__PURE__*/ frozenPersona({
    key: 'admin',
    button: 'Admin',
    area: 'admin',
    name: 'Jordan Lee',
    title: 'IT Service Manager',
    email: 'jordan.lee@northwind.example',
    initials: 'JL',
    site: 'London HQ',
    roles: ['administrator', 'service_owner'],
  }),
]);

// A Map rather than an object lookup: `demoPersona('toString')` must be null,
// and a key that arrives from a form or a cookie is exactly that kind of input.
const PERSONAS_BY_KEY: ReadonlyMap<string, DemoPersona> = /*#__PURE__*/ new Map(/*#__PURE__*/ DEMO_PERSONAS.map((p) => [p.key, p]));

/** Derived from the table, never typed twice; a test asserts it is a bijection. */
export const DEMO_PERSONA_FOR_AREA: Readonly<Record<DemoArea, DemoPersonaKey>> = /*#__PURE__*/ Object.freeze(
  /*#__PURE__*/ Object.fromEntries(/*#__PURE__*/ DEMO_PERSONAS.map((p) => [p.area, p.key])) as Record<DemoArea, DemoPersonaKey>,
);

export function isDemoArea(value: unknown): value is DemoArea {
  return typeof value === 'string' && (DEMO_AREAS as readonly string[]).includes(value);
}

export function isDemoPersonaKey(value: unknown): value is DemoPersonaKey {
  return typeof value === 'string' && PERSONAS_BY_KEY.has(value);
}

/** The persona for a key, or `null` for anything that is not in the table. */
export function demoPersona(key: unknown): DemoPersona | null {
  return typeof key === 'string' ? (PERSONAS_BY_KEY.get(key) ?? null) : null;
}

export function demoPersonaForArea(area: DemoArea): DemoPersona {
  const found = PERSONAS_BY_KEY.get(DEMO_PERSONA_FOR_AREA[area]);
  if (!found) throw new RangeError(`no demo persona for area "${String(area)}"`);
  return found;
}

/**
 * The mint allow-list is the table: an app mints exactly its own area's
 * persona. The Service Desk can never mint the administrator, whatever the
 * form posted (D11).
 */
export function mayMint(app: DemoArea, persona: unknown): persona is DemoPersonaKey {
  return isDemoArea(app) && isDemoPersonaKey(persona) && DEMO_PERSONA_FOR_AREA[app] === persona;
}

/* ------------------------------------------------------------------ The reset clock */

/**
 * The demo resets at midnight UK time (D12). Everything that counts down to it
 * — the bar, the re-entry cookie's lifetime, the API status, the worker's
 * "is a new day due" check — calls the functions below, so the countdown a
 * visitor sees and the build the worker starts agree to the second, through
 * both daylight-saving changes.
 */
export const DEMO_RESET = /*#__PURE__*/ Object.freeze({ timeZone: 'Europe/London', hour: 0, label: '00:00 UK time' } as const);

interface WallClock {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

let resetZoneFormat: Intl.DateTimeFormat | undefined;

function wallClock(ms: number): WallClock {
  if (!Number.isFinite(ms)) throw new RangeError(`not a time: ${String(ms)}`);
  // Built once: constructing an Intl formatter costs far more than using one.
  resetZoneFormat ??= new Intl.DateTimeFormat('en-GB', {
    timeZone: DEMO_RESET.timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts: Record<string, number> = {};
  for (const part of resetZoneFormat.formatToParts(ms)) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  return {
    year: parts.year ?? 0,
    month: parts.month ?? 1,
    day: parts.day ?? 1,
    hour: parts.hour ?? 0,
    minute: parts.minute ?? 0,
    second: parts.second ?? 0,
  };
}

/** How far the reset zone's wall clock is ahead of UTC at an instant. */
function zoneOffsetMs(ms: number): number {
  const wall = wallClock(ms);
  const wallAsUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  return wallAsUtc - Math.floor(ms / 1000) * 1000;
}

/**
 * The instant at which the reset zone's wall clock reads the given local time.
 * Two passes, because the offset at the guess can differ from the offset at
 * the answer when a change lies between them. Midnight in London never falls
 * in a daylight-saving gap (the UK changes at 01:00 UTC), so the answer is
 * always unique for the reset hour.
 */
function zonedInstant(year: number, month: number, day: number, hour: number): number {
  const guess = Date.UTC(year, month - 1, day, hour);
  return guess - zoneOffsetMs(guess - zoneOffsetMs(guess));
}

function resetOn(year: number, month: number, day: number, shiftDays: number): number {
  // Calendar arithmetic in UTC, where every day has 24 hours.
  const date = new Date(Date.UTC(year, month - 1, day + shiftDays));
  return zonedInstant(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), DEMO_RESET.hour);
}

/** The reset that started the current demo day (at or before `nowMs`). */
export function previousResetAt(nowMs: number): number {
  const wall = wallClock(nowMs);
  const today = resetOn(wall.year, wall.month, wall.day, 0);
  return today <= nowMs ? today : resetOn(wall.year, wall.month, wall.day, -1);
}

/** The next reset strictly after `nowMs`. */
export function nextResetAt(nowMs: number): number {
  const wall = wallClock(nowMs);
  const today = resetOn(wall.year, wall.month, wall.day, 0);
  return today > nowMs ? today : resetOn(wall.year, wall.month, wall.day, 1);
}

/** Length of the current demo day: 24 h, or 25 h and 23 h on the change days. */
export function periodMs(nowMs: number): number {
  return nextResetAt(nowMs) - previousResetAt(nowMs);
}

/**
 * Whole seconds until the next reset, rounded down: the re-entry cookie's
 * `Max-Age` comes from this, and a cookie must never outlive the day it names.
 */
export function secondsUntilNextReset(nowMs: number): number {
  return Math.max(0, Math.floor((nextResetAt(nowMs) - nowMs) / 1000));
}

/** The UK calendar date, `YYYY-MM-DD`; it flips at midnight in London, not UTC. */
export function ukDateKey(nowMs: number): string {
  const wall = wallClock(nowMs);
  return `${String(wall.year).padStart(4, '0')}-${String(wall.month).padStart(2, '0')}-${String(wall.day).padStart(2, '0')}`;
}

/* ------------------------------------------------------------------ Tokens */

/**
 * A demo token is opaque: a prefix and 32 random bytes in base64url. The API
 * checks the shape before it hashes anything, so raw input never reaches a
 * Redis key (§4.4 step 2).
 */
export const DEMO_TOKEN_PREFIX = 'itsmdemo_';
export const DEMO_TOKEN_PATTERN = /^itsmdemo_[A-Za-z0-9_-]{43}$/;

export function isDemoTokenShape(value: unknown): value is string {
  return typeof value === 'string' && DEMO_TOKEN_PATTERN.test(value);
}

/** One visit's id: `demo-` and a UUID, stable across re-mints. */
export const DEMO_SID_PATTERN = /^demo-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A salted IP bucket (`ipBucket` in the BFF): 16 hex, or `unknown` with no usable address. */
export const DEMO_IP_BUCKET_PATTERN = /^(?:[0-9a-f]{16}|unknown)$/;

/** The token's SHA-256, the only form in which it appears in a key name. */
export const DEMO_TOKEN_HASH_PATTERN = /^[0-9a-f]{64}$/;

/**
 * The live demo tenant's slug. The boot interlock refuses any other shape, so
 * a misconfigured `DEMO_TENANT_SLUG` can never point the demo at a customer.
 */
export const DEMO_TENANT_SLUG_PATTERN = /^demo(-[a-z0-9-]+)?$/;

/* ------------------------------------------------------------------ Redis keys */

/** A rate-limit window: `m:<minute index>` or `h:<hour index>` since the epoch. */
export type DemoMinuteWindow = `m:${number}`;
export type DemoHourWindow = `h:${number}`;
export type DemoWindow = DemoMinuteWindow | DemoHourWindow;

export function demoWindow(unit: 'm', nowMs: number): DemoMinuteWindow;
export function demoWindow(unit: 'h', nowMs: number): DemoHourWindow;
export function demoWindow(unit: 'm' | 'h', nowMs: number): DemoWindow {
  return unit === 'm' ? `m:${Math.floor(nowMs / 60_000)}` : `h:${Math.floor(nowMs / 3_600_000)}`;
}

function checked(value: string, pattern: RegExp, what: string): string {
  // A key built from an unchecked value is a key the isolation scan cannot
  // classify — or, for a token, a raw secret in a key name. Refuse loudly.
  if (!pattern.test(value)) throw new RangeError(`not a demo ${what}: ${JSON.stringify(value.slice(0, 24))}`);
  return value;
}

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function capCategory(category: DemoCapCategory): DemoCapCategory {
  if (!isDemoCapCategory(category)) throw new RangeError(`not a demo cap category: ${JSON.stringify(String(category))}`);
  return category;
}
const GENERATION_PATTERN = /^[1-9]\d*$/;

/**
 * Every Redis key the demo writes (§4.2), as builders, so no process spells a
 * key by hand. The `bff:<app>:rl:login:…` limiter is deliberately not here: it
 * runs in every mode and is not demo data (RV3), so `isDemoKey` must not
 * excuse it from the isolation scan.
 */
export const DEMO_KEYS = /*#__PURE__*/ Object.freeze({
  live: 'demo:live',
  paused: 'demo:paused',
  build: 'demo:build',
  active: 'demo:active',
  /** A pub/sub channel, not a stored key. */
  events: 'demo:events',
  resetLock: 'demo:reset:lock',
  resetCooldown: 'demo:reset:cooldown',
  resetRequested: 'demo:reset:requested',
  resetBackoff: 'demo:reset:backoff',
  token: (tokenHash: string) => `demo:tok:${checked(tokenHash, DEMO_TOKEN_HASH_PATTERN, 'token hash')}`,
  activeForBucket: (ipb: string) => `demo:active:ipb:${checked(ipb, DEMO_IP_BUCKET_PATTERN, 'IP bucket')}`,
  salt: (dateKey: string) => `demo:salt:${checked(dateKey, DATE_KEY_PATTERN, 'date key')}`,
  mintPerBucket: (app: DemoArea, persona: DemoPersonaKey, ipb: string, window: DemoWindow) =>
    `demo:rl:mint:${app}:${persona}:${checked(ipb, DEMO_IP_BUCKET_PATTERN, 'IP bucket')}:${window}`,
  mintAll: (window: DemoWindow) => `demo:rl:mint:all:${window}`,
  mintTop: (window: DemoWindow) => `demo:rl:mint:top:${window}`,
  remint: (sid: string, window: DemoHourWindow) => `demo:rl:remint:${checked(sid, DEMO_SID_PATTERN, 'visit id')}:${window}`,
  writesPerVisit: (sid: string, window: DemoMinuteWindow) => `demo:wb:${checked(sid, DEMO_SID_PATTERN, 'visit id')}:${window}`,
  writesPerVisitTotal: (sid: string) => `demo:wb:${checked(sid, DEMO_SID_PATTERN, 'visit id')}:total`,
  writesPerBucket: (ipb: string, window: DemoHourWindow) => `demo:wb:ip:${checked(ipb, DEMO_IP_BUCKET_PATTERN, 'IP bucket')}:${window}`,
  writesAll: (window: DemoHourWindow) => `demo:wb:all:${window}`,
  writesTop: (window: DemoHourWindow) => `demo:wb:top:${window}`,
  readsPerBucket: (ipb: string, window: DemoMinuteWindow) => `demo:rb:ip:${checked(ipb, DEMO_IP_BUCKET_PATTERN, 'IP bucket')}:${window}`,
  capPerVisit: (generation: number, category: DemoCapCategory, sid: string) =>
    `demo:cap:${checked(String(generation), GENERATION_PATTERN, 'generation')}:${capCategory(category)}:${checked(sid, DEMO_SID_PATTERN, 'visit id')}`,
  capAll: (generation: number, category: DemoCapCategory) =>
    `demo:cap:${checked(String(generation), GENERATION_PATTERN, 'generation')}:${capCategory(category)}:all`,
});

/* `ops:demo` is the operator surface for a failing build (Y-M7). Like
   `ops:config-warnings` it is not a `demo:` key: it holds no visitor data and
   is read by the deployment-warnings route. */
export const DEMO_OPS_KEY = 'ops:demo';
export const DEMO_BUILD_FAILING_FIELD = 'demo_build_failing';

function escapeForPattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The patterns the key builders produce, used by the isolation scan (Y-B4).
 * Exact shapes, not a `demo:` prefix: a key the demo did not mean to write —
 * a token key with the raw token in it, a cap for a category nobody declared
 * — fails the scan instead of being waved through.
 */
function demoKeyPatterns(): readonly RegExp[] {
  const ipb = '(?:[0-9a-f]{16}|unknown)';
  const sid = 'demo-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  const app = `(?:${DEMO_AREAS.join('|')})`;
  const personaKey = `(?:${/*#__PURE__*/ DEMO_PERSONAS.map((p) => p.key).join('|')})`;
  const category = `(?:${DEMO_CAP_CATEGORIES.map(escapeForPattern).join('|')})`;
  const window = '(?:m|h):\\d+';
  const sources = [
    'demo:live',
    'demo:paused',
    'demo:build',
    'demo:active',
    'demo:events',
    'demo:reset:(?:lock|cooldown|requested|backoff)',
    'demo:tok:[0-9a-f]{64}',
    `demo:active:ipb:${ipb}`,
    'demo:salt:\\d{4}-\\d{2}-\\d{2}',
    `demo:rl:mint:${app}:${personaKey}:${ipb}:${window}`,
    `demo:rl:mint:(?:all|top):${window}`,
    `demo:rl:remint:${sid}:h:\\d+`,
    `demo:wb:${sid}:(?:m:\\d+|total)`,
    `demo:wb:ip:${ipb}:h:\\d+`,
    'demo:wb:(?:all|top):h:\\d+',
    `demo:rb:ip:${ipb}:m:\\d+`,
    `demo:cap:[1-9]\\d*:${category}:(?:${sid}|all)`,
  ];
  return /*#__PURE__*/ Object.freeze(sources.map((source) => new RegExp(`^${source}$`)));
}

let keyPatterns: readonly RegExp[] | undefined;

/** The exact key patterns of `DEMO_KEYS`, for the isolation scan and its tests. */
export function demoKeyPatternList(): readonly RegExp[] {
  keyPatterns ??= demoKeyPatterns();
  return keyPatterns;
}

/** True when `key` is one the demo writes, by exact shape (Y-B4). */
export function isDemoKey(key: unknown): boolean {
  return typeof key === 'string' && demoKeyPatternList().some((pattern) => pattern.test(key));
}

/* ------------------------------------------------------------------ Records */

export type DemoResetReason = 'initial' | 'scheduled' | 'catch-up' | 'manual' | 'operator';
export const DEMO_RESET_REASONS: readonly DemoResetReason[] = /*#__PURE__*/ Object.freeze([
  'initial',
  'scheduled',
  'catch-up',
  'manual',
  'operator',
] as const);

/** `demo:live`: written in one `SET` by the swap, after its transaction commits. */
export interface DemoLiveRecord {
  readonly v: 1;
  readonly tenantId: string;
  readonly slug: string;
  /** Strictly increasing; equals `tenant.settings.demo.generation`. */
  readonly generation: number;
  readonly builtAt: number;
  /** T0 of the generation's story, epoch ms. */
  readonly anchor: number;
  readonly lastResetAt: number;
  readonly lastResetReason: DemoResetReason;
  readonly personas: Readonly<Record<DemoPersonaKey, { readonly userId: string }>>;
  /** The agent persona's teams, so "Open in Service Desk" is offered only where Alex can open it (X-B2). */
  readonly agentTeamIds: readonly string[];
}

/** `demo:tok:<sha256>`: one minted token. Minted and re-minted by the BFF's Lua only. */
export interface DemoTokenRecord {
  readonly v: 1;
  readonly tenantId: string;
  readonly userId: string;
  readonly persona: DemoPersonaKey;
  readonly app: DemoArea;
  /** `demo-` + UUID, stable for the whole visit across re-mints. */
  readonly sid: string;
  readonly gen: number;
  readonly iat: number;
  readonly exp: number;
  /** The salted IP bucket at mint time; never an address. */
  readonly ipb: string;
}

export type DemoEvent =
  | {
      readonly type: 'swapped';
      readonly generation: number;
      readonly previousGeneration: number | null;
      readonly previousTenantId: string | null;
      readonly reason: DemoResetReason;
      readonly at: number;
    }
  | { readonly type: 'build-started' | 'build-failed'; readonly at: number; readonly reason: string }
  | { readonly type: 'paused' | 'resumed'; readonly at: number };

/** The build's steps, in order; `stepIndex` is the position in this list, from 1. */
export const DEMO_BUILD_STEPS = /*#__PURE__*/ Object.freeze([
  'prepare',
  'company',
  'people',
  'catalogue',
  'tickets',
  'service-levels',
  'history',
  'reports',
  'search',
  'checks',
  'switching',
] as const);
export type DemoBuildStep = (typeof DEMO_BUILD_STEPS)[number];

/** `demo:build`: present while a generation is being built (`EX 900`, refreshed per step). */
export interface DemoBuildState {
  readonly v: 1;
  readonly state: 'building';
  readonly generation: number;
  readonly reason: DemoResetReason;
  readonly startedAt: number;
  readonly step: DemoBuildStep;
  readonly stepIndex: number;
  readonly steps: 11;
  /** Median of the last five good builds; 180 with no history. Visitors see only this. */
  readonly etaSec: number;
}

/** `demo:reset:backoff`: after a failed build, how long until the worker tries again. */
export interface DemoBackoff {
  readonly v: 1;
  readonly failures: number;
  readonly retryAt: number;
  readonly step: DemoBuildStep;
}

/** `demo:reset:cooldown`: written at every swap; no reset for the next 30 minutes (D12, D28). */
export interface DemoCooldown {
  readonly at: number;
  readonly generation: number;
  readonly reason: DemoResetReason;
}

/** `demo:paused`: the operator's switch (`pnpm platform demo pause`). */
export interface DemoPausedRecord {
  readonly by: 'operator';
  readonly at: number;
  readonly reason: string;
}

/** `demo:reset:requested`: one visitor reset in flight (`SET NX EX 300`). */
export interface DemoResetRequest {
  readonly at: number;
  readonly sidHash: string;
  readonly generation: number;
}

/* ------------------------------------------------------------------ Status */

export type DemoState = 'ready' | 'building' | 'preparing' | 'paused';

export interface DemoStatusPersona {
  readonly key: DemoPersonaKey;
  readonly button: DemoPersona['button'];
  readonly name: string;
  readonly title: string;
  readonly area: DemoArea;
}

/**
 * What `GET /api/demo/v1/status` and each app's `/api/demo/status` answer.
 * Public, so it names no tenant, user or token: the persona strings and the
 * clock are the whole of it.
 */
export interface DemoStatus {
  readonly v: 1;
  readonly demo: true;
  readonly state: DemoState;
  readonly serverNow: number;
  readonly resetTimeZone: string;
  readonly resetLabel: string;
  readonly resetHour: number;
  readonly nextResetAt: number;
  readonly periodMs: number;
  readonly generation: number | null;
  readonly lastResetAt: number | null;
  readonly lastResetReason: DemoResetReason | null;
  readonly build: { readonly startedAt: number; readonly etaSec: number } | null;
  /** When a visitor may reset again: the end of the cooldown or of the backoff, whichever is later. */
  readonly manualResetAvailableAt: number | null;
  readonly resetBlocked: boolean;
  readonly cooldownSeconds: number;
  /** Uploads are always off in the demo (RV4); the field lets a page say so without asking. */
  readonly uploads: false;
  readonly personas: readonly DemoStatusPersona[];
  readonly company: { readonly name: string; readonly fictional: true };
}

/** The records `computeDemoStatus` reads, already parsed by the caller (`MGET` + the strict schemas). */
export interface DemoStatusRecords {
  readonly live: DemoLiveRecord | null;
  readonly build: DemoBuildState | null;
  readonly cooldown: DemoCooldown | null;
  /** True whenever `demo:paused` exists, parsed or not: an unreadable pause is still a pause. */
  readonly paused: boolean;
  readonly backoff: DemoBackoff | null;
}

/** D12's cooldown after every reset; deployments may change it (`DEMO_RESET_COOLDOWN_SECONDS`). */
export const DEMO_RESET_COOLDOWN_SECONDS = 1800;

const STATUS_PERSONAS: readonly DemoStatusPersona[] = /*#__PURE__*/ Object.freeze(
  /*#__PURE__*/ DEMO_PERSONAS.map((p) => /*#__PURE__*/ Object.freeze({ key: p.key, button: p.button, name: p.name, title: p.title, area: p.area })),
);

/**
 * The demo's public state, from the records alone (A3 §6.4). Pure, so the API
 * route, every BFF route and the tests compute the same answer, and so the
 * API and the apps can never disagree about whether a reset is allowed.
 */
export function computeDemoStatus(
  records: DemoStatusRecords,
  nowMs: number,
  options: { readonly cooldownSeconds?: number } = {},
): DemoStatus {
  const cooldownSeconds = options.cooldownSeconds ?? DEMO_RESET_COOLDOWN_SECONDS;
  const { live, build, cooldown, paused, backoff } = records;

  const state: DemoState = paused ? 'paused' : !live && !build ? 'preparing' : build ? 'building' : 'ready';

  const cooldownEndsAt = cooldown ? cooldown.at + cooldownSeconds * 1000 : null;
  const coolingDown = cooldownEndsAt !== null && cooldownEndsAt > nowMs;
  const backingOff = backoff !== null && backoff.retryAt > nowMs;

  const availableAt = [coolingDown ? cooldownEndsAt : null, backingOff ? backoff.retryAt : null].filter(
    (value): value is number => value !== null,
  );

  return {
    v: 1,
    demo: true,
    state,
    serverNow: nowMs,
    resetTimeZone: DEMO_RESET.timeZone,
    resetLabel: DEMO_RESET.label,
    resetHour: DEMO_RESET.hour,
    nextResetAt: nextResetAt(nowMs),
    periodMs: periodMs(nowMs),
    generation: live?.generation ?? null,
    lastResetAt: live?.lastResetAt ?? null,
    lastResetReason: live?.lastResetReason ?? null,
    build: build ? { startedAt: build.startedAt, etaSec: build.etaSec } : null,
    manualResetAvailableAt: availableAt.length > 0 ? Math.max(...availableAt) : null,
    resetBlocked: state !== 'ready' || coolingDown || backingOff,
    cooldownSeconds,
    uploads: false,
    personas: STATUS_PERSONAS,
    company: { name: DEMO_COMPANY.name, fictional: true },
  };
}

/* ------------------------------------------------------------------ Lockdown: the strip-list */

/**
 * Everything the shared demo turns off, by feature (§4.7.1). The first group
 * is enforced by stripping permissions from every actor of a `kind = 'demo'`
 * tenant; the last five are raised by guards that have no permission to strip
 * (a live AI call, the personas' own accounts, the seeded dashboards, the
 * story's hero tickets, the locked settings).
 */
export const DEMO_FEATURES = /*#__PURE__*/ Object.freeze([
  'integrations',
  'channels',
  'sso',
  'api-keys',
  'roles',
  'sessions',
  'organisation',
  'modules',
  'feature-switches',
  'import',
  'discovery',
  'analytics-admin',
  'audit-export',
  'ai-settings',
  'status-page',
  'uploads',
  'notifications',
  'platform',
  'ai',
  'personas',
  'shared-dashboards',
  'story',
  'settings',
] as const);
export type DemoFeature = (typeof DEMO_FEATURES)[number];

/** What each feature is called in "This is a shared demo, so ___ is turned off." */
const FEATURE_PHRASES: Readonly<Record<DemoFeature, string>> = /*#__PURE__*/ Object.freeze({
  integrations: 'connecting to other systems',
  channels: 'connecting mailboxes and chat channels',
  sso: 'single sign-on and user provisioning',
  'api-keys': 'creating API keys',
  roles: "changing people's roles",
  sessions: 'managing signed-in devices',
  organisation: 'changing the organisation structure',
  modules: 'switching modules on or off',
  'feature-switches': 'changing feature switches',
  import: 'importing data',
  discovery: 'discovery against real systems',
  'analytics-admin': 'rebuilding analytics',
  'audit-export': 'exporting the audit log',
  'ai-settings': 'changing AI settings',
  'status-page': 'editing the public status page',
  uploads: 'uploading files',
  notifications: 'changing notification wording',
  platform: 'this administrative action',
  ai: 'calling a live AI model',
  personas: "changing the demo's own accounts",
  'shared-dashboards': 'changing the shared demo dashboards',
  story: "changing the demo's story tickets",
  settings: 'changing this setting in the shared demo',
});

export function isDemoFeature(value: unknown): value is DemoFeature {
  return typeof value === 'string' && (DEMO_FEATURES as readonly string[]).includes(value);
}

export function demoFeaturePhrase(feature: DemoFeature): string {
  return FEATURE_PHRASES[feature];
}

/**
 * The sentence a demo-disabled control or a `demo_disabled` problem shows. A
 * feature this build does not know (a newer API) still gets a true sentence
 * rather than an empty one.
 */
export function demoDisabledSentence(feature: DemoFeature | (string & {}) | null | undefined): string {
  const phrase = isDemoFeature(feature) ? FEATURE_PHRASES[feature] : 'this action';
  return `This is a shared demo, so ${phrase} is turned off. Everything else works as in the full product.`;
}

/**
 * Permission keys stripped from every actor in a demo tenant, with the feature
 * each one belongs to. Every key is checked against the module manifests in a
 * test, so a renamed permission fails the build instead of silently coming
 * back into the shared demo.
 */
export const DEMO_STRIPPED_PERMISSIONS = /*#__PURE__*/ Object.freeze({
  'integration.credential.manage': 'integrations',
  'integration.action.manage': 'integrations',
  'integration.action.replay': 'integrations',
  'webhook.manage': 'integrations',
  'channel.account.manage': 'channels',
  'channel.identity.manage': 'channels',
  'identity.scim.manage': 'sso',
  'identity.apikey.manage': 'api-keys',
  'identity.role.manage': 'roles',
  'identity.session.manage': 'sessions',
  'identity.org.manage': 'organisation',
  'tenant.org.manage': 'organisation',
  'admin.module.manage': 'modules',
  'admin.flag.manage': 'feature-switches',
  'migration.manage': 'import',
  'discovery.manage': 'discovery',
  'analytics.admin': 'analytics-admin',
  'audit.export': 'audit-export',
  'ai.manage': 'ai-settings',
  'statuspage.manage': 'status-page',
  'ticket.attachment.add': 'uploads',
  'notification.template.manage': 'notifications',
} as const satisfies Readonly<Record<string, DemoFeature>>);
export type DemoStrippedPermission = keyof typeof DEMO_STRIPPED_PERMISSIONS;

/** Prefixes stripped whole: no platform operator action is ever available in the demo tenant. */
export const DEMO_STRIPPED_PREFIXES = /*#__PURE__*/ Object.freeze({
  'platform.': 'platform',
} as const satisfies Readonly<Record<string, DemoFeature>>);

/** The feature a permission belongs to when the demo strips it, or `null` when the demo keeps it. */
export function demoFeatureForPermission(key: string): DemoFeature | null {
  if (typeof key !== 'string') return null;
  if (Object.hasOwn(DEMO_STRIPPED_PERMISSIONS, key)) {
    return DEMO_STRIPPED_PERMISSIONS[key as DemoStrippedPermission];
  }
  for (const [prefix, feature] of Object.entries(DEMO_STRIPPED_PREFIXES)) {
    if (key.startsWith(prefix)) return feature;
  }
  return null;
}

/**
 * Settings no visitor may change in the shared demo (Y-M12): each one would
 * make every later visitor's numbers or behaviour dishonest until the reset
 * (the SLA target behind every gauge, auto-close, the workflow limits). A
 * trailing `.*` matches the whole family; anything else is one exact key.
 * Other settings stay editable, within the `setting.change` cap.
 */
export const DEMO_LOCKED_SETTINGS = /*#__PURE__*/ Object.freeze([
  'sla.*',
  'ticket.autoClose.*',
  'workflow.*',
  'rules.*',
  'knowledge.requireApprovalToPublish',
  'workload.*',
  'notification.*',
  'channel.*',
  'auth.*',
  'ai.*',
] as const);

export function isDemoLockedSetting(key: string): boolean {
  if (typeof key !== 'string' || key.length === 0) return false;
  return DEMO_LOCKED_SETTINGS.some((pattern) =>
    pattern.endsWith('.*') ? key.startsWith(pattern.slice(0, -1)) : key === pattern,
  );
}

/* ------------------------------------------------------------------ Caps */

/**
 * The high-visibility actions a visit may take a few times only, and every
 * visitor together a few more times per generation (A3 §7.6 as amended by
 * §4.7.4). The API counts them; the UI words them.
 */
export const DEMO_CAP_CATEGORIES = /*#__PURE__*/ Object.freeze([
  'mi.declare',
  'mi.update',
  'mi.transition',
  'mi.review',
  'kb.publish',
  'kb.draft',
  'catalogue.change',
  'ticket.create',
  'user.create',
  'user.deactivate',
  'dashboard.change',
  'metric.change',
  'report.change',
  'report.run',
  'rule.change',
  'rule.test',
  'workflow.change',
  'sla.change',
  'approval-policy.change',
  'setting.change',
  'pack.install',
  'field.change',
  'problem.publish',
  'usage.change',
] as const);
export type DemoCapCategory = (typeof DEMO_CAP_CATEGORIES)[number];

/** Every `category` a `demo_limit` problem can carry: the caps, and the per-visit write budget. */
export type DemoLimitCategory = DemoCapCategory | 'writes';

export interface DemoCap {
  readonly perVisit: number;
  readonly perGeneration: number;
  /** Completes "each visit can ___", given the per-visit number. */
  readonly phrase: (perVisit: number) => string;
}

const COUNT_FORMAT = /*#__PURE__*/ new Intl.NumberFormat('en-GB');

function counted(n: number, one: string, many: string): string {
  return n === 1 ? `${one}` : `${COUNT_FORMAT.format(n)} ${many}`;
}

function cap(perVisit: number, perGeneration: number, phrase: (n: number) => string): DemoCap {
  return /*#__PURE__*/ Object.freeze({ perVisit, perGeneration, phrase });
}

export const DEMO_CAPS: Readonly<Record<DemoCapCategory, DemoCap>> = /*#__PURE__*/ Object.freeze({
  'mi.declare': /*#__PURE__*/ cap(1, 10, (n) => `declare ${counted(n, 'one major incident', 'major incidents')}`),
  'mi.update': /*#__PURE__*/ cap(10, 150, (n) => `post ${counted(n, 'one major-incident update', 'major-incident updates')}`),
  'mi.transition': /*#__PURE__*/ cap(3, 30, (n) => `change a major incident's state ${counted(n, 'once', 'times')}`),
  'mi.review': /*#__PURE__*/ cap(5, 50, (n) => `make ${counted(n, 'one change', 'changes')} to major-incident roles and reviews`),
  'kb.publish': /*#__PURE__*/ cap(3, 30, (n) => `publish, roll back or retire ${counted(n, 'one knowledge article', 'knowledge articles')}`),
  'kb.draft': /*#__PURE__*/ cap(10, 200, (n) => `write ${counted(n, 'one knowledge draft', 'knowledge drafts')}`),
  'catalogue.change': /*#__PURE__*/ cap(5, 50, (n) => `make ${counted(n, 'one change', 'changes')} to the service catalogue`),
  'ticket.create': /*#__PURE__*/ cap(25, 1500, (n) => `raise ${counted(n, 'one ticket', 'tickets')}`),
  'user.create': /*#__PURE__*/ cap(5, 50, (n) => `add ${counted(n, 'one person', 'people')}`),
  'user.deactivate': /*#__PURE__*/ cap(3, 30, (n) => `deactivate ${counted(n, 'one person', 'people')}`),
  'dashboard.change': /*#__PURE__*/ cap(5, 50, (n) => `make ${counted(n, 'one dashboard change', 'dashboard changes')}`),
  'metric.change': /*#__PURE__*/ cap(3, 30, (n) => `make ${counted(n, 'one change', 'changes')} to metric definitions`),
  'report.change': /*#__PURE__*/ cap(5, 50, (n) => `make ${counted(n, 'one change', 'changes')} to reports and their schedules`),
  'report.run': /*#__PURE__*/ cap(10, 200, (n) => `run ${counted(n, 'one report', 'reports')}`),
  'rule.change': /*#__PURE__*/ cap(5, 40, (n) => `make ${counted(n, 'one change', 'changes')} to business rules`),
  'rule.test': /*#__PURE__*/ cap(30, 600, (n) => `run ${counted(n, 'one rule test', 'rule tests')}`),
  'workflow.change': /*#__PURE__*/ cap(3, 20, (n) => `make ${counted(n, 'one change', 'changes')} to workflows`),
  'sla.change': /*#__PURE__*/ cap(3, 20, (n) => `make ${counted(n, 'one change', 'changes')} to service levels`),
  'approval-policy.change': /*#__PURE__*/ cap(3, 20, (n) => `make ${counted(n, 'one change', 'changes')} to approval policies`),
  'setting.change': /*#__PURE__*/ cap(5, 40, (n) => `change ${counted(n, 'one setting', 'settings')}`),
  'pack.install': /*#__PURE__*/ cap(1, 3, (n) => `install or upgrade ${counted(n, 'one pack', 'packs')}`),
  'field.change': /*#__PURE__*/ cap(5, 30, (n) => `make ${counted(n, 'one change', 'changes')} to ticket fields`),
  'problem.publish': /*#__PURE__*/ cap(3, 30, (n) => `publish or withdraw ${counted(n, 'one known error', 'known errors')}`),
  'usage.change': /*#__PURE__*/ cap(3, 20, (n) => `change usage warnings ${counted(n, 'once', 'times')}`),
});

export function isDemoCapCategory(value: unknown): value is DemoCapCategory {
  return typeof value === 'string' && Object.hasOwn(DEMO_CAPS, value);
}

/**
 * The sentence for a `demo_limit` problem. Always the per-visit figure: the
 * copy speaks to the visitor ("each visit can …"), even when it was the
 * generation's shared cap that ran out. Pass `limit` only for `writes`, whose
 * budget is deployment configuration (`DEMO_WRITES_PER_SESSION`).
 */
export function demoLimitSentence(
  category: DemoLimitCategory | (string & {}) | null | undefined,
  options: { readonly limit?: number } = {},
): string {
  let phrase: string;
  if (isDemoCapCategory(category)) {
    const entry = DEMO_CAPS[category];
    phrase = entry.phrase(entry.perVisit);
  } else if (category === 'writes') {
    const limit = options.limit;
    phrase =
      typeof limit === 'number' && Number.isInteger(limit) && limit > 0
        ? `make ${counted(limit, 'one change', 'changes')}`
        : 'only make a limited number of changes';
  } else {
    phrase = 'only make a few changes like this';
  }
  return `To keep this shared demo tidy for everyone, each visit can ${phrase}. You've reached that limit.`;
}

/* ------------------------------------------------------------------ Problems */

/** The `code` (last segment of the problem `type`) of each demo problem (§4.4). */
export const DEMO_PROBLEM_CODES = /*#__PURE__*/ Object.freeze({
  reset: 'demo_reset',
  sessionEnded: 'demo_session_ended',
  unavailable: 'demo_unavailable',
  disabled: 'demo_disabled',
  limit: 'demo_limit',
} as const);
export type DemoProblemCode = (typeof DEMO_PROBLEM_CODES)[keyof typeof DEMO_PROBLEM_CODES];

/** Why a `demo_unavailable` (503) was answered. */
export const DEMO_UNAVAILABLE_REASONS = /*#__PURE__*/ Object.freeze(['store', 'paused', 'preparing', 'persona', 'misconfigured'] as const);
export type DemoUnavailableReason = (typeof DEMO_UNAVAILABLE_REASONS)[number];

/* ------------------------------------------------------------------ Links */

/**
 * The one demo link shape: the area's `/demo` page, which decides whether to
 * mint (§4.5 P rows). Every role button, `/try` page, cross-area link and
 * signed-out link is built here, so no caller can link straight to a mint.
 */
export function demoEntryHref(origin: string, persona: DemoPersonaKey, redirectTo?: string): string {
  const query = new URLSearchParams({ persona, demo: '1' });
  if (redirectTo) query.set('redirectTo', redirectTo);
  return `${origin.replace(/\/+$/, '')}/demo?${query.toString()}`;
}

function samePath(path: string): string {
  // A same-origin path only; the BFF checks again (`safeRedirectTarget`), but a
  // link built here should never carry somewhere else in the first place.
  return path.startsWith('/') && !path.startsWith('//') && !path.includes('\\') ? path : '/';
}

/**
 * "Sign in again" for a session-ended screen. `demo` marks the request as the
 * demo client's (D22), so the BFF reopens the demo instead of sending a
 * visitor to an identity provider they have no account with.
 */
export function signInAgainHref(path: string, options: { readonly demo?: boolean } = {}): string {
  const query = new URLSearchParams({ redirectTo: samePath(typeof path === 'string' ? path : '/') });
  if (options.demo) query.set('demo', '1');
  return `/api/session/login?${query.toString()}`;
}

/** Browser storage keys of the reset notice; cleared with the rest of a visit's local data. */
export const DEMO_LOCAL_KEYS = /*#__PURE__*/ Object.freeze({
  lastGeneration: 'itsm-demo:last-gen',
  noticeSeen: 'itsm-demo:notice-seen',
} as const);

/* ------------------------------------------------------------------ The story */

/**
 * The hero tickets that must route to the `service-desk` team (R8, X-B2), so
 * every hop into the Service Desk lands on a ticket Alex can open. The
 * generator's tests and its S10 checks assert each one.
 */
export const DEMO_SD_HEROES = /*#__PURE__*/ Object.freeze([
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H8',
  'H9',
  'H10',
  'H11',
  'H12',
  'A1',
  'A2',
  'A3',
  'A4',
  'E1',
  'E3',
  'E4',
] as const);
export type DemoHeroKey = (typeof DEMO_SD_HEROES)[number];

/** Hero tickets carry `externalRef = demo:hero:<key>`; their title and description are guarded (`story`). */
export const DEMO_HERO_REF_PREFIX = 'demo:hero:';

export function demoHeroRef(key: string): string {
  return `${DEMO_HERO_REF_PREFIX}${key}`;
}

export function isDemoHeroRef(externalRef: unknown): boolean {
  return typeof externalRef === 'string' && externalRef.startsWith(DEMO_HERO_REF_PREFIX) && externalRef.length > DEMO_HERO_REF_PREFIX.length;
}

/**
 * The audit `reason` and actor of every configuration row a build writes
 * (X-M8), so the Command centre's "Recent changes" can show only what
 * visitors changed and the audit log can fold the build into one row.
 */
export const DEMO_BUILD_REASON = 'demo.build';
export const DEMO_BUILD_ACTOR = /*#__PURE__*/ Object.freeze({ type: 'system', id: 'demo-build' } as const);

/* ------------------------------------------------------------------ Copy */

/**
 * "about 4 minutes", rounded up, or "a few minutes" without an estimate. Every
 * sentence about a build's duration goes through this; none carries a figure
 * of its own (X13).
 */
export function demoEtaPhrase(etaSec: number | null | undefined): string {
  if (typeof etaSec !== 'number' || !Number.isFinite(etaSec) || etaSec <= 0) return 'a few minutes';
  const minutes = Math.ceil(etaSec / 60);
  return minutes === 1 ? 'about 1 minute' : `about ${COUNT_FORMAT.format(minutes)} minutes`;
}

const RESET_WHEN: Readonly<Record<Exclude<DemoResetReason, 'initial'>, string>> = /*#__PURE__*/ Object.freeze({
  scheduled: `at ${DEMO_RESET.label}`,
  'catch-up': 'overnight',
  manual: 'by a visitor',
  operator: 'by the operator',
});

/**
 * The in-view notice after a reset (§3.8). `fresh`: the page already shows the
 * new data; `stale`: a poll found a newer generation than the page. A first
 * generation has no "before", so it reads the same either way.
 */
export function demoResetNotice(variant: 'fresh' | 'stale', reason: DemoResetReason): string {
  if (reason === 'initial') return 'The demo has been prepared.';
  const when = RESET_WHEN[reason];
  return variant === 'fresh'
    ? `Demo data was reset ${when}. You're looking at the fresh data.`
    : `Demo data was reset ${when}. Reload to see the fresh data.`;
}

/** Shared demo sentences, in one wording everywhere (canonical copy register, §6.6). */
export const DEMO_COPY = /*#__PURE__*/ Object.freeze({
  resetsDaily: `Demo data resets every day at ${DEMO_RESET.label}.`,
  sharedData: "Changes are shared with other visitors until the nightly reset. Please don't enter real personal data.",
  fictional: `${DEMO_COMPANY.name} and its people are fictional.`,
  /** On one AI decision. */
  sample: 'Sample',
  /** On a banner or chip over aggregates. */
  sampleData: 'Sample data',
  unavailable: 'The demo is paused or being prepared. It will be back in a few minutes.',
  sessionEnded: 'Your demo session ended',
  continueDemo: 'Continue the demo',
  resettingNow: (etaSec: number | null | undefined) => `Resetting now… ${demoEtaPhrase(etaSec)}`,
  resetStarted: (etaSec: number | null | undefined) =>
    `Resetting the demo data. This takes ${demoEtaPhrase(etaSec)}; you can keep exploring.`,
  resetRunning: 'A reset is already running.',
  resetReloading: 'Your fresh demo is ready — reloading…',
  resetBlocked: 'Resetting is paused on this demo at the moment.',
  resetCooldown: (minutesAgo: number, minutesLeft: number) =>
    `The demo was reset ${minutesAgo} min ago. To keep fresh data safe for presenters, it can be reset again in ${minutesLeft} min.`,
  resetConfirm: /*#__PURE__*/ Object.freeze({
    title: 'Reset demo data?',
    body: "This restores the original demo data for everyone using it. Changes made by you and other visitors since the last reset are discarded. This can't be undone.",
    note: 'Nobody can reset it again for 30 minutes afterwards.',
    confirm: 'Reset demo data',
  }),
  resetOnlyInDemo: 'Only a demo session can reset the demo data.',
});
