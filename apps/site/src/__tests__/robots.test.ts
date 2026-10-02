import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { default: robots } = await import('../app/robots.js');
const { default: sitemap } = await import('../app/sitemap.js');

/**
 * What the site tells a crawler (A5 §3.12, §13.1).
 *
 * Read per request from the environment, so each case sets the variables it
 * describes and puts them back afterwards.
 */

afterEach(() => {
  vi.unstubAllEnvs();
});

function deployedAt(site: string | undefined): void {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('SITE_ORIGIN', site ?? '');
}

describe('robots.txt', () => {
  it('keeps crawlers off the demo entry and the API, and nothing else', () => {
    deployedAt('https://www.example.com');
    const rules = robots().rules;
    expect(rules).toEqual({ userAgent: '*', allow: '/', disallow: ['/demo', '/api/'] });
  });

  it('never disallows /try/, so a shared role link still unfurls', () => {
    deployedAt('https://www.example.com');
    const disallowed = [robots().rules].flat().flatMap((rule) => [rule.disallow ?? []].flat());
    expect(disallowed.some((path) => path.startsWith('/try'))).toBe(false);
  });

  it('names the sitemap only when the site knows its own origin', () => {
    deployedAt('https://www.example.com');
    expect(robots().sitemap).toBe('https://www.example.com/sitemap.xml');
    deployedAt(undefined);
    expect(robots().sitemap).toBeUndefined();
  });
});

describe('sitemap.xml', () => {
  it('lists the landing page and the legal pages on an indexable origin', () => {
    deployedAt('https://www.example.com');
    expect(sitemap().map((entry) => entry.url)).toEqual([
      'https://www.example.com/',
      'https://www.example.com/privacy',
      'https://www.example.com/cookies',
      'https://www.example.com/terms',
    ]);
  });

  it('is empty on a Railway-generated host and over http', () => {
    deployedAt('https://site-production-1a2b.up.railway.app');
    expect(sitemap()).toEqual([]);
    deployedAt('http://www.example.com');
    expect(sitemap()).toEqual([]);
    deployedAt(undefined);
    expect(sitemap()).toEqual([]);
  });
});
