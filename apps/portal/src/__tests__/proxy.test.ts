import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { LAST_PATH_COOKIE, SESSION_COOKIE, lastPathValue, resumeTarget } from '@itsm/bff/cookies';
import { PATH_HEADER, config, proxy, requestedPath } from '../proxy.js';

/**
 * The proxy keeps the deep link through a sign-in (F5), hands the path to
 * the layouts, remembers the page for `/resume` (v3 §3.3, A2 §4.3) — and stays
 * out of the way of every route that must work without a session, the demo's
 * entry among them (A3 §6.5).
 */

function request(path: string, cookies: Record<string, string> = {}, headers: Record<string, string> = {}, method = 'GET'): NextRequest {
  const cookie = Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
  return new NextRequest(new URL(path, 'https://portal.example'), { method, headers: { ...headers, ...(cookie ? { cookie } : {}) } });
}

/** What a browser sends for a page it navigates to. */
const NAVIGATION = { 'sec-fetch-dest': 'document', accept: 'text/html' };

function lastPathCookieOf(response: Response): string | null {
  const header = response.headers.getSetCookie().find((value) => value.startsWith(`${LAST_PATH_COOKIE}=`));
  return header ? decodeURIComponent(header.slice(LAST_PATH_COOKIE.length + 1).split(';')[0]!) : null;
}

describe('without a session', () => {
  it('sends the person to sign in, keeping the page and its query', async () => {
    const response = await proxy(request('/tickets/INC-000123?from=email'));
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get('location')!);
    expect(location.pathname).toBe('/api/session/login');
    expect(location.searchParams.get('redirectTo')).toBe('/tickets/INC-000123?from=email');
  });

  it('sends a switch from another area through sign-in and back to /resume', async () => {
    const response = await proxy(request('/resume', {}, NAVIGATION));
    expect(new URL(response.headers.get('location')!).searchParams.get('redirectTo')).toBe('/resume');
    expect(lastPathCookieOf(response)).toBeNull();
  });

  it('leaves the router’s own cache key out of the deep link', () => {
    expect(requestedPath(new URL('https://p.example/knowledge?q=vpn&_rsc=abc123'))).toBe('/knowledge?q=vpn');
    expect(requestedPath(new URL('https://p.example/approvals?_rsc=abc123'))).toBe('/approvals');
  });
});

describe('with a session cookie', () => {
  it('lets the request through with the path for the layouts', async () => {
    const response = await proxy(request('/tickets/INC-000123?from=email', { [SESSION_COOKIE]: 'session-id' }));
    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-request-' + PATH_HEADER)).toBe('/tickets/INC-000123?from=email');
  });

  it('remembers the page a navigation opens, bound to this session, for /resume', async () => {
    const response = await proxy(request('/tickets/INC-000123?tab=details&_rsc=x1', { [SESSION_COOKIE]: 'session-id' }, NAVIGATION));
    const value = lastPathCookieOf(response);
    expect(value).toBe(await lastPathValue('session-id', '/tickets/INC-000123?tab=details'));
    const header = response.headers.getSetCookie().find((cookie) => cookie.startsWith(`${LAST_PATH_COOKIE}=`))!;
    expect(header).toMatch(/; Path=\//);
    expect(header).toMatch(/; Secure/);
    expect(header).toMatch(/; HttpOnly/);
    expect(header).toMatch(/; SameSite=Lax/);
    expect(header).toMatch(/; Max-Age=43200/);
    // What /resume reads back: this page for this session, Home for any other.
    expect(await resumeTarget(value, 'session-id', '/')).toBe('/tickets/INC-000123?tab=details');
    expect(await resumeTarget(value, 'another-session', '/')).toBe('/');
  });

  it('records a client-side navigation too (the router’s RSC request)', async () => {
    const response = await proxy(request('/knowledge?_rsc=1a2b', { [SESSION_COOKIE]: 'session-id' }, { rsc: '1' }));
    expect(await resumeTarget(lastPathCookieOf(response), 'session-id', '/')).toBe('/knowledge');
  });

  it('records nothing for a prefetch, a form post or the router’s own fetches of something else', async () => {
    const cookies = { [SESSION_COOKIE]: 'session-id' };
    for (const response of [
      await proxy(request('/tickets', cookies, { ...NAVIGATION, 'next-router-prefetch': '1' })),
      await proxy(request('/tickets', cookies, { ...NAVIGATION, 'sec-purpose': 'prefetch;prerender' })),
      await proxy(request('/tickets', cookies, NAVIGATION, 'POST')),
      await proxy(request('/resume', cookies, NAVIGATION)),
    ]) {
      expect(lastPathCookieOf(response)).toBeNull();
    }
  });

  it('records nothing too long to carry back (1 kB)', async () => {
    const response = await proxy(request(`/search?q=${'x'.repeat(1_100)}`, { [SESSION_COOKIE]: 'session-id' }, NAVIGATION));
    expect(response.status).toBe(200);
    expect(lastPathCookieOf(response)).toBeNull();
  });
});

describe('the matcher', () => {
  const pattern = new RegExp(`^${config.matcher[0]!}$`);

  it('covers the pages, /resume and a page whose name merely starts with “demo”', () => {
    for (const path of ['/', '/tickets', '/tickets/INC-000123', '/catalogue/laptop', '/knowledge', '/approvals', '/profile', '/report', '/search', '/resume', '/demographics', '/democracy/x']) {
      expect(pattern.test(path), path).toBe(true);
    }
  });

  it('skips everything that must work without a session (Y-1.3.4), the demo’s entry and robots.txt among them', () => {
    for (const path of [
      '/api/session/login',
      '/api/session/demo',
      '/api/demo/status',
      '/api/proxy/api/v1/me',
      '/_next/static/chunk.js',
      '/itsm-ui.css',
      '/offline',
      '/sign-in',
      '/signed-out',
      '/demo',
      '/demo/',
      '/sw.js',
      '/manifest.webmanifest',
      '/robots.txt',
      '/icon.svg',
      '/icon-maskable.svg',
      '/favicon.ico',
    ]) {
      expect(pattern.test(path), path).toBe(false);
    }
  });
});
