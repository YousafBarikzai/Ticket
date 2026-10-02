import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { problemDetailsSchema, problemExtensionsSchema, type ProblemExtensions } from '@itsm/contracts';
import {
  DEMO_COPY,
  DEMO_FEATURES,
  DEMO_STRIPPED_PERMISSIONS,
  demoDisabledSentence,
  demoLimitSentence,
} from '@itsm/contracts/demo';
import { authz, buildPermissionSet, type GrantedPermission } from '../authz.js';
import { loadConfig, resetConfig } from '../config.js';
import { SYSTEM_PERMISSIONS, createContext, type DemoContext } from '../context.js';
import {
  DEMO_TENANT_CACHE_SIZE,
  DemoDisabledError,
  DemoLimitError,
  DemoResetError,
  DemoSessionEndedError,
  DemoUnavailableError,
  checkDemoInterlock,
  clearDemoTenantCache,
  demoDisabledForForbidden,
  demoInterlock,
  demoJobOptions,
  isDemoTenant,
  setTenantKindReader,
  stripDemoPermissions,
} from '../demo.js';
import { DomainError, ForbiddenError, NotFoundError, RateLimitedError, toProblemDetails } from '../errors.js';
import { ALL_QUEUES, QUEUE_FAMILIES, queuesForFamilies } from '../jobs.js';
import { logger } from '../telemetry.js';

/**
 * The shared demo's platform core (SPEC v3 §4.4, §4.7.1, §4.7.2, §4.9; WP-12).
 * Everything here is pure or runs against an injected reader: the database
 * and Redis halves are the integration suites' (`demo-auth`, `demo-egress`,
 * `tenant-isolation`).
 */

const STANDARD_ID = '11111111-1111-4111-8111-111111111111';
const DEMO_ID = '22222222-2222-4222-8222-222222222222';
const MISSING_ID = '33333333-3333-4333-8333-333333333333';
const SCHEDULER_ID = '00000000-0000-0000-0000-000000000000';

const DEMO: DemoContext = {
  sid: 'demo-0b6f3c1e-2a4d-4c1b-9e3f-5a6b7c8d9e0f',
  persona: 'agent',
  app: 'workbench',
  generation: 41,
  personaUserIds: {
    employee: '44444444-4444-4444-8444-444444444444',
    agent: '55555555-5555-4555-8555-555555555555',
    admin: '66666666-6666-4666-8666-666666666666',
  },
  agentTeamIds: ['77777777-7777-4777-8777-777777777777'],
};

function grant(key: string, scope: GrantedPermission['scope'] = 'any'): GrantedPermission {
  return { key, scope };
}

const STRIPPED_KEYS = Object.keys(DEMO_STRIPPED_PERMISSIONS);
const KEPT_KEYS = [
  'ticket.read',
  'ticket.update',
  'integration.read',
  'channel.read',
  'identity.user.manage',
  'tenant.limit.manage',
  'ai.suggest',
  'ai.decision.read',
  'audit.read',
  // Near misses: a strip is exact or by the `platform.` prefix, never a substring.
  'webhook.manage.history',
  'platformer.read',
];

describe('stripDemoPermissions (§4.7.1)', () => {
  const everything = buildPermissionSet([
    ...STRIPPED_KEYS.map((key) => grant(key)),
    grant('platform.tenant.manage'),
    grant('platform.anything.at.all', 'own'),
    ...KEPT_KEYS.map((key) => grant(key, 'team')),
  ]);
  const stripped = stripDemoPermissions(everything);

  it.each(STRIPPED_KEYS)('behaves as if %s had never been granted', (key) => {
    expect(everything.has(key)).toBe(true);
    expect(stripped.has(key)).toBe(false);
    expect(stripped.has(key, 'own')).toBe(false);
    expect(stripped.scopeFor(key)).toBeUndefined();
    expect(stripped.keys()).not.toContain(key);
    expect(stripped.grantsFor?.(key)).toEqual([]);
  });

  it('strips every key under the platform. prefix', () => {
    for (const key of ['platform.tenant.manage', 'platform.anything.at.all']) {
      expect(stripped.has(key)).toBe(false);
      expect(stripped.scopeFor(key)).toBeUndefined();
      expect(stripped.grantsFor?.(key)).toEqual([]);
    }
    expect(stripped.keys().some((key) => key.startsWith('platform.'))).toBe(false);
  });

  it.each(KEPT_KEYS)('keeps %s with its scope and grants', (key) => {
    expect(stripped.has(key)).toBe(true);
    expect(stripped.has(key, 'team')).toBe(true);
    expect(stripped.has(key, 'any')).toBe(false);
    expect(stripped.scopeFor(key)).toBe('team');
    expect(stripped.grantsFor?.(key)).toEqual([grant(key, 'team')]);
  });

  it('lists exactly the kept keys, sorted as the set lists them', () => {
    expect(stripped.keys()).toEqual([...KEPT_KEYS].sort());
  });

  it('is what authorisation sees: a stripped key is refused, a kept one allowed', () => {
    const ctx = createContext({ tenantId: DEMO_ID, actor: { type: 'user', id: DEMO.personaUserIds.admin }, permissions: stripped });
    expect(authz.can(ctx, 'webhook.manage')).toBe(false);
    expect(() => authz.require(ctx, 'identity.role.manage')).toThrow(ForbiddenError);
    expect(authz.effectiveScope(ctx, 'audit.export')).toBeUndefined();
    expect(authz.can(ctx, 'ticket.read')).toBe(true);
  });

  it('never claims isSystem, so nothing short-circuits past the strip-list', () => {
    const fromSystem = stripDemoPermissions(SYSTEM_PERMISSIONS);
    expect(fromSystem.isSystem).toBeUndefined();
    expect(fromSystem.has('ticket.read')).toBe(true);
    expect(fromSystem.has('migration.manage')).toBe(false);
    expect(fromSystem.has('platform.tenant.manage')).toBe(false);
    const ctx = createContext({ tenantId: DEMO_ID, actor: { type: 'system', id: null }, permissions: fromSystem });
    expect(authz.can(ctx, 'statuspage.manage')).toBe(false);
    expect(authz.effectiveScope(ctx, 'statuspage.manage')).toBeUndefined();
    expect(authz.can(ctx, 'ticket.read')).toBe(true);
  });

  it('is idempotent and leaves the original set untouched', () => {
    expect(stripDemoPermissions(stripped)).toBe(stripped);
    expect(everything.has('webhook.manage')).toBe(true);
  });

  it('offers grantsFor only when the original does', () => {
    const bare = stripDemoPermissions({ has: () => true, scopeFor: () => 'any', keys: () => ['ticket.read', 'audit.export'] });
    expect(bare.grantsFor).toBeUndefined();
    expect(bare.keys()).toEqual(['ticket.read']);
  });
});

describe('demo problems and their extension members (§4.4)', () => {
  it.each([
    { error: new DemoResetError(), status: 401, code: 'demo_reset', extensions: { demo: true } },
    { error: new DemoSessionEndedError(), status: 401, code: 'demo_session_ended', extensions: { demo: true } },
    { error: new DemoUnavailableError('store'), status: 503, code: 'demo_unavailable', extensions: { demo: true, reason: 'store' } },
    { error: new DemoUnavailableError('misconfigured'), status: 503, code: 'demo_unavailable', extensions: { demo: true, reason: 'misconfigured' } },
    { error: new DemoDisabledError('integrations'), status: 403, code: 'demo_disabled', extensions: { demo: true, feature: 'integrations' } },
    { error: new DemoLimitError('mi.declare', 1), status: 429, code: 'demo_limit', extensions: { demo: true, category: 'mi.declare', limit: 1 } },
    { error: new DemoLimitError('writes', 500), status: 429, code: 'demo_limit', extensions: { demo: true, category: 'writes', limit: 500 } },
  ])('$code ($status) carries $extensions', ({ error, status, code, extensions }) => {
    const problem = toProblemDetails(error, 'corr-demo', '/api/v1/tickets');
    expect(problem.status).toBe(status);
    expect(problem.type).toBe(`https://docs.itsm.example/problems/${code}`);
    const members = Object.fromEntries(
      Object.keys(problemExtensionsSchema.shape)
        .filter((key) => key in problem)
        .map((key) => [key, (problem as Record<string, unknown>)[key]]),
    );
    expect(members).toEqual(extensions);
    expect(problem.correlationId).toBe('corr-demo');
    expect(problem.instance).toBe('/api/v1/tickets');
    // The wire shape every client parses.
    expect(problemDetailsSchema.safeParse(problem).success).toBe(true);
  });

  it('words each detail from the shared copy, never from the API', () => {
    expect(toProblemDetails(new DemoDisabledError('uploads'), 'c').detail).toBe(demoDisabledSentence('uploads'));
    expect(toProblemDetails(new DemoLimitError('ticket.create', 25), 'c').detail).toBe(demoLimitSentence('ticket.create'));
    expect(toProblemDetails(new DemoLimitError('writes', 500), 'c').detail).toBe(demoLimitSentence('writes', { limit: 500 }));
    expect(toProblemDetails(new DemoLimitError('writes', 500), 'c').detail).toContain('each visit can make 500 changes');
    expect(toProblemDetails(new DemoUnavailableError('paused'), 'c').detail).toBe(DEMO_COPY.unavailable);
    expect(toProblemDetails(new DemoSessionEndedError(), 'c').detail).toBe(DEMO_COPY.sessionEnded);
  });

  it('titles a disabled feature "Not available in the demo" and the rest by code', () => {
    expect(toProblemDetails(new DemoDisabledError('roles'), 'c').title).toBe('Not available in the demo');
    expect(toProblemDetails(new DemoResetError(), 'c').title).toBe('demo reset');
    expect(toProblemDetails(new NotFoundError('ticket'), 'c').title).toBe('not found');
  });

  it('has a sentence and a valid problem for every feature', () => {
    for (const feature of DEMO_FEATURES) {
      const problem = toProblemDetails(new DemoDisabledError(feature), 'c');
      expect(problem.feature).toBe(feature);
      expect(problem.detail).toMatch(/^This is a shared demo, so .+ is turned off\. Everything else works as in the full product\.$/);
      expect(problemDetailsSchema.safeParse(problem).success).toBe(true);
    }
  });

  it('adds no member to a problem that has none', () => {
    const problem = toProblemDetails(new NotFoundError('ticket', 'abc'), 'corr-2', '/x');
    expect(Object.keys(problem).sort()).toEqual(['correlationId', 'detail', 'instance', 'status', 'title', 'type']);
  });

  it('puts the wait of a rate limit in the body, whole seconds rounded up', () => {
    expect(toProblemDetails(new RateLimitedError(20), 'c').retryAfterSec).toBe(20);
    expect(toProblemDetails(new RateLimitedError(19.2), 'c').retryAfterSec).toBe(20);
    expect(toProblemDetails(new RateLimitedError(-3), 'c').retryAfterSec).toBe(0);
    expect(toProblemDetails(new RateLimitedError(Number.NaN), 'c')).not.toHaveProperty('retryAfterSec');
  });

  it('writes every member the schema knows, and nothing that could overwrite a standard one', () => {
    const all: ProblemExtensions = { demo: true, feature: 'sso', category: 'writes', limit: 3, reason: 'paused', retryAfterSec: 9 };
    class Everything extends DomainError {
      readonly status = 418;
      readonly code = 'everything';
      override problemExtensions(): ProblemExtensions {
        return { ...all, status: 200, type: 'x', correlationId: 'forged' } as unknown as ProblemExtensions;
      }
    }
    const problem = toProblemDetails(new Everything('m'), 'corr-real');
    for (const key of Object.keys(problemExtensionsSchema.shape)) {
      expect(problem, `member ${key}`).toHaveProperty(key, all[key as keyof ProblemExtensions]);
    }
    expect(problem.status).toBe(418);
    expect(problem.type).toBe('https://docs.itsm.example/problems/everything');
    expect(problem.correlationId).toBe('corr-real');
  });

  it('turns a permission failure on a stripped key into demo_disabled, and nothing else', () => {
    expect(demoDisabledForForbidden(new ForbiddenError('webhook.manage'))?.feature).toBe('integrations');
    expect(demoDisabledForForbidden(new ForbiddenError('notification.template.manage'))?.feature).toBe('notifications');
    expect(demoDisabledForForbidden(new ForbiddenError('platform.tenant.manage'))?.feature).toBe('platform');
    expect(demoDisabledForForbidden(new ForbiddenError('ticket.update'))).toBeNull();
    expect(demoDisabledForForbidden(new NotFoundError('ticket'))).toBeNull();
    expect(demoDisabledForForbidden(new Error('webhook.manage'))).toBeNull();
    expect(demoDisabledForForbidden(null)).toBeNull();
  });
});

describe('isDemoTenant (§4.7.2)', () => {
  let reads: string[];
  let table: Map<string, string>;

  beforeEach(() => {
    reads = [];
    table = new Map([
      [STANDARD_ID, 'standard'],
      [DEMO_ID, 'demo'],
    ]);
    setTenantKindReader(async (id) => {
      reads.push(id);
      return table.get(id) ?? null;
    });
  });

  afterEach(() => setTenantKindReader(null));

  it('reads the kind: demo is true, standard is false', async () => {
    expect(await isDemoTenant(DEMO_ID)).toBe(true);
    expect(await isDemoTenant(STANDARD_ID)).toBe(false);
  });

  it('caches positive and negative answers for the life of the process', async () => {
    await isDemoTenant(DEMO_ID);
    await isDemoTenant(STANDARD_ID);
    // Even if the row changed (it cannot: kind is immutable), the answer stands.
    table.set(DEMO_ID, 'standard');
    table.set(STANDARD_ID, 'demo');
    expect(await isDemoTenant(DEMO_ID)).toBe(true);
    expect(await isDemoTenant(STANDARD_ID)).toBe(false);
    expect(reads).toEqual([DEMO_ID, STANDARD_ID]);
  });

  it('treats a missing row as the demo and never caches it', async () => {
    expect(await isDemoTenant(MISSING_ID)).toBe(true);
    expect(await isDemoTenant(MISSING_ID)).toBe(true);
    expect(reads).toEqual([MISSING_ID, MISSING_ID]);
    // A row that appears later is read afresh.
    table.set(MISSING_ID, 'standard');
    expect(await isDemoTenant(MISSING_ID)).toBe(false);
  });

  it('answers false for the scheduler nil id without a read', async () => {
    expect(await isDemoTenant(SCHEDULER_ID)).toBe(false);
    expect(reads).toEqual([]);
  });

  it('treats an unknown kind or an empty id as the demo: anything unexpected suppresses egress', async () => {
    table.set(STANDARD_ID, 'sandbox');
    expect(await isDemoTenant(STANDARD_ID)).toBe(true);
    expect(await isDemoTenant('')).toBe(true);
  });

  it('throws on a read error, caches nothing, and reads again next time', async () => {
    setTenantKindReader(async (id) => {
      reads.push(id);
      throw new Error('connection refused');
    });
    await expect(isDemoTenant(STANDARD_ID)).rejects.toThrow('connection refused');
    await expect(isDemoTenant(STANDARD_ID)).rejects.toThrow('connection refused');
    expect(reads).toEqual([STANDARD_ID, STANDARD_ID]);
  });

  it('shares one read among concurrent callers', async () => {
    let release: (kind: string) => void = () => undefined;
    setTenantKindReader((id) => {
      reads.push(id);
      return new Promise((resolve) => {
        release = resolve;
      });
    });
    const answers = Promise.all([isDemoTenant(DEMO_ID), isDemoTenant(DEMO_ID), isDemoTenant(DEMO_ID)]);
    release('demo');
    expect(await answers).toEqual([true, true, true]);
    expect(reads).toEqual([DEMO_ID]);
  });

  it(`remembers at most ${DEMO_TENANT_CACHE_SIZE} tenants, dropping the least recently used`, async () => {
    const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
    setTenantKindReader(async (tenantId) => {
      reads.push(tenantId);
      return 'standard';
    });
    for (let n = 1; n <= DEMO_TENANT_CACHE_SIZE; n += 1) await isDemoTenant(id(n));
    // Touch the oldest, so the second-oldest becomes the least recently used.
    await isDemoTenant(id(1));
    await isDemoTenant(id(DEMO_TENANT_CACHE_SIZE + 1));
    reads = [];
    await isDemoTenant(id(1));
    await isDemoTenant(id(DEMO_TENANT_CACHE_SIZE));
    expect(reads).toEqual([]);
    await isDemoTenant(id(2));
    expect(reads).toEqual([id(2)]);
  });

  it('forgets every answer when the reader is replaced or the cache cleared', async () => {
    await isDemoTenant(DEMO_ID);
    clearDemoTenantCache();
    await isDemoTenant(DEMO_ID);
    expect(reads).toEqual([DEMO_ID, DEMO_ID]);
  });

  it('with the database reader, a malformed id reads as a missing row without a query', async () => {
    setTenantKindReader(null);
    // No configuration is loaded here, so a query would throw rather than answer.
    await expect(isDemoTenant('not-a-uuid')).resolves.toBe(true);
    await expect(isDemoTenant("'; DROP TABLE tenant; --")).resolves.toBe(true);
  });
});

describe('the boot interlock (§4.9)', () => {
  const on = (slug: string, bootstrap?: string) => ({
    DEMO_MODE: 'on' as const,
    DEMO_TENANT_SLUG: slug,
    ...(bootstrap === undefined ? {} : { BOOTSTRAP_TENANT_SLUG: bootstrap }),
  });

  it('is off, whatever the slug, when the demo is off', () => {
    expect(demoInterlock({ DEMO_MODE: 'off', DEMO_TENANT_SLUG: 'acme' })).toEqual({ mode: 'off', ready: false });
    expect(demoInterlock({ DEMO_MODE: 'off', DEMO_TENANT_SLUG: 'demo' })).toEqual({ mode: 'off', ready: false });
  });

  it.each(['demo', 'demo-uk', 'demo-2026-10', 'demo-gen-test', 'demo--x'])('accepts %j', (slug) => {
    expect(demoInterlock(on(slug))).toEqual({ mode: 'on', ready: true, slug });
  });

  it.each(['acme', 'Demo', 'DEMO', 'demo_uk', 'demox', 'demo-', 'demo-UK', ' demo', 'demo ', '', 'my-demo'])('refuses %j as not a demo slug', (slug) => {
    expect(demoInterlock(on(slug))).toEqual({ mode: 'on', ready: false, slug, problem: 'slug_pattern' });
  });

  it('refuses the operator\'s own bootstrap tenant, however it is spelled', () => {
    expect(demoInterlock(on('demo', 'demo'))).toMatchObject({ ready: false, problem: 'bootstrap_slug' });
    expect(demoInterlock(on('demo-uk', ' Demo-UK '))).toMatchObject({ ready: false, problem: 'bootstrap_slug' });
    expect(demoInterlock(on('demo', 'acme'))).toEqual({ mode: 'on', ready: true, slug: 'demo' });
    expect(demoInterlock(on('demo', '   '))).toEqual({ mode: 'on', ready: true, slug: 'demo' });
  });

  it('logs a refusal once per configuration and never throws', () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    try {
      const bad = on('acme');
      expect(checkDemoInterlock(bad)).toMatchObject({ ready: false, problem: 'slug_pattern' });
      expect(checkDemoInterlock(bad)).toMatchObject({ ready: false });
      expect(error).toHaveBeenCalledTimes(1);
      expect(error.mock.calls[0]?.[1]).toMatchObject({ problem: 'slug_pattern', slug: 'acme' });
      checkDemoInterlock(on('demo', 'demo'));
      expect(error).toHaveBeenCalledTimes(2);
      checkDemoInterlock(on('demo'));
      checkDemoInterlock({ DEMO_MODE: 'off', DEMO_TENANT_SLUG: 'acme' });
      expect(error).toHaveBeenCalledTimes(2);
    } finally {
      error.mockRestore();
    }
  });
});

describe('demo configuration (§4.9)', () => {
  const minimal = { DATABASE_URL_APP: 'postgresql://app_user:pw@127.0.0.1:5432/itsm' };

  beforeEach(() => resetConfig());
  afterEach(() => resetConfig());

  it('defaults every demo key, with the demo off', () => {
    expect(loadConfig(minimal)).toMatchObject({
      DEMO_MODE: 'off',
      DEMO_TENANT_SLUG: 'demo',
      DEMO_RESET_COOLDOWN_SECONDS: 1800,
      DEMO_WRITES_PER_MINUTE: 30,
      DEMO_WRITES_PER_SESSION: 500,
      DEMO_WRITES_PER_IP_HOUR: 2000,
      DEMO_WRITES_ALERT_PER_HOUR: 20_000,
      DEMO_READS_PER_IP_MINUTE: 1200,
      DEMO_SEED: 20_261_002,
      DEMO_SCALE: 1,
      DEMO_HISTORY_DAYS: 120,
      DEMO_BUILD_TIMEOUT_SECONDS: 900,
      DEMO_BUILD_PARALLELISM: 2,
      ANALYTICS_QUERY_CACHE_SECONDS: 0,
    });
    expect(loadConfig(minimal).BOOTSTRAP_TENANT_SLUG).toBeUndefined();
  });

  it('reads the values a deployment sets', () => {
    expect(
      loadConfig({
        ...minimal,
        DEMO_MODE: 'on',
        DEMO_TENANT_SLUG: 'demo-uk',
        BOOTSTRAP_TENANT_SLUG: 'acme',
        DEMO_SCALE: '0.2',
        DEMO_BUILD_PARALLELISM: '4',
        ANALYTICS_QUERY_CACHE_SECONDS: '120',
      }),
    ).toMatchObject({ DEMO_MODE: 'on', DEMO_TENANT_SLUG: 'demo-uk', BOOTSTRAP_TENANT_SLUG: 'acme', DEMO_SCALE: 0.2, DEMO_BUILD_PARALLELISM: 4, ANALYTICS_QUERY_CACHE_SECONDS: 120 });
  });

  it('starts with a bad demo slug, so the interlock (not the boot) refuses it', () => {
    const config = loadConfig({ ...minimal, DEMO_MODE: 'on', DEMO_TENANT_SLUG: 'acme' });
    expect(demoInterlock(config)).toMatchObject({ mode: 'on', ready: false, problem: 'slug_pattern' });
  });

  it.each([
    ['DEMO_MODE', 'true'],
    ['DEMO_SCALE', '0.05'],
    ['DEMO_SCALE', '2'],
    ['DEMO_HISTORY_DAYS', '59'],
    ['DEMO_HISTORY_DAYS', '151'],
    ['DEMO_BUILD_PARALLELISM', '0'],
    ['DEMO_WRITES_PER_MINUTE', '0'],
    ['DEMO_RESET_COOLDOWN_SECONDS', '10'],
    ['ANALYTICS_QUERY_CACHE_SECONDS', '601'],
  ])('refuses %s=%s', (key, value) => {
    expect(() => loadConfig({ ...minimal, [key]: value })).toThrow(new RegExp(key));
  });
});

describe('demo jobs (Y-B3, R3)', () => {
  it('runs each demo job once and keeps none, so a deterministic id is never swallowed', () => {
    expect(demoJobOptions).toEqual({ attempts: 1, removeOnComplete: true, removeOnFail: true });
    expect(Object.isFrozen(demoJobOptions)).toBe(true);
    expect({ ...demoJobOptions, jobId: 'demo-reset-manual-g41-a2' }).toMatchObject({ attempts: 1, jobId: 'demo-reset-manual-g41-a2' });
  });

  it('puts the demo queue in the data family, so worker-data runs it', () => {
    expect(QUEUE_FAMILIES.data).toContain('demo');
    expect(queuesForFamilies('data')).toContain('demo');
    expect(queuesForFamilies('demo')).toEqual(['demo']);
    expect(ALL_QUEUES).toContain('demo');
    for (const family of ['events', 'engine', 'comms'] as const) expect(queuesForFamilies(family)).not.toContain('demo');
  });
});

describe('the demo context (§4.4, D23)', () => {
  const base = { tenantId: DEMO_ID, actor: { type: 'user' as const, id: DEMO.personaUserIds.agent }, permissions: SYSTEM_PERMISSIONS };

  it('carries the visit and never the visitor\'s address or browser', () => {
    const ctx = createContext({ ...base, demo: DEMO, ip: '203.0.113.7', userAgent: 'Mozilla/5.0' });
    expect(ctx.demo).toEqual(DEMO);
    expect(ctx).not.toHaveProperty('ip');
    expect(ctx).not.toHaveProperty('userAgent');
  });

  it('leaves a standard context as it was', () => {
    const ctx = createContext({ ...base, tenantId: STANDARD_ID, ip: '203.0.113.7', userAgent: 'Mozilla/5.0' });
    expect(ctx).not.toHaveProperty('demo');
    expect(ctx.ip).toBe('203.0.113.7');
    expect(ctx.userAgent).toBe('Mozilla/5.0');
  });
});
