import { createHash } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEMO_KEYS,
  DEMO_STRIPPED_PERMISSIONS,
  type DemoLiveRecord,
  type DemoTokenRecord,
} from '@itsm/contracts/demo';

/**
 * Shared-demo token verification and the database interlock (SPEC v3 §4.4;
 * A3 §4.3–§4.5, §11.1).
 *
 * `verifyDemoToken` runs against an injected record reader standing in for
 * Redis, so every step's refusal — and the order of the steps — is pinned
 * without a server. The context plugin runs for real, under the real error
 * handler, with the two directory lookups it makes (the tenant row and the
 * actor) replaced: what is asserted is what it decides from them. The same
 * rows against Postgres and Redis are `tests/integration/demo-auth.test.ts`.
 */

const identity = vi.hoisted(() => ({
  actors: new Map<string, unknown>(),
  provisioned: 0,
}));
const tenancy = vi.hoisted(() => ({ tenants: new Map<string, { id: string; kind: string; status: string; region: string; aiAllowedRegions: string[] }>() }));

vi.mock('@itsm/module-identity', () => ({
  resolveActor: async (_ctx: unknown, userId: string) => identity.actors.get(userId) ?? null,
  scimTokenService: {
    authenticate: async () => ({ tenantId: DEMO_TENANT, region: 'eu-west', permissions: { has: () => false, scopeFor: () => undefined, keys: () => [] } }),
  },
  userService: {
    provisionFromToken: async () => {
      identity.provisioned += 1;
      return { userId: 'never' };
    },
  },
}));

vi.mock('@itsm/module-tenancy', () => ({
  tenantService: {
    findTenantById: async (id: string) => tenancy.tenants.get(id) ?? null,
    findTenantByHost: async () => null,
  },
}));

const platform = await import('@itsm/platform');
const { buildPermissionSet, metrics, logger, resetConfig, setTenantKindReader } = platform;
const { setDemoRecordReader, verifyDemoToken, demoTokenHash, DEMO_STORE_TIMEOUT_MS } = await import('../auth/demo-token.js');
const { verifyAccessToken, signDevelopmentToken } = await import('../auth/verify.js');
const { assertTenantAccepts, contextPlugin } = await import('../plugins/context.js');
const { errorsPlugin } = await import('../plugins/errors.js');

const DEMO_TENANT = '0190f3a5-0000-7000-8000-00000000d001';
const STANDARD_TENANT = '0190f3a5-0000-7000-8000-00000000a001';
const EMMA = '0190f3a5-0000-7000-8000-0000000000e1';
const ALEX = '0190f3a5-0000-7000-8000-0000000000a1';
const JORDAN = '0190f3a5-0000-7000-8000-0000000000f1';
const SERVICE_DESK = '0190f3a5-0000-7000-8000-0000000000c1';
const SID = 'demo-6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b';
// Real time: the context plugin verifies with the clock, so the records must be current.
const NOW = Date.now();

/** A well-formed token: the prefix and 43 base64url characters. */
function token(fill = 'A'): string {
  return `itsmdemo_${fill.repeat(43).slice(0, 43)}`;
}

function liveRecord(overrides: Partial<DemoLiveRecord> = {}): DemoLiveRecord {
  return {
    v: 1,
    tenantId: DEMO_TENANT,
    slug: 'demo',
    generation: 41,
    builtAt: NOW - 3_600_000,
    anchor: NOW - 3_600_000,
    lastResetAt: NOW - 3_600_000,
    lastResetReason: 'scheduled',
    personas: { employee: { userId: EMMA }, agent: { userId: ALEX }, admin: { userId: JORDAN } },
    agentTeamIds: [SERVICE_DESK],
    ...overrides,
  };
}

function tokenRecord(overrides: Partial<DemoTokenRecord> = {}): DemoTokenRecord {
  return {
    v: 1,
    tenantId: DEMO_TENANT,
    userId: ALEX,
    persona: 'agent',
    app: 'workbench',
    sid: SID,
    gen: 41,
    iat: NOW - 60_000,
    exp: NOW + 840_000,
    ipb: '0123456789abcdef',
    ...overrides,
  };
}

/** What the stand-in Redis holds, and every key it was asked for. */
const store = {
  values: new Map<string, string>(),
  reads: [] as string[][],
  fail: null as Error | null,
  hang: false,
};

function putRecords(options: { token?: string; record?: DemoTokenRecord | string | null; live?: DemoLiveRecord | string | null; paused?: boolean } = {}): string {
  const bearer = options.token ?? token();
  const key = DEMO_KEYS.token(demoTokenHash(bearer));
  const record = options.record === undefined ? tokenRecord() : options.record;
  const live = options.live === undefined ? liveRecord() : options.live;
  if (record !== null) store.values.set(key, typeof record === 'string' ? record : JSON.stringify(record));
  if (live !== null) store.values.set(DEMO_KEYS.live, typeof live === 'string' ? live : JSON.stringify(live));
  if (options.paused) store.values.set(DEMO_KEYS.paused, JSON.stringify({ by: 'operator', at: NOW, reason: 'test' }));
  return bearer;
}

function demoEnv(overrides: Record<string, string> = {}): void {
  const env = { DATABASE_URL_APP: 'postgresql://app_user:pw@127.0.0.1:5432/itsm', DEMO_MODE: 'on', DEMO_TENANT_SLUG: 'demo', LOG_SILENT: '1', ...overrides };
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  resetConfig();
}

function counter(name: string, labels: Record<string, string>): number {
  const key = `${name}{${Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join(',')}}`;
  return metrics.snapshot().counters[key] ?? 0;
}

async function refusal(promise: Promise<unknown>): Promise<{ status: number; code: string; reason?: string }> {
  try {
    await promise;
  } catch (error) {
    const domain = error as { status: number; code: string; reason?: string };
    return { status: domain.status, code: domain.code, ...(domain.reason ? { reason: domain.reason } : {}) };
  }
  throw new Error('expected a refusal');
}

beforeEach(() => {
  demoEnv();
  store.values.clear();
  store.reads = [];
  store.fail = null;
  store.hang = false;
  setDemoRecordReader(async (keys) => {
    store.reads.push([...keys]);
    if (store.fail) throw store.fail;
    if (store.hang) return new Promise<never>(() => undefined);
    return keys.map((key) => store.values.get(key) ?? null);
  });
});

afterEach(() => {
  setDemoRecordReader(null);
  setTenantKindReader(null);
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  resetConfig();
});

describe('verifyDemoToken, in the order of §4.4', () => {
  it('1 · refuses every demo token when the demo is off, without reading Redis', async () => {
    demoEnv({ DEMO_MODE: 'off' });
    const bearer = putRecords();
    expect(await refusal(verifyDemoToken(bearer, NOW))).toEqual({ status: 401, code: 'demo_session_ended' });
    expect(store.reads).toEqual([]);
  });

  it('1 · refuses every demo token when the slug fails the boot interlock', async () => {
    demoEnv({ DEMO_TENANT_SLUG: 'northwind' });
    expect(await refusal(verifyDemoToken(putRecords(), NOW))).toEqual({ status: 401, code: 'demo_session_ended' });
    demoEnv({ DEMO_TENANT_SLUG: 'demo-main', BOOTSTRAP_TENANT_SLUG: 'Demo-Main' });
    expect(await refusal(verifyDemoToken(putRecords(), NOW))).toEqual({ status: 401, code: 'demo_session_ended' });
    expect(store.reads).toEqual([]);
  });

  it('2 · refuses a malformed bearer as unauthorised, and never looks it up', async () => {
    const malformed = [
      `itsmdemo_${'A'.repeat(42)}`,
      `itsmdemo_${'A'.repeat(44)}`,
      `itsmdemo_${'A'.repeat(42)}*`,
      `itsmdemo_${'A'.repeat(42)}:`,
      `itsmdemo_${'A'.repeat(21)}\n${'A'.repeat(21)}`,
      `itsmdemo_${'A'.repeat(43)}\n`,
      'itsmdemo_eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJlLWxvb2tpbmctcGFydA',
      'itsmdemo_',
    ];
    for (const bearer of malformed) {
      expect(await refusal(verifyDemoToken(bearer, NOW)), JSON.stringify(bearer)).toEqual({ status: 401, code: 'unauthorised' });
    }
    expect(store.reads).toEqual([]);
  });

  it('3 · reads the three records in one round trip, by the hash of the token and never the token', async () => {
    const bearer = putRecords();
    await verifyDemoToken(bearer, NOW);
    const hash = createHash('sha256').update(bearer).digest('hex');
    expect(store.reads).toEqual([[`demo:tok:${hash}`, 'demo:live', 'demo:paused']]);
    expect(store.reads.flat().some((key) => key.includes(bearer.slice('itsmdemo_'.length)))).toBe(false);
  });

  it('3 · fails closed with 503 store when Redis errors', async () => {
    store.fail = new Error('connect ECONNREFUSED 127.0.0.1:6379');
    expect(await refusal(verifyDemoToken(putRecords(), NOW))).toEqual({ status: 503, code: 'demo_unavailable', reason: 'store' });
  });

  it('3 · fails closed with 503 store when Redis does not answer in time', async () => {
    vi.useFakeTimers();
    store.hang = true;
    const pending = refusal(verifyDemoToken(putRecords(), NOW));
    await vi.advanceTimersByTimeAsync(DEMO_STORE_TIMEOUT_MS + 1);
    expect(await pending).toEqual({ status: 503, code: 'demo_unavailable', reason: 'store' });
  });

  it('4 · answers 503 paused while the operator has paused the demo, whatever the token', async () => {
    expect(await refusal(verifyDemoToken(putRecords({ paused: true }), NOW))).toEqual({ status: 503, code: 'demo_unavailable', reason: 'paused' });
    // An unreadable pause is still a pause.
    const bearer = putRecords({ record: 'not json' });
    store.values.set(DEMO_KEYS.paused, '1');
    expect(await refusal(verifyDemoToken(bearer, NOW))).toEqual({ status: 503, code: 'demo_unavailable', reason: 'paused' });
  });

  it('5 · ends the visit when the token record is missing, unreadable or not strictly valid', async () => {
    const cases: (DemoTokenRecord | string | null)[] = [
      null,
      'not json',
      JSON.stringify({ ...tokenRecord(), extra: true }),
      JSON.stringify({ ...tokenRecord(), v: 2 }),
      // An app paired with another area's persona: not something the mint writes.
      JSON.stringify({ ...tokenRecord(), app: 'admin' }),
      JSON.stringify({ ...tokenRecord(), sid: 'demo-not-a-visit' }),
    ];
    for (const record of cases) {
      store.values.clear();
      expect(await refusal(verifyDemoToken(putRecords({ record }), NOW)), String(record)).toEqual({ status: 401, code: 'demo_session_ended' });
    }
  });

  it('6 · ends the visit once the record has expired, even before its key does', async () => {
    const bearer = putRecords({ record: tokenRecord({ exp: NOW }) });
    expect(await refusal(verifyDemoToken(bearer, NOW))).toEqual({ status: 401, code: 'demo_session_ended' });
  });

  it('7 · answers 503 preparing when there is no live generation to check against', async () => {
    expect(await refusal(verifyDemoToken(putRecords({ live: null }), NOW))).toEqual({ status: 503, code: 'demo_unavailable', reason: 'preparing' });
    store.values.clear();
    expect(await refusal(verifyDemoToken(putRecords({ live: '{"v":1}' }), NOW))).toEqual({ status: 503, code: 'demo_unavailable', reason: 'preparing' });
  });

  it('8 · answers demo_reset when the demo was rebuilt since the token was minted', async () => {
    expect(await refusal(verifyDemoToken(putRecords({ live: liveRecord({ generation: 42 }) }), NOW))).toEqual({ status: 401, code: 'demo_reset' });
    store.values.clear();
    // The same generation number on another tenant is still another demo.
    const elsewhere = liveRecord({ tenantId: '0190f3a5-0000-7000-8000-00000000d002' });
    expect(await refusal(verifyDemoToken(putRecords({ live: elsewhere }), NOW))).toEqual({ status: 401, code: 'demo_reset' });
  });

  it('9 · ends the visit, and logs an eight-character hash, when the user is not the live persona', async () => {
    const error = vi.spyOn(logger, 'error');
    const bearer = putRecords({ live: liveRecord({ personas: { employee: { userId: EMMA }, agent: { userId: JORDAN }, admin: { userId: ALEX } } }) });
    expect(await refusal(verifyDemoToken(bearer, NOW))).toEqual({ status: 401, code: 'demo_session_ended' });
    expect(error).toHaveBeenCalledWith('demo token persona mismatch', { hash8: demoTokenHash(bearer).slice(0, 8), persona: 'agent' });
    expect(JSON.stringify(error.mock.calls)).not.toContain(bearer);
  });

  it('10 · returns the visitor identity: no email, the visit as subject, the generation and its personas', async () => {
    const before = counter('demo_verify_total', { result: 'ok' });
    const verified = await verifyDemoToken(putRecords(), NOW);
    expect(verified).toEqual({
      kind: 'user',
      tenantId: DEMO_TENANT,
      userId: ALEX,
      subject: `demo:${SID}`,
      sessionId: SID,
      expiresAt: Math.floor((NOW + 840_000) / 1000),
      name: 'Alex Morgan',
      demo: {
        sid: SID,
        persona: 'agent',
        app: 'workbench',
        generation: 41,
        issuedAt: NOW - 60_000,
        ipBucket: '0123456789abcdef',
        personaUserIds: { employee: EMMA, agent: ALEX, admin: JORDAN },
        agentTeamIds: [SERVICE_DESK],
      },
    });
    expect(verified).not.toHaveProperty('email');
    expect(counter('demo_verify_total', { result: 'ok' })).toBe(before + 1);
  });
});

describe('verifyAccessToken', () => {
  it('sends an itsmdemo_ bearer to the demo path even when an identity provider is configured', async () => {
    demoEnv({ OIDC_ISSUER: 'http://127.0.0.1:9/realms/none' });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const verified = await verifyAccessToken(`Bearer ${putRecords()}`);
    expect(verified.demo?.persona).toBe('agent');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('never tries a development token as a demo token, or the other way round', async () => {
    const dev = signDevelopmentToken({ sub: ALEX, itsm_user_id: ALEX, tenant_id: STANDARD_TENANT }, 'dev-only-not-a-secret');
    const verified = await verifyAccessToken(`Bearer ${dev}`);
    expect(verified.demo).toBeUndefined();
    expect(store.reads).toEqual([]);
  });
});

describe('the database interlock (D25), both ways', () => {
  const demoFacts = { demo: { sid: SID } as never };
  const tenant = (kind: string, status = 'active') => ({ id: kind === 'demo' ? DEMO_TENANT : STANDARD_TENANT, kind, status });

  it('accepts a demo token for the active demo tenant, and any other token for a standard one', () => {
    expect(() => assertTenantAccepts(demoFacts, tenant('demo'))).not.toThrow();
    expect(() => assertTenantAccepts({}, tenant('standard'))).not.toThrow();
    // A missing tenant for a real token is the caller's own 401.
    expect(() => assertTenantAccepts({}, null)).not.toThrow();
  });

  it('answers demo_reset for a demo tenant that is not active, or no longer exists', () => {
    for (const status of ['seeding', 'retired', 'suspended', 'provisioning']) {
      expect(() => assertTenantAccepts(demoFacts, tenant('demo', status))).toThrow(expect.objectContaining({ code: 'demo_reset', status: 401 }));
    }
    expect(() => assertTenantAccepts(demoFacts, null)).toThrow(expect.objectContaining({ code: 'demo_reset' }));
  });

  it('refuses a demo token naming a standard tenant, loudly', () => {
    const error = vi.spyOn(logger, 'error');
    const before = counter('demo_interlock_refusals_total', { reason: 'kind' });
    expect(() => assertTenantAccepts(demoFacts, tenant('standard'))).toThrow(expect.objectContaining({ code: 'unauthorised', status: 401 }));
    expect(counter('demo_interlock_refusals_total', { reason: 'kind' })).toBe(before + 1);
    expect(error).toHaveBeenCalledWith('SECURITY: a demo token named a standard tenant', { tenantId: STANDARD_TENANT });
  });

  it('refuses every other kind of token for the demo tenant', () => {
    const before = counter('demo_interlock_refusals_total', { reason: 'non-demo-token' });
    expect(() => assertTenantAccepts({}, tenant('demo'))).toThrow('this workspace only accepts demo sessions');
    expect(counter('demo_interlock_refusals_total', { reason: 'non-demo-token' })).toBe(before + 1);
  });
});

describe('the context plugin', () => {
  let app: FastifyInstance;

  const ALEX_ACTOR = {
    userId: ALEX,
    displayName: 'Alex Morgan',
    status: 'active',
    permissions: buildPermissionSet([
      { key: 'ticket.read', scope: 'team' },
      { key: 'webhook.manage', scope: 'any' },
      { key: 'ticket.attachment.add', scope: 'any' },
      { key: 'platform.tenant.manage', scope: 'any' },
    ]),
    organisationIds: [],
    organisationPaths: [],
    teamIds: [SERVICE_DESK],
    locale: 'en-GB',
    timeZone: 'Europe/London',
  };

  async function build(): Promise<FastifyInstance> {
    const instance = Fastify({ logger: false, trustProxy: true });
    await instance.register(errorsPlugin);
    await instance.register(contextPlugin);
    instance.get('/api/v1/probe', async (request) => {
      const ctx = request.tenantContext!;
      return {
        tenantId: ctx.tenantId,
        actor: ctx.actor.id,
        ip: ctx.ip ?? null,
        userAgent: ctx.userAgent ?? null,
        demo: ctx.demo ?? null,
        keys: ctx.permissions.keys(),
        subject: request.token?.subject,
      };
    });
    instance.get('/scim/v2/Users', async () => ({ ok: true }));
    instance.get('/api/demo/v1/status', async () => ({ open: true }));
    instance.post('/api/demo/v1/reset', async () => ({ reached: true }));
    return instance;
  }

  beforeEach(async () => {
    identity.actors.clear();
    identity.provisioned = 0;
    tenancy.tenants.clear();
    tenancy.tenants.set(DEMO_TENANT, { id: DEMO_TENANT, kind: 'demo', status: 'active', region: 'eu-west', aiAllowedRegions: [] });
    tenancy.tenants.set(STANDARD_TENANT, { id: STANDARD_TENANT, kind: 'standard', status: 'active', region: 'eu-west', aiAllowedRegions: [] });
    identity.actors.set(ALEX, ALEX_ACTOR);
    app = await build();
  });

  afterEach(async () => {
    await app.close();
  });

  const probe = (bearer: string, headers: Record<string, string> = {}) =>
    app.inject({ method: 'GET', url: '/api/v1/probe', headers: { authorization: `Bearer ${bearer}`, 'user-agent': 'Probe/1.0', 'x-forwarded-for': '203.0.113.7', ...headers } });

  it('builds a demo context: the visit, stripped permissions, and no address or browser', async () => {
    const response = await probe(putRecords());
    expect(response.statusCode).toBe(200);
    const body = response.json() as Record<string, unknown>;
    expect(body).toMatchObject({ tenantId: DEMO_TENANT, actor: ALEX, ip: null, userAgent: null, subject: `demo:${SID}` });
    expect(body.demo).toEqual({
      sid: SID,
      persona: 'agent',
      app: 'workbench',
      generation: 41,
      personaUserIds: { employee: EMMA, agent: ALEX, admin: JORDAN },
      agentTeamIds: [SERVICE_DESK],
    });
    // Kept keys stay; stripped keys and every platform key are gone.
    expect(body.keys).toEqual(['ticket.read']);
    for (const key of Object.keys(DEMO_STRIPPED_PERMISSIONS)) expect(body.keys).not.toContain(key);
  });

  it('keeps the address and browser of a standard session', async () => {
    identity.actors.set(JORDAN, { ...ALEX_ACTOR, userId: JORDAN });
    const dev = signDevelopmentToken({ sub: JORDAN, itsm_user_id: JORDAN, tenant_id: STANDARD_TENANT }, 'dev-only-not-a-secret');
    const body = (await probe(dev)).json() as Record<string, unknown>;
    expect(body).toMatchObject({ ip: '203.0.113.7', userAgent: 'Probe/1.0', demo: null });
    expect(body.keys).toContain('webhook.manage');
  });

  it('refuses a development token for the demo tenant (two-way interlock)', async () => {
    const dev = signDevelopmentToken({ sub: ALEX, itsm_user_id: ALEX, tenant_id: DEMO_TENANT }, 'dev-only-not-a-secret');
    const response = await probe(dev);
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ detail: 'this workspace only accepts demo sessions' });
  });

  it('refuses a SCIM token for the demo tenant', async () => {
    setTenantKindReader(async (id) => (id === DEMO_TENANT ? 'demo' : 'standard'));
    const response = await app.inject({ method: 'GET', url: '/scim/v2/Users', headers: { authorization: 'Bearer scim-token' } });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ detail: 'this workspace only accepts demo sessions' });
  });

  it('refuses a fully forged Redis that names a standard tenant, by its kind', async () => {
    identity.actors.set(JORDAN, { ...ALEX_ACTOR, userId: JORDAN });
    const forged = liveRecord({ tenantId: STANDARD_TENANT, personas: { employee: { userId: EMMA }, agent: { userId: JORDAN }, admin: { userId: ALEX } } });
    const bearer = putRecords({ live: forged, record: tokenRecord({ tenantId: STANDARD_TENANT, userId: JORDAN }) });
    const response = await probe(bearer);
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ type: 'https://docs.itsm.example/problems/unauthorised' });
  });

  it('answers demo_reset for a retired demo tenant, so the BFF re-mints', async () => {
    tenancy.tenants.set(DEMO_TENANT, { id: DEMO_TENANT, kind: 'demo', status: 'retired', region: 'eu-west', aiAllowedRegions: [] });
    const response = await probe(putRecords());
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ type: 'https://docs.itsm.example/problems/demo_reset', demo: true });
  });

  it('answers 503 persona, and never provisions anyone, when the persona is missing or inactive', async () => {
    identity.actors.delete(ALEX);
    let response = await probe(putRecords());
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ type: 'https://docs.itsm.example/problems/demo_unavailable', reason: 'persona', demo: true });
    identity.actors.set(ALEX, { ...ALEX_ACTOR, status: 'deactivated' });
    response = await probe(putRecords());
    expect(response.statusCode).toBe(503);
    expect(identity.provisioned).toBe(0);
  });

  it('lets the public status through without a token, and nothing else under /api/demo', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/demo/v1/status' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/demo/v1/status?x=1' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/demo/v1/reset', payload: { confirm: 'RESET' } })).statusCode).toBe(401);
  });

  it('lets every /api/demo path past the door while the demo is off, so each can answer its own 404', async () => {
    demoEnv({ DEMO_MODE: 'off' });
    expect((await app.inject({ method: 'POST', url: '/api/demo/v1/reset', payload: { confirm: 'RESET' } })).json()).toEqual({ reached: true });
  });
});
