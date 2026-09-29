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
