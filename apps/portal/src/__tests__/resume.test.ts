import { describe, expect, it } from 'vitest';
import { LAST_PATH_COOKIE, SESSION_COOKIE, lastPathValue } from '@itsm/bff/cookies';
import { GET, HEAD, dynamic } from '../app/resume/route.js';

/**
 * `/resume` (SPEC v3 §3.3, A2 §4.2): a switch from another area lands on the
 * last page this session had open here — and only this session's — else Home.
 * Never cached.
 */

async function resume(cookies: Record<string, string>, method: 'GET' | 'HEAD' = 'GET'): Promise<Response> {
  const cookie = Object.entries(cookies)
    .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
    .join('; ');
  const request = new Request('https://portal.example/resume', { method, headers: cookie ? { cookie } : {} });
  return method === 'GET' ? GET(request) : HEAD(request);
}

describe('/resume', () => {
  it('answers 303 to the page this session last had open, query and all', async () => {
    const response = await resume({ [SESSION_COOKIE]: 'session-a', [LAST_PATH_COOKIE]: await lastPathValue('session-a', '/tickets/INC-000123?tab=details') });
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/tickets/INC-000123?tab=details');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('answers HEAD the same way', async () => {
    const response = await resume({ [SESSION_COOKIE]: 'session-a', [LAST_PATH_COOKIE]: await lastPathValue('session-a', '/knowledge') }, 'HEAD');
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/knowledge');
  });

  it('goes Home when the page was another session’s (a new sign-in, a demo after a real one, a shared machine)', async () => {
    const response = await resume({ [SESSION_COOKIE]: 'session-b', [LAST_PATH_COOKIE]: await lastPathValue('session-a', '/tickets/INC-000123') });
    expect(response.headers.get('location')).toBe('/');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('goes Home with no last page, or no session', async () => {
    expect((await resume({ [SESSION_COOKIE]: 'session-a' })).headers.get('location')).toBe('/');
    expect((await resume({ [LAST_PATH_COOKIE]: await lastPathValue('session-a', '/tickets') })).headers.get('location')).toBe('/');
    expect((await resume({})).status).toBe(303);
  });

  it('goes Home rather than to anything that is not a page here', async () => {
    for (const unsafe of ['//evil.example/x', '/\\evil.example', 'https://evil.example/', '/api/session/logout', '/demo?persona=employee', '/resume']) {
      const response = await resume({ [SESSION_COOKIE]: 'session-a', [LAST_PATH_COOKIE]: await lastPathValue('session-a', unsafe) });
      expect(response.headers.get('location'), unsafe).toBe('/');
    }
    const garbled = await resume({ [SESSION_COOKIE]: 'session-a', [LAST_PATH_COOKIE]: '1.zz.%E0%A4%A' });
    expect(garbled.headers.get('location')).toBe('/');
  });

  it('is rendered per request', () => {
    expect(dynamic).toBe('force-dynamic');
  });
});
