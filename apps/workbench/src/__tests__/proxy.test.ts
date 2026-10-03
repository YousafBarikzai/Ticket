import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { LAST_PATH_COOKIE, SESSION_COOKIE, readCookie, resumeTarget } from '@itsm/bff/cookies';
import { LAST_VIEW_COOKIE } from '../inbox/views.js';
import { PATH_HEADER, config, proxy, requestedPath } from '../proxy.js';

/**
 * The proxy keeps the deep link through a sign-in (F5), hands the path to
 * the layouts, remembers the view and the last page — bound to the session,
 * for `/resume` (v3 §3.3) — and stays out of the way of every route that must
 * work without a session.
 */

function request(path: string, cookies: Record<string, string> = {}, headers: Record<string, string> = {}): NextRequest {
  const cookie = Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
  return new NextRequest(new URL(path, 'https://workbench.example'), { headers: { ...(cookie ? { cookie } : {}), ...headers } });
}

const SESSION = 'session-id';
const signedIn = { [SESSION_COOKIE]: SESSION };
/** A full page load, as a browser sends it. */
const page = { 'sec-fetch-dest': 'document', accept: 'text/html' };

/** The value of one `Set-Cookie` header the response sends, by name. */
function setCookie(response: Response, name: string): string | undefined {
  const header = response.headers.getSetCookie().find((line) => line.startsWith(`${name}=`));
  return header === undefined ? undefined : readCookie(header.split(';', 1)[0], name);
}

describe('without a session', () => {
  it('sends the person to sign in, keeping the page and its query', async () => {
    const response = await proxy(request('/tickets/INC-000123?tab=details'));
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get('location')!);
    expect(location.pathname).toBe('/api/session/login');
    expect(location.searchParams.get('redirectTo')).toBe('/tickets/INC-000123?tab=details');
  });

  it('sends /resume to sign in too, so the hop comes back to it', async () => {
    const response = await proxy(request('/resume', {}, page));
    expect(new URL(response.headers.get('location')!).searchParams.get('redirectTo')).toBe('/resume');
    expect(setCookie(response, LAST_PATH_COOKIE)).toBeUndefined();
  });

  it('leaves the router’s own cache key out of the deep link', () => {
    expect(requestedPath(new URL('https://w.example/inbox/mine?q=vpn&_rsc=abc123'))).toBe('/inbox/mine?q=vpn');
    expect(requestedPath(new URL('https://w.example/inbox/mine?_rsc=abc123'))).toBe('/inbox/mine');
  });
});

describe('with a session cookie', () => {
  it('lets the request through with the path for the layouts', async () => {
    const response = await proxy(request('/tickets/INC-000123?tab=details', signedIn));
    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-request-' + PATH_HEADER)).toBe('/tickets/INC-000123?tab=details');
  });

  it('remembers the view the person is on, and the last path, bound to the session', async () => {
    const onView = await proxy(request('/inbox/due?q=vpn', signedIn, page));
    expect(onView.cookies.get(LAST_VIEW_COOKIE)).toMatchObject({ value: 'due', httpOnly: true, sameSite: 'lax', path: '/' });
    // Both cookies survive: the view cookie's own list does not swallow the last-path header.
    expect(await resumeTarget(setCookie(onView, LAST_PATH_COOKIE), SESSION, '/overview')).toBe('/inbox/due?q=vpn');

    const onTeam = await proxy(request('/inbox/team/9B2C1A40-1111-4A2B-8C3D-0123456789AB', signedIn));
    expect(onTeam.cookies.get(LAST_VIEW_COOKIE)?.value).toBe('team/9b2c1a40-1111-4a2b-8c3d-0123456789ab');
    expect((await proxy(request('/inbox/not-a-view', signedIn))).cookies.get(LAST_VIEW_COOKIE)).toBeUndefined();
  });

  it('records a ticket as the last path (not as the view), and only for this session', async () => {
    const response = await proxy(request('/tickets/INC-000123', signedIn, page));
    expect(response.cookies.get(LAST_VIEW_COOKIE)).toBeUndefined();
    const value = setCookie(response, LAST_PATH_COOKIE);
    expect(await resumeTarget(value, SESSION, '/overview')).toBe('/tickets/INC-000123');
    // Another session — a demo after a real sign-in, someone else on this machine — starts at home.
    expect(await resumeTarget(value, 'another-session', '/overview')).toBe('/overview');
    const header = response.headers.getSetCookie().find((line) => line.startsWith(`${LAST_PATH_COOKIE}=`))!;
    expect(header).toMatch(/; Path=\//);
    expect(header).toMatch(/; Secure/i);
    expect(header).toMatch(/; HttpOnly/i);
    expect(header).toMatch(/; SameSite=Lax/i);
  });

  it('records client navigations, never prefetches, and never the pages that are not a place to come back to', async () => {
    expect(setCookie(await proxy(request('/overview', signedIn, { rsc: '1' })), LAST_PATH_COOKIE)).toBeDefined();
    expect(setCookie(await proxy(request('/overview', signedIn, { rsc: '1', 'next-router-prefetch': '1' })), LAST_PATH_COOKIE)).toBeUndefined();
    expect(setCookie(await proxy(request('/resume', signedIn, page)), LAST_PATH_COOKIE)).toBeUndefined();
    // A stylesheet or an image the proxy happens to see is not a page.
    expect(setCookie(await proxy(request('/overview', signedIn, { 'sec-fetch-dest': 'image' })), LAST_PATH_COOKIE)).toBeUndefined();
  });

  it('leaves the router’s cache key out of the remembered page', async () => {
    const response = await proxy(request('/inbox/mine?q=vpn&_rsc=abc', signedIn, { rsc: '1' }));
    expect(await resumeTarget(setCookie(response, LAST_PATH_COOKIE), SESSION, '/overview')).toBe('/inbox/mine?q=vpn');
  });
});

describe('the matcher', () => {
  const pattern = new RegExp(`^${config.matcher[0]!}$`);

  it('covers the pages, /resume and lookalikes of the demo', () => {
    for (const path of ['/', '/overview', '/inbox', '/inbox/mine', '/queue', '/tickets/INC-000123', '/resume', '/demographics', '/demos']) {
      expect(pattern.test(path), path).toBe(true);
    }
  });

  it('skips everything that must work without a session (Y-1.3.4), the demo entry among them', () => {
    for (const path of [
      '/api/session/login',
      '/api/session/demo',
      '/api/demo/status',
      '/api/desk/counts',
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
