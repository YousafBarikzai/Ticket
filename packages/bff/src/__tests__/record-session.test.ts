import { describe, expect, it, vi } from 'vitest';
import { readConfig } from '../config.js';
import { recordSession } from '../record-session.js';

/**
 * Telling the API about a session, and — mostly — what happens when that fails.
 *
 * This is the one call in the sign-in path that is allowed to fail without
 * failing the sign-in, which makes it the one call where "it went wrong and
 * nobody noticed" is a design decision rather than a bug. So the tests are
 * mostly about the noticing.
 */

const config = readConfig(
  {
    appName: 'test-app',
    originEnvVar: 'TEST_ORIGIN',
    defaultOrigin: 'https://desk.example.test',
    defaultLanding: '/queue',
    signInPath: '/sign-in',
    signedOutPath: '/signed-out',
  },
  { NODE_ENV: 'development', API_BASE_URL: 'http://api.internal' },
);

const RECORDED = { id: 'sess-1', expiresAt: '2026-01-01T00:00:00.000Z', lastSeenAt: '2026-01-01T00:00:00.000Z' };

function answering(response: Response | Error): ReturnType<typeof vi.fn> {
  return vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
}

describe('recording a session with the API', () => {
  it('presents the token and nothing else', async () => {
    const fetchImpl = answering(new Response(JSON.stringify(RECORDED), { status: 201 }));
    const result = await recordSession(config, 'tok-abc', { fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(result).toEqual(RECORDED);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('http://api.internal/api/v1/auth/session');
    expect(init.method).toBe('POST');
    expect(init.headers.authorization).toBe('Bearer tok-abc');
    // Anything in the body would be the client's claim about itself, which is
    // exactly what the API must not believe.
    expect(init.body).toBe('{}');
  });

  it('returns null and reports when the API refuses', async () => {
    const reasons: string[] = [];
    const result = await recordSession(config, 'tok-abc', {
      fetchImpl: answering(new Response('{}', { status: 403 })) as unknown as typeof fetch,
      onFailure: (reason) => reasons.push(reason),
    });

    expect(result).toBeNull();
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain('403');
  });

  it('returns null and reports when the API cannot be reached', async () => {
    const reasons: string[] = [];
    const result = await recordSession(config, 'tok-abc', {
      fetchImpl: answering(new Error('ECONNREFUSED')) as unknown as typeof fetch,
      onFailure: (reason) => reasons.push(reason),
    });

    expect(result).toBeNull();
    expect(reasons).toEqual(['ECONNREFUSED']);
  });

  it('never throws, because a sign-in must not fail on this', async () => {
    // A body that is not JSON at all: the response is fine, reading it is not.
    const fetchImpl = answering(new Response('<html>a proxy error page</html>', { status: 200 }));
    await expect(
      recordSession(config, 'tok-abc', { fetchImpl: fetchImpl as unknown as typeof fetch, onFailure: () => undefined }),
    ).resolves.toBeNull();
  });
});
