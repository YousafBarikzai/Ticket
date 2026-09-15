import { describe, expect, it } from 'vitest';
import { clearedAttributes, cookieAttributes, SESSION_COOKIE, violatesHostPrefix } from '../bff/cookies.js';
import { decodeSession, encodeSession, memorySessionStore, needsRefresh, newSessionId, type Session } from '../bff/session.js';
import { DEFAULT_LANDING, safeRedirectTarget } from '../bff/redirects.js';

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
    expect(attributes.sameSite).toBe('lax');
  });

  it('clears by expiring rather than by being removed from the response', () => {
    expect(clearedAttributes().maxAge).toBe(0);
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

describe('where a sign-in is allowed to land', () => {
  it('keeps a path on this origin', () => {
    expect(safeRedirectTarget('/tickets/INC-1')).toBe('/tickets/INC-1');
    expect(safeRedirectTarget('/queue?assignee=me')).toBe('/queue?assignee=me');
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
      expect(safeRedirectTarget(hostile)).toBe(DEFAULT_LANDING);
    }
  });

  it('refuses a control character, which is where checker and follower disagree', () => {
    expect(safeRedirectTarget('/queue\n/evil')).toBe(DEFAULT_LANDING);
  });
});
