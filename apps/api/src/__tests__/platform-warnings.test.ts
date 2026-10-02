import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * `GET /api/platform/v1/deployment-warnings` (D24, Y-M7; SPEC v3 §6.5).
 *
 * The real route file under the real error handler, with Redis replaced by a
 * double holding the two hashes — what is pinned here is who may ask and the
 * shape of the answer; how each hash is parsed is the platform's own test.
 */

const hashes = vi.hoisted(() => ({
  config: {} as Record<string, string>,
  demo: null as string | null,
  fail: false,
}));

vi.mock('@itsm/platform', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@itsm/platform')>();
  const redis = {
    hgetall: async (key: string) => {
      if (hashes.fail) throw new Error('connect ECONNREFUSED 127.0.0.1:6379');
      return key === 'ops:config-warnings' ? hashes.config : {};
    },
    hget: async (key: string, field: string) => (key === 'ops:demo' && field === 'demo_build_failing' ? hashes.demo : null),
  };
  return { ...actual, cache: () => redis };
});

const { buildPermissionSet, createContext, EMPTY_PERMISSIONS } = await import('@itsm/platform');
const { errorsPlugin } = await import('../plugins/errors.js');
const { platformRoutes } = await import('../routes/platform.js');

const TENANT = '01a0ee8e-2e36-7705-b28e-80a403f83962';

/** The platform prefix behind a stand-in for the context plugin: the caller's permissions come from a header. */
async function api(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(errorsPlugin);
  app.decorateRequest('tenantContext', undefined);
  app.addHook('onRequest', async (request) => {
    request.correlationId = 'test';
    const operator = request.headers['x-test-operator'] === 'yes';
    request.tenantContext = createContext({
      tenantId: TENANT,
      correlationId: 'test',
      actor: { type: 'user', id: '0190f3a5-0000-7000-8000-000000000001', displayName: 'Jordan Lee' },
      permissions: operator ? buildPermissionSet([{ key: 'platform.tenant.manage', scope: 'any' }]) : EMPTY_PERMISSIONS,
    });
  });
  await app.register(platformRoutes, { prefix: '/api/platform/v1' });
  return app;
}

async function get(operator: boolean): Promise<{ status: number; body: Record<string, unknown> }> {
  const app = await api();
  try {
    const response = await app.inject({
      method: 'GET',
      url: '/api/platform/v1/deployment-warnings',
      headers: operator ? { 'x-test-operator': 'yes' } : {},
    });
    return { status: response.statusCode, body: response.json() as Record<string, unknown> };
  } finally {
    await app.close();
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
  hashes.config = {};
  hashes.demo = null;
  hashes.fail = false;
});

describe('the deployment warnings route', () => {
  it('answers 403 without platform.tenant.manage, before reading anything', async () => {
    hashes.config = { 'itsm-api': JSON.stringify({ codes: ['dev_token_secret_default'], at: new Date().toISOString() }) };
    const { status, body } = await get(false);
    expect(status).toBe(403);
    expect(JSON.stringify(body)).not.toContain('itsm-api');
  });

  it('answers an empty list when all is well', async () => {
    expect(await get(true)).toEqual({ status: 200, body: { data: [] } });
  });

  it('answers { data: [{ service, codes, at }] } sorted by service, with the demo build beside the config warnings', async () => {
    const at = new Date(Date.now() - 60_000).toISOString();
    hashes.config = {
      'itsm-worker-comms': JSON.stringify({ codes: ['dev_token_secret_default'], at }),
      'itsm-api': JSON.stringify({ codes: ['dev_token_secret_default'], at }),
    };
    hashes.demo = JSON.stringify({ since: '2026-10-01T00:05:00.000Z', failures: 3, step: 'checks', check: 'V3 attainment bands' });

    const { status, body } = await get(true);
    expect(status).toBe(200);
    expect(body).toEqual({
      data: [
        { service: 'itsm-api', codes: ['dev_token_secret_default'], at },
        { service: 'itsm-worker-comms', codes: ['dev_token_secret_default'], at },
        {
          service: 'itsm-worker-data',
          codes: ['demo_build_failing'],
          at: '2026-10-01T00:05:00.000Z',
          failure: { step: 'checks', check: 'V3 attainment bands', failures: 3 },
        },
      ],
    });
  });

  it('fails as a problem, not a stack, when Redis cannot be reached', async () => {
    hashes.fail = true;
    // The handler logs the fault for the operator; this test reads only what the caller is sent.
    vi.stubEnv('LOG_SILENT', '1');
    const { status, body } = await get(true);
    expect(status).toBe(500);
    expect(JSON.stringify(body)).not.toContain('ECONNREFUSED');
  });
});
