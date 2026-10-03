import { randomBytes, randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEMO_CAPS,
  DEMO_CAP_CATEGORIES,
  DEMO_FEATURES,
  DEMO_HERO_REF_PREFIX,
  DEMO_KEYS,
  demoDisabledSentence,
  demoLimitSentence,
  demoWindow,
  isDemoKey,
  type DemoCapCategory,
  type DemoFeature,
  type DemoPersonaKey,
} from '@itsm/contracts/demo';
import {
  EMPTY_PERMISSIONS,
  NotFoundError,
  SYSTEM_PERMISSIONS,
  ValidationError,
  createContext,
  metrics,
  resetConfig,
  type DemoContext,
  type TenantContext,
} from '@itsm/platform';
import { dashboardService } from '@itsm/module-analytics';
import { buildApp, listenHosts, listenOnFirstHost } from '../app.js';
import {
  DEMO_TOP_WRITERS_REFUSED,
  demoPlugin,
  interpretCapReply,
  interpretSpendReply,
  registeredRoutes,
  secondsUntilNextWindow,
  setDemoCounterStore,
  type DemoCapClaim,
  type DemoCounterStore,
  type DemoSpend,
  type TicketStory,
} from '../plugins/demo.js';
import { DEMO_ROUTE_POLICY, DEMO_SHORT_CIRCUITS, READ_LIKE_PENDING, READ_LIKE_POSTS, isUnsafeMethod } from '../plugins/demo-policy.js';
import { errorsPlugin } from '../plugins/errors.js';
import { DEMO_TENANT_MANAGED, platformRoutes } from '../routes/platform.js';

/**
 * The shared demo's request policy (SPEC v3 §4.7.3, §4.7.4, §4.7.7, §4.8;
 * A3 §7.5, §7.6, §7.9, §8.2, §11.1 "API pieces").
 *
 * Four parts:
 *
 * 1. The policy against the real route table. `buildApp()` is built with no
 *    database or Redis behind it (nothing is asked of either until a
 *    request), its routes are read from the plugin's route table and
 *    cross-checked against `app.printRoutes()`, and every unsafe route must
 *    be decided: a policy, a short-circuit, or a read-like POST. A route
 *    added later without a decision fails here, before it can reach the
 *    shared demo. A3 §7.6's rows are pinned one by one.
 * 2. The plugin's behaviour on a small app whose routes sit at the real
 *    paths, with the counters in memory (the same decisions the Lua makes;
 *    the Lua itself runs against real Redis in
 *    `tests/integration/demo-limits.test.ts`).
 * 3. The operator guard on the platform routes (Y-M13) and the seeded
 *    dashboards (`requireEditable`).
 * 4. Where the API listens without IPv6.
 */

vi.hoisted(() => {
  // `loadConfig()` needs a database address; nothing here connects to it.
  process.env.DATABASE_URL_APP ??= 'postgresql://nobody:nothing@127.0.0.1:1/none';
  process.env.LOG_SILENT ??= '1';
});

const tenancy = vi.hoisted(() => ({
  kinds: new Map<string, string>(),
  calls: [] as string[],
}));

vi.mock('@itsm/module-tenancy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@itsm/module-tenancy')>();
  return {
    ...actual,
    tenantService: {
      ...actual.tenantService,
      findTenantById: async (id: string) => {
        const kind = tenancy.kinds.get(id);
        return kind ? { id, kind, status: 'active', slug: kind === 'demo' ? 'demo' : 'acme' } : null;
      },
      provisionTenant: async (input: { slug: string }) => {
        tenancy.calls.push(`provision ${input.slug}`);
        return { tenantId: randomUUID() };
      },
      suspendTenant: async (id: string) => void tenancy.calls.push(`suspend ${id}`),
      resumeTenant: async (id: string) => void tenancy.calls.push(`resume ${id}`),
      setAiRegions: async (id: string) => {
        tenancy.calls.push(`regions ${id}`);
        return { id };
      },
    },
    planService: {
      ...actual.planService,
      assignPlan: async (_ctx: unknown, id: string, planKey: string) => {
        tenancy.calls.push(`plan ${id} ${planKey}`);
        return { planKey };
      },
    },
  };
});

type Policy = (typeof DEMO_ROUTE_POLICY)[string];

/* ================================================================== 1. The policy against the real routes */

/**
 * `METHOD /path` pairs read from `printRoutes()`, with every parameter name
 * replaced by `:` — the printout merges two routes whose parameters differ
 * only in name (`/:idOrNumber|:id`), so names cannot be compared there.
 */
function routesFromPrintout(printout: string): Set<string> {
  const found = new Set<string>();
  const stack: string[] = [];
  for (const line of printout.split('\n')) {
    const match = /^((?:│ {3}| {4})*)(?:├── |└── )(.*)$/.exec(line);
    if (!match) continue;
    const depth = (match[1] ?? '').length / 4;
    const rest = match[2] ?? '';
    const methods = /^(.*) \(([A-Z, ]+)\)$/.exec(rest);
    const segment = methods ? (methods[1] ?? '') : rest;
    stack.length = depth;
    stack.push(segment);
    if (!methods) continue;
    const path = normalisePath(stack.join(''));
    for (const method of (methods[2] ?? '').split(', ')) found.add(`${method} ${path}`);
  }
  return found;
}

function normalisePath(path: string): string {
  return path.replace(/:[A-Za-z0-9_]+(?:\|:[A-Za-z0-9_]+)*/g, ':');
}

function normaliseKey(key: string): string {
  const [method, ...rest] = key.split(' ');
  return `${method} ${normalisePath(rest.join(' '))}`;
}

describe('the policy decides every unsafe route the API mounts (§4.7.7)', () => {
  let app: FastifyInstance;
  let routes: readonly string[];
  let unsafe: string[];

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    routes = registeredRoutes(app);
    unsafe = routes.filter((route) => isUnsafeMethod(route.split(' ')[0] ?? ''));
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  it('sees every route the printout lists, so nothing escapes the table', () => {
    // The plugin's table is what the policy is checked against; the printout
    // is Fastify's own account. If a route were registered before the plugin,
    // the printout would have it and the table would not.
    const printed = routesFromPrintout(app.printRoutes({ commonPrefix: false }));
    const recorded = new Set(routes.map(normaliseKey));
    expect(printed.size).toBeGreaterThan(400);
    expect([...printed].filter((route) => !recorded.has(route)).sort()).toEqual([]);
    expect([...recorded].filter((route) => !printed.has(route)).sort()).toEqual([]);
    expect(unsafe.length).toBeGreaterThan(200);
  });

  it('has a decision for every unsafe route: a policy, a short-circuit or a read-like POST', () => {
    const undecided = unsafe.filter(
      (route) => !Object.hasOwn(DEMO_ROUTE_POLICY, route) && !Object.hasOwn(DEMO_SHORT_CIRCUITS, route) && !READ_LIKE_POSTS.has(route),
    );
    expect(undecided, 'unsafe routes the demo policy does not decide (apps/api/src/plugins/demo-policy.ts)').toEqual([]);
  });

  it('names only routes that exist, exactly as Fastify reports them', () => {
    const mounted = new Set(routes);
    expect(Object.keys(DEMO_ROUTE_POLICY).filter((key) => !mounted.has(key))).toEqual([]);
    expect(Object.keys(DEMO_SHORT_CIRCUITS).filter((key) => !mounted.has(key))).toEqual([]);
    for (const key of READ_LIKE_POSTS) {
      expect(key.startsWith('POST /api/v1/'), key).toBe(true);
      if (!READ_LIKE_PENDING.has(key)) expect(mounted.has(key), `${key} is not mounted`).toBe(true);
    }
  });

  it('keeps the policy to unsafe methods, and the short-circuits to the personas’ sessions', () => {
    for (const key of Object.keys(DEMO_ROUTE_POLICY)) expect(isUnsafeMethod(key.split(' ')[0] ?? ''), key).toBe(true);
    expect(Object.keys(DEMO_SHORT_CIRCUITS).sort()).toEqual(['DELETE /api/v1/me/sessions/:id', 'GET /api/v1/me/sessions', 'POST /api/v1/auth/session']);
    for (const key of Object.keys(DEMO_SHORT_CIRCUITS)) expect(Object.hasOwn(DEMO_ROUTE_POLICY, key), key).toBe(false);
  });

  it('lists every POST that only evaluates — metrics, forecasts, arrivals, rule and workflow tests — as read-like (Y-M3)', () => {
    const evaluating = /\/(?:query|query\/batch|forecast|arrivals|dry-run|test|validate)$/;
    const posts = unsafe.filter((route) => route.startsWith('POST /api/v1/') && evaluating.test(route));
    expect(posts.length).toBeGreaterThanOrEqual(7);
    for (const route of posts) expect(READ_LIKE_POSTS.has(route), `${route} should be read-like`).toBe(true);
    expect([...READ_LIKE_POSTS].sort()).toEqual(
      [
        'POST /api/v1/analytics/arrivals',
        'POST /api/v1/analytics/forecast',
        'POST /api/v1/analytics/query',
        'POST /api/v1/analytics/query/batch',
        'POST /api/v1/rules/:idOrKey/test',
        'POST /api/v1/rules/dry-run',
        'POST /api/v1/workflows/:key/test',
        'POST /api/v1/workflows/:key/validate',
      ].sort(),
    );
    expect([...READ_LIKE_PENDING]).toEqual(['POST /api/v1/analytics/arrivals']);
  });

  it('refuses every platform route as the platform feature, and claims "no session" only for routes that build none', () => {
    for (const route of unsafe.filter((key) => key.includes(' /api/platform/'))) {
      expect(DEMO_ROUTE_POLICY[route], route).toEqual({ kind: 'read-only', feature: 'platform' });
    }
    const outside = Object.entries(DEMO_ROUTE_POLICY).filter(([, policy]) => policy.kind === 'outside-session');
    for (const [key] of outside) {
      const path = key.split(' ')[1] ?? '';
      const buildsNoSession =
        path.startsWith('/scim/v2/') ||
        path.startsWith('/status/') ||
        path.startsWith('/api/v1/public/') ||
        /^\/api\/v1\/channels\/[^/]+\/:accountKey\/inbound$/.test(path) ||
        path === '/api/v1/auth/dev-session';
      expect(buildsNoSession, key).toBe(true);
    }
    expect(outside.length).toBe(13);
  });
});

describe('the policy table carries A3 §7.6 as amended by §4.7.4', () => {
  const capOf = (category: DemoCapCategory): Policy => ({ kind: 'cap', category });
  const readOnly = (feature: DemoFeature): Policy => ({ kind: 'read-only', feature });
  const allow: Policy = { kind: 'allow' };

  const rows: readonly (readonly [row: string, key: string, policy: Policy])[] = [
    ['1', 'POST /api/v1/major-incidents', capOf('mi.declare')],
    ['2', 'POST /api/v1/major-incidents/:number/updates', capOf('mi.update')],
    ['3', 'POST /api/v1/major-incidents/:number/transition', capOf('mi.transition')],
    ['3', 'POST /api/v1/major-incidents/:number/close', capOf('mi.transition')],
    ['4', 'PATCH /api/v1/major-incidents/:number/roles', capOf('mi.review')],
    ['4', 'PATCH /api/v1/major-incidents/:number/review', capOf('mi.review')],
    ['4', 'POST /api/v1/major-incidents/:number/review/actions', capOf('mi.review')],
    ['4', 'PATCH /api/v1/major-incidents/review/actions/:id', capOf('mi.review')],
    ['4', 'POST /api/v1/major-incidents/:number/review/publish', capOf('mi.review')],
    ['5', 'PATCH /api/v1/status-page', readOnly('status-page')],
    ['5', 'POST /api/v1/status-page/incidents', readOnly('status-page')],
    ['5', 'DELETE /api/v1/status-page/subscribers/:id', readOnly('status-page')],
    ['8', 'POST /api/v1/knowledge/:key/publish', capOf('kb.publish')],
    ['8', 'POST /api/v1/knowledge/:key/rollback', capOf('kb.publish')],
    ['8', 'POST /api/v1/knowledge/:key/retire', capOf('kb.publish')],
    ['9', 'POST /api/v1/knowledge', capOf('kb.draft')],
    ['9', 'PATCH /api/v1/knowledge/:key', capOf('kb.draft')],
    ['9', 'POST /api/v1/knowledge/:key/submit', capOf('kb.draft')],
    ['10', 'POST /api/v1/services', capOf('catalogue.change')],
    ['10', 'PATCH /api/v1/request-types/:key', capOf('catalogue.change')],
    ['10', 'POST /api/v1/request-types/:key/publish', capOf('catalogue.change')],
    ['10', 'POST /api/v1/forms/:key/publish', capOf('catalogue.change')],
    ['11', 'POST /api/v1/tickets', capOf('ticket.create')],
    ['12', 'POST /api/v1/tickets/:idOrNumber/comments', allow],
    ['12', 'POST /api/v1/tickets/:idOrNumber/transitions', allow],
    ['12', 'POST /api/v1/tickets/:idOrNumber/assign', allow],
    ['12', 'POST /api/v1/tickets/:idOrNumber/watchers', allow],
    ['13', 'POST /api/v1/tickets/:idOrNumber/attachments', readOnly('uploads')],
    ['13', 'POST /api/v1/tickets/:idOrNumber/attachments:presign', readOnly('uploads')],
    ['14', 'POST /api/v1/users', capOf('user.create')],
    ['15', 'POST /api/v1/users/:id/deactivate', { kind: 'guard', guard: 'persona', category: 'user.deactivate' }],
    ['16', 'POST /api/v1/role-assignments', readOnly('roles')],
    ['16', 'DELETE /api/v1/role-assignments/:id', readOnly('roles')],
    ['17', 'POST /api/v1/teams', readOnly('organisation')],
    ['17', 'POST /api/v1/teams/:id/members', readOnly('organisation')],
    ['17', 'POST /api/v1/organisations', readOnly('organisation')],
    ['19', 'PATCH /api/v1/analytics/dashboards/:id', capOf('dashboard.change')],
    ['19', 'DELETE /api/v1/analytics/dashboards/:id', capOf('dashboard.change')],
    ['20', 'POST /api/v1/analytics/dashboards', capOf('dashboard.change')],
    ['21', 'POST /api/v1/analytics/metrics', capOf('metric.change')],
    ['21', 'DELETE /api/v1/analytics/metrics/:key', capOf('metric.change')],
    ['22', 'POST /api/v1/analytics/reports', capOf('report.change')],
    ['22', 'POST /api/v1/analytics/reports/:id/schedules', capOf('report.change')],
    ['22', 'DELETE /api/v1/analytics/report-schedules/:id', capOf('report.change')],
    ['23', 'POST /api/v1/analytics/reports/:id/run', capOf('report.run')],
    ['24', 'POST /api/v1/rules', capOf('rule.change')],
    ['24', 'POST /api/v1/rules/:idOrKey/archive', capOf('rule.change')],
    ['25', 'POST /api/v1/rules/:idOrKey/test', capOf('rule.test')],
    ['25', 'POST /api/v1/rules/dry-run', capOf('rule.test')],
    ['26', 'POST /api/v1/workflows', capOf('workflow.change')],
    ['26', 'POST /api/v1/workflows/:key/rollback', capOf('workflow.change')],
    ['27', 'POST /api/v1/sla-policies', capOf('sla.change')],
    ['27', 'PUT /api/v1/sla-policies/:idOrKey/targets', capOf('sla.change')],
    ['27', 'POST /api/v1/sla-calendars', capOf('sla.change')],
    ['27', 'PUT /api/v1/priority-matrix', capOf('sla.change')],
    ['28', 'POST /api/v1/approval-policies', capOf('approval-policy.change')],
    ['28', 'POST /api/v1/approval-policies/:idOrKey/publish', capOf('approval-policy.change')],
    ['29', 'POST /api/v1/approvals/:id/decide', allow],
    ['30', 'PUT /api/v1/settings/:key', { kind: 'locked-setting' }],
    ['30', 'POST /api/v1/settings/:key/rollback', { kind: 'locked-setting' }],
    ['31', 'PUT /api/v1/feature-flags/:key', readOnly('feature-switches')],
    ['31', 'POST /api/v1/modules/:id/:action', readOnly('modules')],
    ['32', 'POST /api/v1/packs/:key/install', capOf('pack.install')],
    ['32', 'POST /api/v1/packs/:key/upgrade', capOf('pack.install')],
    ['33', 'PUT /api/v1/field-definitions/:key', capOf('field.change')],
    ['33', 'DELETE /api/v1/field-definitions/:key', capOf('field.change')],
    ['33', 'POST /api/v1/field-definitions/:key/reactivate', capOf('field.change')],
    ['34', 'PUT /api/v1/problems/:number/known-error', capOf('problem.publish')],
    ['34', 'DELETE /api/v1/problems/:number/known-error', capOf('problem.publish')],
    ['35', 'PUT /api/v1/usage/limits/:meter', capOf('usage.change')],
    ['36', 'PATCH /api/v1/tickets/:idOrNumber', { kind: 'hero-ticket' }],
    ['—', 'POST /api/v1/credentials', readOnly('integrations')],
    ['—', 'POST /api/v1/webhooks', readOnly('integrations')],
    ['—', 'POST /api/v1/actions', readOnly('integrations')],
    ['—', 'POST /api/v1/error-queue/:id/replay', readOnly('integrations')],
    ['—', 'POST /api/v1/channels/identities', readOnly('channels')],
    ['—', 'POST /api/v1/discovery/sources/:key/run', readOnly('discovery')],
    ['—', 'POST /api/v1/import/jobs', readOnly('import')],
    ['—', 'POST /api/v1/scim/token', readOnly('sso')],
    ['—', 'PUT /api/v1/ai/budget', readOnly('ai-settings')],
    ['—', 'POST /api/v1/analytics/rebuild', readOnly('analytics-admin')],
    ['—', 'POST /api/v1/changes', allow],
    ['—', 'POST /api/v1/problems', allow],
    ['—', 'POST /api/v1/cis', allow],
    ['—', 'POST /api/v1/time-entries', allow],
    ['—', 'PUT /api/v1/workload/availability', allow],
    ['—', 'POST /api/v1/surveys', allow],
  ];

  it.each(rows)('row %s · %s', (_row, key, policy) => {
    expect(DEMO_ROUTE_POLICY[key]).toEqual(policy);
  });

  it('raises a ticket through the catalogue against the same cap as POST /tickets', () => {
    expect(DEMO_ROUTE_POLICY['POST /api/v1/catalogue/:key/submit']).toEqual(capOf('ticket.create'));
  });

  it('uses every cap category, and each has its own sentence', () => {
    const used = new Set<string>();
    for (const policy of Object.values(DEMO_ROUTE_POLICY)) {
      if (policy.kind === 'cap' || policy.kind === 'guard') used.add(policy.category);
      if (policy.kind === 'locked-setting') used.add('setting.change');
    }
    expect([...used].sort()).toEqual([...DEMO_CAP_CATEGORIES].sort());
    const fallback = demoLimitSentence('not-a-category');
    for (const category of DEMO_CAP_CATEGORIES) {
      const sentence = demoLimitSentence(category);
      expect(sentence, category).not.toBe(fallback);
      expect(sentence).toMatch(/^To keep this shared demo tidy for everyone, each visit can .+\. You've reached that limit\.$/);
      expect(DEMO_CAPS[category].perVisit).toBeGreaterThan(0);
      expect(DEMO_CAPS[category].perGeneration).toBeGreaterThanOrEqual(DEMO_CAPS[category].perVisit);
    }
  });

  it('refuses read-only routes only with features that have a sentence', () => {
    const generic = demoDisabledSentence('not-a-feature');
    for (const policy of [...Object.values(DEMO_ROUTE_POLICY), ...Object.values(DEMO_SHORT_CIRCUITS)]) {
      if (!('feature' in policy)) continue;
      expect(DEMO_FEATURES).toContain(policy.feature);
      expect(demoDisabledSentence(policy.feature)).not.toBe(generic);
    }
  });
});

/* ================================================================== 2. The plugin */

/**
 * The counters in memory, making the decisions the Lua scripts make: reads
 * count every request; a write is counted only when every write budget
 * allows it; above the alert level the busiest buckets (by score, ties by
 * member, highest first, as `ZREVRANK`) are refused; a cap is checked before
 * it is counted and given back never below zero.
 */
function memoryStore() {
  const counters = new Map<string, number>();
  const sets = new Map<string, Map<string, number>>();
  const seen: string[] = [];
  let failing: 'throw' | 'hang' | null = null;

  const get = (key: string) => counters.get(key) ?? 0;
  const incr = (key: string) => {
    seen.push(key);
    const next = get(key) + 1;
    counters.set(key, next);
    return next;
  };
  const rank = (key: string, member: string): number | null => {
    const set = sets.get(key);
    if (!set?.has(member)) return null;
    const ordered = [...set.entries()].sort(([a, x], [b, y]) => y - x || (a < b ? 1 : a > b ? -1 : 0));
    return ordered.findIndex(([name]) => name === member);
  };
  const fail = async () => {
    if (failing === 'throw') throw new Error('connect ECONNREFUSED 127.0.0.1:6379');
    if (failing === 'hang') await new Promise(() => undefined);
  };

  const store: DemoCounterStore & {
    counters: Map<string, number>;
    sets: Map<string, Map<string, number>>;
    seen: string[];
    calls: number;
    fail(mode: 'throw' | 'hang' | null): void;
  } = {
    counters,
    sets,
    seen,
    calls: 0,
    fail(mode) {
      failing = mode;
    },
    async spend({ keys, ipb, write, limits }: DemoSpend) {
      store.calls += 1;
      await fail();
      if (incr(keys.readsPerBucket) > limits.readsPerBucketMinute) return { ok: false, budget: 'reads' };
      if (!write) return { ok: true, tenantWrites: null };
      if (get(keys.writesPerVisitMinute) >= limits.writesPerMinute) return { ok: false, budget: 'writes-minute' };
      if (get(keys.writesPerVisit) >= limits.writesPerVisit) return { ok: false, budget: 'writes-visit' };
      if (get(keys.writesPerBucketHour) >= limits.writesPerBucketHour) return { ok: false, budget: 'writes-bucket' };
      if (get(keys.tenantWritesHour) >= limits.writesAlertPerHour) {
        const position = rank(keys.topWritersHour, ipb);
        if (position !== null && position < DEMO_TOP_WRITERS_REFUSED) return { ok: false, budget: 'writes-ceiling' };
      }
      incr(keys.writesPerVisitMinute);
      incr(keys.writesPerVisit);
      incr(keys.writesPerBucketHour);
      const all = incr(keys.tenantWritesHour);
      const set = sets.get(keys.topWritersHour) ?? new Map<string, number>();
      set.set(ipb, (set.get(ipb) ?? 0) + 1);
      sets.set(keys.topWritersHour, set);
      seen.push(keys.topWritersHour);
      return { ok: true, tenantWrites: all };
    },
    async takeCap(claim: DemoCapClaim, limits) {
      store.calls += 1;
      await fail();
      if (get(claim.visitKey) >= limits.perVisit) return { ok: false, exhausted: 'visit' };
      if (get(claim.generationKey) >= limits.perGeneration) return { ok: false, exhausted: 'generation' };
      incr(claim.visitKey);
      incr(claim.generationKey);
      return { ok: true };
    },
    async giveBackCap(claim: DemoCapClaim) {
      store.calls += 1;
      await fail();
      for (const key of [claim.visitKey, claim.generationKey]) if (get(key) > 0) counters.set(key, get(key) - 1);
    },
  };
  return store;
}

const TENANT = randomUUID();
const PERSONAS: Record<DemoPersonaKey, string> = { employee: randomUUID(), agent: randomUUID(), admin: randomUUID() };
const SERVICE_DESK = randomUUID();

interface Visit {
  readonly sid: string;
  readonly ipb: string;
  readonly persona: DemoPersonaKey;
  readonly generation: number;
}

const visits = new Map<string, Visit>();

/** A new visit, in a bucket of its own unless one is given. */
function newVisit(options: Partial<Pick<Visit, 'ipb' | 'persona' | 'generation'>> = {}): string {
  const visit: Visit = {
    sid: `demo-${randomUUID()}`,
    ipb: options.ipb ?? randomBytes(8).toString('hex'),
    persona: options.persona ?? 'admin',
    generation: options.generation ?? 4,
  };
  visits.set(visit.sid, visit);
  return visit.sid;
}

/** Every route the plugin tests call, at its real path; each records the call and answers as the body asks. */
const STUB_ROUTES = [
  'GET /api/v1/tickets',
  'POST /api/v1/tickets',
  'PATCH /api/v1/tickets/:idOrNumber',
  'POST /api/v1/tickets/:idOrNumber/comments',
  'POST /api/v1/major-incidents',
  'PUT /api/v1/settings/:key',
  'POST /api/v1/settings/:key/rollback',
  'POST /api/v1/users/:id/deactivate',
  'POST /api/v1/role-assignments',
  'POST /api/v1/analytics/query',
  'POST /api/v1/rules/dry-run',
  'POST /api/v1/auth/session',
  'GET /api/v1/me/sessions',
  'DELETE /api/v1/me/sessions/:id',
  'POST /api/v1/not-in-the-policy',
] as const;

interface Harness {
  app: FastifyInstance;
  store: ReturnType<typeof memoryStore>;
  handled: string[];
  clock: { now: number };
  tickets: Map<string, TicketStory>;
  storyReads: string[];
  call(method: string, url: string, options?: { visit?: string; body?: unknown }): Promise<{ status: number; body: Record<string, unknown>; headers: Record<string, unknown> }>;
}

async function harness(): Promise<Harness> {
  const store = memoryStore();
  const handled: string[] = [];
  const clock = { now: Date.UTC(2026, 9, 3, 10, 15, 30) };
  const tickets = new Map<string, TicketStory>();
  const storyReads: string[] = [];

  const app = Fastify({ logger: false });
  await app.register(errorsPlugin);
  // Stands in for the context plugin: a demo visit, or a standard tenant's user.
  app.addHook('preHandler', async (request) => {
    const sid = request.headers['x-visit'];
    if (sid === 'standard') {
      request.tenantContext = createContext({ tenantId: randomUUID(), actor: { type: 'user', id: randomUUID() }, permissions: SYSTEM_PERMISSIONS });
      request.token = { kind: 'user', tenantId: request.tenantContext.tenantId, subject: 'someone' };
      return;
    }
    const visit = typeof sid === 'string' ? visits.get(sid) : undefined;
    if (!visit) return;
    const demo: DemoContext = {
      sid: visit.sid,
      persona: visit.persona,
      app: 'admin',
      generation: visit.generation,
      personaUserIds: PERSONAS,
      agentTeamIds: [SERVICE_DESK],
    };
    request.tenantContext = createContext({ tenantId: TENANT, actor: { type: 'user', id: PERSONAS[visit.persona] }, permissions: EMPTY_PERMISSIONS, demo });
    request.token = {
      kind: 'user',
      tenantId: TENANT,
      userId: PERSONAS[visit.persona],
      subject: `demo:${visit.sid}`,
      demo: { ...demo, issuedAt: clock.now, ipBucket: visit.ipb },
    };
  });
  await app.register(demoPlugin, {
    store,
    now: () => clock.now,
    readTicketStory: async (_ctx: TenantContext, idOrNumber: string) => {
      storyReads.push(idOrNumber);
      const ticket = tickets.get(idOrNumber);
      if (!ticket) throw new NotFoundError('ticket', idOrNumber);
      return ticket;
    },
  });
  for (const route of STUB_ROUTES) {
    const [method, url] = route.split(' ') as [string, string];
    app.route({
      method: method as 'GET',
      url,
      handler: async (request, reply) => {
        handled.push(route);
        const body = (request.body ?? {}) as { fail?: 'validation' | 'boom' };
        if (body.fail === 'validation') throw new ValidationError('the request did not match the expected shape');
        if (body.fail === 'boom') throw new Error('handler failed');
        if (route === 'GET /api/v1/me/sessions') return { data: [{ id: 'a real session' }] };
        reply.status(method === 'POST' ? 201 : 200);
        return { ok: true };
      },
    });
  }
  await app.ready();

  return {
    app,
    store,
    handled,
    clock,
    tickets,
    storyReads,
    async call(method, url, options = {}) {
      const response = await app.inject({
        method: method as 'GET',
        url,
        headers: options.visit ? { 'x-visit': options.visit } : {},
        ...(options.body !== undefined ? { payload: options.body as object } : {}),
      });
      return {
        status: response.statusCode,
        body: response.body ? (JSON.parse(response.body) as Record<string, unknown>) : {},
        headers: response.headers as Record<string, unknown>,
      };
    },
  };
}

function code(body: Record<string, unknown>): string | undefined {
  return typeof body.type === 'string' ? body.type.split('/').pop() : undefined;
}

function counter(name: string, labels?: Record<string, string>): number {
  const key = labels
    ? `${name}{${Object.entries(labels)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}=${v}`)
        .join(',')}}`
    : name;
  return metrics.snapshot().counters[key] ?? 0;
}

function limits(values: Partial<Record<'reads' | 'perMinute' | 'perVisit' | 'perBucketHour' | 'alert', number>>): void {
  if (values.reads !== undefined) vi.stubEnv('DEMO_READS_PER_IP_MINUTE', String(values.reads));
  if (values.perMinute !== undefined) vi.stubEnv('DEMO_WRITES_PER_MINUTE', String(values.perMinute));
  if (values.perVisit !== undefined) vi.stubEnv('DEMO_WRITES_PER_SESSION', String(values.perVisit));
  if (values.perBucketHour !== undefined) vi.stubEnv('DEMO_WRITES_PER_IP_HOUR', String(values.perBucketHour));
  if (values.alert !== undefined) vi.stubEnv('DEMO_WRITES_ALERT_PER_HOUR', String(values.alert));
  resetConfig();
}

describe('the demo plugin', () => {
  let h: Harness;

  beforeEach(async () => {
    vi.unstubAllEnvs();
    resetConfig();
    h = await harness();
  });

  afterEach(async () => {
    await h.app.close();
    vi.unstubAllEnvs();
    resetConfig();
  });

  describe('a standard tenant', () => {
    it('is untouched by every rule: nothing is counted, refused or answered for it', async () => {
      limits({ reads: 1, perMinute: 1 });
      for (let i = 0; i < 3; i += 1) {
        expect((await h.call('GET', '/api/v1/tickets', { visit: 'standard' })).status).toBe(200);
        expect((await h.call('POST', '/api/v1/major-incidents', { visit: 'standard', body: {} })).status).toBe(201);
      }
      expect((await h.call('POST', '/api/v1/role-assignments', { visit: 'standard', body: {} })).status).toBe(201);
      expect((await h.call('PUT', '/api/v1/settings/sla.attainment.target', { visit: 'standard', body: {} })).status).toBe(200);
      expect((await h.call('GET', '/api/v1/me/sessions', { visit: 'standard' })).body).toEqual({ data: [{ id: 'a real session' }] });
      expect(h.store.calls).toBe(0);
    });
  });

  describe('1 · the personas’ sessions (§4.7.3)', () => {
    it('answers without counting a budget or reaching the handler', async () => {
      const visit = newVisit();
      const session = await h.call('POST', '/api/v1/auth/session', { visit, body: {} });
      expect(session.status).toBe(204);
      const list = await h.call('GET', '/api/v1/me/sessions', { visit });
      expect(list.status).toBe(200);
      expect(list.body).toEqual({ data: [] });
      const revoke = await h.call('DELETE', `/api/v1/me/sessions/${randomUUID()}`, { visit });
      expect(revoke.status).toBe(403);
      expect(code(revoke.body)).toBe('demo_disabled');
      expect(revoke.body.feature).toBe('sessions');
      expect(revoke.body.detail).toBe(demoDisabledSentence('sessions'));
      expect(h.handled).toEqual([]);
      expect(h.store.calls).toBe(0);
    });
  });

  describe('2 · the read budget per IP bucket (Y-M2)', () => {
    it('refuses the request after the limit with 429 rate_limited until the next minute, for that bucket only', async () => {
      limits({ reads: 3 });
      const visit = newVisit();
      const before = counter('demo_reads_refused_total');
      for (let i = 0; i < 3; i += 1) expect((await h.call('GET', '/api/v1/tickets', { visit })).status).toBe(200);
      const refused = await h.call('GET', '/api/v1/tickets', { visit });
      expect(refused.status).toBe(429);
      expect(code(refused.body)).toBe('rate_limited');
      // 10:15:30 → the next minute opens in 30 s.
      expect(refused.headers['retry-after']).toBe('30');
      expect(refused.body.retryAfterSec).toBe(30);
      expect(counter('demo_reads_refused_total')).toBe(before + 1);

      // Writes are reads too: a refused bucket cannot write either.
      expect((await h.call('POST', '/api/v1/tickets/T-1/comments', { visit, body: {} })).status).toBe(429);
      // Another bucket is untouched, and the next minute is a new window.
      expect((await h.call('GET', '/api/v1/tickets', { visit: newVisit() })).status).toBe(200);
      h.clock.now += 30_000;
      expect((await h.call('GET', '/api/v1/tickets', { visit })).status).toBe(200);
    });

    it('counts under the bucket’s own key, never an address', async () => {
      const visit = newVisit();
      await h.call('GET', '/api/v1/tickets', { visit });
      const { ipb } = visits.get(visit)!;
      expect(h.store.seen).toEqual([DEMO_KEYS.readsPerBucket(ipb, demoWindow('m', h.clock.now))]);
    });
  });

  describe('3 · the write budgets (§4.8, Y-M1)', () => {
    it('refuses the visit’s write after the per-minute budget with 429 and Retry-After; a refused write is not counted', async () => {
      limits({ perMinute: 2 });
      const visit = newVisit();
      for (let i = 0; i < 2; i += 1) expect((await h.call('POST', '/api/v1/tickets/T-1/comments', { visit, body: {} })).status).toBe(201);
      const refused = await h.call('POST', '/api/v1/tickets/T-1/comments', { visit, body: {} });
      expect(refused.status).toBe(429);
      expect(code(refused.body)).toBe('rate_limited');
      expect(refused.headers['retry-after']).toBe('30');
      const { sid } = visits.get(visit)!;
      expect(h.store.counters.get(DEMO_KEYS.writesPerVisitTotal(sid))).toBe(2);
      // Reads are not writes.
      expect((await h.call('GET', '/api/v1/tickets', { visit })).status).toBe(200);
      h.clock.now += 60_000;
      expect((await h.call('POST', '/api/v1/tickets/T-1/comments', { visit, body: {} })).status).toBe(201);
    });

    it('ends the visit’s writes after its total with 429 demo_limit "writes", naming the budget and no retry', async () => {
      limits({ perVisit: 3 });
      const visit = newVisit();
      for (let i = 0; i < 3; i += 1) {
        expect((await h.call('POST', '/api/v1/tickets/T-1/comments', { visit, body: {} })).status).toBe(201);
        h.clock.now += 60_000;
      }
      const before = counter('demo_limit_hits_total', { category: 'writes' });
      const refused = await h.call('POST', '/api/v1/tickets/T-1/comments', { visit, body: {} });
      expect(refused.status).toBe(429);
      expect(code(refused.body)).toBe('demo_limit');
      expect(refused.body).toMatchObject({ demo: true, category: 'writes', limit: 3 });
      expect(refused.body.detail).toBe(demoLimitSentence('writes', { limit: 3 }));
      expect(refused.headers['retry-after']).toBeUndefined();
      expect(counter('demo_limit_hits_total', { category: 'writes' })).toBe(before + 1);
      // A new visit starts afresh.
      expect((await h.call('POST', '/api/v1/tickets/T-1/comments', { visit: newVisit(), body: {} })).status).toBe(201);
    });

    it('refuses a bucket’s writes after its hourly budget, across visits, until the next hour', async () => {
      limits({ perBucketHour: 4 });
      const ipb = randomBytes(8).toString('hex');
      const first = newVisit({ ipb });
      const second = newVisit({ ipb });
      for (const visit of [first, first, second, second]) {
        expect((await h.call('POST', '/api/v1/tickets/T-1/comments', { visit, body: {} })).status).toBe(201);
      }
      const refused = await h.call('POST', '/api/v1/tickets/T-1/comments', { visit: newVisit({ ipb }), body: {} });
      expect(refused.status).toBe(429);
      expect(code(refused.body)).toBe('rate_limited');
      // 10:15:30 → the next hour opens in 44 min 30 s.
      expect(refused.headers['retry-after']).toBe(String(44 * 60 + 30));
      expect((await h.call('POST', '/api/v1/tickets/T-1/comments', { visit: newVisit(), body: {} })).status).toBe(201);
    });

    it('above the alert level refuses only the ten busiest buckets, never everybody (Y-M1)', async () => {
      limits({ alert: 20 });
      const busy = Array.from({ length: 10 }, () => newVisit());
      for (const visit of busy) {
        for (let i = 0; i < 2; i += 1) expect((await h.call('POST', '/api/v1/tickets/T-1/comments', { visit, body: {} })).status).toBe(201);
      }
      const refusedBefore = counter('demo_write_ceiling_total', { level: 'refused' });
      for (const visit of busy) {
        const refused = await h.call('POST', '/api/v1/tickets/T-1/comments', { visit, body: {} });
        expect(refused.status).toBe(429);
        expect(code(refused.body)).toBe('rate_limited');
      }
      expect(counter('demo_write_ceiling_total', { level: 'refused' })).toBe(refusedBefore + 10);

      // A quiet bucket still writes, above the alert level.
      const alertBefore = counter('demo_write_ceiling_total', { level: 'alert' });
      const quiet = newVisit();
      expect((await h.call('POST', '/api/v1/tickets/T-1/comments', { visit: quiet, body: {} })).status).toBe(201);
      expect(counter('demo_write_ceiling_total', { level: 'alert' })).toBe(alertBefore + 1);
      // It is now the eleventh: still not among the ten.
      expect((await h.call('POST', '/api/v1/tickets/T-1/comments', { visit: quiet, body: {} })).status).toBe(201);
      // Reads go on for everybody.
      expect((await h.call('GET', '/api/v1/tickets', { visit: busy[0] })).status).toBe(200);
    });

    it('spends no write budget on a read-like POST (Y-M3), and does on any other unsafe method', async () => {
      limits({ perMinute: 1 });
      const visit = newVisit();
      for (let i = 0; i < 3; i += 1) expect((await h.call('POST', '/api/v1/analytics/query', { visit, body: {} })).status).toBe(201);
      expect((await h.call('POST', '/api/v1/tickets/T-1/comments', { visit, body: {} })).status).toBe(201);
      expect((await h.call('POST', '/api/v1/tickets/T-1/comments', { visit, body: {} })).status).toBe(429);
    });

    it('writes only the shapes DEMO_KEYS builds, and never an address', async () => {
      const visit = newVisit();
      await h.call('POST', '/api/v1/major-incidents', { visit, body: {} });
      expect(h.store.seen.length).toBeGreaterThanOrEqual(8);
      for (const key of h.store.seen) {
        expect(isDemoKey(key), key).toBe(true);
        expect(key).not.toMatch(/\d+\.\d+\.\d+\.\d+|::/);
      }
    });

    it('still bounds a route the policy does not list, with the write budgets', async () => {
      limits({ perMinute: 1 });
      const visit = newVisit();
      expect((await h.call('POST', '/api/v1/not-in-the-policy', { visit, body: {} })).status).toBe(201);
      expect((await h.call('POST', '/api/v1/not-in-the-policy', { visit, body: {} })).status).toBe(429);
    });
  });

  describe('4 · caps (§4.7.4)', () => {
    it('allows one major incident per visit, then answers 429 demo_limit with the category and the per-visit figure', async () => {
      const visit = newVisit();
      expect((await h.call('POST', '/api/v1/major-incidents', { visit, body: {} })).status).toBe(201);
      const refused = await h.call('POST', '/api/v1/major-incidents', { visit, body: {} });
      expect(refused.status).toBe(429);
      expect(code(refused.body)).toBe('demo_limit');
      expect(refused.body).toMatchObject({ demo: true, category: 'mi.declare', limit: 1 });
      expect(refused.body.detail).toBe(demoLimitSentence('mi.declare'));
      expect(h.handled.filter((route) => route === 'POST /api/v1/major-incidents')).toHaveLength(1);
    });

    it('allows ten per generation across every visit, and a new generation starts again', async () => {
      for (let i = 0; i < 10; i += 1) expect((await h.call('POST', '/api/v1/major-incidents', { visit: newVisit(), body: {} })).status).toBe(201);
      const refused = await h.call('POST', '/api/v1/major-incidents', { visit: newVisit(), body: {} });
      expect(refused.status).toBe(429);
      expect(refused.body).toMatchObject({ category: 'mi.declare', limit: 1 });
      expect((await h.call('POST', '/api/v1/major-incidents', { visit: newVisit({ generation: 5 }), body: {} })).status).toBe(201);
    });

    it('gives the cap back when the request fails, whether the visitor or the server was wrong', async () => {
      const visit = newVisit();
      expect((await h.call('POST', '/api/v1/major-incidents', { visit, body: { fail: 'validation' } })).status).toBe(422);
      expect((await h.call('POST', '/api/v1/major-incidents', { visit, body: { fail: 'boom' } })).status).toBe(500);
      const { sid, generation } = visits.get(visit)!;
      expect(h.store.counters.get(DEMO_KEYS.capPerVisit(generation, 'mi.declare', sid))).toBe(0);
      expect(h.store.counters.get(DEMO_KEYS.capAll(generation, 'mi.declare'))).toBe(0);
      expect((await h.call('POST', '/api/v1/major-incidents', { visit, body: {} })).status).toBe(201);
      expect((await h.call('POST', '/api/v1/major-incidents', { visit, body: {} })).status).toBe(429);
    });

    it('caps a read-like POST that is heavy without spending the write budget: rule tests', async () => {
      limits({ perMinute: 1 });
      const visit = newVisit();
      for (let i = 0; i < DEMO_CAPS['rule.test'].perVisit; i += 1) {
        expect((await h.call('POST', '/api/v1/rules/dry-run', { visit, body: {} })).status).toBe(201);
      }
      const refused = await h.call('POST', '/api/v1/rules/dry-run', { visit, body: {} });
      expect(refused.body).toMatchObject({ category: 'rule.test', limit: 30 });
    });
  });

  describe('5 · read-only and the guards', () => {
    it('refuses a read-only route with its feature before the handler runs', async () => {
      const visit = newVisit();
      const refused = await h.call('POST', '/api/v1/role-assignments', { visit, body: {} });
      expect(refused.status).toBe(403);
      expect(code(refused.body)).toBe('demo_disabled');
      expect(refused.body).toMatchObject({ demo: true, feature: 'roles', title: 'Not available in the demo' });
      expect(refused.body.detail).toBe(demoDisabledSentence('roles'));
      expect(h.handled).toEqual([]);
    });

    it('locks the settings in DEMO_LOCKED_SETTINGS and caps the rest at five per visit (Y-M12)', async () => {
      const visit = newVisit();
      for (const key of ['sla.attainment.target', 'ticket.autoClose.days', 'ai.enabled', 'knowledge.requireApprovalToPublish']) {
        const put = await h.call('PUT', `/api/v1/settings/${key}`, { visit, body: { value: 1 } });
        expect(put.status, key).toBe(403);
        expect(put.body.feature).toBe('settings');
        const rollback = await h.call('POST', `/api/v1/settings/${key}/rollback`, { visit, body: { toVersion: 1 } });
        expect(rollback.status, key).toBe(403);
        expect(rollback.body.feature).toBe('settings');
      }
      expect(h.handled).toEqual([]);
      for (let i = 0; i < 5; i += 1) {
        expect((await h.call('PUT', '/api/v1/settings/assets.warrantyWarningDays', { visit, body: { value: 30 } })).status).toBe(200);
      }
      const capped = await h.call('POST', '/api/v1/settings/assets.warrantyWarningDays/rollback', { visit, body: { toVersion: 1 } });
      expect(capped.status).toBe(429);
      expect(capped.body).toMatchObject({ category: 'setting.change', limit: 5 });
    });

    it('never lets a visitor switch off one of the personas, and caps other deactivations (§4.7.3)', async () => {
      const visit = newVisit();
      for (const persona of Object.values(PERSONAS)) {
        const refused = await h.call('POST', `/api/v1/users/${persona}/deactivate`, { visit, body: {} });
        expect(refused.status).toBe(403);
        expect(refused.body).toMatchObject({ feature: 'personas' });
        expect(refused.body.detail).toBe(demoDisabledSentence('personas'));
      }
      expect(h.handled).toEqual([]);
      for (let i = 0; i < 3; i += 1) expect((await h.call('POST', `/api/v1/users/${randomUUID()}/deactivate`, { visit, body: {} })).status).toBe(201);
      expect((await h.call('POST', `/api/v1/users/${randomUUID()}/deactivate`, { visit, body: {} })).body).toMatchObject({ category: 'user.deactivate' });
    });

    it('keeps a hero ticket’s title and description, and allows every other change to it (Y-m5)', async () => {
      const visit = newVisit({ persona: 'agent' });
      h.tickets.set('INC-000101', { externalRef: `${DEMO_HERO_REF_PREFIX}H1`, title: 'Finance share is read-only', description: 'Since Monday.' });
      h.tickets.set('INC-000102', { externalRef: null, title: 'Printer jammed', description: null });

      const title = await h.call('PATCH', '/api/v1/tickets/INC-000101', { visit, body: { title: 'lol' } });
      expect(title.status).toBe(403);
      expect(code(title.body)).toBe('demo_disabled');
      expect(title.body.feature).toBe('story');
      const description = await h.call('PATCH', '/api/v1/tickets/INC-000101', { visit, body: { description: null } });
      expect(description.body.feature).toBe('story');

      // Unchanged values are not changes; other fields are the demo working.
      expect((await h.call('PATCH', '/api/v1/tickets/INC-000101', { visit, body: { title: 'Finance share is read-only', description: 'Since Monday.', priority: 'P2' } })).status).toBe(200);
      const readsBefore = h.storyReads.length;
      expect((await h.call('PATCH', '/api/v1/tickets/INC-000101', { visit, body: { priority: 'P1' } })).status).toBe(200);
      expect(h.storyReads.length).toBe(readsBefore);
      // An ordinary ticket's title is the visitor's to change.
      expect((await h.call('PATCH', '/api/v1/tickets/INC-000102', { visit, body: { title: 'Printer on floor 2 jammed', description: null } })).status).toBe(200);
      // A ticket the visitor cannot see is the route's own 404.
      expect((await h.call('PATCH', '/api/v1/tickets/INC-404', { visit, body: { title: 'x' } })).status).toBe(404);
    });
  });

  describe('6 · fail closed', () => {
    it('answers 503 demo_unavailable "store" when Redis errors, and runs nothing', async () => {
      const visit = newVisit();
      h.store.fail('throw');
      const before = counter('demo_budget_unavailable_total');
      for (const [method, url] of [['GET', '/api/v1/tickets'], ['POST', '/api/v1/major-incidents']] as const) {
        const response = await h.call(method, url, { visit, body: method === 'GET' ? undefined : {} });
        expect(response.status).toBe(503);
        expect(code(response.body)).toBe('demo_unavailable');
        expect(response.body).toMatchObject({ demo: true, reason: 'store' });
      }
      expect(h.handled).toEqual([]);
      expect(counter('demo_budget_unavailable_total')).toBe(before + 2);
    });

    it('answers 503 when Redis does not answer at all, after the store timeout', async () => {
      const visit = newVisit();
      h.store.fail('hang');
      const started = Date.now();
      const response = await h.call('GET', '/api/v1/tickets', { visit });
      expect(response.status).toBe(503);
      expect(response.body.reason).toBe('store');
      expect(Date.now() - started).toBeGreaterThanOrEqual(1_900);
    }, 10_000);

    it('keeps the answer when a give-back fails', async () => {
      const visit = newVisit();
      const original = h.store.giveBackCap.bind(h.store);
      h.store.giveBackCap = async () => {
        throw new Error('connection lost');
      };
      const response = await h.call('POST', '/api/v1/major-incidents', { visit, body: { fail: 'validation' } });
      expect(response.status).toBe(422);
      h.store.giveBackCap = original;
    });
  });

  it('uses the shared Redis store unless an app is given one, and the seam restores it', () => {
    expect(() => setDemoCounterStore(memoryStore())).not.toThrow();
    expect(() => setDemoCounterStore(null)).not.toThrow();
  });
});

describe('the Lua replies', () => {
  it('reads the spend and cap replies, and refuses anything else rather than guessing', () => {
    expect(interpretSpendReply(['ok', -1])).toEqual({ ok: true, tenantWrites: null });
    expect(interpretSpendReply(['ok', 21])).toEqual({ ok: true, tenantWrites: 21 });
    for (const budget of ['reads', 'writes-minute', 'writes-visit', 'writes-bucket', 'writes-ceiling'] as const) {
      expect(interpretSpendReply([budget])).toEqual({ ok: false, budget });
    }
    expect(interpretCapReply(['ok'])).toEqual({ ok: true });
    expect(interpretCapReply(['visit'])).toEqual({ ok: false, exhausted: 'visit' });
    expect(interpretCapReply(['generation'])).toEqual({ ok: false, exhausted: 'generation' });
    for (const reply of [null, 'ok', [], [1], ['maybe']]) {
      expect(() => interpretSpendReply(reply)).toThrow();
      expect(() => interpretCapReply(reply)).toThrow();
    }
  });

  it('counts the seconds to the next window, never zero', () => {
    const at = Date.UTC(2026, 9, 3, 10, 15, 30, 250);
    expect(secondsUntilNextWindow('m', at)).toBe(30);
    expect(secondsUntilNextWindow('h', at)).toBe(44 * 60 + 30);
    expect(secondsUntilNextWindow('m', Date.UTC(2026, 9, 3, 10, 15, 0))).toBe(60);
    expect(secondsUntilNextWindow('m', Date.UTC(2026, 9, 3, 10, 15, 59, 999))).toBe(1);
  });
});

/* ================================================================== 3. The operator guard and the seeded dashboards */

describe('the platform routes leave the demo tenant to its build (Y-M13)', () => {
  const demoTenant = randomUUID();
  const standardTenant = randomUUID();
  let app: FastifyInstance;

  beforeAll(async () => {
    tenancy.kinds.set(demoTenant, 'demo');
    tenancy.kinds.set(standardTenant, 'standard');
    app = Fastify({ logger: false });
    await app.register(errorsPlugin);
    app.addHook('preHandler', async (request) => {
      // A platform operator: the routes' own hook checks platform.tenant.manage.
      request.tenantContext = createContext({ tenantId: standardTenant, actor: { type: 'integration', id: null }, permissions: SYSTEM_PERMISSIONS });
    });
    await app.register(platformRoutes, { prefix: '/api/platform/v1' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    tenancy.calls.length = 0;
  });

  const mutations = (id: string) =>
    [
      ['POST', `/api/platform/v1/tenants/${id}/suspend`, { reason: 'testing' }],
      ['POST', `/api/platform/v1/tenants/${id}/resume`, {}],
      ['PUT', `/api/platform/v1/tenants/${id}/plan`, { planKey: 'professional' }],
      ['PUT', `/api/platform/v1/tenants/${id}/ai-regions`, { regions: ['eu-west'] }],
    ] as const;

  it('answers 409 "Use pnpm platform demo pause" for every lifecycle and plan change to a demo tenant, and changes nothing', async () => {
    for (const [method, url, body] of mutations(demoTenant)) {
      const response = await app.inject({ method, url, payload: body });
      expect(response.statusCode, url).toBe(409);
      const problem = response.json() as { type: string; detail: string };
      expect(problem.type.split('/').pop()).toBe('conflict');
      expect(problem.detail).toBe(DEMO_TENANT_MANAGED);
      expect(problem.detail).toContain('pnpm platform demo pause');
    }
    expect(tenancy.calls).toEqual([]);
  });

  it('leaves a standard tenant’s lifecycle and plan to the operator', async () => {
    for (const [method, url, body] of mutations(standardTenant)) {
      const response = await app.inject({ method, url, payload: body });
      expect(response.statusCode, url).toBe(200);
    }
    expect(tenancy.calls).toEqual([`suspend ${standardTenant}`, `resume ${standardTenant}`, `plan ${standardTenant} professional`, `regions ${standardTenant}`]);
  });

  it('never provisions a demo tenant by hand: only the demo build makes one', async () => {
    const refused = await app.inject({ method: 'POST', url: '/api/platform/v1/tenants', payload: { name: 'Demo', slug: 'demo-by-hand', kind: 'demo' } });
    expect(refused.statusCode).toBe(422);
    expect(refused.json()).toMatchObject({ errors: [{ field: 'kind', code: 'demo_managed' }] });
    expect(tenancy.calls).toEqual([]);
    const made = await app.inject({ method: 'POST', url: '/api/platform/v1/tenants', payload: { name: 'Acme', slug: 'acme-two' } });
    expect(made.statusCode).toBe(201);
    expect(tenancy.calls).toEqual(['provision acme-two']);
  });
});

describe('the seeded shared dashboards in the demo (A3 §7.5)', () => {
  const demo: DemoContext = { sid: `demo-${randomUUID()}`, persona: 'admin', app: 'admin', generation: 3, personaUserIds: PERSONAS, agentTeamIds: [] };
  const jordan = createContext({ tenantId: TENANT, actor: { type: 'user', id: PERSONAS.admin }, permissions: SYSTEM_PERMISSIONS, demo });
  const realAdmin = createContext({ tenantId: TENANT, actor: { type: 'user', id: PERSONAS.admin }, permissions: SYSTEM_PERMISSIONS });

  it('refuses a seeded dashboard in a demo context as shared-dashboards, before the permission check', () => {
    const viewer = createContext({ tenantId: TENANT, actor: { type: 'user', id: randomUUID() }, permissions: EMPTY_PERMISSIONS, demo });
    for (const ctx of [jordan, viewer]) {
      expect(() => dashboardService.requireEditable(ctx, { ownerId: null, seeded: true })).toThrowError(
        expect.objectContaining({ code: 'demo_disabled', feature: 'shared-dashboards' }),
      );
    }
  });

  it('leaves a visitor’s own dashboards, and every real tenant’s, as they were', () => {
    expect(() => dashboardService.requireEditable(jordan, { ownerId: null, seeded: false })).not.toThrow();
    expect(() => dashboardService.requireEditable(jordan, { ownerId: PERSONAS.admin, seeded: false })).not.toThrow();
    expect(() => dashboardService.requireEditable(realAdmin, { ownerId: null, seeded: true })).not.toThrow();
    const reader = createContext({ tenantId: TENANT, actor: { type: 'user', id: randomUUID() }, permissions: EMPTY_PERMISSIONS });
    expect(() => dashboardService.requireEditable(reader, { ownerId: null, seeded: true })).toThrowError(expect.objectContaining({ code: 'forbidden' }));
  });
});

/* ================================================================== 4. Listening without IPv6 */

describe('where the API listens', () => {
  it('prefers dual-stack ::, falls back to 0.0.0.0, and API_HOST names exactly one address', () => {
    expect(listenHosts({})).toEqual(['::', '0.0.0.0']);
    expect(listenHosts({ API_HOST: '  ' })).toEqual(['::', '0.0.0.0']);
    expect(listenHosts({ API_HOST: '127.0.0.1' })).toEqual(['127.0.0.1']);
  });

  function listener(failures: Record<string, string>) {
    const tried: string[] = [];
    return {
      tried,
      listen: async ({ host }: { port?: number; host?: string }) => {
        tried.push(host ?? '');
        const failure = failures[host ?? ''];
        if (failure) throw Object.assign(new Error(`listen ${failure}`), { code: failure });
        return `http://${host}`;
      },
    };
  }

  it('falls back only when the host has no IPv6', async () => {
    const ipv4Only = listener({ '::': 'EAFNOSUPPORT' });
    await expect(listenOnFirstHost(ipv4Only as never, 3000, ['::', '0.0.0.0'])).resolves.toBe('0.0.0.0');
    expect(ipv4Only.tried).toEqual(['::', '0.0.0.0']);

    const dualStack = listener({});
    await expect(listenOnFirstHost(dualStack as never, 3000, ['::', '0.0.0.0'])).resolves.toBe('::');
    expect(dualStack.tried).toEqual(['::']);
  });

  it('still fails to start on any other error, or when the last address fails', async () => {
    const inUse = listener({ '::': 'EADDRINUSE' });
    await expect(listenOnFirstHost(inUse as never, 3000, ['::', '0.0.0.0'])).rejects.toMatchObject({ code: 'EADDRINUSE' });
    expect(inUse.tried).toEqual(['::']);
    const nowhere = listener({ '::1': 'EAFNOSUPPORT' });
    await expect(listenOnFirstHost(nowhere as never, 3000, ['::1'])).rejects.toMatchObject({ code: 'EAFNOSUPPORT' });
  });
});
