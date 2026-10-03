import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { LAST_PATH_COOKIE, SESSION_COOKIE, readCookie, resumeTarget } from '@itsm/bff/cookies';
import { PATH_HEADER, config, proxy, requestedPath } from '../proxy.js';

/**
 * The console's front door (SPEC §5.1, F5; v3 §3.3, §4.6.1): a deep link
 * survives sign-in, the layout learns the path, the last page someone opened
 * is remembered for `/resume` — bound to their session — and every route that
 * must work without a session, `/demo` among them, is left alone.
 */

const ORIGIN = 'https://admin.acme.test';

function request(path: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(new URL(path, ORIGIN), { headers });
}

/** A page navigation with a session cookie, as a browser sends it. */
function navigation(path: string, extra: Record<string, string> = {}): NextRequest {
  return request(path, { cookie: `${SESSION_COOKIE}=session-1`, 'sec-fetch-dest': 'document', 'sec-fetch-mode': 'navigate', ...extra });
}

function lastPathCookieOf(response: Response): string | undefined {
  const header = response.headers.get('set-cookie');
  if (!header || !header.startsWith(`${LAST_PATH_COOKIE}=`)) return undefined;
  return readCookie(header.split(';')[0], LAST_PATH_COOKIE);
}

describe('without a session', () => {
  it('sends the person to sign in, keeping the page and its query', async () => {
    const response = await proxy(request('/rules?open=rule:vip'));
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get('location')!);
    expect(location.pathname).toBe('/api/session/login');
    expect(location.searchParams.get('redirectTo')).toBe('/rules?open=rule:vip');
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('sends `/resume` to sign in too, so it is resumed afterwards', async () => {
    const response = await proxy(request('/resume'));
    expect(new URL(response.headers.get('location')!).searchParams.get('redirectTo')).toBe('/resume');
  });

  it('leaves the router’s own cache key out of the deep link', () => {
    expect(requestedPath(new URL(`${ORIGIN}/rules?q=vip&_rsc=abc123`))).toBe('/rules?q=vip');
    expect(requestedPath(new URL(`${ORIGIN}/tickets?_rsc=abc123`))).toBe('/tickets');
  });
});

describe('with a session cookie', () => {
  it('passes the request through with the path for the layout, overwriting a header the client sent', async () => {
    const response = await proxy(request('/sla/calendars?x=1', { cookie: `${SESSION_COOKIE}=abc`, [PATH_HEADER]: '//evil.example' }));
    expect(response.status).toBe(200);
    expect(response.headers.get(`x-middleware-request-${PATH_HEADER}`)).toBe('/sla/calendars?x=1');
  });

  it('remembers the page a person navigates to, bound to their session', async () => {
    const response = await proxy(navigation('/rules/vip-requester?tab=history'));
    const header = response.headers.get('set-cookie')!;
    expect(header).toMatch(new RegExp(`^${LAST_PATH_COOKIE}=1\\.[0-9a-f]{16}\\.`));
    expect(header).toContain('HttpOnly');
    expect(header).toContain('Secure');
    expect(header).toContain('SameSite=Lax');
    expect(header).toContain('Path=/');
    expect(header).toContain('Max-Age=43200');
    // `/resume` finds it again for the same session, and not for another.
    const value = lastPathCookieOf(response);
    expect(await resumeTarget(value, 'session-1', '/')).toBe('/rules/vip-requester?tab=history');
    expect(await resumeTarget(value, 'session-2', '/')).toBe('/');
  });

  it('remembers a client navigation too, without the router’s cache key', async () => {
    const response = await proxy(request('/workflows?_rsc=x1', { cookie: `${SESSION_COOKIE}=session-1`, rsc: '1' }));
    expect(await resumeTarget(lastPathCookieOf(response), 'session-1', '/')).toBe('/workflows');
  });

  it('remembers nothing for a prefetch, a non-navigation or a page that is not a place to come back to', async () => {
    const cases = [
      navigation('/rules', { 'next-router-prefetch': '1' }),
      navigation('/rules', { 'sec-purpose': 'prefetch' }),
      request('/rules', { cookie: `${SESSION_COOKIE}=session-1`, 'sec-fetch-dest': 'image' }),
      navigation('/resume'),
    ];
    for (const one of cases) {
      const response = await proxy(one);
      expect(response.headers.get('set-cookie'), one.nextUrl.pathname).toBeNull();
    }
  });
});

describe('the matcher', () => {
  const pattern = new RegExp(`^${config.matcher[0]!}$`);

  it('covers the console’s pages, `/resume` and a page that only starts like the demo', () => {
    for (const path of ['/', '/rules', '/tenants', '/queues', '/resume', '/demographics', '/demos/list']) {
      expect(pattern.test(path), path).toBe(true);
    }
  });

  it('leaves alone everything that must work without a session, the demo entry among them', () => {
    for (const path of [
      '/api/proxy/api/v1/me',
      '/api/session/demo',
      '/api/demo/status',
      '/_next/static/x.js',
      '/itsm-ui.css',
      '/sign-in',
      '/signed-out',
      '/demo',
      '/demo/',
      '/robots.txt',
      '/icon.svg',
      '/favicon.ico',
    ]) {
      expect(pattern.test(path), path).toBe(false);
    }
  });
});
