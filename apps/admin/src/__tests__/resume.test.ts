import { describe, expect, it, vi } from 'vitest';
import { LAST_PATH_COOKIE, SESSION_COOKIE, lastPathValue } from '@itsm/bff/cookies';

vi.mock('../bff.js', () => ({ bff: { config: { defaultLanding: '/', appOrigin: 'https://admin.acme.test' } } }));

const { GET, HEAD, dynamic } = await import('../app/resume/route.js');

/**
 * `/resume` (SPEC v3 §3.3): where another area's switcher and links land a
 * real session — the last page opened here, when the cookie was written
 * under this same session and names a same-origin page; the Command centre
 * otherwise. Always a 303, never stored.
 */

function resume(cookies: Record<string, string>, method: 'GET' | 'HEAD' = 'GET'): Promise<Response> {
  const cookie = Object.entries(cookies)
    .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
    .join('; ');
  const request = new Request('https://admin.acme.test/resume', { method, headers: cookie ? { cookie } : {} });
  return method === 'GET' ? GET(request) : HEAD(request);
}

function landing(response: Response): string {
  const location = new URL(response.headers.get('location')!);
  expect(location.origin).toBe('https://admin.acme.test');
  return `${location.pathname}${location.search}`;
}

describe('/resume', () => {
  it('sends the session back to the page it last had open here', async () => {
    const value = await lastPathValue('session-1', '/rules/vip-requester?tab=history');
    const response = await resume({ [SESSION_COOKIE]: 'session-1', [LAST_PATH_COOKIE]: value });
    expect(response.status).toBe(303);
    expect(landing(response)).toBe('/rules/vip-requester?tab=history');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('ignores a page remembered for another session', async () => {
    const value = await lastPathValue('someone-else', '/security');
    const response = await resume({ [SESSION_COOKIE]: 'session-1', [LAST_PATH_COOKIE]: value });
    expect(landing(response)).toBe('/');
  });

  it('lands on the Command centre with no remembered page, or no session', async () => {
    expect(landing(await resume({ [SESSION_COOKIE]: 'session-1' }))).toBe('/');
    expect(landing(await resume({}))).toBe('/');
  });

  it('never follows a stored path off this origin, or back into a route that is not a page', async () => {
    for (const unsafe of ['//evil.example/x', '/\\evil.example', 'https://evil.example/', '/resume', '/demo?persona=admin', '/api/session/logout']) {
      const value = `1.${(await lastPathValue('session-1', '/x')).split('.')[1]}.${encodeURIComponent(unsafe)}`;
      const response = await resume({ [SESSION_COOKIE]: 'session-1', [LAST_PATH_COOKIE]: value });
      expect(landing(response), unsafe).toBe('/');
    }
  });

  it('answers HEAD the same way, and is rendered per request', async () => {
    const value = await lastPathValue('session-1', '/audit');
    const response = await resume({ [SESSION_COOKIE]: 'session-1', [LAST_PATH_COOKIE]: value }, 'HEAD');
    expect(response.status).toBe(303);
    expect(landing(response)).toBe('/audit');
    expect(dynamic).toBe('force-dynamic');
  });
});
