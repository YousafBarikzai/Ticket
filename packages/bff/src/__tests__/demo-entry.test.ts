import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEMO_KEYS, ukDateKey, type DemoLiveRecord } from '@itsm/contracts/demo';
import { createBff } from '../bff.js';
import { DEMO_COOKIE, demoCookieValue } from '../cookies.js';
import {
  decideDemoEntry,
  decideSignIn,
  demoEntryReason,
  DEMO_ENTRY_FORM_ID,
  DEMO_SIGN_IN_ACTION,
  type DemoEntryDecision,
  type DemoEntryInput,
} from '../demo/entry.js';
import { memoryLoginCounter, setLoginCounter } from '../demo/handlers.js';
import { memoryDemoTokenStore, type MemoryDemoTokenStore } from '../demo/memory-store.js';
import { forgetRemints } from '../demo/remint.js';
import { setDemoTokenStore, type DemoTokenStore } from '../demo/store.js';
import { setSessionStore } from '../store.js';

/**
 * What `/demo` and `/sign-in` show (SPEC §4.5 rows P1–P8, the hop P7h, and
 * I1–I3; A3 §5.3, §6.2, §6.6).
 *
 * The decisions are pure, so most rows below are a table: one input, one
 * answer. The invariants they keep are the reason for the cases chosen —
 * no GET ever mints (a decision is at most a form), a page on another site
 * never auto-submits the form (D22), and a real session is asked, never
 * switched. Each `it()` name starts with its row id.
 */

const DESK = 'https://desk.example.test';
const PORTAL = 'https://help.example.test';
const ADMIN = 'https://admin.example.test';
const SITE = 'https://www.example.test';
const ORIGINS = { portal: PORTAL, workbench: DESK, admin: ADMIN, site: SITE };

function input(
  overrides: Partial<Omit<DemoEntryInput, 'headers' | 'query'>> & { headers?: Record<string, string>; query?: Record<string, string> } = {},
): DemoEntryInput {
  const { headers = {}, query = {}, ...rest } = overrides;
  return {
    app: 'workbench',
    mode: true,
    paused: false,
    liveGeneration: 7,
    buildEtaSec: null,
    session: null,
    query: new URLSearchParams(query),
    headers: new Headers(headers),
    origins: ORIGINS,
    ownOrigin: DESK,
    defaultLanding: '/overview',
    ...rest,
  };
}

const sameOrigin = { 'sec-fetch-site': 'same-origin' };
const demoSession = (generation = 7) => ({ kind: 'demo' as const, persona: 'agent' as const, demoGeneration: generation, displayName: 'Alex Morgan' });

/** The fields a decision with a form carries, for the rows that must never auto-submit. */
function autoSubmits(decision: DemoEntryDecision): boolean {
  return 'autoSubmit' in decision && decision.autoSubmit === true;
}

describe('GET /demo (P rows)', () => {
  it('P1 is a 404 while the demo is off here', () => {
    expect(decideDemoEntry(input({ mode: false, headers: sameOrigin }))).toEqual({ row: 'P1', kind: 'not-found' });
  });

  it('P2 shows the paused page, with no form, before anything else', () => {
    const decision = decideDemoEntry(input({ paused: true, liveGeneration: null, session: demoSession(), headers: sameOrigin }));
    expect(decision).toMatchObject({ row: 'P2', kind: 'paused', area: 'workbench' });
    expect('form' in decision).toBe(false);
  });

  it('P3 says the demo is being prepared and checks again every 15 s while nothing is live', () => {
    const decision = decideDemoEntry(input({ liveGeneration: null, buildEtaSec: 200, headers: sameOrigin }));
    expect(decision).toMatchObject({ row: 'P3', kind: 'preparing', refreshSeconds: 15, etaSec: 200 });
    expect('form' in decision).toBe(false);
    // No estimate, or a nonsense one: the copy falls back to "a few minutes".
    expect(decideDemoEntry(input({ liveGeneration: null, buildEtaSec: null }))).toMatchObject({ row: 'P3', etaSec: null });
    expect(decideDemoEntry(input({ liveGeneration: null, buildEtaSec: -5 }))).toMatchObject({ row: 'P3', etaSec: null });
  });

  it('P4 sends a browser already in today’s demo straight on with a 307', () => {
    const decision = decideDemoEntry(input({ session: demoSession(7), query: { redirectTo: '/tickets/INC-0042' } }));
    expect(decision).toMatchObject({ row: 'P4', kind: 'redirect', status: 307, location: '/tickets/INC-0042' });
  });

  it('P4 lands on the app’s own page when the link asks for somewhere off-origin', () => {
    expect(decideDemoEntry(input({ session: demoSession(7), query: { redirectTo: 'https://evil.example' } }))).toMatchObject({
      row: 'P4',
      location: '/overview',
    });
  });

  it('P4 does not count a session of an older generation as in the demo', () => {
    expect(decideDemoEntry(input({ session: demoSession(6), headers: sameOrigin }))).toMatchObject({ row: 'P7' });
  });

  it.each([
    ['a provider session', 'oidc' as const],
    ['a development session', 'dev' as const],
  ])('P5 asks %s before replacing it, and never submits by itself', (_label, kind) => {
    const decision = decideDemoEntry(
      input({ session: { kind, displayName: 'Jane Smith' }, headers: sameOrigin, query: { redirectTo: '/resume' } }),
    );
    expect(decision).toMatchObject({ row: 'P5', kind: 'confirm', signedInAs: 'Jane Smith' });
    expect(autoSubmits(decision)).toBe(false);
    if (decision.kind !== 'confirm') throw new Error('unreachable');
    expect(decision.form).toEqual({
      id: DEMO_ENTRY_FORM_ID,
      method: 'post',
      action: DEMO_SIGN_IN_ACTION,
      fields: { persona: 'agent', redirectTo: '/resume', confirm: 'replace' },
    });
  });

  it.each([
    ['busy', 'busy'],
    ['capacity', 'capacity'],
    ['invalid', 'invalid'],
    ['ended', 'ended'],
    ['unavailable', 'ended'],
    ['paused', 'busy'],
    ['preparing', 'busy'],
    ['an-old-code', 'invalid'],
    ['__proto__', 'invalid'],
    ['constructor', 'invalid'],
  ])('P6 answers reason=%s with the %s copy and a button, never an auto-submit, even same-origin', (reason, expected) => {
    const decision = decideDemoEntry(input({ headers: sameOrigin, query: { reason, redirectTo: '/overview' } }));
    expect(decision).toMatchObject({ row: 'P6', kind: 'reason', reason: expected });
    expect(autoSubmits(decision)).toBe(false);
  });

  it('P6 maps the reason codes the BFF emits, and only those, to their copy', () => {
    expect(demoEntryReason('unavailable')).toBe('ended');
    expect(demoEntryReason('hasOwnProperty')).toBe('invalid');
  });

  it('P6 gives a visitor asked to confirm, who has no real session any more, the plain button (P8)', () => {
    const decision = decideDemoEntry(input({ headers: sameOrigin, query: { reason: 'confirm' } }));
    expect(decision).toMatchObject({ row: 'P8', kind: 'form', autoSubmit: false });
  });

  it('P7h shows the hop card for an area switch from a sibling app to /resume, and submits it', () => {
    const decision = decideDemoEntry(
      input({ headers: { 'sec-fetch-site': 'same-site', referer: `${PORTAL}/tickets` }, query: { redirectTo: '/resume', persona: 'agent', demo: '1' } }),
    );
    expect(decision).toMatchObject({ row: 'P7h', kind: 'hop', autoSubmit: true, from: 'portal', redirectTo: '/resume' });
  });

  it('P7h hops for a deep link from a sibling app too, whatever Sec-Fetch-Site says', () => {
    const decision = decideDemoEntry(
      input({ headers: { 'sec-fetch-site': 'cross-site', referer: `${ADMIN}/` }, query: { redirectTo: '/tickets/INC-0042' } }),
    );
    expect(decision).toMatchObject({ row: 'P7h', from: 'admin', redirectTo: '/tickets/INC-0042' });
  });

  it('P7h is not a hop without a landing page in the link: an allowed Referer is P7', () => {
    expect(decideDemoEntry(input({ headers: { referer: `${PORTAL}/` } }))).toMatchObject({ row: 'P7', autoSubmit: true });
  });

  it('P7h is not a hop from this app itself, nor from the site, which are P7', () => {
    expect(decideDemoEntry(input({ headers: { ...sameOrigin, referer: `${DESK}/overview` }, query: { redirectTo: '/resume', resumed: '1' } }))).toMatchObject({
      row: 'P7',
      resumed: true,
    });
    expect(decideDemoEntry(input({ headers: { referer: `${SITE}/try/agent` }, query: { redirectTo: '/resume' } }))).toMatchObject({ row: 'P7' });
  });

  it('P7h refuses an unsafe landing page as a hop, and lands on the default instead', () => {
    const decision = decideDemoEntry(input({ headers: { referer: `${PORTAL}/` }, query: { redirectTo: '//evil.example' } }));
    expect(decision).toMatchObject({ row: 'P7', redirectTo: '/overview' });
  });

  it('P7 submits the form by itself for a same-origin request, and says so on a return visit', () => {
    const first = decideDemoEntry(input({ headers: sameOrigin }));
    expect(first).toMatchObject({ row: 'P7', kind: 'form', autoSubmit: true, resumed: false });
    const back = decideDemoEntry(input({ headers: sameOrigin, query: { resumed: '1' } }));
    expect(back).toMatchObject({ row: 'P7', resumed: true });
  });

  it('P7 submits by itself for a link from the public site (a configured origin)', () => {
    expect(decideDemoEntry(input({ headers: { 'sec-fetch-site': 'cross-site', referer: `${SITE}/` } }))).toMatchObject({ row: 'P7', autoSubmit: true });
  });

  it.each([
    ['a typed URL (Sec-Fetch-Site: none)', { 'sec-fetch-site': 'none' }],
    ['same-site without a Referer', { 'sec-fetch-site': 'same-site' }],
    ['no headers at all', {}],
    ['a Referer from an origin nobody configured', { 'sec-fetch-site': 'cross-site', referer: 'https://evil.example/page' }],
    ['a Referer that is not a URL', { referer: 'not a url' }],
    ['a javascript: Referer', { referer: 'javascript:alert(1)' }],
  ])('P8 shows a button and never submits by itself for %s', (_label, headers) => {
    const decision = decideDemoEntry(input({ headers }));
    expect(decision).toMatchObject({ row: 'P8', kind: 'form', autoSubmit: false });
  });

  it('P8 ignores a persona in the link: the app decides its own (D11)', () => {
    const decision = decideDemoEntry(input({ query: { persona: 'admin' } }));
    if (decision.kind !== 'form') throw new Error('expected a form');
    expect(decision.form.fields.persona).toBe('agent');
    expect(decision.persona.name).toBe('Alex Morgan');
  });

  it('reads Next’s searchParams record, taking the first of a repeated parameter', () => {
    const decision = decideDemoEntry({ ...input({ headers: sameOrigin }), query: { redirectTo: ['/tickets', '/elsewhere'], resumed: '1' } });
    expect(decision).toMatchObject({ row: 'P7', redirectTo: '/tickets', resumed: true });
  });

  it('gives the Help Portal its own persona and area', () => {
    const decision = decideDemoEntry(input({ app: 'portal', ownOrigin: PORTAL, defaultLanding: '/', headers: sameOrigin }));
    expect(decision).toMatchObject({ row: 'P7', area: 'portal', persona: { key: 'employee', name: 'Emma Clarke' } });
  });
});

describe('GET /sign-in (I rows)', () => {
  const base = { app: 'workbench', defaultLanding: '/overview', ownOrigin: DESK, siteOrigin: SITE, redirectTo: '/tickets' };

  it('I1 shows the development form, and offers the demo back when this browser was in it today', () => {
    expect(decideSignIn({ ...base, mode: false, development: true, reentry: null })).toEqual({
      row: 'I1',
      kind: 'development',
      continueDemo: null,
      redirectTo: '/tickets',
    });
    const offered = decideSignIn({ ...base, mode: true, development: true, reentry: 'agent' });
    expect(offered).toMatchObject({
      row: 'I1',
      continueDemo: { persona: { key: 'agent' }, href: '/demo?persona=agent&demo=1&redirectTo=%2Ftickets' },
    });
  });

  it('I2 is the chooser: continue the demo (same-origin, so it reopens by itself) or a work account', () => {
    const decision = decideSignIn({ ...base, mode: true, development: false, reentry: 'agent' });
    expect(decision).toEqual({
      row: 'I2',
      kind: 'chooser',
      persona: expect.objectContaining({ key: 'agent', name: 'Alex Morgan', title: 'Service Desk team lead' }),
      continueHref: '/demo?persona=agent&demo=1&redirectTo=%2Ftickets',
      workAccountHref: '/api/session/login?account=1&redirectTo=%2Ftickets',
      homeHref: SITE,
      redirectTo: '/tickets',
    });
  });

  it('I3 offers a work account and, with the demo on, "New here? Explore the demo"', () => {
    expect(decideSignIn({ ...base, mode: true, development: false, reentry: null })).toEqual({
      row: 'I3',
      kind: 'sign-in',
      workAccountHref: '/api/session/login?account=1&redirectTo=%2Ftickets',
      exploreHref: `${DESK}/demo?persona=agent&demo=1`,
      homeHref: SITE,
      redirectTo: '/tickets',
    });
    expect(decideSignIn({ ...base, mode: false, development: false, reentry: 'agent' })).toMatchObject({
      row: 'I3',
      exploreHref: null,
      homeHref: null,
    });
  });

  it('I3 keeps an off-origin redirectTo out of every link', () => {
    const decision = decideSignIn({ ...base, mode: true, development: false, reentry: null, redirectTo: 'https://evil.example' });
    expect(decision).toMatchObject({ row: 'I3', workAccountHref: '/api/session/login?account=1&redirectTo=%2Foverview' });
  });
});

describe('the pages’ inputs, gathered by the BFF', () => {
  const LIVE: DemoLiveRecord = {
    v: 1,
    tenantId: '3f1c2a9e-5b7d-4e8f-9a0b-1c2d3e4f5a6b',
    slug: 'demo',
    generation: 7,
    builtAt: Date.UTC(2026, 9, 2),
    anchor: Date.UTC(2026, 9, 2),
    lastResetAt: Date.UTC(2026, 9, 2),
    lastResetReason: 'scheduled',
    personas: {
      employee: { userId: 'a1000000-0000-4000-8000-000000000001' },
      agent: { userId: 'a1000000-0000-4000-8000-000000000002' },
      admin: { userId: 'a1000000-0000-4000-8000-000000000003' },
    },
    agentTeamIds: ['c3000000-0000-4000-8000-000000000001'],
  };
  const APP = {
    appName: 'workbench',
    originEnvVar: 'WORKBENCH_ORIGIN',
    defaultOrigin: DESK,
    defaultLanding: '/overview',
    signInPath: '/sign-in',
    signedOutPath: '/signed-out',
  };
  const ENV = { NODE_ENV: 'test', WORKBENCH_ORIGIN: DESK, PORTAL_ORIGIN: PORTAL, ADMIN_ORIGIN: ADMIN, SITE_ORIGIN: SITE, API_BASE_URL: 'http://api.internal' };
  let tokens: MemoryDemoTokenStore;

  beforeEach(() => {
    tokens = memoryDemoTokenStore({ appName: 'workbench', clock: () => Date.now() });
    setSessionStore('workbench', tokens.sessions);
    setDemoTokenStore('workbench', tokens);
    setLoginCounter('workbench', memoryLoginCounter(tokens.keyspace));
    forgetRemints();
  });

  afterEach(() => {
    setSessionStore('workbench', null);
    setDemoTokenStore('workbench', null);
    setLoginCounter('workbench', null);
  });

  it('P1 through the BFF: no demo, no page', async () => {
    const bff = createBff(APP, { ...ENV, DEMO_MODE: 'off' });
    expect(await bff.demoEntry({ cookie: undefined, query: {}, headers: new Headers(sameOrigin) })).toEqual({ row: 'P1', kind: 'not-found' });
  });

  it('P2 and P7 through the BFF, from the records in the store', async () => {
    const bff = createBff(APP, { ...ENV, DEMO_MODE: 'on' });
    tokens.write(DEMO_KEYS.live, LIVE);
    expect(await bff.demoEntry({ cookie: undefined, query: {}, headers: new Headers(sameOrigin) })).toMatchObject({ row: 'P7' });
    tokens.write(DEMO_KEYS.paused, { by: 'operator', at: Date.now(), reason: 'maintenance' });
    expect(await bff.demoEntry({ cookie: undefined, query: {}, headers: new Headers(sameOrigin) })).toMatchObject({ row: 'P2' });
  });

  it('P3 through the BFF when the store cannot be read: "being prepared", which checks again by itself', async () => {
    const broken: DemoTokenStore = { ...tokens, readStatusRecords: () => Promise.reject(new Error('ECONNREFUSED')) };
    setDemoTokenStore('workbench', broken);
    const bff = createBff(APP, { ...ENV, DEMO_MODE: 'on' });
    expect(await bff.demoEntry({ cookie: undefined, query: {}, headers: new Headers(sameOrigin) })).toMatchObject({ row: 'P3', refreshSeconds: 15 });
  });

  it('P7h through the BFF, with the sibling origins read from the environment', async () => {
    const bff = createBff(APP, { ...ENV, DEMO_MODE: 'on' });
    tokens.write(DEMO_KEYS.live, LIVE);
    const decision = await bff.demoEntry({
      cookie: undefined,
      query: { redirectTo: '/resume' },
      headers: new Headers({ 'sec-fetch-site': 'same-site', referer: `${ADMIN}/` }),
    });
    expect(decision).toMatchObject({ row: 'P7h', from: 'admin' });
  });

  it('I2 through the BFF, from the re-entry cookie’s value', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(Date.UTC(2026, 9, 3, 12));
      const bff = createBff(APP, { ...ENV, NODE_ENV: 'production', OIDC_ISSUER: 'https://id.example.test/realms/x', OIDC_CLIENT_ID: 'c', OIDC_CLIENT_SECRET: 's', DEMO_MODE: 'on' });
      expect(ukDateKey(Date.now())).toBe('2026-10-03');
      expect(bff.signInPage({ demoCookie: demoCookieValue('agent'), redirectTo: '/overview' })).toMatchObject({ row: 'I2' });
      // Yesterday's cookie, or another app's persona, offers nothing.
      expect(bff.signInPage({ demoCookie: 'agent.2026-10-02', redirectTo: '/overview' })).toMatchObject({ row: 'I3' });
      expect(bff.signInPage({ demoCookie: demoCookieValue('employee'), redirectTo: '/overview' })).toMatchObject({ row: 'I3' });
      expect(bff.signInPage({ demoCookie: undefined, redirectTo: '/overview' })).toMatchObject({ row: 'I3' });
      expect(DEMO_COOKIE).toBe('__Host-itsm-demo');
    } finally {
      vi.useRealTimers();
    }
  });
});
