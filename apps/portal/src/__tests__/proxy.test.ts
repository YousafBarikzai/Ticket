import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@itsm/bff/cookies';
import { PATH_HEADER, config, proxy, requestedPath } from '../proxy.js';

/**
 * The proxy keeps the deep link through a sign-in (F5) and hands the path to
 * the layouts — and stays out of the way of every route that must work
 * without a session.
 */

function request(path: string, cookies: Record<string, string> = {}): NextRequest {
  const cookie = Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
  return new NextRequest(new URL(path, 'https://portal.example'), { headers: cookie ? { cookie } : {} });
}

describe('without a session', () => {
  it('sends the person to sign in, keeping the page and its query', () => {
    const response = proxy(request('/tickets/INC-000123?from=email'));
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get('location')!);
    expect(location.pathname).toBe('/api/session/login');
    expect(location.searchParams.get('redirectTo')).toBe('/tickets/INC-000123?from=email');
  });

  it('leaves the router’s own cache key out of the deep link', () => {
    expect(requestedPath(new URL('https://p.example/knowledge?q=vpn&_rsc=abc123'))).toBe('/knowledge?q=vpn');
    expect(requestedPath(new URL('https://p.example/approvals?_rsc=abc123'))).toBe('/approvals');
  });
});

describe('with a session cookie', () => {
  it('lets the request through with the path for the layouts', () => {
    const response = proxy(request('/tickets/INC-000123?from=email', { [SESSION_COOKIE]: 'session-id' }));
    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-request-' + PATH_HEADER)).toBe('/tickets/INC-000123?from=email');
  });
});

describe('the matcher', () => {
  const pattern = new RegExp(`^${config.matcher[0]!}$`);

  it('covers the pages', () => {
    for (const path of ['/', '/tickets', '/tickets/INC-000123', '/catalogue/laptop', '/knowledge', '/approvals', '/profile', '/report', '/search']) {
      expect(pattern.test(path), path).toBe(true);
    }
  });

  it('skips everything that must work without a session (Y-1.3.4)', () => {
    for (const path of [
      '/api/session/login',
      '/api/proxy/api/v1/me',
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
