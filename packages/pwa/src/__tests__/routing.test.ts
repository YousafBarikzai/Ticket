import { describe, expect, it } from 'vitest';
import { routeFor } from '../routing.js';

/**
 * The two same-origin routes the redesign added (SPEC §3.4, F19).
 *
 * The workbench reads its inbox through aggregation handlers at `/api/desk/*`
 * rather than through the proxy, and those answers used to fall through to
 * "never cached" — so the offline inbox the design promises ("showing the copy
 * from 10:42") could not exist. The design system's stylesheet is served at
 * `/itsm-ui.css?v=<hash>` by a route handler in each app.
 */

const get = (path: string) => routeFor({ method: 'GET', url: `https://x.test${path}` });

describe('the workbench’s aggregation handlers', () => {
  it('are API reads: network-first, in the API cache sign-out clears', () => {
    for (const path of ['/api/desk/inbox/mine?cursor=abc', '/api/desk/tickets/INC-000123', '/api/desk/counts']) {
      expect(get(path)).toEqual({ strategy: 'network-first', cache: 'api' });
    }
  });

  it('are never cached or queued when written to', () => {
    for (const method of ['POST', 'PATCH', 'DELETE']) {
      expect(routeFor({ method, url: 'https://x.test/api/desk/tickets/INC-1' })).toEqual({
        strategy: 'network-only',
        cache: null,
      });
    }
  });

  it('do not reach wider than their own prefix', () => {
    expect(get('/api/desktop').strategy).toBe('network-only');
    expect(get('/api/health').strategy).toBe('network-only');
    // Other route handlers under /api are never kept, whatever they end in.
    expect(get('/api/health.json').strategy).toBe('network-only');
  });

  it('leave the proxy’s rules as they were', () => {
    expect(get('/api/proxy/api/v1/tickets')).toEqual({ strategy: 'network-first', cache: 'api' });
    expect(get('/api/proxy/api/v1/events/stream?topics=group%3Aa').strategy).toBe('network-only');
    expect(get('/api/session/login').strategy).toBe('network-only');
  });
});

describe('the design system’s stylesheet', () => {
  it('is a static asset, stale-while-revalidate, whatever its version', () => {
    expect(get('/itsm-ui.css?v=3f2a1b')).toEqual({ strategy: 'stale-while-revalidate', cache: 'assets' });
    expect(get('/itsm-ui.css')).toEqual({ strategy: 'stale-while-revalidate', cache: 'assets' });
  });
});

/**
 * The pages that decide where a visit goes (A3 §5.3, critique S11): the
 * demo's entry, the sign-in chooser, the signed-out page and the cross-area
 * hop read the visit's cookies and session, so a cached copy would replay a
 * decision made for someone else, or yesterday. They are never kept.
 */
describe('the doors: /demo, /sign-in, /signed-out and /resume', () => {
  const doors = [
    '/demo?persona=agent&demo=1',
    '/demo',
    '/demo/',
    '/sign-in',
    '/sign-in?redirectTo=%2Ftickets',
    '/signed-out?demo=1',
    '/signed-out?reason=stale',
    '/resume',
    '/resume?redirectTo=%2Foverview',
  ];

  it('are network-only navigations, never the cached shell', () => {
    for (const path of doors) {
      expect(routeFor({ method: 'GET', url: `https://x.test${path}`, mode: 'navigate' }), path).toEqual({ strategy: 'network-only', cache: null });
    }
  });

  it('are network-only however they are fetched: a prefetch, an RSC payload, a HEAD', () => {
    expect(get('/sign-in?_rsc=1x2y')).toEqual({ strategy: 'network-only', cache: null });
    expect(routeFor({ method: 'HEAD', url: 'https://x.test/demo' })).toEqual({ strategy: 'network-only', cache: null });
    expect(routeFor({ method: 'POST', url: 'https://x.test/demo', mode: 'navigate' })).toEqual({ strategy: 'network-only', cache: null });
  });

  it('leave lookalike pages to the shell, and every other page as it was', () => {
    for (const path of ['/demographics', '/sign-ins', '/signed-outcomes', '/resumes', '/tickets', '/', '/overview']) {
      expect(routeFor({ method: 'GET', url: `https://x.test${path}`, mode: 'navigate' }), path).toEqual({ strategy: 'shell', cache: 'shell' });
    }
  });

  it('keep the demo bar’s status and reset routes uncached, as every /api route is', () => {
    expect(get('/api/demo/status')).toEqual({ strategy: 'network-only', cache: null });
    expect(routeFor({ method: 'POST', url: 'https://x.test/api/demo/reset' })).toEqual({ strategy: 'network-only', cache: null });
    expect(get('/api/session/demo')).toEqual({ strategy: 'network-only', cache: null });
  });
});
