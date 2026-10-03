import { describe, expect, it } from 'vitest';
import {
  clearedAttributes,
  clearedDemoCookie,
  cookieAttributes,
  DEMO_COOKIE,
  demoCookie,
  demoCookieMaxAge,
  demoCookieValue,
  demoReentryFromValue,
  readDemoReentry,
  SESSION_COOKIE,
  violatesHostPrefix,
} from '../cookies.js';
import {
  decodeSession,
  encodeSession,
  isDemoSession,
  isRealSession,
  memorySessionStore,
  needsRefresh,
  newSessionId,
  type Session,
} from '../session.js';
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
    kind: 'oidc',
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

/* ------------------------------------------------------------------ v3: kinds and the demo record (A3 §5.5) */

const SID = 'demo-0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const DEMO_TOKEN = `itsmdemo_${'A'.repeat(43)}`;

function demoRecord(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: 'demo-session',
    kind: 'demo',
    accessToken: DEMO_TOKEN,
    refreshToken: null,
    accessExpiresAt: Date.now() + 900_000,
    tenantId: 'demo-tenant',
    userId: 'agent-user',
    displayName: 'Alex Morgan',
    createdAt: Date.now(),
    persona: 'agent',
    demoGeneration: 41,
    demoSid: SID,
    ...overrides,
  });
}

describe('the kind of session a record holds', () => {
  it('reads a record written before v3, with no kind, as a provider session', () => {
    const { kind: _kind, ...old } = session();
    expect(decodeSession(JSON.stringify(old))).toMatchObject({ kind: 'oidc', refreshToken: 'refresh' });
  });

  it('keeps a development session’s kind', () => {
    expect(decodeSession(encodeSession(session({ kind: 'dev', refreshToken: null })))).toMatchObject({ kind: 'dev' });
  });

  it('refuses a kind nobody wrote', () => {
    expect(decodeSession(JSON.stringify({ ...session(), kind: 'admin' }))).toBeNull();
  });

  it('decodes a demo record with its persona, generation, visit, parked session and last touch', () => {
    const decoded = decodeSession(demoRecord({ parkedSessionId: 'real-1', lastTouchAt: 1_759_400_000_000 }));
    expect(decoded).toMatchObject({
      kind: 'demo',
      persona: 'agent',
      demoGeneration: 41,
      demoSid: SID,
      parkedSessionId: 'real-1',
      lastTouchAt: 1_759_400_000_000,
      refreshToken: null,
    });
    expect(isDemoSession(decoded)).toBe(true);
    expect(isRealSession(decoded)).toBe(false);
  });

  it('reads a last touch the Lua round trip wrote as a string', () => {
    expect(decodeSession(demoRecord({ lastTouchAt: '1759400000000' }))).toMatchObject({ lastTouchAt: 1_759_400_000_000 });
    expect(decodeSession(demoRecord({ lastTouchAt: 'soon' }))?.lastTouchAt).toBeUndefined();
  });

  it('never carries a refresh token on a demo session', () => {
    expect(decodeSession(demoRecord({ refreshToken: 'smuggled' }))?.refreshToken).toBeNull();
  });

  it.each([
    ['no persona', { persona: undefined }],
    ['a persona nobody has', { persona: 'root' }],
    ['no generation', { demoGeneration: undefined }],
    ['generation 0', { demoGeneration: 0 }],
    ['a fractional generation', { demoGeneration: 1.5 }],
    ['a generation as a string', { demoGeneration: '41' }],
    ['no visit id', { demoSid: undefined }],
    ['a visit id of the wrong shape', { demoSid: 'demo-1234' }],
    ['a token that is not a demo token', { accessToken: 'eyJhbGciOi.payload.sig' }],
  ])('refuses a demo record with %s outright', (_label, overrides) => {
    expect(decodeSession(demoRecord(overrides))).toBeNull();
  });

  it('tells a real session from a demo one', () => {
    expect(isRealSession(session({ kind: 'oidc' }))).toBe(true);
    expect(isRealSession(session({ kind: 'dev' }))).toBe(true);
    expect(isRealSession(null)).toBe(false);
    expect(isDemoSession(session())).toBe(false);
  });
});

describe('the demo re-entry cookie', () => {
  // 10:00 BST on 3 Oct 2026.
  const NOW = Date.UTC(2026, 9, 3, 9, 0, 0);

  it('names the persona and the UK date, with the session cookie’s attributes', () => {
    const header = demoCookie('agent', NOW);
    expect(header).toBe(`${DEMO_COOKIE}=agent.2026-10-03; Path=/; Max-Age=${14 * 3600}; HttpOnly; Secure; SameSite=Lax`);
    expect(violatesHostPrefix(DEMO_COOKIE, cookieAttributes(60))).toBeNull();
    expect(demoCookieValue('employee', NOW)).toBe('employee.2026-10-03');
  });

  it('lives until the next reset and never longer than a day', () => {
    // 23:59:30 London.
    expect(demoCookieMaxAge(Date.UTC(2026, 9, 2, 22, 59, 30))).toBe(30);
    // Just after midnight London: a whole day, not more.
    expect(demoCookieMaxAge(Date.UTC(2026, 9, 2, 23, 0, 0))).toBe(86_400);
    // The night the clocks go back is 25 hours long; the cookie still stops at a day.
    expect(demoCookieMaxAge(Date.UTC(2026, 9, 24, 23, 0, 0))).toBe(86_400);
  });

  it('is cleared by expiring', () => {
    expect(clearedDemoCookie()).toBe(`${DEMO_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
  });

  it('is valid only for this app’s persona, and only today in London', () => {
    const header = (value: string) => `theme=dark; ${DEMO_COOKIE}=${value}`;
    expect(readDemoReentry(header('agent.2026-10-03'), 'workbench', NOW)).toBe('agent');
    expect(readDemoReentry(header('employee.2026-10-03'), 'portal', NOW)).toBe('employee');
    expect(readDemoReentry(header('employee.2026-10-03'), 'workbench', NOW)).toBeNull();
    expect(readDemoReentry(header('agent.2026-10-02'), 'workbench', NOW)).toBeNull();
    expect(readDemoReentry(header('agent'), 'workbench', NOW)).toBeNull();
    expect(readDemoReentry(header('.2026-10-03'), 'workbench', NOW)).toBeNull();
    expect(readDemoReentry(header('__proto__.2026-10-03'), 'workbench', NOW)).toBeNull();
    expect(readDemoReentry(header('agent.2026-10-03'), 'reports', NOW)).toBeNull();
    expect(readDemoReentry(null, 'workbench', NOW)).toBeNull();
    expect(demoReentryFromValue('agent.2026-10-03', 'workbench', NOW)).toBe('agent');
    expect(demoReentryFromValue(undefined, 'workbench', NOW)).toBeNull();
  });

  it('flips with the UK date, not the UTC one', () => {
    // 00:30 BST on 3 Oct is still 2 Oct in UTC.
    expect(readDemoReentry(`${DEMO_COOKIE}=agent.2026-10-03`, 'workbench', Date.UTC(2026, 9, 2, 23, 30))).toBe('agent');
  });
});
