import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { baseUrlOf, isIndexable, originOf, readOrigins, siteConfig } = await import('../server/config.js');

/**
 * The site's configuration (SPEC v3 §6.1; A5 §3.6, §3.12).
 *
 * Everything a visitor clicks on the public site is built from these four
 * origins, so the rules are pinned here as values: what a pasted URL becomes,
 * what an unset variable becomes in production and in development, and when
 * the site lets itself be indexed.
 */

const PRODUCTION = {
  NODE_ENV: 'production',
  SITE_ORIGIN: 'https://www.example.com',
  PORTAL_ORIGIN: 'https://help.example.com',
  WORKBENCH_ORIGIN: 'https://desk.example.com',
  ADMIN_ORIGIN: 'https://admin.example.com',
  API_BASE_URL: 'https://api.example.com',
  DEMO_MODE: 'on',
};

describe('the origins', () => {
  it('reads all four, as origins', () => {
    expect(readOrigins(PRODUCTION)).toEqual({
      site: 'https://www.example.com',
      portal: 'https://help.example.com',
      workbench: 'https://desk.example.com',
      admin: 'https://admin.example.com',
    });
  });

  it('drops what a paste brings with it, so two spellings build the same links', () => {
    expect(originOf(' https://help.example.com/ ')).toBe('https://help.example.com');
    expect(originOf('https://help.example.com/some/path?x=1#y')).toBe('https://help.example.com');
    expect(originOf('http://localhost:3200')).toBe('http://localhost:3200');
  });

  it('never turns a value that is not an http(s) URL into an href', () => {
    // A `javascript:` origin would otherwise become a link on a public page.
    for (const value of ['javascript:alert(1)', 'ftp://help.example.com', 'help.example.com', '', '   ', undefined]) {
      expect(originOf(value), String(value)).toBeNull();
    }
  });

  it('leaves an origin unset in production rather than pointing at localhost', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const origins = readOrigins({ ...PRODUCTION, WORKBENCH_ORIGIN: undefined, ADMIN_ORIGIN: 'not a url' });
    expect(origins.workbench).toBeUndefined();
    expect(origins.admin).toBeUndefined();
    expect(origins.portal).toBe('https://help.example.com');
    // The broken value is named once, without being printed back.
    expect(warn).toHaveBeenCalledWith('[site] ADMIN_ORIGIN is not an http(s) URL; links that need it are left out');
    warn.mockRestore();
  });

  it('falls back to the pnpm dev:* addresses outside production', () => {
    expect(readOrigins({ NODE_ENV: 'development' })).toEqual({
      portal: 'http://localhost:3200',
      workbench: 'http://localhost:3100',
      admin: 'http://localhost:3300',
      site: 'http://localhost:3400',
    });
  });
});

describe('the API base URL', () => {
  it('keeps a path and drops a trailing slash, a query and a fragment', () => {
    expect(baseUrlOf('https://api.example.com/')).toBe('https://api.example.com');
    expect(baseUrlOf('https://example.com/itsm/?a=1#b')).toBe('https://example.com/itsm');
    expect(baseUrlOf('mailto:ops@example.com')).toBeNull();
  });

  it('is null in production when unset, so the demo status reads as unknown', () => {
    expect(siteConfig({ ...PRODUCTION, API_BASE_URL: undefined }).apiBaseUrl).toBeNull();
    expect(siteConfig({ NODE_ENV: 'development' }).apiBaseUrl).toBe('http://localhost:3000');
  });
});

describe('the demo switch', () => {
  it('is on only for the exact value the catalogue sets', () => {
    expect(siteConfig(PRODUCTION).demo).toBe(true);
    for (const value of ['off', 'ON', 'true', '1', '', undefined]) {
      expect(siteConfig({ ...PRODUCTION, DEMO_MODE: value }).demo, String(value)).toBe(false);
    }
  });
});

describe('indexing', () => {
  it('is allowed only on an https origin of the owner\'s own', () => {
    expect(isIndexable('https://www.example.com')).toBe(true);
    expect(siteConfig(PRODUCTION).indexable).toBe(true);
  });

  it('is refused on a Railway-generated host, over http, and with no origin at all', () => {
    // A temporary host is never indexed, so the move to the owner's domain
    // leaves no duplicate behind.
    expect(isIndexable('https://site-production-1a2b.up.railway.app')).toBe(false);
    expect(isIndexable('http://www.example.com')).toBe(false);
    expect(isIndexable(undefined)).toBe(false);
    expect(siteConfig({ NODE_ENV: 'development' }).indexable).toBe(false);
  });
});
