import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { configWarnings, DEFAULT_DEV_TOKEN_SECRET } from '@itsm/platform';
import { failureDetail, healthRoutes, readiness, type ReadinessProbes } from '../app.js';

/**
 * `/health/ready` answered `redis: failed` for an evening while every part of
 * the connection — host, port, user, password — was correct. The API knew
 * which of them was wrong and discarded it, so the fault could only be guessed
 * at from outside. These tests are about the two things that has to satisfy at
 * once: say enough to identify the fault, and say nothing that is a secret.
 */

describe('what a failed dependency reports', () => {
  it('names the fault, so a resolver problem is not read as a bad password', () => {
    expect(failureDetail(new Error('getaddrinfo ENOTFOUND redis.railway.internal'))).toBe(
      'failed: getaddrinfo ENOTFOUND redis.railway.internal',
    );
    expect(failureDetail(new Error('WRONGPASS invalid username-password pair or user is disabled.'))).toContain('WRONGPASS');
    expect(failureDetail(new Error('connect ECONNREFUSED ::1:6379'))).toContain('ECONNREFUSED');
  });

  it('takes the credentials out, because this endpoint is unauthenticated', () => {
    // ioredis and Prisma both quote the URL they were given, and Railway's
    // health check is not the only thing that can call /health/ready.
    const detail = failureDetail(new Error('connect ECONNREFUSED redis://default:hunter2@redis.railway.internal:6379'));
    expect(detail).not.toContain('hunter2');
    expect(detail).toContain('redis://***@redis.railway.internal:6379');

    const prisma = failureDetail(new Error('P1001: Can\'t reach database server at postgresql://app_owner:s3cret@postgres.railway.internal:5432/railway'));
    expect(prisma).not.toContain('s3cret');
    expect(prisma).toContain('postgresql://***@postgres.railway.internal');
  });

  it('keeps it to one bounded line, since this is a polled JSON body', () => {
    const detail = failureDetail(new Error('first line\nsecond line\n  at somewhere (file.ts:1:1)'));
    expect(detail).toBe('failed: first line');
    expect(failureDetail(new Error('x'.repeat(500))).length).toBeLessThanOrEqual('failed: '.length + 200);
  });

  it('still says failed when the error says nothing', () => {
    // A thrown string, a thrown object, an Error with an empty message: the
    // check must not answer `ok` by accident, and must not answer `failed: `.
    expect(failureDetail(new Error(''))).toBe('failed');
    expect(failureDetail('   ')).toBe('failed');
    expect(failureDetail({ nope: true })).toBe('failed: [object Object]');
  });
});

/**
 * D24 (SPEC v3 §6.5): `/health/ready` says the deployment signs links with the
 * public development secret, and still answers 200 — Railway and the deploy's
 * smoke test read the status, and a forgotten variable must not become an
 * outage. `warnings` sits beside `checks` and never inside it.
 */
describe('readiness warnings', () => {
  const PRODUCTION = { NODE_ENV: 'production', DEV_TOKEN_SECRET: DEFAULT_DEV_TOKEN_SECRET } as const;
  const STRONG = 'm2Q8vX4kT7zR1pW9cY3hN6sB0dF5gJ8eU2iO4yL7rE1wA9zX3cV6bN0mK5hG8jD2';

  /** Every dependency answering, and the warnings `buildApp` would compute for this configuration. */
  function probes(overrides: Partial<ReadinessProbes> = {}, env: Record<string, string> = {}): ReadinessProbes {
    return {
      database: async () => [{ '?column?': 1 }],
      redis: async () => 'PONG',
      moduleCount: () => 24,
      warnings: () => configWarnings(PRODUCTION, env).map((warning) => warning.code),
      ...overrides,
    };
  }

  async function ask(given: ReadinessProbes): Promise<{ status: number; body: Record<string, unknown> }> {
    const app = Fastify({ logger: false });
    healthRoutes(app, given);
    try {
      const response = await app.inject({ method: 'GET', url: '/health/ready' });
      return { status: response.statusCode, body: response.json() as Record<string, unknown> };
    } finally {
      await app.close();
    }
  }

  it('answers 200 with the default secret in production, and names it beside the checks', async () => {
    const { status, body } = await ask(probes());
    expect(status).toBe(200);
    expect(body).toEqual({
      status: 'ready',
      checks: { database: 'ok', redis: 'ok', modules: 'ok' },
      warnings: ['dev_token_secret_default'],
    });
  });

  it('leaves the key out entirely with a real secret, so a clean body is unchanged', async () => {
    const { status, body } = await ask(probes({}, { DEV_TOKEN_SECRET: STRONG }));
    expect(status).toBe(200);
    expect(body).toEqual({ status: 'ready', checks: { database: 'ok', redis: 'ok', modules: 'ok' } });
    expect('warnings' in body).toBe(false);
  });

  it('keeps the warnings when the database is down, and the 503 is the checks’ alone', async () => {
    const { status, body } = await ask(
      probes({
        database: async () => {
          throw new Error("P1001: Can't reach database server at postgresql://app_owner:s3cret@postgres.railway.internal:5432/railway");
        },
      }),
    );
    expect(status).toBe(503);
    expect(body.status).toBe('not-ready');
    expect(body.warnings).toEqual(['dev_token_secret_default']);
    expect((body.checks as Record<string, string>).database).toMatch(/^failed: /);
    expect(JSON.stringify(body)).not.toContain('s3cret');
  });

  it('never decides the status from a warning, and never carries the value', async () => {
    const short = 'a-short-secret';
    const { statusCode, body } = await readiness(probes({}, { DEV_TOKEN_SECRET: short }));
    expect(statusCode).toBe(200);
    expect(body.warnings).toEqual(['dev_token_secret_short']);
    expect(JSON.stringify(body)).not.toContain(short);
    expect(JSON.stringify((await readiness(probes())).body)).not.toContain(DEFAULT_DEV_TOKEN_SECRET);
  });

  it('still answers liveness from the same registration', async () => {
    const app = Fastify({ logger: false });
    healthRoutes(app, probes());
    const response = await app.inject({ method: 'GET', url: '/health/live' });
    await app.close();
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok' });
  });
});
