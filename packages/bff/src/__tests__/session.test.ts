import { describe, expect, it } from 'vitest';
import { clearedAttributes, cookieAttributes, SESSION_COOKIE, violatesHostPrefix } from '../cookies.js';
import { decodeSession, encodeSession, memorySessionStore, needsRefresh, newSessionId, type Session } from '../session.js';
import { safeRedirectTarget } from '../redirects.js';
import { readCookie, serialiseCookie } from '../cookies.js';

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 'sid',
    accessToken: 'token',
    refreshToken: 'refresh',
    accessExpiresAt: Date.now() + 600_000,
    tenantId: 'tenant',
    userId: 'user',
    displayName: 'A Person',
    createdAt: Date.now(),
    ...overrides,
  };
}

describe('the session cookie', () => {
  it('satisfies every rule the __Host- prefix imposes', () => {
    // A browser silently drops a `__Host-` cookie that breaks any one of these,
    // and the symptom is "signing in does nothing" rather than an error.
    expect(SESSION_COOKIE.startsWith('__Host-')).toBe(true);
    expect(violatesHostPrefix(SESSION_COOKIE, cookieAttributes(3600))).toBeNull();
    expect(violatesHostPrefix(SESSION_COOKIE, clearedAttributes())).toBeNull();
  });

  it('catches an attribute set that would be dropped', () => {
    expect(violatesHostPrefix('__Host-session', { ...cookieAttributes(60), secure: false })).toMatch(/Secure/);
    expect(violatesHostPrefix('__Host-session', { ...cookieAttributes(60), path: '/app' })).toMatch(/Path=\//);
    expect(violatesHostPrefix('__Host-session', { ...cookieAttributes(60), domain: 'example.test' })).toMatch(/Domain/);
  });

  it('is httpOnly and Lax, which is what the callback redirect needs', () => {
    const attributes = cookieAttributes(3600);
    expect(attributes.httpOnly).toBe(true);
    expect(attributes.sameSite).toBe('Lax');
  });

  it('serialises every attribute the prefix requires', () => {
    const header = serialiseCookie(SESSION_COOKIE, 'abc', cookieAttributes(3600));
    expect(header).toBe('__Host-session=abc; Path=/; Max-Age=3600; HttpOnly; Secure; SameSite=Lax');
    // Never a Domain, whatever else changes.
    expect(header).not.toContain('Domain');
  });

  it('clears by expiring rather than by being removed from the response', () => {
    expect(clearedAttributes().maxAge).toBe(0);
    expect(serialiseCookie(SESSION_COOKIE, '', clearedAttributes())).toContain('Max-Age=0');
  });
});

describe('reading a cookie header', () => {
  it('finds the named cookie among others', () => {
    expect(readCookie('theme=dark; __Host-session=abc; other=1', SESSION_COOKIE)).toBe('abc');
    expect(readCookie('__Host-session=abc', SESSION_COOKIE)).toBe('abc');
  });

  it('takes the first occurrence, which is the one a sibling host cannot append past', () => {
    expect(readCookie('__Host-session=real; __Host-session=forged', SESSION_COOKIE)).toBe('real');
  });

  it('names no session where there is none to name', () => {
    expect(readCookie(null, SESSION_COOKIE)).toBeUndefined();
    expect(readCookie('', SESSION_COOKIE)).toBeUndefined();
    expect(readCookie('theme=dark', SESSION_COOKIE)).toBeUndefined();
    expect(readCookie('=abc; ;;', SESSION_COOKIE)).toBeUndefined();
    // Not valid percent-encoding: a value that cannot be decoded names nothing.
    expect(readCookie('__Host-session=%E0%A4%A', SESSION_COOKIE)).toBeUndefined();
  });

  it('round-trips a value that needed encoding', () => {
    const header = serialiseCookie(SESSION_COOKIE, 'a b;c', cookieAttributes(60));
    const value = header.slice(`${SESSION_COOKIE}=`.length, header.indexOf(';'));
    expect(readCookie(`${SESSION_COOKIE}=${value}`, SESSION_COOKIE)).toBe('a b;c');
  });
});

describe('reading a stored session back', () => {
  it('round-trips a complete record', () => {
    const original = session();
    expect(decodeSession(encodeSession(original))).toEqual(original);
  });

  it('treats anything incomplete as no session at all', () => {
    // A shared Redis, a colliding key, a half-written value: all of them are
    // "sign in again", never "carry this token into a request".
    expect(decodeSession(null)).toBeNull();
    expect(decodeSession('not json')).toBeNull();
    expect(decodeSession('"a string"')).toBeNull();
    expect(decodeSession(JSON.stringify({ id: 'x' }))).toBeNull();
    expect(decodeSession(JSON.stringify({ ...session(), accessToken: '' }))).toBeNull();
    expect(decodeSession(JSON.stringify({ ...session(), tenantId: undefined }))).toBeNull();
    expect(decodeSession(JSON.stringify({ ...session(), accessExpiresAt: 'soon' }))).toBeNull();
  });

  it('refreshes before the token expires, not after', () => {
    const now = Date.now();
    expect(needsRefresh(session({ accessExpiresAt: now + 600_000 }), now)).toBe(false);
    // Thirty seconds left is not enough: the request has yet to travel.
    expect(needsRefresh(session({ accessExpiresAt: now + 30_000 }), now)).toBe(true);
    expect(needsRefresh(session({ accessExpiresAt: now - 1 }), now)).toBe(true);
  });

  it('mints identifiers nobody could guess', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newSessionId()));
    expect(ids.size).toBe(200);
    expect([...ids][0]!.length).toBeGreaterThanOrEqual(43);
  });
});

describe('the pending-login record', () => {
  it('can only be read once, so a replayed callback finds nothing', async () => {
    const store = memorySessionStore();
    await store.putPending('state-1', { verifier: 'v', redirectTo: '/queue', createdAt: Date.now() }, 600);

    expect(await store.takePending('state-1')).toMatchObject({ verifier: 'v' });
    expect(await store.takePending('state-1')).toBeNull();
  });

  it('expires', async () => {
    const store = memorySessionStore();
    await store.putPending('state-2', { verifier: 'v', redirectTo: '/queue', createdAt: Date.now() }, 0);
    expect(await store.takePending('state-2')).toBeNull();
  });

  it('keeps and drops sessions', async () => {
    const store = memorySessionStore();
    const record = session({ id: 'abc' });
    await store.put(record, 600);
    expect(await store.get('abc')).toEqual(record);
    await store.delete('abc');
    expect(await store.get('abc')).toBeNull();
  });
});

const LANDING = '/queue';

describe('where a sign-in is allowed to land', () => {
  it('keeps a path on this origin', () => {
    expect(safeRedirectTarget('/tickets/INC-1', LANDING)).toBe('/tickets/INC-1');
    expect(safeRedirectTarget('/queue?assignee=me', LANDING)).toBe('/queue?assignee=me');
  });

  it('refuses everything a browser would resolve off-origin', () => {
    for (const hostile of [
      '//evil.example',
      'https://evil.example',
      'http://evil.example',
      '/\\evil.example',
      'javascript:alert(1)',
      '',
      null,
      undefined,
    ]) {
      expect(safeRedirectTarget(hostile, LANDING)).toBe(LANDING);
    }
  });

  it('refuses a control character, which is where checker and follower disagree', () => {
    expect(safeRedirectTarget('/queue\n/evil', LANDING)).toBe(LANDING);
  });
});
