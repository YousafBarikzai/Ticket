import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { LAST_PATH_COOKIE, SESSION_COOKIE, lastPathValue } from '@itsm/bff/cookies';
import { dynamic, GET, HEAD } from '../app/resume/route.js';
import { bff } from '../bff.js';

/**
 * `/resume` (v3 §3.3, A2 §4.2, §15.1): where a hop into the Service Desk
 * lands. The last page this session had open here when the remembered path
 * was written under the same session; the Overview otherwise — and never
 * anywhere off this origin, whatever the cookie says.
 */

const SESSION = 'a-session-id';

async function requestWith(cookies: Record<string, string>): Promise<NextRequest> {
  const cookie = Object.entries(cookies)
    .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
    .join('; ');
  return new NextRequest('https://workbench.example/resume', { headers: cookie ? { cookie } : {} });
}

function location(response: Response): string {
  return new URL(response.headers.get('location')!).pathname + new URL(response.headers.get('location')!).search;
}

describe('/resume', () => {
  it('answers 303 to the last page when the cookie was written under this session', async () => {
    const response = await GET(await requestWith({ [SESSION_COOKIE]: SESSION, [LAST_PATH_COOKIE]: await lastPathValue(SESSION, '/tickets/INC-000123?tab=details') }));
    expect(response.status).toBe(303);
    expect(location(response)).toBe('/tickets/INC-000123?tab=details');
    // Absolute, on this app's own configured origin, never a request header's.
    expect(new URL(response.headers.get('location')!).origin).toBe(new URL(bff.config.appOrigin).origin);
  });

  it('falls back to the Overview when the cookie belongs to another session', async () => {
    const response = await GET(await requestWith({ [SESSION_COOKIE]: SESSION, [LAST_PATH_COOKIE]: await lastPathValue('someone-else', '/tickets/INC-000123') }));
    expect(response.status).toBe(303);
    expect(location(response)).toBe('/overview');
  });

  it('falls back to the Overview with no cookie, and with no session', async () => {
    expect(location(await GET(await requestWith({ [SESSION_COOKIE]: SESSION })))).toBe('/overview');
    expect(location(await GET(await requestWith({ [LAST_PATH_COOKIE]: await lastPathValue(SESSION, '/inbox/mine') })))).toBe('/overview');
  });

  it('never follows a stored path off this origin, nor back into a page that is not a place', async () => {
    for (const path of ['//evil.example/x', '/\\evil.example', 'https://evil.example/', '/resume', '/sign-in', '/demo?persona=agent']) {
      const response = await GET(await requestWith({ [SESSION_COOKIE]: SESSION, [LAST_PATH_COOKIE]: await lastPathValue(SESSION, path) }));
      expect(location(response), path).toBe('/overview');
    }
    const garbage = await GET(await requestWith({ [SESSION_COOKIE]: SESSION, [LAST_PATH_COOKIE]: '1.zz.%E0%A4%A' }));
    expect(location(garbage)).toBe('/overview');
  });

  it('is never cached, answers HEAD alike, and renders per request', async () => {
    const response = await GET(await requestWith({ [SESSION_COOKIE]: SESSION }));
    expect(response.headers.get('cache-control')).toBe('no-store');
    const head = await HEAD(await requestWith({ [SESSION_COOKIE]: SESSION }));
    expect(head.status).toBe(303);
    expect(head.headers.get('cache-control')).toBe('no-store');
    expect(dynamic).toBe('force-dynamic');
  });
});
