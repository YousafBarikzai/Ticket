import { beforeEach, describe, expect, it } from 'vitest';
import { call, GatewayRefusedError, type GatewayLogEntry } from '../gateway/gateway.js';
import { breakers, CircuitOpenError } from '../gateway/circuit-breaker.js';

/**
 * The gateway end to end, with `fetch`, the resolver and the log sink injected.
 *
 * The most valuable assertion here is the negative one: the credential never
 * reaches the log. That failure would be invisible in production until somebody
 * read a support export, which is exactly the kind of thing a test has to catch
 * because nothing else will.
 */

const ctx = {
  tenantId: 'tenant-1',
  correlationId: 'corr-1',
  actor: { type: 'system' as const, id: null, displayName: 'test' },
} as never;

const publicResolver = async () => [{ address: '93.184.216.34' }];

function respond(status: number, body: unknown, headers: Record<string, string> = {}): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    })) as unknown as typeof fetch;
}

let logged: GatewayLogEntry[];
const sink = async (entry: GatewayLogEntry) => {
  logged.push(entry);
};

beforeEach(() => {
  logged = [];
  breakers.reset();
});

describe('a successful call', () => {
  it('returns the parsed body and the status', async () => {
    const response = await call(
      ctx,
      { connector: 'jira', method: 'POST', url: 'https://api.test/issues', body: { summary: 'x' } },
      { fetchImpl: respond(201, { id: '42' }), resolver: publicResolver, sink },
    );
    expect(response).toMatchObject({ status: 201, body: { id: '42' } });
  });

  it('sends the credential but never logs it', async () => {
    // The assertion this file exists for.
    let sentHeaders: Record<string, string> = {};
    const capture = (async (_url: string, init: RequestInit) => {
      sentHeaders = init.headers as Record<string, string>;
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;

    await call(
      ctx,
      {
        connector: 'jira',
        method: 'POST',
        url: 'https://api.test/issues',
        headers: { 'x-request-id': 'abc' },
        credential: { header: 'authorization', value: 'Bearer the-real-secret' },
      },
      { fetchImpl: capture, resolver: publicResolver, sink },
    );

    // It went out…
    expect(sentHeaders.authorization).toBe('Bearer the-real-secret');
    // …and it is nowhere in what was written down.
    expect(JSON.stringify(logged)).not.toContain('the-real-secret');
    expect(logged[0]!.requestHeaders).toEqual({ 'x-request-id': 'abc' });
  });

  it('attaches the idempotency key the caller gave it', async () => {
    let sentHeaders: Record<string, string> = {};
    const capture = (async (_url: string, init: RequestInit) => {
      sentHeaders = init.headers as Record<string, string>;
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;

    await call(
      ctx,
      { connector: 'jira', method: 'POST', url: 'https://api.test/x', idempotencyKey: 'run-1-step-2' },
      { fetchImpl: capture, resolver: publicResolver, sink },
    );
    expect(sentHeaders['idempotency-key']).toBe('run-1-step-2');
  });

  it('strips a token out of the logged URL', async () => {
    await call(
      ctx,
      { connector: 'jira', method: 'GET', url: 'https://api.test/x?token=abc&id=7' },
      { fetchImpl: respond(200, {}), resolver: publicResolver, sink },
    );
    expect(logged[0]!.url).not.toContain('abc');
    expect(logged[0]!.url).toContain('id=7');
  });
});

describe('calls the gateway will not make', () => {
  it('refuses a private address, and records the refusal', async () => {
    // Recorded because a refused destination is usually somebody mis-typing an
    // internal hostname, and occasionally somebody probing.
    await expect(
      call(
        ctx,
        { connector: 'jira', method: 'GET', url: 'https://internal.test/x' },
        { fetchImpl: respond(200, {}), resolver: async () => [{ address: '10.0.0.5' }], sink },
      ),
    ).rejects.toThrow(GatewayRefusedError);

    expect(logged).toHaveLength(1);
    expect(logged[0]!.error).toMatch(/private network/);
  });

  it('refuses a redirect rather than following it', async () => {
    // A 302 to the metadata endpoint would walk straight past a check made on
    // the URL the administrator configured.
    await expect(
      call(
        ctx,
        { connector: 'jira', method: 'GET', url: 'https://api.test/x' },
        {
          fetchImpl: respond(302, {}, { location: 'http://169.254.169.254/latest/meta-data/' }),
          resolver: publicResolver,
          sink,
        },
      ),
    ).rejects.toThrow(/final address/);
  });

  it('does not make the call at all once the circuit is open', async () => {
    for (let i = 0; i < 5; i += 1) breakers.recordFailure('tenant-1', 'flaky');

    let called = false;
    const shouldNotRun = (async () => {
      called = true;
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;

    await expect(
      call(
        ctx,
        { connector: 'flaky', method: 'GET', url: 'https://api.test/x' },
        { fetchImpl: shouldNotRun, resolver: publicResolver, sink },
      ),
    ).rejects.toThrow(CircuitOpenError);
    expect(called).toBe(false);
  });
});

describe('what counts as the endpoint being broken', () => {
  it('opens the circuit on repeated 5xx', async () => {
    for (let i = 0; i < 5; i += 1) {
      await call(
        ctx,
        { connector: 'sad', method: 'GET', url: 'https://api.test/x' },
        { fetchImpl: respond(503, { error: 'nope' }), resolver: publicResolver, sink },
      );
    }
    expect(breakers.state('tenant-1', 'sad')).toBe('open');
  });

  it('does not open the circuit on a 404', async () => {
    // Pausing a connector whose URL is simply wrong hides the one message that
    // would fix it.
    for (let i = 0; i < 10; i += 1) {
      await call(
        ctx,
        { connector: 'wrong-url', method: 'GET', url: 'https://api.test/nope' },
        { fetchImpl: respond(404, { error: 'not found' }), resolver: publicResolver, sink },
      );
    }
    expect(breakers.state('tenant-1', 'wrong-url')).toBe('closed');
  });

  it('returns a 4xx to the caller rather than throwing', async () => {
    // The endpoint said no. That is an answer, and the caller decides what it
    // means — a failed call is a different thing from an unreachable one.
    const response = await call(
      ctx,
      { connector: 'jira', method: 'POST', url: 'https://api.test/x' },
      { fetchImpl: respond(422, { error: 'bad field' }), resolver: publicResolver, sink },
    );
    expect(response.status).toBe(422);
    expect(response.body).toEqual({ error: 'bad field' });
  });

  it('treats a network error as a failure and records it', async () => {
    const dead = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;

    await expect(
      call(
        ctx,
        { connector: 'dead', method: 'GET', url: 'https://api.test/x' },
        { fetchImpl: dead, resolver: publicResolver, sink },
      ),
    ).rejects.toThrow(/ECONNREFUSED/);
    expect(logged[0]!.status).toBe(0);
  });
});
