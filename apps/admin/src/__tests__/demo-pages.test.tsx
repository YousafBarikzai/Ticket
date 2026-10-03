// @vitest-environment jsdom
import { createRequire } from 'node:module';
import { act, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * The deployment: the four public origins, read once per process by
 * `@itsm/bff/areas`, so they are set before anything imports it.
 */
process.env.PORTAL_ORIGIN = 'https://help.acme.test';
process.env.WORKBENCH_ORIGIN = 'https://desk.acme.test';
process.env.ADMIN_ORIGIN = 'https://admin.acme.test';
process.env.SITE_ORIGIN = 'https://itsm.example';

vi.mock('server-only', () => ({}));

const { ApiError, decideDemoEntry, decideSignIn } = await (async () => {
  const sdk = await import('@itsm/sdk');
  const bffEntry = await import('@itsm/bff');
  return { ApiError: sdk.ApiError, decideDemoEntry: bffEntry.decideDemoEntry, decideSignIn: bffEntry.decideSignIn };
})();
type DemoEntryDecision = ReturnType<typeof decideDemoEntry>;
type SignInDecision = ReturnType<typeof decideSignIn>;

/** What the BFF answers this file's pages: set per test. */
let entry: DemoEntryDecision;
let signIn: SignInDecision;
let demoOn = true;
let session: { kind: 'oidc' | 'dev' | 'demo'; displayName: string | null; createdAt: number } | null = null;
vi.mock('../bff.js', () => ({
  bff: {
    get config() {
      return { defaultLanding: '/', appOrigin: 'https://admin.acme.test', demo: demoOn ? {} : null };
    },
    demoEntry: async () => entry,
    signInPage: () => signIn,
    sessionFor: async () => session,
    latestSession: (value: unknown) => value,
    clientFor: () => ({}),
    developmentSignInAvailable: () => false,
  },
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers({ 'x-itsm-path': '/rules' }),
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
  usePathname: () => '/rules',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
// The bar's lazy wrappers, as the bar itself: `next/dynamic` needs Next's runtime, and the bar is what is drawn.
vi.mock('../app/demo/bars.js', async () => {
  const { DemoBar } = await import('@itsm/ui/shell');
  return { LazyPublicDemoBar: DemoBar, LazySessionDemoBar: DemoBar };
});
// The form submits itself in a browser; here it only says it would.
vi.mock('@itsm/ui', async (importOriginal) => {
  const real = await importOriginal<typeof import('@itsm/ui')>();
  return { ...real, AutoSubmitForm: ({ formId }: { formId: string }) => <span data-auto-submit={formId} /> };
});

/** The console layout's view of who is signed in, for its ended screen. */
let load: { kind: 'ended'; demo: boolean } = { kind: 'ended', demo: true };
vi.mock('../server/session.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../server/session.js')>();
  return { ...real, loadActor: async () => load, currentPath: async () => '/rules?open=rule:vip' };
});

const { default: DemoPage, generateMetadata } = await import('../app/demo/page.js');
const { default: SignInPage } = await import('../app/sign-in/page.js');
const { default: SignedOutPage } = await import('../app/signed-out/page.js');
const { default: ConsoleLayout } = await import('../app/(console)/layout.js');
const { demoRefusal, demoEntryFor, DEMO_LOOP_BREAKER_MS } = await import('../server/session.js');
const { cleanupDocument, render } = await import('./support/render.js');

/**
 * The pages outside the frame (SPEC v3 §4.5, §4.6.2–§4.6.4; A3 §6.2, §6.6,
 * §6.7): `/demo` for every decision the BFF makes, the hop card included;
 * `/sign-in` for I1–I3; `/signed-out` for each variant; and the console's
 * ended screen in a demo visit — each read for its words and controls, and
 * audited with axe.
 */

/*
 * axe-core is the design system's devDependency; this app has none of its own
 * (adding one is a dependency line for an integrator, SPEC §15.0 rule 9). It
 * is resolved through `@itsm/ui`, so this audit runs the same axe the design
 * system's own tests run.
 */
interface AxeRule {
  readonly id: string;
  readonly nodes: readonly { readonly html: string }[];
}
interface Axe {
  run(context: Element, options: Record<string, unknown>): Promise<{ violations: AxeRule[] }>;
}
const axe = createRequire(createRequire(import.meta.url).resolve('@itsm/ui'))('axe-core') as Axe;
/** Rules a fragment in jsdom cannot answer: the document's own parts, and those that need a layout engine. */
const OFF = ['html-has-lang', 'document-title', 'html-lang-valid', 'color-contrast', 'color-contrast-enhanced', 'target-size'];
async function violations(container: Element): Promise<string[]> {
  let found: AxeRule[] = [];
  // Inside `act`: the bar's countdown ticks while axe works, and that update is the page's own.
  await act(async () => {
    const results = await axe.run(container, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] },
      rules: Object.fromEntries(OFF.map((rule) => [rule, { enabled: false }])),
    });
    found = results.violations;
  });
  return found.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.html).join(' | ')}`);
}

const ORIGINS = { portal: 'https://help.acme.test', workbench: 'https://desk.acme.test', admin: 'https://admin.acme.test', site: 'https://itsm.example' };

/** A `/demo` decision as the BFF makes it, from the real decision table. */
function decide(
  overrides: Partial<Omit<Parameters<typeof decideDemoEntry>[0], 'query' | 'headers'>> & { query?: Record<string, string>; headers?: Record<string, string> } = {},
): DemoEntryDecision {
  const { query = {}, headers = {}, ...rest } = overrides;
  return decideDemoEntry({
    app: 'admin',
    mode: true,
    paused: false,
    liveGeneration: 3,
    session: null,
    query: new URLSearchParams(query),
    headers: new Headers(headers),
    origins: ORIGINS,
    ownOrigin: ORIGINS.admin,
    defaultLanding: '/',
    ...rest,
  });
}

async function show(page: Promise<ReactElement | unknown>): Promise<HTMLElement> {
  const element = (await page) as ReactElement;
  return render(element).container;
}

const params = (query: Record<string, string> = {}) => ({ searchParams: Promise.resolve(query) });
const text = (root: Element, selector: string): string => root.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
const links = (root: Element): string[][] => [...root.querySelectorAll('a')].map((link) => [link.textContent?.replace(/\s+/g, ' ').trim() ?? '', link.getAttribute('href') ?? '']);

beforeEach(() => {
  demoOn = true;
  session = null;
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }));
});

afterEach(() => {
  cleanupDocument();
  vi.unstubAllGlobals();
});

describe('/demo', () => {
  it('does not exist while the demo is off (P1), and goes straight on for a live visit (P4)', async () => {
    entry = decide({ mode: false });
    await expect(DemoPage(params())).rejects.toThrow('NEXT_NOT_FOUND');
    entry = decide({ session: { kind: 'demo', persona: 'admin', demoGeneration: 3, displayName: 'Jordan Lee' }, query: { redirectTo: '/rules' } });
    await expect(DemoPage(params())).rejects.toThrow('NEXT_REDIRECT /rules');
  });

  it('opens by itself from this origin (P7), with the persona, the company and the reset', async () => {
    entry = decide({ headers: { 'sec-fetch-site': 'same-origin' }, query: { redirectTo: '/rules' } });
    const page = await show(DemoPage(params()));
    expect(text(page, 'h1')).toBe('Opening Administration…');
    expect(page.querySelector('h1 [role="status"]')).not.toBeNull();
    expect(text(page, '.app-Entry__body')).toBe(
      'You’re exploring as Jordan Lee, IT Service Manager at Northwind Traders (UK), a fictional company. Demo data resets every day at 00:00 UK time.',
    );
    const form = page.querySelector<HTMLFormElement>('form#itsm-demo-entry')!;
    expect(form.getAttribute('method')).toBe('post');
    expect(form.getAttribute('action')).toBe('/api/session/demo');
    expect(Object.fromEntries(new FormData(form))).toEqual({ persona: 'admin', redirectTo: '/rules' });
    expect(page.querySelector('[data-auto-submit="itsm-demo-entry"]')).not.toBeNull();
    // "Open the demo", becoming "Taking a while? Open the demo" after 3 s (CSS).
    expect(text(page, 'button .app-Entry__now')).toBe('Open the demo');
    expect(text(page, 'button .app-Entry__later')).toBe('Taking a while? Open the demo');
    // The public bar above, and the lockup to the site.
    expect(page.querySelector('.itsm-SystemBar[aria-label="Demo environment"]')).not.toBeNull();
    expect(page.querySelector('a.itsm-SignInLayout__lockup')?.getAttribute('href')).toBe('https://itsm.example/');
    expect(await violations(page)).toEqual([]);
  });

  it('welcomes a returning visitor back (P7, resumed)', async () => {
    entry = decide({ headers: { 'sec-fetch-site': 'same-origin' }, query: { resumed: '1' } });
    expect(text(await show(DemoPage(params())), 'h1')).toBe('Welcome back — reopening the demo…');
  });

  it('asks with a button when the link came from anywhere else (P8)', async () => {
    entry = decide();
    const page = await show(DemoPage(params()));
    expect(text(page, 'h1')).toBe('Explore Administration');
    expect(text(page, '.app-Entry__body')).toContain('You’ll be signed in to a shared demo as Jordan Lee, IT Service Manager.');
    expect(text(page, '.app-Entry__body')).toContain('please don’t enter real personal data');
    expect(page.querySelector('[data-auto-submit]')).toBeNull();
    expect(text(page, 'form button')).toBe('Open the demo');
    expect(links(page)).toContainEqual(['IT Service Management home', 'https://itsm.example/']);
    expect(await violations(page)).toEqual([]);
  });

  it('asks a person signed in to their own account first, never switching them (P5)', async () => {
    entry = decide({ session: { kind: 'oidc', persona: undefined, demoGeneration: undefined, displayName: 'Ada Admin' }, query: { redirectTo: '/audit' } });
    const page = await show(DemoPage(params()));
    expect(text(page, 'h1')).toBe('You’re signed in as Ada Admin');
    expect(text(page, '.app-Entry__body')).toContain('You’ll explore as Jordan Lee in a shared demo.');
    const form = page.querySelector<HTMLFormElement>('form#itsm-demo-entry')!;
    expect(Object.fromEntries(new FormData(form))).toEqual({ persona: 'admin', redirectTo: '/audit', confirm: 'replace' });
    expect(page.querySelector('[data-auto-submit]')).toBeNull();
    expect(links(page)).toContainEqual(['Stay in my account', '/audit']);
    expect(await violations(page)).toEqual([]);
  });

  it.each([
    ['busy', 'The demo is busy', 'Please try again in a moment.', 'Try again'],
    ['capacity', 'The demo is very busy right now', 'Lots of people are exploring at once. Please try again in a few minutes.', 'Try again'],
    ['invalid', 'That link didn’t work', 'Open the demo from the start.', 'Open the demo'],
    ['unavailable', 'Your demo session ended', 'Pick up where you left off — the demo data may have been reset since.', 'Continue the demo'],
  ])('says why an earlier attempt came back (P6, %s), with a button and never by itself', async (reason, title, body, action) => {
    entry = decide({ headers: { 'sec-fetch-site': 'same-origin' }, query: { reason } });
    const page = await show(DemoPage(params()));
    expect(text(page, 'h1')).toBe(title);
    expect(text(page, '.app-Entry__body')).toBe(body);
    expect(text(page, 'form button')).toBe(action);
    expect(page.querySelector('[data-auto-submit]')).toBeNull();
    expect(await violations(page)).toEqual([]);
  });

  it('says when the demo is paused (P2), on the bar too', async () => {
    entry = decide({ paused: true });
    const page = await show(DemoPage(params()));
    expect(text(page, 'h1')).toBe('The demo is paused');
    expect(page.querySelector('form')).toBeNull();
    expect(page.querySelector('.itsm-SystemBar')?.textContent).toContain('Paused');
    expect(await violations(page)).toEqual([]);
  });

  it('says it is being prepared and checks again by itself (P3)', async () => {
    entry = decide({ liveGeneration: null, buildEtaSec: 200 });
    const page = await show(DemoPage(params()));
    expect(text(page, 'h1')).toBe('The demo is being prepared…');
    expect(text(page, '.app-Entry__body')).toBe('It’s being built with fresh data and is usually ready in about 4 minutes. This page checks again by itself.');
    expect(document.querySelector('meta[http-equiv="refresh"]')?.getAttribute('content')).toBe('15');
    expect(page.querySelector('.itsm-SystemBar')?.textContent).toContain('Preparing the demo…');
    expect(await violations(page)).toEqual([]);
  });

  it('draws an area switch as the hop card, submitting by itself (P7h, X-M11)', async () => {
    entry = decide({ headers: { referer: 'https://desk.acme.test/overview' }, query: { redirectTo: '/resume' } });
    expect(entry.kind).toBe('hop');
    const page = await show(DemoPage(params()));
    const card = page.querySelector('.itsm-StatusScreen[data-variant="hop"]')!;
    expect(text(card, 'h1 [role="status"]')).toBe('Opening Administration as Jordan Lee…');
    expect(text(card, '.itsm-StatusScreen__session .itsm-SystemBar__badge')).toBe('Demo');
    expect(text(card, '.itsm-StatusScreen__persona')).toBe('You’re Jordan Lee · IT Service Manager');
    expect(page.querySelector('.itsm-SignInLayout')).toBeNull();
    expect(Object.fromEntries(new FormData(page.querySelector<HTMLFormElement>('form#itsm-demo-entry')!))).toEqual({ persona: 'admin', redirectTo: '/resume' });
    expect(page.querySelector('[data-auto-submit="itsm-demo-entry"]')).not.toBeNull();
    expect(text(page, 'button.app-Entry__hopAction')).toBe('Taking a while? Open the demo');
    expect(await violations(page)).toEqual([]);
  });

  it('titles the document with the decision and keeps it out of every index', async () => {
    entry = decide();
    expect(await generateMetadata(params())).toEqual({ title: 'Explore Administration', robots: { index: false, follow: false } });
    entry = decide({ mode: false });
    expect(await generateMetadata(params())).toEqual({ robots: { index: false, follow: false } });
  });
});

describe('/sign-in', () => {
  const base = { app: 'admin', mode: true, development: false, reentry: null, redirectTo: '/rules', defaultLanding: '/', ownOrigin: ORIGINS.admin, siteOrigin: ORIGINS.site } as const;

  it('offers a returning demo visitor the demo back, or their work account (I2)', async () => {
    signIn = decideSignIn({ ...base, reentry: 'admin' });
    const page = await show(SignInPage(params()));
    expect(text(page, 'h1')).toBe('Welcome back');
    expect(text(page, '.app-Entry__body')).toBe('This browser was exploring the demo as Jordan Lee, IT Service Manager.');
    expect(links(page)).toEqual(
      expect.arrayContaining([
        ['Continue the demo as Jordan Lee', '/demo?persona=admin&demo=1&redirectTo=%2Frules'],
        ['Sign in with your work account', '/api/session/login?account=1&redirectTo=%2Frules'],
        ['IT Service Management home', 'https://itsm.example/'],
      ]),
    );
    expect(await violations(page)).toEqual([]);
  });

  it('signs in to Administration, and offers the demo to someone new (I3)', async () => {
    signIn = decideSignIn(base);
    const page = await show(SignInPage(params()));
    expect(text(page, 'h1')).toBe('Sign in to Administration');
    expect(links(page)).toEqual(
      expect.arrayContaining([
        ['Sign in with your work account', '/api/session/login?account=1&redirectTo=%2Frules'],
        ['Explore the demo', 'https://admin.acme.test/demo?persona=admin&demo=1'],
      ]),
    );
    expect(await violations(page)).toEqual([]);
  });

  it('has no demo, no bar and no site in a deployment without the demo (I3)', async () => {
    demoOn = false;
    signIn = decideSignIn({ ...base, mode: false });
    const page = await show(SignInPage(params()));
    expect(page.querySelector('.itsm-SystemBar')).toBeNull();
    expect(links(page).map(([label]) => label)).toEqual(['Sign in with your work account']);
  });

  it('shows the development form, and the demo back beside it (I1)', async () => {
    signIn = decideSignIn({ ...base, development: true, reentry: 'admin' });
    const page = await show(SignInPage(params({ reason: 'No active account with that address.' })));
    expect(text(page, 'h1')).toBe('Sign in to Administration');
    const form = page.querySelector<HTMLFormElement>('form.app-SignIn__form')!;
    expect(form.getAttribute('action')).toBe('/api/session/dev');
    expect(form.querySelector<HTMLInputElement>('input[name="redirectTo"]')?.value).toBe('/rules');
    expect(page.textContent).toContain('No active account with that address.');
    expect(links(page)).toContainEqual(['Continue the demo as Jordan Lee', '/demo?persona=admin&demo=1&redirectTo=%2Frules']);
    expect(await violations(page)).toEqual([]);
  });
});

describe('/signed-out', () => {
  it('says the session ended, offering a sign-in and, with the demo on, the site', async () => {
    const page = await show(SignedOutPage(params()));
    expect(text(page, 'h1')).toBe('You’re signed out');
    expect(links(page)).toEqual(
      expect.arrayContaining([
        ['Sign in again', '/api/session/login'],
        ['IT Service Management home', 'https://itsm.example/'],
      ]),
    );
    expect(await violations(page)).toEqual([]);
  });

  it('thanks a demo visitor, with the site and a way back in as each persona', async () => {
    const page = await show(SignedOutPage(params({ demo: '1' })));
    expect(text(page, 'h1')).toBe('Thanks for exploring');
    expect(text(page, '.app-Entry__body')).toBe(
      'Your demo session has ended. Northwind Traders (UK) and its people are fictional, and the demo resets every night at 00:00 UK time.',
    );
    expect(links(page)).toEqual(
      expect.arrayContaining([
        ['IT Service Management home', 'https://itsm.example/'],
        ['Explore as Employee · Emma Clarke, Finance Manager', 'https://help.acme.test/demo?persona=employee&demo=1'],
        ['Explore as Agent · Alex Morgan, Service Desk team lead', 'https://desk.acme.test/demo?persona=agent&demo=1'],
        ['Explore as Admin · Jordan Lee, IT Service Manager', '/demo?persona=admin&demo=1'],
      ]),
    );
    expect(page.querySelector('a[href="/api/session/login"]')).toBeNull();
    expect(await violations(page)).toEqual([]);
  });

  it('welcomes a person back to their own account when the demo handed it back', async () => {
    session = { kind: 'oidc', displayName: 'Ada Admin', createdAt: 0 };
    const page = await show(SignedOutPage(params({ demo: '1', restored: '1' })));
    expect(text(page, '.app-Entry__body')).toBe('You’re back in your own account, signed in as Ada Admin.');
    expect(links(page)).toContainEqual(['Continue to Administration', '/']);
    expect(await violations(page)).toEqual([]);
  });

  it('says why a sign-in did not finish, in the BFF’s words and never the link’s', async () => {
    const page = await show(SignedOutPage(params({ reason: 'stale' })));
    expect(text(page, 'h1')).toBe('That sign-in didn’t finish');
    expect(text(page, '.itsm-Banner')).toContain('That sign-in had already been used, or it expired.');
    expect(links(page)).toContainEqual(['Sign in again', '/api/session/login']);
    expect(await violations(page)).toEqual([]);
    cleanupDocument();
    const odd = await show(SignedOutPage(params({ reason: '<b>Your account was hacked</b>' })));
    expect(odd.textContent).not.toContain('hacked');
    expect(text(odd, '.itsm-Banner')).toContain('Something went wrong while signing you in.');
  });

  it('sends a person whose own sign-in expired during the demo to their work account', async () => {
    const page = await show(SignedOutPage(params({ demo: '1', reason: 'parked_expired' })));
    expect(text(page, 'h1')).toBe('Thanks for exploring');
    expect(text(page, '.itsm-Banner')).toContain('Your account’s sign-in expired while you explored; sign in again.');
    expect(links(page)).toContainEqual(['Sign in again', '/api/session/login?account=1']);
  });

  it('has no bar and no site link without the demo', async () => {
    demoOn = false;
    const page = await show(SignedOutPage(params()));
    expect(page.querySelector('.itsm-SystemBar')).toBeNull();
    expect(links(page)).toEqual([['Sign in again', '/api/session/login']]);
  });
});

describe('the console’s ended screen in a demo visit (§4.6.4)', () => {
  it('says the demo session ended and continues the demo through /demo', async () => {
    load = { kind: 'ended', demo: true };
    const page = await show(ConsoleLayout({ children: null }));
    expect(text(page, 'h1')).toBe('Your demo session ended');
    expect(links(page)).toEqual([['Continue the demo', '/demo?persona=admin&demo=1&redirectTo=%2Frules%3Fopen%3Drule%3Avip']]);
    expect(page.textContent).not.toContain('Sign in again');
    expect(await violations(page)).toEqual([]);
  });

  it('keeps "Sign in again" for a real session', async () => {
    load = { kind: 'ended', demo: false };
    const page = await show(ConsoleLayout({ children: null }));
    expect(text(page, 'h1')).toBe('Your session ended');
    expect(links(page)).toEqual([['Sign in again', '/api/session/login?redirectTo=%2Frules%3Fopen%3Drule%3Avip']]);
  });
});

describe('the demo bar’s lazy wrappers (app/demo/bars.tsx, session-bar.tsx)', () => {
  const clock = { nextResetAt: 86_400_000, serverNow: 3_600_000, periodMs: 86_400_000, resetLabel: '00:00 UK time', timeZone: 'Europe/London' };

  async function until(check: () => boolean): Promise<void> {
    for (let attempt = 0; attempt < 50 && !check(); attempt += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    }
  }

  it('draws the public bar once its own chunk has arrived', async () => {
    const { LazyPublicDemoBar } = await vi.importActual<typeof import('../app/demo/bars.js')>('../app/demo/bars.js');
    const page = render(<LazyPublicDemoBar variant="public" clock={clock} links={{ home: 'https://itsm.example/' }} />).container;
    await until(() => page.querySelector('.itsm-SystemBar') !== null);
    const bar = page.querySelector('.itsm-SystemBar[aria-label="Demo environment"]')!;
    expect(bar).not.toBeNull();
    expect(bar.textContent).toContain('Demo data resets every day at 00:00 UK time.');
    expect(bar.textContent).not.toContain('End demo');
    expect(await violations(page)).toEqual([]);
  });

  it('draws the session bar, which forgets the visit’s keys when the demo is rebuilt', async () => {
    // The bar's status watch starts when the browser is idle; it is not what this test is about.
    vi.stubGlobal('requestIdleCallback', () => 0);
    vi.stubGlobal('cancelIdleCallback', () => undefined);
    localStorage.setItem('itsm-recents:admin:u-1', '[]');
    localStorage.setItem('itsm-keep-me', '1');
    const { LazySessionDemoBar } = await vi.importActual<typeof import('../app/demo/bars.js')>('../app/demo/bars.js');
    const page = render(
      <LazySessionDemoBar variant="session" clock={clock} persona={{ name: 'Jordan Lee', title: 'IT Service Manager' }} generation={3} />,
    ).container;
    await until(() => page.querySelector('.itsm-SystemBar') !== null);
    expect(page.querySelector('.itsm-SystemBar')?.textContent).toContain('Jordan Lee');
    expect(page.querySelector('button[form="itsm-signout"]')?.textContent).toContain('End demo');

    let work: Promise<unknown> | null = null;
    window.dispatchEvent(new CustomEvent('itsm:demo-generation-change', { detail: { generation: 4, waitUntil: (promise: Promise<unknown>) => (work = promise) } }));
    expect(work).not.toBeNull();
    await act(async () => {
      await work;
    });
    expect(localStorage.getItem('itsm-recents:admin:u-1')).toBeNull();
    expect(localStorage.getItem('itsm-keep-me')).toBe('1');
    expect(localStorage.getItem('itsm-demo:last-gen')).toBe('4');
    expect(await violations(page)).toEqual([]);
    localStorage.clear();
  });
});

describe('what a refused /me means for a demo visit', () => {
  const problem = (code: string, extra: Record<string, unknown> = {}) => ({
    type: `https://itsm.example/problems/${code}`,
    title: code,
    status: 401,
    correlationId: 'c-1',
    ...extra,
  });
  const demo = { kind: 'demo' as const, createdAt: 1_000_000 };
  const later = demo.createdAt + DEMO_LOOP_BREAKER_MS;

  it('reloads when the person’s own session came back', () => {
    expect(demoRefusal(new ApiError(401, problem('demo_session_ended', { restored: true }), 'x'), demo, later)).toBe('reload');
  });

  it('reopens a visit the BFF ended, unless it was opened moments ago', () => {
    expect(demoRefusal(new ApiError(401, problem('demo_session_ended'), 'x'), demo, later)).toBe('reopen');
    expect(demoRefusal(new ApiError(401, problem('demo_session_ended'), 'x'), demo, later - 1)).toBe('ended');
  });

  it('shows the ended screen for any other refusal of a visit, so nothing loops', () => {
    expect(demoRefusal(new ApiError(401, problem('demo_reset'), 'x'), demo, later)).toBe('ended');
    expect(demoRefusal(new ApiError(401, null, 'x'), demo, later)).toBe('ended');
  });

  it('sends an unavailable demo to /demo with its reason', () => {
    expect(demoRefusal(new ApiError(503, { ...problem('demo_unavailable'), status: 503 }, 'x'), demo, later)).toBe('unavailable');
    expect(demoEntryFor('/rules', { reason: 'unavailable' })).toBe('/demo?persona=admin&demo=1&redirectTo=%2Frules&reason=unavailable');
    expect(demoEntryFor('/rules', { resumed: true })).toBe('/demo?persona=admin&demo=1&redirectTo=%2Frules&resumed=1');
  });

  it('leaves a real session’s refusals to the console’s own screens', () => {
    expect(demoRefusal(new ApiError(401, problem('demo_session_ended'), 'x'), { kind: 'oidc', createdAt: 0 }, later)).toBeNull();
    expect(demoRefusal(new ApiError(500, null, 'x'), demo, later)).toBeNull();
    expect(demoRefusal(new Error('network'), demo, later)).toBeNull();
  });
});
