import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@itsm/bff/cookies';
import { LAST_VIEW_COOKIE } from '../inbox/views.js';
import { PATH_HEADER, config, proxy, requestedPath } from '../proxy.js';

/**
 * The proxy keeps the deep link through a sign-in (F5), hands the path to
 * the layouts, remembers the view — and stays out of the way of every route
 * that must work without a session.
 */

function request(path: string, cookies: Record<string, string> = {}): NextRequest {
  const cookie = Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
  return new NextRequest(new URL(path, 'https://workbench.example'), { headers: cookie ? { cookie } : {} });
}

const signedIn = { [SESSION_COOKIE]: 'session-id' };

describe('without a session', () => {
  it('sends the person to sign in, keeping the page and its query', () => {
    const response = proxy(request('/tickets/INC-000123?tab=details'));
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get('location')!);
    expect(location.pathname).toBe('/api/session/login');
    expect(location.searchParams.get('redirectTo')).toBe('/tickets/INC-000123?tab=details');
  });

  it('leaves the router’s own cache key out of the deep link', () => {
    expect(requestedPath(new URL('https://w.example/inbox/mine?q=vpn&_rsc=abc123'))).toBe('/inbox/mine?q=vpn');
    expect(requestedPath(new URL('https://w.example/inbox/mine?_rsc=abc123'))).toBe('/inbox/mine');
  });
});

describe('with a session cookie', () => {
  it('lets the request through with the path for the layouts', () => {
    const response = proxy(request('/tickets/INC-000123?tab=details', signedIn));
    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-request-' + PATH_HEADER)).toBe('/tickets/INC-000123?tab=details');
  });

  it('remembers the view the person is on, and nothing else', () => {
    const onView = proxy(request('/inbox/due?q=vpn', signedIn));
    expect(onView.cookies.get(LAST_VIEW_COOKIE)).toMatchObject({ value: 'due', httpOnly: true, sameSite: 'lax', path: '/' });
    const onTeam = proxy(request('/inbox/team/9B2C1A40-1111-4A2B-8C3D-0123456789AB', signedIn));
    expect(onTeam.cookies.get(LAST_VIEW_COOKIE)?.value).toBe('team/9b2c1a40-1111-4a2b-8c3d-0123456789ab');
    expect(proxy(request('/tickets/INC-000123', signedIn)).cookies.get(LAST_VIEW_COOKIE)).toBeUndefined();
    expect(proxy(request('/inbox/not-a-view', signedIn)).cookies.get(LAST_VIEW_COOKIE)).toBeUndefined();
  });
});

describe('the matcher', () => {
  const pattern = new RegExp(`^${config.matcher[0]!}$`);

  it('covers the pages', () => {
    for (const path of ['/', '/inbox', '/inbox/mine', '/queue', '/tickets/INC-000123']) expect(pattern.test(path), path).toBe(true);
  });

  it('skips everything that must work without a session (Y-1.3.4)', () => {
    for (const path of [
      '/api/session/login',
      '/api/desk/counts',
      '/_next/static/chunk.js',
      '/itsm-ui.css',
      '/offline',
      '/sign-in',
      '/signed-out',
      '/sw.js',
      '/manifest.webmanifest',
      '/icon.svg',
      '/icon-maskable.svg',
      '/favicon.ico',
    ]) {
      expect(pattern.test(path), path).toBe(false);
    }
  });
});
