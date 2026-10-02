import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { siteConfig } = await import('../server/config.js');
const { DEEP_LINK_MAX, PERSONA_AREA, demoHref, safeDeepLink, workAccountHref } = await import('../server/links.js');

/**
 * Every link that leaves the site (SPEC v3 §6.1 "Links"; A5 §3.8, §13.1).
 *
 * These are the hrefs a prospect follows into the product. The app on the
 * other side checks each one again, so a link the app would refuse is a link
 * that silently lands somewhere else — the shapes are pinned here as strings.
 */

const config = siteConfig({
  NODE_ENV: 'production',
  SITE_ORIGIN: 'https://www.example.com',
  PORTAL_ORIGIN: 'https://help.example.com',
  WORKBENCH_ORIGIN: 'https://desk.example.com',
  ADMIN_ORIGIN: 'https://admin.example.com',
  DEMO_MODE: 'on',
});

describe('role buttons', () => {
  it('open each persona in its own area, in the one link shape /demo accepts', () => {
    expect(demoHref(config, 'employee')).toBe('https://help.example.com/demo?persona=employee&demo=1');
    expect(demoHref(config, 'agent')).toBe('https://desk.example.com/demo?persona=agent&demo=1');
    expect(demoHref(config, 'admin')).toBe('https://admin.example.com/demo?persona=admin&demo=1');
  });

  it('pairs the three personas with the three areas one to one (SPEC §4.1)', () => {
    expect(PERSONA_AREA).toEqual({ employee: 'portal', agent: 'workbench', admin: 'admin' });
    expect(new Set(Object.values(PERSONA_AREA)).size).toBe(3);
  });

  it('carries a deep link encoded, and drops one the app would refuse', () => {
    expect(demoHref(config, 'agent', '/resume')).toBe('https://desk.example.com/demo?persona=agent&demo=1&redirectTo=%2Fresume');
    expect(demoHref(config, 'agent', '/tickets/INC-004101')).toBe(
      'https://desk.example.com/demo?persona=agent&demo=1&redirectTo=%2Ftickets%2FINC-004101',
    );
    // Dropped, not an error: the role page still opens the demo, at home.
    expect(demoHref(config, 'admin', '//evil.example')).toBe('https://admin.example.com/demo?persona=admin&demo=1');
  });

  it('is null for an area this deployment has no origin for', () => {
    const partial = siteConfig({ NODE_ENV: 'production', PORTAL_ORIGIN: 'https://help.example.com' });
    expect(demoHref(partial, 'agent')).toBeNull();
    expect(demoHref(partial, 'employee')).toBe('https://help.example.com/demo?persona=employee&demo=1');
  });
});

describe('work-account rows', () => {
  it('go to each app\'s sign-in with account=1 and come back to /resume', () => {
    expect(workAccountHref(config, 'portal')).toBe('https://help.example.com/api/session/login?account=1&redirectTo=%2Fresume');
    expect(workAccountHref(config, 'workbench')).toBe('https://desk.example.com/api/session/login?account=1&redirectTo=%2Fresume');
    expect(workAccountHref(config, 'admin')).toBe('https://admin.example.com/api/session/login?account=1&redirectTo=%2Fresume');
  });

  it('is null for an area this deployment has no origin for', () => {
    expect(workAccountHref(siteConfig({ NODE_ENV: 'production' }), 'admin')).toBeNull();
  });
});

describe('deep links a role page passes on', () => {
  it('accepts a path in the product', () => {
    for (const path of ['/tickets/INC-004101', '/overview', '/rules', '/resume', '/inbox/mine?layout=board', '/demographics', '/api-docs']) {
      expect(safeDeepLink(path), path).toBe(path);
    }
  });

  it('refuses anything a browser would treat as another origin', () => {
    for (const path of ['//evil.example', '/\\evil.example', 'https://evil.example', 'javascript:alert(1)', 'evil.example', '']) {
      expect(safeDeepLink(path), path).toBeNull();
    }
  });

  it('refuses control characters, which normalise differently from how they are checked', () => {
    for (const path of ['/tickets\n/x', '/a\tb', '/x\u0000', '/x\u007f']) {
      expect(safeDeepLink(path), JSON.stringify(path)).toBeNull();
    }
  });

  it('refuses the BFF, the demo entry itself and the ends of a session, as whole segments', () => {
    for (const path of ['/api', '/api/x', '/api/session/login', '/demo', '/demo?persona=agent', '/sign-in', '/sign-in/x', '/signed-out', '/signed-out#x']) {
      expect(safeDeepLink(path), path).toBeNull();
    }
  });

  it('refuses a link longer than anybody typed, and anything that is not a string', () => {
    expect(safeDeepLink(`/${'a'.repeat(DEEP_LINK_MAX - 1)}`)).not.toBeNull();
    expect(safeDeepLink(`/${'a'.repeat(DEEP_LINK_MAX)}`)).toBeNull();
    for (const value of [undefined, null, 42, ['/overview'], { to: '/overview' }]) {
      expect(safeDeepLink(value), JSON.stringify(value)).toBeNull();
    }
  });
});
