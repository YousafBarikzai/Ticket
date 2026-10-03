// @vitest-environment jsdom
import { createRequire } from 'node:module';
import { act, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decideDemoEntry, decideSignIn, type DemoEntryDecision, type DemoEntryInput, type SignInInput } from '@itsm/bff';
import { ApiError, type ProblemDetails } from '@itsm/sdk';
import { AREAS, SITE } from '@itsm/contracts/areas';
import { DEMO_COPY, signInAgainHref } from '@itsm/contracts/demo';
import { demoBarClock } from '../app/demo/clock.js';
import { DemoEntryScreen } from '../app/demo/DemoEntry.js';
import { OpenDemoButton, TAKING_A_WHILE_MS } from '../app/demo/OpenDemoButton.js';
import RootError from '../app/error.js';
import GlobalError from '../app/global-error.js';
import { SignInScreen } from '../app/sign-in/SignInScreen.js';
import { SignedOutScreen, type SignedOutScreenProps } from '../app/signed-out/SignedOutScreen.js';
import { DESK_DEMO_COPY, KNOWLEDGE_LABEL, signInHrefFor } from '../components/DeskShell.js';
import { DEMO_REENTRY_GRACE_MS, currentMe, demoReentryHref, loginHref } from '../server/session.js';
import { cleanupDocument, render } from './support/render.js';

/**
 * The Service Desk's demo entry, sign-in and signed-out pages (v3 §4.5,
 * §4.6; A3 §6.2, §6.6, §6.7): every decision the BFF can make, worded as the
 * copy register words it, with the one form and only the auto-submit the
 * decision allows; and the frame's demo words, held to the contracts they
 * spell out.
 *
 * The decisions are the BFF's own pure functions, fed the way the pages
 * feed them; the demo bar is replaced by a marker here (it is the design
 * system's, tested there) and its lazy slot is checked on its own.
 */

/*
 * The server's session helpers, with the request, the BFF and the SDK in the
 * test's hands: `redirect()` throws what it was given, as Next's does.
 */
const server = vi.hoisted(() => {
  class Redirected extends Error {
    constructor(readonly location: string) {
      super(`redirect ${location}`);
    }
  }
  return { Redirected, session: null as null | Record<string, unknown>, me: (): Promise<unknown> => Promise.resolve({}) };
});

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => ({ value: 'session-id' }) }),
  headers: async () => new Headers({ 'x-itsm-path': '/tickets/INC-000004' }),
}));
vi.mock('next/navigation', () => ({
  redirect: (location: string) => {
    throw new server.Redirected(location);
  },
  notFound: () => {
    throw new Error('notFound');
  },
}));
vi.mock('../bff.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../bff.js')>();
  return {
    ...actual,
    bff: {
      config: { defaultLanding: '/overview' },
      sessionFor: async () => server.session,
      clientFor: () => ({}),
      latestSession: (session: unknown) => session,
    },
  };
});
vi.mock('@itsm/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@itsm/sdk')>();
  return { ...actual, workbench: () => ({ me: () => server.me() }) };
});

vi.mock('../app/demo/DemoBarSlot.js', () => ({
  DemoBarSlot: (props: { variant: string; state?: string; links?: { home?: string } }) => (
    <div className="test-DemoBar" data-variant={props.variant} data-state={props.state ?? ''} data-home={props.links?.home ?? ''} />
  ),
}));

const SITE_ORIGIN = 'https://itsm.example';
const ORIGINS = { portal: 'https://help.example', workbench: 'https://desk.example', admin: 'https://admin.example', site: SITE_ORIGIN };
const clock = demoBarClock(Date.parse('2026-10-02T14:58:22Z'));
const sameOrigin = { get: (name: string) => (name === 'sec-fetch-site' ? 'same-origin' : null) };
const fromPortal = { get: (name: string) => (name === 'referer' ? 'https://help.example/tickets/REQ-000001' : null) };
const typed = { get: () => null };

function entry(overrides: Partial<DemoEntryInput> = {}): DemoEntryDecision {
  return decideDemoEntry({
    app: 'workbench',
    mode: true,
    paused: false,
    liveGeneration: 7,
    session: null,
    query: {},
    headers: typed,
    origins: ORIGINS,
    ownOrigin: ORIGINS.workbench,
    defaultLanding: '/overview',
    ...overrides,
  });
}

type Rendered = Exclude<DemoEntryDecision, { kind: 'not-found' } | { kind: 'redirect' }>;

function shown(decision: DemoEntryDecision, site: string | null = SITE_ORIGIN): HTMLElement {
  if (decision.kind === 'not-found' || decision.kind === 'redirect') throw new Error(`${decision.row} renders nothing`);
  return render(<DemoEntryScreen decision={decision as Rendered} site={site} clock={clock} />).container;
}

function text(element: Element | null | undefined): string {
  return (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function form(container: HTMLElement): HTMLFormElement | null {
  return container.querySelector<HTMLFormElement>('form#itsm-demo-entry');
}

function fields(container: HTMLElement): Record<string, string> {
  return Object.fromEntries([...form(container)!.querySelectorAll<HTMLInputElement>('input[type="hidden"]')].map((input) => [input.name, input.value]));
}

/** Whether the page submits the entry form by itself: `AutoSubmitForm` calls `requestSubmit` once it has mounted. */
function submitsItself(container: HTMLElement): boolean {
  return form(container)?.dataset.submitted === '1';
}

beforeEach(() => {
  // The form never really posts: record the auto-submit instead.
  HTMLFormElement.prototype.requestSubmit = function requestSubmit(this: HTMLFormElement) {
    this.dataset.submitted = '1';
  };
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
});

afterEach(() => {
  cleanupDocument();
  document.head.querySelectorAll('meta').forEach((meta) => meta.remove());
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------- /demo */

describe('/demo (§4.6.2)', () => {
  it('P7: "Opening the Service Desk…" from this app or the product’s own pages, and submits itself', () => {
    const container = shown(entry({ headers: sameOrigin, query: { redirectTo: '/tickets/INC-000004' } }));
    expect(text(container.querySelector('h1'))).toBe('Opening the Service Desk…');
    expect(container.querySelector('h1 [role="status"]')).not.toBeNull();
    expect(text(container.querySelector('.app-Entry__body'))).toBe(
      `You’re exploring as Alex Morgan, Service Desk team lead at Northwind Traders (UK), a fictional company. ${DEMO_COPY.resetsDaily}`,
    );
    expect(form(container)).toMatchObject({ method: 'post' });
    expect(form(container)!.getAttribute('action')).toBe('/api/session/demo');
    expect(fields(container)).toEqual({ persona: 'agent', redirectTo: '/tickets/INC-000004' });
    expect(submitsItself(container)).toBe(true);
    expect(container.querySelector('.test-DemoBar')).toMatchObject({ dataset: { variant: 'public', state: 'ready' } });
    // The lockup goes to the site (D18).
    expect(container.querySelector('a.itsm-SignInLayout__lockup')?.getAttribute('href')).toBe(SITE_ORIGIN);
  });

  it('P7 resumed: "Welcome back — reopening the demo…"', () => {
    const container = shown(entry({ headers: sameOrigin, query: { resumed: '1' } }));
    expect(text(container.querySelector('h1'))).toBe('Welcome back — reopening the demo…');
    expect(submitsItself(container)).toBe(true);
  });

  it('P7h: an area switch is the hop card, in the bar’s look, and submits itself', () => {
    const decision = entry({ headers: fromPortal, query: { redirectTo: '/resume' } });
    expect(decision.row).toBe('P7h');
    const container = shown(decision);
    expect(container.querySelector('.itsm-SignInLayout')).toBeNull();
    expect(container.querySelector('.itsm-StatusScreen[data-variant="hop"], .itsm-StatusScreen')).not.toBeNull();
    expect(text(container.querySelector('h1'))).toBe('Opening the Service Desk as Alex Morgan…');
    expect(container.querySelector('h1 [role="status"]')).not.toBeNull();
    expect(text(container.querySelector('.itsm-StatusScreen__persona'))).toBe('You’re Alex Morgan · Service Desk team lead');
    expect(text(container.querySelector('.itsm-StatusScreen__session'))).toContain('Demo');
    expect(fields(container)).toEqual({ persona: 'agent', redirectTo: '/resume' });
    expect(submitsItself(container)).toBe(true);
  });

  it('P8: a typed URL or another site gets "Explore the Service Desk" and a button, never an auto-submit', () => {
    const container = shown(entry());
    expect(text(container.querySelector('h1'))).toBe('Explore the Service Desk');
    expect(text(container.querySelector('.app-Entry__body'))).toBe(
      'You’ll be signed in to a shared demo as Alex Morgan, Service Desk team lead. Northwind Traders (UK) and its people are fictional. Changes are shared with other visitors until the nightly reset — please don’t enter real personal data.',
    );
    expect(text(form(container)!.querySelector('button[type="submit"]'))).toBe('Open the demo');
    expect(submitsItself(container)).toBe(false);
    expect([...container.querySelectorAll('a')].find((link) => text(link) === SITE.homeLabel)?.getAttribute('href')).toBe(SITE_ORIGIN);
  });

  it('P5: a person signed in to their own account is asked, never switched', () => {
    const container = shown(entry({ session: { kind: 'oidc', displayName: 'Jane Smith' }, headers: sameOrigin, query: { redirectTo: '/inbox/mine' } }));
    expect(text(container.querySelector('h1'))).toBe('You’re signed in as Jane Smith');
    expect(text(container.querySelector('.app-Entry__body'))).toContain('You’ll explore as Alex Morgan in a shared demo.');
    expect(fields(container)).toEqual({ persona: 'agent', redirectTo: '/inbox/mine', confirm: 'replace' });
    expect(submitsItself(container)).toBe(false);
    const stay = [...container.querySelectorAll('a')].find((link) => text(link) === 'Stay in my account');
    expect(stay?.getAttribute('href')).toBe('/inbox/mine');
  });

  it('P3: being prepared — no form, the estimate in words, and the page looks again by itself', () => {
    const container = shown(entry({ liveGeneration: null, buildEtaSec: 170 }));
    expect(text(container.querySelector('h1'))).toBe('The demo is being prepared…');
    expect(text(container.querySelector('.app-Entry__body'))).toBe(
      'It’s being built with fresh data and is usually ready in about 3 minutes. This page checks again by itself.',
    );
    expect(form(container)).toBeNull();
    expect(document.querySelector('meta[http-equiv="refresh"]')?.getAttribute('content')).toBe('15');
    expect(container.querySelector('.test-DemoBar')).toMatchObject({ dataset: { state: 'preparing' } });
  });

  it('P2: paused — no form, the bar says so', () => {
    const container = shown(entry({ paused: true }));
    expect(text(container.querySelector('h1'))).toBe('The demo is paused');
    expect(text(container.querySelector('.app-Entry__body'))).toBe('It’s back shortly. Please try again in a few minutes.');
    expect(form(container)).toBeNull();
    expect(container.querySelector('.test-DemoBar')).toMatchObject({ dataset: { state: 'paused' } });
  });

  it.each([
    ['busy', 'The demo is busy', 'Please try again in a moment.', 'Try again'],
    ['capacity', 'The demo is very busy right now', 'Lots of people are exploring at once. Please try again in a few minutes.', 'Try again'],
    ['invalid', 'That link didn’t work', 'Open the demo from the start.', 'Open the demo'],
    ['unavailable', DEMO_COPY.sessionEnded, 'Pick up where you left off — the demo data may have been reset since.', DEMO_COPY.continueDemo],
  ])('P6 reason=%s: "%s", a button and never an auto-submit, even same-origin', (reason, title, body, action) => {
    const container = shown(entry({ headers: sameOrigin, query: { reason, redirectTo: '/overview' } }));
    expect(text(container.querySelector('h1'))).toBe(title);
    expect(text(container.querySelector('.app-Entry__body'))).toBe(body);
    expect(text(form(container)!.querySelector('button[type="submit"]'))).toBe(action);
    expect(submitsItself(container)).toBe(false);
  });

  it('leaves the site out where it is not configured', () => {
    const container = shown(entry(), null);
    expect(container.querySelector('a.itsm-SignInLayout__lockup')).toBeNull();
    expect([...container.querySelectorAll('a')].some((link) => text(link) === SITE.homeLabel)).toBe(false);
  });

  it('has one h1 and one main on every page it can show', () => {
    const decisions = [
      entry({ headers: sameOrigin }),
      entry(),
      entry({ headers: fromPortal, query: { redirectTo: '/resume' } }),
      entry({ session: { kind: 'dev', displayName: 'Dev' } }),
      entry({ liveGeneration: null }),
      entry({ paused: true }),
      entry({ query: { reason: 'busy' } }),
    ];
    for (const decision of decisions) {
      const container = shown(decision);
      expect(container.querySelectorAll('h1'), decision.row).toHaveLength(1);
      expect(container.querySelectorAll('main'), decision.row).toHaveLength(1);
      cleanupDocument();
    }
  });

  it('says "Taking a while? Open the demo" after three seconds', () => {
    vi.useFakeTimers();
    const { container } = render(<OpenDemoButton />);
    expect(text(container.querySelector('button'))).toBe('Open the demo');
    act(() => {
      vi.advanceTimersByTime(TAKING_A_WHILE_MS);
    });
    expect(text(container.querySelector('button'))).toBe('Taking a while? Open the demo');
    expect(container.querySelector('button')!.getAttribute('type')).toBe('submit');
  });

  it('is axe clean in each look', async () => {
    for (const decision of [entry({ headers: sameOrigin }), entry(), entry({ headers: fromPortal, query: { redirectTo: '/resume' } }), entry({ session: { kind: 'oidc', displayName: 'Jane' } }), entry({ query: { reason: 'ended' } })]) {
      const container = shown(decision);
      expect(await audit(container), decision.row).toEqual([]);
      cleanupDocument();
    }
  });
});

/* ---------------------------------------------------------------- /sign-in */

function signIn(overrides: Partial<SignInInput> = {}) {
  return decideSignIn({
    app: 'workbench',
    mode: true,
    development: false,
    reentry: null,
    redirectTo: '/tickets/INC-000004',
    defaultLanding: '/overview',
    ownOrigin: ORIGINS.workbench,
    siteOrigin: SITE_ORIGIN,
    ...overrides,
  });
}

describe('/sign-in (§4.5 I rows, A3 §6.6)', () => {
  it('I1: the development form, and the way back into today’s demo', () => {
    const { container } = render(<SignInScreen decision={signIn({ development: true, reentry: 'agent' })} reason="No such account" demo site={SITE_ORIGIN} clock={clock} />);
    expect(text(container.querySelector('h1'))).toBe('Sign in to the Service Desk');
    const devForm = container.querySelector<HTMLFormElement>('form[action="/api/session/dev"]')!;
    expect(devForm.method).toBe('post');
    expect(devForm.querySelector<HTMLInputElement>('input[name="redirectTo"]')!.value).toBe('/tickets/INC-000004');
    expect(text(container)).toContain('No such account');
    const back = [...container.querySelectorAll('a')].find((link) => text(link) === 'Continue the demo as Alex Morgan');
    expect(back?.getAttribute('href')).toBe('/demo?persona=agent&demo=1&redirectTo=%2Ftickets%2FINC-000004');
    expect(container.querySelector('.test-DemoBar')).toMatchObject({ dataset: { variant: 'public' } });
  });

  it('I2: the chooser — continue the demo, or a work account, which always wins', () => {
    const { container } = render(<SignInScreen decision={signIn({ reentry: 'agent' })} demo site={SITE_ORIGIN} clock={clock} />);
    expect(text(container.querySelector('h1'))).toBe('Welcome back');
    expect(text(container.querySelector('.app-Entry__body'))).toBe('This browser was exploring the demo as Alex Morgan, Service Desk team lead.');
    const links = Object.fromEntries([...container.querySelectorAll('a')].map((link) => [text(link), link.getAttribute('href')]));
    expect(links['Continue the demo as Alex Morgan']).toBe('/demo?persona=agent&demo=1&redirectTo=%2Ftickets%2FINC-000004');
    expect(links['Sign in with your work account']).toBe('/api/session/login?account=1&redirectTo=%2Ftickets%2FINC-000004');
    expect(links[SITE.homeLabel]).toBe(SITE_ORIGIN);
    // A real sign-in comes first in reading order only after the demo the browser was in; there is no other form.
    expect(container.querySelectorAll('form')).toHaveLength(0);
  });

  it('I3: "Sign in to the Service Desk", and with the demo on "New here? Explore the demo"', () => {
    const { container } = render(<SignInScreen decision={signIn()} demo site={SITE_ORIGIN} clock={clock} />);
    expect(text(container.querySelector('h1'))).toBe('Sign in to the Service Desk');
    const links = Object.fromEntries([...container.querySelectorAll('a')].map((link) => [text(link), link.getAttribute('href')]));
    expect(links['Sign in with your work account']).toBe('/api/session/login?account=1&redirectTo=%2Ftickets%2FINC-000004');
    expect(links['New here? Explore the demo']).toBe('https://desk.example/demo?persona=agent&demo=1');
  });

  it('I3 with the demo off: no demo, no bar, no site', () => {
    const { container } = render(<SignInScreen decision={signIn({ mode: false, siteOrigin: null })} demo={false} site={null} clock={clock} />);
    expect(text(container)).not.toContain('Explore the demo');
    expect(container.querySelector('.test-DemoBar')).toBeNull();
    expect(container.querySelector('a.itsm-SignInLayout__lockup')).toBeNull();
  });

  it('shows the development reason on the development form only', () => {
    const { container } = render(<SignInScreen decision={signIn()} reason="Injected words" demo site={SITE_ORIGIN} clock={clock} />);
    expect(text(container)).not.toContain('Injected words');
  });

  it('is axe clean in each row', async () => {
    for (const decision of [signIn({ development: true, reentry: 'agent' }), signIn({ reentry: 'agent' }), signIn()]) {
      const { container } = render(<SignInScreen decision={decision} demo site={SITE_ORIGIN} clock={clock} />);
      expect(await audit(container), decision.row).toEqual([]);
      cleanupDocument();
    }
  });
});

/* ------------------------------------------------------------- /signed-out */

function signedOut(overrides: Partial<SignedOutScreenProps> = {}): HTMLElement {
  const props: SignedOutScreenProps = {
    demo: false,
    restored: false,
    reason: null,
    mode: true,
    origins: ORIGINS,
    ownOrigin: ORIGINS.workbench,
    clock,
    ...overrides,
  };
  return render(<SignedOutScreen {...props} />).container;
}

describe('/signed-out (§4.6.3, A3 §6.7)', () => {
  it('none: "You’re signed out", Sign in again, and the site with the demo on', () => {
    const container = signedOut();
    expect(text(container.querySelector('h1'))).toBe('You’re signed out');
    expect(text(container.querySelector('.app-Entry__body'))).toBe('Your session on this device has ended.');
    const links = Object.fromEntries([...container.querySelectorAll('a')].map((link) => [text(link), link.getAttribute('href')]));
    expect(links['Sign in again']).toBe('/api/session/login');
    expect(links[SITE.homeLabel]).toBe(SITE_ORIGIN);
    expect(container.querySelector('.test-DemoBar')).not.toBeNull();
  });

  it('none, demo off: only Sign in again', () => {
    const container = signedOut({ mode: false });
    expect([...container.querySelectorAll('a')].filter((link) => !link.classList.contains('itsm-SignInLayout__back')).map(text)).toEqual(['Sign in again']);
    expect(container.querySelector('.test-DemoBar')).toBeNull();
  });

  it('demo=1: thanks, the fictional company, the site and an "Explore as" link per persona', () => {
    const container = signedOut({ demo: true });
    expect(text(container.querySelector('h1'))).toBe('Thanks for exploring');
    expect(text(container.querySelector('.app-Entry__body'))).toBe(
      'Your demo session has ended. Northwind Traders (UK) and its people are fictional, and the demo resets every night at 00:00 UK time.',
    );
    const links = [...container.querySelectorAll<HTMLAnchorElement>('a:not(.itsm-SignInLayout__lockup)')].map((link) => [text(link), link.getAttribute('href'), link.rel]);
    expect(links).toEqual([
      [SITE.homeLabel, 'https://itsm.example/?ended=1', ''],
      ['Explore as Employee · Emma Clarke, Finance Manager', 'https://help.example/demo?persona=employee&demo=1', 'nofollow'],
      ['Explore as Agent · Alex Morgan, Service Desk team lead', 'https://desk.example/demo?persona=agent&demo=1', 'nofollow'],
      ['Explore as Admin · Jordan Lee, IT Service Manager', 'https://admin.example/demo?persona=admin&demo=1', 'nofollow'],
    ]);
  });

  it('demo=1 leaves out an area whose origin is not configured', () => {
    const container = signedOut({ demo: true, origins: { workbench: ORIGINS.workbench, site: SITE_ORIGIN } });
    expect([...container.querySelectorAll('.app-Entry__links a')].map(text)).toEqual(['Explore as Agent · Alex Morgan, Service Desk team lead']);
  });

  it('demo=1&restored=1: back in your own account, by the session’s name, never the link’s', () => {
    const container = signedOut({ demo: true, restored: true, signedInAs: 'Jane Smith' });
    expect(text(container.querySelector('h1'))).toBe('Thanks for exploring');
    expect(text(container.querySelector('.app-Entry__body'))).toBe('You’re back in your own account, signed in as Jane Smith.');
    expect([...container.querySelectorAll('a')].find((link) => text(link) === 'Continue to the Service Desk')?.getAttribute('href')).toBe('/');
  });

  it.each([
    ['stale', 'That sign-in had already been used, or it expired.', '/api/session/login'],
    ['provider', 'The identity provider didn’t finish the sign-in.', '/api/session/login'],
    ['parked_expired', 'Your account’s sign-in expired while you explored; sign in again.', '/api/session/login?account=1'],
    ['<script>alert(1)</script>', 'Something went wrong while signing you in.', '/api/session/login'],
  ])('reason=%s: the sentence for the code, never the code itself', (reason, sentence, href) => {
    const container = signedOut({ reason, demo: reason === 'parked_expired' });
    expect(text(container.querySelector('h1'))).toBe('That sign-in didn’t finish');
    expect(text(container)).toContain(sentence);
    expect(text(container)).not.toContain('<script>');
    expect([...container.querySelectorAll('a')].find((link) => text(link) === 'Sign in again')?.getAttribute('href')).toBe(href);
  });

  it('is axe clean in each variant', async () => {
    for (const props of [{}, { demo: true }, { demo: true, restored: true, signedInAs: 'Jane' }, { reason: 'stale' }]) {
      const container = signedOut(props);
      expect(await audit(container)).toEqual([]);
      cleanupDocument();
    }
  });
});

/* ------------------------------------------------------------- The demo bar */

describe('the demo bar’s slot (v3 §3.8, §10.2)', () => {
  it('loads the bar on its own and draws it with the props it was given', async () => {
    const { DemoBarSlot } = await vi.importActual<typeof import('../app/demo/DemoBarSlot.js')>('../app/demo/DemoBarSlot.js');
    let rendered!: { container: HTMLElement };
    await act(async () => {
      rendered = render(<DemoBarSlot variant="session" clock={clock} persona={{ name: 'Alex Morgan', title: 'Service Desk team lead' }} generation={7} />);
    });
    for (let attempt = 0; attempt < 50 && !rendered.container.querySelector('.itsm-DemoBar'); attempt += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
    }
    const bar = rendered.container.querySelector('.itsm-DemoBar');
    expect(bar).not.toBeNull();
    expect(bar!.getAttribute('aria-label')).toBe('Demo environment');
    expect(text(bar)).toContain('Alex Morgan');
  });

  it('computes the clock from the pure UK reset clock, on the server', () => {
    const now = Date.parse('2026-10-25T09:00:00Z');
    const value = demoBarClock(now);
    expect(value).toMatchObject({ serverNow: now, resetLabel: '00:00 UK time', timeZone: 'Europe/London' });
    // 25 October 2026 is the day the clocks go back: a 25-hour demo day.
    expect(value.periodMs).toBe(25 * 60 * 60 * 1000);
    expect(value.nextResetAt).toBe(Date.parse('2026-10-26T00:00:00Z'));
  });
});

/* ------------------------------------------------- Server-side redirects */

function refused(status: number, code: string, extra: Record<string, unknown> = {}): ApiError {
  const problem = { type: `https://itsm.example/problems/${code}`, title: code, status, ...extra } as unknown as ProblemDetails;
  return new ApiError(status, problem, code);
}

async function redirectOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    if (error instanceof server.Redirected) return error.location;
    throw error;
  }
  throw new Error('no redirect');
}

describe('a demo visit the API stopped honouring (§4.6.4, A3 §6.8)', () => {
  const demoSession = (age: number) => ({ id: 'session-id', kind: 'demo', persona: 'agent', createdAt: Date.now() - age, accessToken: 'itsmdemo_x' });

  it('re-enters the demo at the same page, through /demo, which submits itself', async () => {
    server.session = demoSession(10 * 60_000);
    server.me = () => Promise.reject(refused(401, 'demo_session_ended'));
    expect(await redirectOf(() => currentMe())).toBe('/demo?persona=agent&demo=1&redirectTo=%2Ftickets%2FINC-000004&resumed=1');
  });

  it('breaks the loop for a session minted moments ago: the reason page, with a button', async () => {
    server.session = demoSession(5_000);
    server.me = () => Promise.reject(refused(401, 'demo_session_ended'));
    expect(await redirectOf(() => currentMe())).toBe('/demo?persona=agent&demo=1&redirectTo=%2Ftickets%2FINC-000004&reason=unavailable');
    expect(demoReentryHref('/overview', { createdAt: 0 }, DEMO_REENTRY_GRACE_MS - 1)).toContain('&reason=unavailable');
    expect(demoReentryHref('/overview', { createdAt: 0 }, DEMO_REENTRY_GRACE_MS)).toContain('&resumed=1');
  });

  it('reloads the page as the person, when ending the visit handed their own session back', async () => {
    server.session = demoSession(10 * 60_000);
    server.me = () => Promise.reject(refused(401, 'demo_session_ended', { restored: true }));
    expect(await redirectOf(() => currentMe())).toBe('/tickets/INC-000004');
  });

  it('shows /demo’s reason page while the demo is paused or being prepared', async () => {
    server.session = demoSession(10 * 60_000);
    server.me = () => Promise.reject(refused(503, 'demo_unavailable', { reason: 'paused' }));
    expect(await redirectOf(() => currentMe())).toBe('/demo?persona=agent&demo=1&redirectTo=%2Ftickets%2FINC-000004&reason=unavailable');
  });

  it('sends a real session to sign in again, and marks a demo’s "sign in again" as the demo’s', async () => {
    server.session = { id: 'session-id', kind: 'oidc', createdAt: 0, accessToken: 'jwt' };
    server.me = () => Promise.reject(refused(401, 'unauthorised'));
    expect(await redirectOf(() => currentMe())).toBe('/api/session/login?redirectTo=%2Ftickets%2FINC-000004');
    expect(await loginHref()).toBe('/api/session/login?redirectTo=%2Ftickets%2FINC-000004');
    server.session = demoSession(10 * 60_000);
    expect(await loginHref()).toBe('/api/session/login?redirectTo=%2Ftickets%2FINC-000004&demo=1');
  });

  it('passes any other failure to the caller', async () => {
    server.session = demoSession(10 * 60_000);
    server.me = () => Promise.reject(refused(500, 'internal'));
    await expect(currentMe()).rejects.toBeInstanceOf(ApiError);
  });
});

/* ---------------------------------------------------- The frame's own words */

describe('words spelt out for the first load, held to their contracts', () => {
  it('the frame’s demo words are the contracts’', () => {
    expect(DESK_DEMO_COPY.sessionEnded).toBe(DEMO_COPY.sessionEnded);
    expect(DESK_DEMO_COPY.continueDemo).toBe(DEMO_COPY.continueDemo);
    expect(KNOWLEDGE_LABEL).toBe(`Knowledge base · ${AREAS.portal.name}`);
  });

  it('the frame’s sign-in link is signInAgainHref’s, in a demo and out of one', () => {
    for (const path of ['/inbox/mine?q=vpn tunnel', '/tickets/INC-000004', '/']) {
      expect(signInHrefFor(path, true)).toBe(signInAgainHref(path, { demo: true }));
      expect(signInHrefFor(path, false)).toBe(signInAgainHref(path));
    }
  });

  it('the error pages name the area (D1)', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { container } = render(<RootError error={Object.assign(new Error('x'), { digest: 'abc' })} retry={() => undefined} />);
    expect(text(container.querySelector('h1'))).toBe(`The ${AREAS.workbench.name} couldn’t open`);
    const html = renderToStaticMarkup((<GlobalError error={new Error('x')} retry={() => undefined} />) as ReactElement);
    expect(html).toContain(`<title>Something went wrong · ${AREAS.workbench.name}</title>`);
    expect(html).not.toContain('Workbench');
  });
});

/* -------------------------------------------------------------------- axe */

/*
 * axe-core is the design system's devDependency; this app has none of its own
 * (a dependency line is an integrator's, SPEC §15.0 rule 9). It is resolved
 * through `@itsm/ui`, as the other audits here do.
 */
interface AxeRule {
  readonly id: string;
  readonly nodes: readonly { readonly html: string }[];
}
interface Axe {
  run(context: Element, options: Record<string, unknown>): Promise<{ violations: AxeRule[] }>;
}
const axe = createRequire(createRequire(import.meta.url).resolve('@itsm/ui'))('axe-core') as Axe;
/** Rules a detached fragment cannot answer, and rules that need a layout engine jsdom lacks. */
const OFF = ['region', 'html-has-lang', 'bypass', 'document-title', 'html-lang-valid', 'color-contrast', 'color-contrast-enhanced', 'target-size'];
async function audit(container: Element): Promise<string[]> {
  const results = await axe.run(container, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] },
    rules: Object.fromEntries(OFF.map((rule) => [rule, { enabled: false }])),
  });
  return results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.html).join(' | ')}`);
}
