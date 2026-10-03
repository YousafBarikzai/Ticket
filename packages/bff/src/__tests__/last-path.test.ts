import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  LAST_PATH_COOKIE,
  LAST_PATH_COOKIE_SECONDS,
  LAST_PATH_MAX_BYTES,
  SESSION_COOKIE,
  cookieAttributes,
  lastPathCookie,
  lastPathValue,
  readCookie,
  resumeTarget,
  shouldRecordLastPath,
  violatesHostPrefix,
  type LastPathRequest,
} from '../cookies.js';

/**
 * The last-path cookie and `/resume` (SPEC v3 §3.3; A2 §4.2).
 *
 * A switcher row lands on the page a person left in that area, and only for
 * the session that left it: a new session — another person, a demo after a
 * real sign-in — must never be sent to the previous one's page.
 */

const SESSION = 'c2Vzc2lvbi1pZGVudGlmaWVyLWZvci10aGUtdGVzdHMtMDAx';
const OTHER_SESSION = 'YW5vdGhlci1zZXNzaW9uLWlkZW50aWZpZXItZm9yLXRlc3Rz';
const h16 = (session: string): string => createHash('sha256').update(session).digest('hex').slice(0, 16);

function request(path: string, headers: Record<string, string> = {}, method = 'GET'): LastPathRequest {
  return {
    method,
    url: `https://desk.example.com${path}`,
    headers: new Headers({ cookie: `${SESSION_COOKIE}=${SESSION}`, 'sec-fetch-dest': 'document', ...headers }),
  };
}

/** The cookie's value as the browser sends it back: the `Set-Cookie` header read through `readCookie`. */
function storedValue(header: string): string | undefined {
  return readCookie(header.split(';')[0], LAST_PATH_COOKIE);
}

describe('the cookie', () => {
  it('is a __Host- cookie living as long as a session', () => {
    expect(LAST_PATH_COOKIE).toBe('__Host-itsm-last');
    expect(LAST_PATH_COOKIE_SECONDS).toBe(43_200);
    expect(violatesHostPrefix(LAST_PATH_COOKIE, cookieAttributes(LAST_PATH_COOKIE_SECONDS))).toBeNull();
  });

  it('is written with every attribute the prefix and the hop need', async () => {
    const header = await lastPathCookie(SESSION, '/inbox/mine');
    expect(header).not.toBeNull();
    const [pair, ...attributes] = header!.split('; ');
    expect(pair!.startsWith(`${LAST_PATH_COOKIE}=`)).toBe(true);
    expect(attributes).toEqual(['Path=/', 'Max-Age=43200', 'HttpOnly', 'Secure', 'SameSite=Lax']);
    expect(header).not.toMatch(/Domain=/i);
  });

  it('holds a version, the session’s hash and the path', async () => {
    const value = await lastPathValue(SESSION, '/tickets/INC-000004?tab=notes');
    expect(value).toBe(`1.${h16(SESSION)}.${encodeURIComponent('/tickets/INC-000004?tab=notes')}`);
    // The hash, never the identifier: the session's secret is not copied.
    expect(value).not.toContain(SESSION);
  });

  it('strips the router’s _rsc key and keeps the rest of the query as written', async () => {
    const decode = (value: string) => decodeURIComponent(value.split('.').slice(2).join('.'));
    expect(decode(await lastPathValue(SESSION, '/inbox/mine?_rsc=1x2y&sort=due'))).toBe('/inbox/mine?sort=due');
    expect(decode(await lastPathValue(SESSION, '/inbox/mine?sort=due&_rsc=1x2y'))).toBe('/inbox/mine?sort=due');
    expect(decode(await lastPathValue(SESSION, '/overview?_rsc=abc'))).toBe('/overview');
    expect(decode(await lastPathValue(SESSION, '/search?q=a+b%20c&_rscx=1'))).toBe('/search?q=a+b%20c&_rscx=1');
  });

  it('is not written for a path over the size limit', async () => {
    const fits = `/search?q=${'a'.repeat(LAST_PATH_MAX_BYTES - 60)}`;
    expect(await lastPathCookie(SESSION, fits)).not.toBeNull();
    expect(await lastPathCookie(SESSION, `/search?q=${'a'.repeat(LAST_PATH_MAX_BYTES)}`)).toBeNull();
    // Measured as stored: characters that are encoded count for what they become.
    expect(await lastPathCookie(SESSION, `/search?q=${'é'.repeat(200)}`)).toBeNull();
  });

  it('is not written for a path that is not a page to come back to', async () => {
    for (const path of ['/api/desk/counts', '/demo', '/demo?persona=agent&demo=1', '/resume', '/sign-in', '/signed-out?reason=stale', '/offline']) {
      expect(await lastPathCookie(SESSION, path), path).toBeNull();
    }
    for (const path of ['//evil.example', '/\\evil.example', 'https://evil.example', 'inbox']) {
      expect(await lastPathCookie(SESSION, path), path).toBeNull();
    }
    expect(await lastPathCookie(SESSION, '/demographics')).not.toBeNull();
  });
});

describe('which requests record it', () => {
  it('records a full page load and a client navigation', () => {
    expect(shouldRecordLastPath(request('/inbox/mine'))).toBe(true);
    expect(shouldRecordLastPath(request('/tickets/INC-000004', { 'sec-fetch-dest': 'empty', rsc: '1' }))).toBe(true);
  });

  it('skips prefetches, which are guesses rather than visits', () => {
    const prefetches: Record<string, string>[] = [
      { rsc: '1', 'next-router-prefetch': '1' },
      { rsc: '1', 'next-router-segment-prefetch': '/_tree' },
      { purpose: 'prefetch' },
      { 'sec-purpose': 'prefetch;prerender' },
      { 'sec-purpose': 'prefetch' },
    ];
    for (const headers of prefetches) {
      expect(shouldRecordLastPath(request('/inbox/mine', headers)), JSON.stringify(headers)).toBe(false);
    }
  });

  it('skips the routes that are not a page to resume', () => {
    for (const path of ['/api/session/login', '/api', '/demo', '/demo/start', '/resume', '/sign-in', '/signed-out', '/offline']) {
      expect(shouldRecordLastPath(request(path)), path).toBe(false);
    }
    // Whole segments only.
    for (const path of ['/demographics', '/apiary', '/resumes', '/offline-help']) {
      expect(shouldRecordLastPath(request(path)), path).toBe(true);
    }
  });

  it('skips anything but GET', () => {
    for (const method of ['POST', 'HEAD', 'PUT', 'DELETE']) expect(shouldRecordLastPath(request('/inbox/mine', {}, method)), method).toBe(false);
    expect(shouldRecordLastPath(request('/inbox/mine', {}, 'get'))).toBe(true);
  });

  it('needs a session to bind the page to', () => {
    expect(shouldRecordLastPath({ ...request('/inbox/mine'), headers: new Headers({ 'sec-fetch-dest': 'document' }) })).toBe(false);
    expect(shouldRecordLastPath({ ...request('/inbox/mine'), headers: new Headers({ cookie: 'other=1', 'sec-fetch-dest': 'document' }) })).toBe(false);
  });

  it('skips subresources the proxy happens to see', () => {
    for (const destination of ['style', 'script', 'image', 'manifest', 'empty']) {
      expect(shouldRecordLastPath(request('/itsm-ui.css', { 'sec-fetch-dest': destination })), destination).toBe(false);
    }
  });

  it('falls back to Accept when the browser sends no fetch metadata', () => {
    const bare = (accept: string): LastPathRequest => ({
      method: 'GET',
      url: 'https://desk.example.com/inbox/mine',
      headers: new Headers({ cookie: `${SESSION_COOKIE}=${SESSION}`, accept }),
    });
    expect(shouldRecordLastPath(bare('text/html,application/xhtml+xml'))).toBe(true);
    expect(shouldRecordLastPath(bare('*/*'))).toBe(false);
  });
});

describe('where /resume sends a session', () => {
  const fallback = '/overview';
  const forged = (path: string, session = SESSION): string => `1.${h16(session)}.${encodeURIComponent(path)}`;

  it('returns the remembered page to the session that left it', async () => {
    const header = (await lastPathCookie(SESSION, '/tickets/INC-000004?tab=notes'))!;
    expect(await resumeTarget(storedValue(header), SESSION, fallback)).toBe('/tickets/INC-000004?tab=notes');
  });

  it('survives the cookie’s own encoding for any page', async () => {
    for (const path of ['/inbox/team/0b9f6f5e-1a2b', '/search?q=printer%20jam&scope=all', '/knowledge/KB-0042?q=café']) {
      const header = (await lastPathCookie(SESSION, path))!;
      expect(await resumeTarget(storedValue(header), SESSION, fallback), path).toBe(path);
    }
  });

  it('sends a different session home: a new sign-in never resumes another one’s page', async () => {
    const header = (await lastPathCookie(SESSION, '/tickets/INC-000004'))!;
    expect(await resumeTarget(storedValue(header), OTHER_SESSION, fallback)).toBe(fallback);
  });

  it('sends a person with no cookie, or no session, home', async () => {
    expect(await resumeTarget(undefined, SESSION, fallback)).toBe(fallback);
    expect(await resumeTarget(null, SESSION, fallback)).toBe(fallback);
    expect(await resumeTarget('', SESSION, fallback)).toBe(fallback);
    expect(await resumeTarget(forged('/inbox/mine'), undefined, fallback)).toBe(fallback);
    expect(await resumeTarget(forged('/inbox/mine'), '', fallback)).toBe(fallback);
  });

  it('never redirects off the origin, whatever the cookie says', async () => {
    for (const path of ['//evil.example', '/\\evil.example', 'https://evil.example', 'evil.example', '/a\nb']) {
      expect(await resumeTarget(forged(path), SESSION, fallback), JSON.stringify(path)).toBe(fallback);
    }
  });

  it('never resumes onto a route that is not a page', async () => {
    for (const path of ['/resume', '/demo?persona=agent', '/api/session/logout', '/sign-in']) {
      expect(await resumeTarget(forged(path), SESSION, fallback), path).toBe(fallback);
    }
  });

  it('reads a malformed value as no value', async () => {
    const hash = h16(SESSION);
    for (const value of [
      `2.${hash}.${encodeURIComponent('/inbox/mine')}`,
      `1.${hash.toUpperCase()}.${encodeURIComponent('/inbox/mine')}`,
      `1.${hash.slice(1)}.${encodeURIComponent('/inbox/mine')}`,
      `1.${hash}.`,
      `1.${hash}`,
      `1.${hash}.%E0%A4%A`,
      '/inbox/mine',
    ]) {
      expect(await resumeTarget(value, SESSION, fallback), value).toBe(fallback);
    }
  });
});
