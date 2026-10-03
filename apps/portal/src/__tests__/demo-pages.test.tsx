// @vitest-environment jsdom
import { createRequire } from 'node:module';
import { act, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DemoEntryDecision, SignInDecision } from '@itsm/bff';
import { DEMO_COPY, DEMO_PERSONAS } from '@itsm/contracts/demo';
import { DemoBar } from '@itsm/ui/shell';
import { cleanupDocument, render } from './support/render.js';

/**
 * The Help Portal's demo entry and sign-in surfaces (SPEC v3 §4.5–§4.6, A3
 * §6.1–§6.7): `/demo` for every decision the BFF can make, the hop on the
 * session bar's card; `/sign-in` I1–I3; `/signed-out` for each way a visit or
 * a sign-in ends — each one axe-clean; and the pieces around them: the route
 * handlers, `robots.txt`, the `/demo` headers, the server-drawn public strip
 * and the session bar's local-data clearing.
 */

/* ---- The server, as the pages see it ------------------------------------ */

vi.mock('server-only', () => ({}));

let demoOn = true;
let entry: DemoEntryDecision = { row: 'P1', kind: 'not-found' };
let signIn: SignInDecision = { row: 'I3', kind: 'sign-in', workAccountHref: '/api/session/login?account=1&redirectTo=%2F', exploreHref: null, homeHref: null, redirectTo: '/' };
const bff = {
  config: {
    get demo() {
      return demoOn ? { tokenTtlSeconds: 900 } : null;
    },
    defaultLanding: '/',
    appOrigin: 'https://portal.example',
  },
  demoEntry: vi.fn(async () => entry),
  signInPage: vi.fn(() => signIn),
  demoSignIn: vi.fn(async () => new Response(null, { status: 303 })),
  demoStatus: vi.fn(async () => Response.json({ state: 'ready' })),
  demoReset: vi.fn(async () => new Response(null, { status: 202 })),
  demoIpCheck: vi.fn(async () => Response.json({ bucket: 'abc' })),
};
vi.mock('../bff.js', () => ({ bff }));

let restoredName: string | null = null;
vi.mock('../server/session.js', () => ({ currentSession: async () => (restoredName ? { displayName: restoredName } : null) }));

const jar = new Map<string, string>();
const requestHeaders = new Headers();
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined) }),
  headers: async () => requestHeaders,
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
}));

const cleared = vi.fn(async (_options: { generation: number; alsoKeys: (key: string) => boolean }) => ({}));
vi.mock('@itsm/pwa/demo', () => ({ clearDemoLocalData: cleared }));
vi.mock('../components/PortalStatus.js', () => ({ isPersonalKey: (key: string) => key.startsWith('itsm-portal-') }));

const demoPage = await import('../app/demo/page.js');
const signInPage = await import('../app/sign-in/page.js');
const signedOutPage = await import('../app/signed-out/page.js');
const { DEMO_STRIP, PublicDemoStrip, resetsIn } = await import('../app/demo/entry.js');
const { DEMO_ENDED_BODY } = await import('../app/demo/server.js');

/* ---- axe, as the design system runs it ---------------------------------- */

interface AxeRule {
  readonly id: string;
  readonly nodes: readonly { readonly html: string }[];
}
interface Axe {
  run(context: Element, options: Record<string, unknown>): Promise<{ violations: AxeRule[] }>;
}
// axe-core is the design system's devDependency; this app has none of its own (rule 9), so it is resolved through `@itsm/ui`.
const axe = createRequire(createRequire(import.meta.url).resolve('@itsm/ui'))('axe-core') as Axe;
/** Rules a fragment cannot answer, and rules that need the layout engine jsdom lacks. */
const OFF = ['region', 'page-has-heading-one', 'html-has-lang', 'bypass', 'document-title', 'html-lang-valid', 'color-contrast', 'color-contrast-enhanced', 'target-size'];
const AXE = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] },
  rules: Object.fromEntries(OFF.map((rule) => [rule, { enabled: false }])),
};

async function violations(...off: string[]): Promise<string[]> {
  const results = await axe.run(document.body, { ...AXE, rules: { ...AXE.rules, ...Object.fromEntries(off.map((rule) => [rule, { enabled: false }])) } });
  return results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.html).join(' | ')}`);
}

/* ---- Rendering a server page -------------------------------------------- */

type Params = Record<string, string | string[] | undefined>;

/** Renders an async page to its HTML, as the server would, into the document. */
async function show(page: (props: { searchParams: Promise<Params> }) => Promise<ReactNode>, params: Params = {}): Promise<HTMLElement> {
  const tree = await page({ searchParams: Promise.resolve(params) });
  document.body.innerHTML = renderToStaticMarkup(tree as ReactElement);
  return document.body;
}

function text(): string {
  return document.body.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

function h1(): string {
  return document.querySelector('h1')?.textContent?.trim() ?? '';
}

function links(): { readonly text: string; readonly href: string | null }[] {
  return [...document.querySelectorAll('a')].map((link) => ({ text: link.textContent?.trim() ?? '', href: link.getAttribute('href') }));
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  demoOn = true;
  restoredName = null;
  jar.clear();
  for (const key of [...requestHeaders.keys()]) requestHeaders.delete(key);
  process.env.SITE_ORIGIN = 'https://itsm.example';
  process.env.WORKBENCH_ORIGIN = 'https://desk.example';
  process.env.ADMIN_ORIGIN = 'https://admin.example';
  bff.demoEntry.mockClear();
});

afterEach(() => {
  cleanupDocument();
  vi.unstubAllEnvs();
  process.env = { ...ORIGINAL_ENV };
});

/* ---- /demo --------------------------------------------------------------- */

const EMMA = DEMO_PERSONAS.find((persona) => persona.key === 'employee')!;
const FORM = { id: 'itsm-demo-entry', method: 'post', action: '/api/session/demo', fields: { persona: 'employee', redirectTo: '/tickets/INC-000004' } } as const;
const base = { area: 'portal', persona: EMMA, redirectTo: '/tickets/INC-000004' } as const;

function entryForm(): HTMLFormElement {
  const form = document.getElementById('itsm-demo-entry');
  if (!(form instanceof HTMLFormElement)) throw new Error(`no entry form in: ${text()}`);
  return form;
}

describe('/demo', () => {
  it('reads the decision from this request’s cookie, query and headers', async () => {
    jar.set('__Host-session', 'sid-1');
    requestHeaders.set('referer', 'https://itsm.example/');
    entry = { ...base, row: 'P8', kind: 'form', autoSubmit: false, resumed: false, form: FORM };
    await show(demoPage.default, { persona: 'employee', demo: '1' });
    expect(bff.demoEntry).toHaveBeenCalledWith({ cookie: 'sid-1', query: { persona: 'employee', demo: '1' }, headers: requestHeaders });
  });

  it('does not exist while the demo is off here (P1), and sends a live visit straight on (P4)', async () => {
    entry = { row: 'P1', kind: 'not-found' };
    await expect(show(demoPage.default)).rejects.toThrow('NEXT_NOT_FOUND');
    entry = { ...base, row: 'P4', kind: 'redirect', status: 307, location: '/tickets/INC-000004' };
    await expect(show(demoPage.default)).rejects.toThrow('NEXT_REDIRECT /tickets/INC-000004');
  });

  it('opens by itself from this product (P7): a status line, the form, the button that later says it is taking a while', async () => {
    entry = { ...base, row: 'P7', kind: 'form', autoSubmit: true, resumed: false, form: FORM };
    await show(demoPage.default);
    expect(h1()).toBe('Opening the Help Portal…');
    expect(document.querySelector('h1 [role="status"]')?.textContent).toBe('Opening the Help Portal…');
    expect(text()).toContain("You're exploring as Emma Clarke, Finance Manager at Northwind Traders (UK), a fictional company. Demo data resets every day at 00:00 UK time.");
    const form = entryForm();
    expect(form.getAttribute('method')).toBe('post');
    expect(form.getAttribute('action')).toBe('/api/session/demo');
    expect(Object.fromEntries(new FormData(form))).toEqual({ persona: 'employee', redirectTo: '/tickets/INC-000004' });
    const button = form.querySelector('button[type="submit"]')!;
    expect(button.querySelector('.app-Entry__now')?.textContent).toBe('Open the demo');
    expect(button.querySelector('.app-Entry__late')?.textContent).toBe('Taking a while? Open the demo');
    // The public strip, server-drawn: no client code of the bar on this page.
    expect(document.querySelector('.itsm-SystemBar[aria-label="Demo environment"]')).not.toBeNull();
    expect(await violations()).toEqual([]);
  });

  it('says welcome back on a return visit', async () => {
    entry = { ...base, row: 'P7', kind: 'form', autoSubmit: true, resumed: true, form: FORM };
    await show(demoPage.default);
    expect(h1()).toBe('Welcome back — reopening the demo…');
  });

  it('asks with a button when the request came from anywhere else (P8)', async () => {
    entry = { ...base, row: 'P8', kind: 'form', autoSubmit: false, resumed: false, form: FORM };
    await show(demoPage.default);
    expect(h1()).toBe('Explore the Help Portal');
    expect(text()).toContain("You'll be signed in to a shared demo as Emma Clarke, Finance Manager. Northwind Traders (UK) and its people are fictional.");
    expect(text()).toContain("please don't enter real personal data");
    expect(entryForm().querySelector('button')?.textContent).toBe('Open the demo');
    expect(document.querySelector('h1 [role="status"]')).toBeNull();
    expect(links()).toContainEqual({ text: 'IT Service Management home', href: 'https://itsm.example/' });
    expect(await violations()).toEqual([]);
  });

  it('asks a person signed in to their own account before putting it aside (P5)', async () => {
    entry = { ...base, row: 'P5', kind: 'confirm', signedInAs: 'Ada Lovelace', form: { ...FORM, fields: { ...FORM.fields, confirm: 'replace' } } };
    await show(demoPage.default);
    expect(h1()).toBe("You're signed in as Ada Lovelace");
    expect(text()).toContain('Open the demo instead? You\'ll explore as Emma Clarke in a shared demo. Your account stays signed in on this device and comes back when you end the demo.');
    expect(Object.fromEntries(new FormData(entryForm()))).toMatchObject({ confirm: 'replace' });
    expect(links()).toContainEqual({ text: 'Stay in my account', href: '/tickets/INC-000004' });
    expect(await violations()).toEqual([]);
  });

  it('says the demo is being prepared, checks again by itself, and shows no form (P3)', async () => {
    entry = { ...base, row: 'P3', kind: 'preparing', refreshSeconds: 15, etaSec: 170 };
    await show(demoPage.default);
    expect(h1()).toBe('The demo is being prepared…');
    expect(text()).toContain('usually ready in about 3 minutes');
    expect(document.querySelector('meta[http-equiv="refresh"]')?.getAttribute('content')).toBe('15');
    expect(document.getElementById('itsm-demo-entry')).toBeNull();
    expect(document.querySelector('.itsm-SystemBar')?.getAttribute('data-state')).toBe('busy');
    expect(text()).toContain('Preparing the demo…');
    // P3's own refresh (A3 §6.2) is the one thing axe objects to: it re-checks a page with nothing to lose.
    expect(await violations()).toEqual([expect.stringMatching(/^meta-refresh:/)]);
    expect(await violations('meta-refresh')).toEqual([]);
  });

  it('says the demo is paused (P2)', async () => {
    entry = { ...base, row: 'P2', kind: 'paused' };
    await show(demoPage.default);
    expect(h1()).toBe('The demo is paused');
    expect(text()).toContain("It's back shortly. Please try again in a few minutes.");
    expect(document.getElementById('itsm-demo-entry')).toBeNull();
    expect(await violations()).toEqual([]);
  });

  it.each([
    ['busy', 'The demo is busy', 'Please try again in a moment.', 'Try again'],
    ['capacity', 'The demo is very busy right now', 'Lots of people are exploring at once. Please try again in a few minutes.', 'Try again'],
    ['invalid', "That link didn't work", 'Open the demo from the start.', 'Open the demo'],
    ['ended', 'Your demo session ended', 'Pick up where you left off — the demo data may have been reset since.', 'Continue the demo'],
  ] as const)('words a reason (P6, %s) with a button, never by itself', async (reason, title, body, action) => {
    entry = { ...base, row: 'P6', kind: 'reason', reason, form: FORM };
    await show(demoPage.default);
    expect(h1()).toBe(title);
    expect(text()).toContain(body);
    expect(entryForm().querySelector('button')?.textContent).toBe(action);
    expect(document.querySelector('[role="status"]')).toBeNull();
    expect(await violations()).toEqual([]);
  });

  it('crosses from another area on the hop card, not the sign-in panel (P7h, X-M11)', async () => {
    entry = { ...base, row: 'P7h', kind: 'hop', autoSubmit: true, from: 'workbench', form: FORM };
    await show(demoPage.default);
    expect(document.querySelector('.itsm-StatusScreen')?.getAttribute('data-variant')).toBe('hop');
    expect(document.querySelector('.itsm-SignInLayout')).toBeNull();
    expect(document.querySelector('h1 [role="status"]')?.textContent).toBe('Opening the Help Portal as Emma Clarke…');
    expect(document.querySelector('.itsm-StatusScreen__session')?.textContent).toContain("You're Emma Clarke · Finance Manager");
    const button = entryForm().querySelector('button')!;
    expect(button.textContent).toBe('Taking a while? Open the demo');
    expect(button.classList.contains('app-Entry__late')).toBe(true);
    expect(document.querySelector('.itsm-SystemBar')).toBeNull();
    expect(await violations()).toEqual([]);
  });

  it('draws no home link, and an unlinked lockup, where the deployment has no site', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    delete process.env.SITE_ORIGIN;
    entry = { ...base, row: 'P2', kind: 'paused' };
    await show(demoPage.default);
    expect(links().map((link) => link.text)).not.toContain('IT Service Management home');
    expect(document.querySelector('.itsm-SignInLayout__lockup')?.tagName).toBe('DIV');
  });
});

/* ---- /sign-in ------------------------------------------------------------ */

describe('/sign-in', () => {
  it('I1: the development form, and the demo again when this browser was in it today', async () => {
    jar.set('__Host-itsm-demo', 'employee.2026-10-02');
    signIn = { row: 'I1', kind: 'development', continueDemo: { persona: EMMA, href: '/demo?persona=employee&demo=1&redirectTo=%2F' }, redirectTo: '/tickets' };
    await show(signInPage.default, { redirectTo: '/tickets', reason: 'No account with that address' });
    expect(bff.signInPage).toHaveBeenLastCalledWith({ demoCookie: 'employee.2026-10-02', redirectTo: '/tickets' });
    expect(h1()).toBe('Sign in to the Help Portal');
    const form = document.querySelector<HTMLFormElement>('form[action="/api/session/dev"]')!;
    expect(form.querySelector<HTMLInputElement>('input[name="redirectTo"]')?.value).toBe('/tickets');
    expect(text()).toContain('No account with that address');
    expect(links()).toContainEqual({ text: 'Continue the demo as Emma Clarke', href: '/demo?persona=employee&demo=1&redirectTo=%2F' });
    expect(await violations()).toEqual([]);
  });

  it('I2: welcome back — continue the demo, or a work account, as plain links', async () => {
    signIn = {
      row: 'I2',
      kind: 'chooser',
      persona: EMMA,
      continueHref: '/demo?persona=employee&demo=1&redirectTo=%2F',
      workAccountHref: '/api/session/login?account=1&redirectTo=%2F',
      homeHref: 'https://itsm.example',
      redirectTo: '/',
    };
    await show(signInPage.default);
    expect(h1()).toBe('Welcome back');
    expect(text()).toContain('This browser was exploring the demo as Emma Clarke, Finance Manager.');
    expect(links()).toEqual([
      ...links().filter((link) => link.href === 'https://itsm.example/'),
      { text: 'Continue the demo as Emma Clarke', href: '/demo?persona=employee&demo=1&redirectTo=%2F' },
      { text: 'Sign in with your work account', href: '/api/session/login?account=1&redirectTo=%2F' },
      { text: 'IT Service Management home', href: 'https://itsm.example' },
    ]);
    expect(document.querySelector('.itsm-SignInLayout main#main')).not.toBeNull();
    expect(await violations()).toEqual([]);
  });

  it('I3: sign in to the Help Portal, and with the demo on, an offer to explore it', async () => {
    signIn = {
      row: 'I3',
      kind: 'sign-in',
      workAccountHref: '/api/session/login?account=1&redirectTo=%2F',
      exploreHref: 'https://portal.example/demo?persona=employee&demo=1',
      homeHref: 'https://itsm.example',
      redirectTo: '/',
    };
    await show(signInPage.default);
    expect(h1()).toBe('Sign in to the Help Portal');
    expect(links()).toContainEqual({ text: 'Sign in with your work account', href: '/api/session/login?account=1&redirectTo=%2F' });
    expect(links()).toContainEqual({ text: 'New here? Explore the demo', href: 'https://portal.example/demo?persona=employee&demo=1' });
    expect(document.querySelector('.itsm-SystemBar')).not.toBeNull();
    expect(await violations()).toEqual([]);
  });

  it('I3 with the demo off: the work account alone, and no demo strip', async () => {
    demoOn = false;
    signIn = { row: 'I3', kind: 'sign-in', workAccountHref: '/api/session/login?account=1&redirectTo=%2F', exploreHref: null, homeHref: null, redirectTo: '/' };
    await show(signInPage.default);
    expect(links().filter((link) => !link.href?.startsWith('https://itsm.example'))).toEqual([{ text: 'Sign in with your work account', href: '/api/session/login?account=1&redirectTo=%2F' }]);
    expect(document.querySelector('.itsm-SystemBar')).toBeNull();
    expect(await violations()).toEqual([]);
  });
});

/* ---- /signed-out --------------------------------------------------------- */

describe('/signed-out', () => {
  it('after an ordinary sign-out: sign in again, and the site’s home while the demo is on', async () => {
    await show(signedOutPage.default);
    expect(h1()).toBe("You're signed out");
    expect(text()).toContain('Your session on this device has ended.');
    expect(links()).toContainEqual({ text: 'Sign in again', href: '/api/session/login' });
    expect(links()).toContainEqual({ text: 'IT Service Management home', href: 'https://itsm.example/' });
    expect(await violations()).toEqual([]);

    demoOn = false;
    await show(signedOutPage.default);
    expect(links().map((link) => link.text)).not.toContain('IT Service Management home');
    expect(document.querySelector('.itsm-SystemBar')).toBeNull();
  });

  it('after a demo visit: thanks, the site’s home, and a way back in as each persona', async () => {
    await show(signedOutPage.default, { demo: '1' });
    expect(h1()).toBe('Thanks for exploring');
    expect(text()).toContain(
      'Your demo session has ended. Northwind Traders (UK) and its people are fictional, and the demo resets every night at 00:00 UK time.',
    );
    expect(links()).toContainEqual({ text: 'IT Service Management home', href: 'https://itsm.example/?ended=1' });
    const explore = [...document.querySelectorAll<HTMLAnchorElement>('.app-Entry__exploreLink')];
    expect(explore.map((link) => [link.querySelector('.app-Entry__exploreLabel')?.textContent, link.getAttribute('href')])).toEqual([
      ['Explore as Employee', '/demo?persona=employee&demo=1'],
      ['Explore as Agent', 'https://desk.example/demo?persona=agent&demo=1'],
      ['Explore as Admin', 'https://admin.example/demo?persona=admin&demo=1'],
    ]);
    expect(explore[1]!.textContent).toContain('Alex Morgan, Service Desk team lead · Service Desk');
    expect(explore.every((link) => link.getAttribute('rel') === 'nofollow')).toBe(true);
    expect(await violations()).toEqual([]);
  });

  it('leaves out a persona whose area the deployment has no address for', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    delete process.env.ADMIN_ORIGIN;
    await show(signedOutPage.default, { demo: '1' });
    expect([...document.querySelectorAll('.app-Entry__exploreLabel')].map((label) => label.textContent)).toEqual(['Explore as Employee', 'Explore as Agent']);
  });

  it('after a demo visit that gave the person’s own account back', async () => {
    restoredName = 'Ada Lovelace';
    await show(signedOutPage.default, { demo: '1', restored: '1' });
    expect(text()).toContain("You're back in your own account, signed in as Ada Lovelace.");
    expect(links()).toContainEqual({ text: 'Continue to the Help Portal', href: '/' });
    expect(await violations()).toEqual([]);
  });

  it.each([
    ['stale', 'That sign-in had already been used, or it expired.', '/api/session/login'],
    ['provider', 'The identity provider didn’t finish the sign-in.', '/api/session/login'],
    ['parked_expired', 'Your account’s sign-in expired while you explored; sign in again.', '/api/session/login?account=1'],
    ['<script>alert(1)</script>', 'Something went wrong while signing you in.', '/api/session/login'],
  ])('words reason %s in the BFF’s sentence, never the query’s', async (reason, sentence, href) => {
    await show(signedOutPage.default, { reason, demo: '1' });
    expect(h1()).toBe("That sign-in didn't finish");
    expect(text()).toContain(sentence);
    expect(text()).not.toContain('<script>');
    expect(links()).toContainEqual({ text: 'Sign in again', href });
    expect(await violations()).toEqual([]);
  });
});

/* ---- The public strip ---------------------------------------------------- */

describe('the public demo strip on these pages', () => {
  const NOW = Date.UTC(2026, 9, 2, 14, 58, 22); // 15:58:22 in London, 8 h 01 min 38 s before midnight.

  it('says when the demo resets, to the minute, in a <time> for the reset', () => {
    document.body.innerHTML = renderToStaticMarkup(<PublicDemoStrip now={NOW} />);
    const bar = document.querySelector('.itsm-SystemBar')!;
    expect(bar.getAttribute('role')).toBe('region');
    expect(bar.getAttribute('aria-label')).toBe('Demo environment');
    expect(bar.getAttribute('data-align')).toBe('center');
    expect(bar.querySelector('time')?.getAttribute('datetime')).toBe('2026-10-02T23:00:00.000Z');
    expect(bar.querySelector('time')?.textContent).toBe('Resets in 8 h 02 min');
    expect(bar.textContent).toContain(DEMO_COPY.resetsDaily);
    // No persona, no Reset, no End demo, no client island.
    expect(bar.querySelectorAll('button')).toHaveLength(0);
    expect(bar.querySelector('[role="timer"]')).toBeNull();
  });

  it('rounds the minutes up, and drops the hours under one', () => {
    expect(resetsIn(9 * 3_600_000 + 61_000)).toBe('Resets in 9 h 02 min');
    expect(resetsIn(42 * 60_000)).toBe('Resets in 42 min');
    expect(resetsIn(30_000)).toBe('Resets in 1 min');
    expect(resetsIn(-5)).toBe('Resets in 0 min');
  });

  it('shows the states the page knows: preparing busy, paused', () => {
    document.body.innerHTML = renderToStaticMarkup(<PublicDemoStrip state="preparing" now={NOW} />);
    expect(document.querySelector('.itsm-SystemBar')?.getAttribute('data-state')).toBe('busy');
    expect(document.body.textContent).toContain('Preparing the demo…');
    document.body.innerHTML = renderToStaticMarkup(<PublicDemoStrip state="paused" now={NOW} />);
    expect(document.querySelector('.itsm-SystemBar__status')?.textContent).toBe('Paused');
  });

  it('uses the demo bar’s own words', () => {
    const clock = { nextResetAt: NOW + 60_000, serverNow: NOW, periodMs: 86_400_000, resetLabel: '00:00 UK time', timeZone: 'Europe/London' };
    const preparing = renderToStaticMarkup(<DemoBar variant="public" clock={clock} state="preparing" />);
    const paused = renderToStaticMarkup(<DemoBar variant="public" clock={clock} state="paused" />);
    expect(preparing).toContain(`aria-label="${DEMO_STRIP.label}"`);
    expect(preparing).toContain(`>${DEMO_STRIP.badge}<`);
    expect(preparing).toContain(DEMO_STRIP.preparing);
    expect(renderToStaticMarkup(<DemoBar variant="public" clock={clock} state="building" />)).toContain(DEMO_STRIP.resetting);
    expect(paused).toContain(DEMO_STRIP.paused);
  });

  it('and an ended visit is worded as the contract and `/demo` word it', () => {
    expect(DEMO_ENDED_BODY).toBe('Pick up where you left off — the demo data may have been reset since.');
    expect(DEMO_COPY.sessionEnded).toBe('Your demo session ended');
  });
});

/* ---- The session bar's clearing ------------------------------------------ */

describe('the session bar', () => {
  it('clears this device’s copies of the visit when the demo is rebuilt, before the notice', async () => {
    const { default: SessionDemoBar, clearForGeneration } = await import('../app/demo/session-bar.js');
    const clock = { nextResetAt: Date.now() + 3_600_000, serverNow: Date.now(), periodMs: 86_400_000, resetLabel: '00:00 UK time', timeZone: 'Europe/London' };
    render(<SessionDemoBar variant="session" clock={clock} persona={{ name: 'Emma Clarke', title: 'Finance Manager' }} generation={41} />);
    const waits: Promise<unknown>[] = [];
    await act(async () => {
      window.dispatchEvent(new CustomEvent('itsm:demo-generation-change', { detail: { generation: 42, waitUntil: (work: Promise<unknown>) => waits.push(work) } }));
      await Promise.all(waits);
    });
    expect(waits).toHaveLength(1);
    expect(cleared).toHaveBeenCalledTimes(1);
    const options = cleared.mock.calls[0]![0];
    expect(options.generation).toBe(42);
    expect(options.alsoKeys('itsm-portal-drafts')).toBe(true);
    expect(options.alsoKeys('itsm-prefs')).toBe(false);
    await clearForGeneration(43);
    expect(cleared).toHaveBeenCalledTimes(2);
  });
});

/* ---- Routes, robots, headers --------------------------------------------- */

describe('the demo’s routes', () => {
  it('are one line each into the BFF', async () => {
    const request = new Request('https://portal.example/x', { method: 'POST' }) as never;
    await (await import('../app/api/session/demo/route.js')).POST(request);
    await (await import('../app/api/demo/status/route.js')).GET(request);
    await (await import('../app/api/demo/reset/route.js')).POST(request);
    await (await import('../app/api/demo/ip-check/route.js')).GET(request);
    for (const handler of [bff.demoSignIn, bff.demoStatus, bff.demoReset, bff.demoIpCheck]) expect(handler).toHaveBeenCalledWith(request);
    expect((await import('../app/api/demo/status/route.js')).dynamic).toBe('force-dynamic');
  });

  it('keep crawlers off the demo’s entry and the API', async () => {
    const robots = (await import('../app/robots.js')).default();
    expect(robots.rules).toEqual({ userAgent: '*', disallow: ['/demo', '/api/'] });
  });

  it('send /demo with noindex and no-store, and rewrite the shell and chart barrels', async () => {
    const config = (await import('../../next.config.js')).default;
    const rules = await config.headers!();
    const demo = rules.find((rule) => rule.source === '/demo')!;
    expect(demo.headers).toEqual([
      { key: 'x-robots-tag', value: 'noindex, nofollow' },
      { key: 'cache-control', value: 'no-store' },
    ]);
    expect(config.experimental?.optimizePackageImports).toEqual(expect.arrayContaining(['@itsm/ui/shell', '@itsm/ui/charts']));
  });

  it('leave the page metadata out of every index', () => {
    expect(demoPage.metadata.robots).toEqual({ index: false, follow: false });
    expect(demoPage.dynamic).toBe('force-dynamic');
  });
});
