import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The site's response headers and its cookie-free promise (SPEC v3 §6.1
 * "Headers"; A5 §3.4, §3.9, §13.1).
 *
 * The headers come from `next.config.ts`, so the config itself is imported
 * and read — the same object Next reads — rather than a copy of its strings.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

async function headersFor(nodeEnv: string): Promise<Map<string, string>> {
  vi.resetModules();
  vi.stubEnv('NODE_ENV', nodeEnv);
  const { default: config } = await import('../../next.config.js');
  const rules = (await config.headers?.()) ?? [];
  expect(rules.map((rule) => rule.source)).toEqual(['/:path*']);
  return new Map(rules[0]!.headers.map(({ key, value }) => [key.toLowerCase(), value]));
}

function directives(csp: string): Map<string, string> {
  return new Map(
    csp.split(';').map((part) => {
      const [name, ...values] = part.trim().split(/\s+/);
      return [name!, values.join(' ')] as const;
    }),
  );
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the content security policy', () => {
  it('lets the page talk to nothing but its own origin, post nothing anywhere and be framed by nobody', async () => {
    const csp = directives((await headersFor('production')).get('content-security-policy')!);
    expect(csp.get('default-src')).toBe("'self'");
    expect(csp.get('connect-src')).toBe("'self'");
    expect(csp.get('form-action')).toBe("'self'");
    expect(csp.get('frame-ancestors')).toBe("'none'");
    expect(csp.get('object-src')).toBe("'none'");
    expect(csp.get('base-uri')).toBe("'self'");
    expect(csp.get('font-src')).toBe("'self'");
    expect(csp.get('img-src')).toBe("'self' data:");
  });

  it('never allows eval in production, and only there is it absent', async () => {
    expect(directives((await headersFor('production')).get('content-security-policy')!).get('script-src')).toBe("'self' 'unsafe-inline'");
    // Development keeps webpack's eval source maps working.
    expect(directives((await headersFor('development')).get('content-security-policy')!).get('script-src')).toContain("'unsafe-eval'");
  });
});

describe('the other headers', () => {
  it('sends the referrer policy the demo entry depends on (D22)', async () => {
    // An app's /demo auto-submits only when the Referer names an allowed
    // origin; `no-referrer` here would make every role button a second click.
    expect((await headersFor('production')).get('referrer-policy')).toBe('strict-origin-when-cross-origin');
  });

  it('sends HSTS with max-age only, never includeSubDomains or preload (Y-m12)', async () => {
    expect((await headersFor('production')).get('strict-transport-security')).toBe('max-age=63072000');
  });

  it('isolates the window and refuses to be framed, belt and braces', async () => {
    const headers = await headersFor('production');
    expect(headers.get('cross-origin-opener-policy')).toBe('same-origin');
    expect(headers.get('x-frame-options')).toBe('DENY');
    expect(headers.get('x-content-type-options')).toBe('nosniff');
    expect(headers.get('permissions-policy')).toBe('camera=(), microphone=(), geolocation=(), browsing-topics=()');
  });

  it('sets no cookie anywhere in the configuration', async () => {
    expect((await headersFor('production')).has('set-cookie')).toBe(false);
  });
});

function filesUnder(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

describe('no cookie, from any route', () => {
  it('has no route handler, page or module outside the tests that sets or reads a cookie', () => {
    // A5 §3.9: the site sets no cookie at all. A route handler is where one
    // would be added, and `cookies()` is the Next API that would read one —
    // which would also make every page that called it per-visitor.
    const offenders = filesUnder(SRC)
      .filter((path) => /\.(ts|tsx)$/.test(path) && !relative(SRC, path).startsWith('__tests__'))
      .filter((path) => {
        const source = readFileSync(path, 'utf8');
        return /set-cookie/i.test(source) || /\bcookies\s*\(/.test(source) || /\{[^}]*\bcookies\b[^}]*\}\s*from ['"]next\/headers['"]/.test(source);
      })
      .map((path) => relative(SRC, path));
    expect(offenders).toEqual([]);
  });
});
