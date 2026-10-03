// @vitest-environment jsdom
import axe from 'axe-core';
import type { ReactElement, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isServiceDeskRoutePending } from '@itsm/contracts/areas';

vi.mock('server-only', () => ({}));
// `next/font` is a build-time transform; outside Next it has nothing to load.
vi.mock('next/font/local', () => ({
  default: (options: { variable: string }) => ({ className: 'font', variable: options.variable.replace(/^--/, 'v-'), style: {} }),
}));

const { default: RootLayout, generateMetadata, viewport } = await import('../app/layout.js');
const { default: LandingPage, dynamic } = await import('../app/page.js');
const { default: NotFound } = await import('../app/not-found.js');
const { Shot } = await import('../components/Shot.js');
const { HINT_LISTEN } = await import('../client/continue-hint.js');
const { CARDS, SPOTLIGHTS } = await import('../landing/content.js');

/**
 * The landing page as a whole document (SPEC v3 §6.2, WP-50 acceptance; A5
 * §3.13, §4, §13.1 "render").
 *
 * The page and the root layout are rendered on the server path —
 * `renderToStaticMarkup`, as Next renders a server component — and loaded
 * into jsdom as a document, so the checks are about what a browser receives:
 * where each link goes and with which `rel`, that nothing is a form, that the
 * strip, the hero and the bands change with the demo's state, and an axe run
 * that includes the page-level rules a fragment cannot answer.
 *
 * The demo status is read through a stubbed `fetch`. The status read keeps a
 * ten-second memo per API base URL, so each state gets a base URL of its own.
 */

const DEPLOYED = {
  NODE_ENV: 'production',
  SITE_ORIGIN: 'https://www.example.com',
  PORTAL_ORIGIN: 'https://help.example.com',
  WORKBENCH_ORIGIN: 'https://desk.example.com',
  ADMIN_ORIGIN: 'https://admin.example.com',
  DEMO_MODE: 'on',
};

type State = 'ready' | 'building' | 'preparing' | 'paused' | 'down';

let apiCounter = 0;

function statusBody(state: Exclude<State, 'down'>): unknown {
  const now = Date.now();
  return {
    v: 1,
    demo: true,
    state,
    serverNow: now,
    resetTimeZone: 'Europe/London',
    resetLabel: '00:00 UK time',
    resetHour: 0,
    nextResetAt: now + 3_600_000,
    periodMs: 86_400_000,
    generation: 3,
    lastResetAt: now - 3_600_000,
    lastResetReason: 'scheduled',
    build: state === 'preparing' || state === 'building' ? { startedAt: now - 10_000, etaSec: 200 } : null,
    manualResetAvailableAt: null,
    resetBlocked: false,
    cooldownSeconds: 0,
    uploads: false,
    personas: [],
    company: { name: 'Northwind Traders (UK)', fictional: true },
  };
}

/** Configures a deployment whose demo is in `state`; `down` is an API that answers 500. */
function deploy(env: Readonly<Record<string, string | undefined>>, state: State = 'down'): void {
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value ?? '');
  // A fresh base URL per call, so the status memo never answers from an earlier test.
  vi.stubEnv('API_BASE_URL', `https://api-${++apiCounter}.example.com`);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => (state === 'down' ? new Response('no', { status: 500 }) : new Response(JSON.stringify(statusBody(state)), { status: 200 }))),
  );
}

/** The page inside the root layout, loaded as the document. */
function load(page: ReactNode): Document {
  const html = renderToStaticMarkup(RootLayout({ children: page }) as ReactElement);
  document.open();
  document.write(`<!doctype html>${html}`);
  document.close();
  return document;
}

async function landing(): Promise<Document> {
  return load(await LandingPage());
}

async function audit(): Promise<axe.AxeResults> {
  return axe.run(document, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] },
    rules: {
      // Contrast needs a layout engine jsdom lacks; it is computed from the tokens (contrast.ts).
      'color-contrast': { enabled: false },
      'color-contrast-enhanced': { enabled: false },
      'target-size': { enabled: false },
      // Next writes <title> from the metadata; asserted separately below.
      'document-title': { enabled: false },
    },
    resultTypes: ['violations', 'passes'],
  });
}

async function violations(): Promise<string[]> {
  const results = await audit();
  return results.violations.map((violation) => `${violation.id}: ${violation.help} (${violation.nodes.map((node) => node.html.slice(0, 160)).join(' | ')})`);
}

const roleLinks = (doc: Document) => [...doc.querySelectorAll<HTMLAnchorElement>('a[data-persona]')];

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the hero', () => {
  it('is rendered per request and names the product once, as the only h1, with the gradient line inside it', async () => {
    expect(dynamic).toBe('force-dynamic');
    deploy(DEPLOYED, 'ready');
    const doc = await landing();
    const headings = [...doc.querySelectorAll('h1')];
    expect(headings).toHaveLength(1);
    expect(headings[0]!.textContent).toBe('IT Service Management for every request, ticket and team');
    expect(headings[0]!.querySelector('.app-Hero__titleB')?.textContent).toBe('for every request, ticket and team');
    expect(doc.querySelector('.app-Pill')?.textContent).toBe('Interactive demo · resets every night');
  });

  it('opens the Service Desk as the agent in one click: a plain nofollow link, with the persona said under it (X-M1)', async () => {
    deploy(DEPLOYED, 'ready');
    const doc = await landing();
    const primary = doc.querySelector<HTMLAnchorElement>('.app-Hero__primary a')!;
    expect(primary.textContent).toBe('Explore as an agent');
    expect(primary.getAttribute('href')).toBe('https://desk.example.com/demo?persona=agent&demo=1');
    expect(primary.dataset.persona).toBe('agent');
    expect(primary.getAttribute('rel')).toBe('nofollow');
    expect(doc.querySelector('.app-Hero__persona')?.textContent).toBe("You'll be Alex Morgan, Service Desk team lead");
  });

  it('shows each other persona with their name and title, and names both in the link at every width (V-m3)', async () => {
    deploy(DEPLOYED, 'ready');
    const doc = await landing();
    const links = [...doc.querySelectorAll<HTMLAnchorElement>('.app-Hero__people a')];
    expect(links.map((link) => [link.dataset.persona, link.getAttribute('href')])).toEqual([
      ['employee', 'https://help.example.com/demo?persona=employee&demo=1'],
      ['admin', 'https://admin.example.com/demo?persona=admin&demo=1'],
    ]);
    // ≥ 48rem: the second line is visible; below 48rem the stylesheet hides it, and the accessible name still carries both.
    expect(links.map((link) => link.querySelector('.app-PersonLink__who')?.textContent)).toEqual(['Emma Clarke, Finance Manager', 'Jordan Lee, IT Service Manager']);
    expect(links.map((link) => link.getAttribute('aria-label'))).toEqual([
      'Explore as Employee — Emma Clarke, Finance Manager',
      'Explore as Admin — Jordan Lee, IT Service Manager',
    ]);
    expect(doc.querySelector('.app-Hero__or')?.textContent).toBe('or explore as');
    expect(doc.querySelector<HTMLAnchorElement>('.app-Hero__signIn')?.getAttribute('href')).toBe('/sign-in');
  });

  it('says the demo is being prepared or paused, in the pill and under the role links', async () => {
    deploy(DEPLOYED, 'preparing');
    let doc = await landing();
    expect(doc.querySelector('.app-Pill')?.textContent).toBe('Interactive demo · being prepared, ready in about 4 minutes');
    expect(doc.querySelector('.app-Pill')?.getAttribute('data-state')).toBe('preparing');
    expect(doc.querySelector('[role="status"].app-StatusNote')?.textContent).toBe("The demo is being prepared with fresh data. It's usually ready in about 4 minutes.");
    // The role links stay links: the app's own /demo page decides.
    expect(roleLinks(doc).length).toBeGreaterThan(0);

    deploy(DEPLOYED, 'paused');
    doc = await landing();
    expect(doc.querySelector('.app-Pill')?.textContent).toBe('Interactive demo · paused for maintenance');
    expect(doc.querySelectorAll('.app-StatusNote')).toHaveLength(2);
    expect(doc.querySelectorAll('[role="status"].app-StatusNote')).toHaveLength(1);
  });

  it('draws an unanswered status read as ready', async () => {
    deploy(DEPLOYED, 'down');
    const doc = await landing();
    expect(doc.querySelector('.app-Pill')?.getAttribute('data-state')).toBe('ready');
    expect(doc.querySelector('.app-StatusNote')).toBeNull();
    expect(doc.querySelector('.itsm-SystemBar')).not.toBeNull();
  });
});

describe('every link into the product', () => {
  it('is a plain same-tab <a> with rel=nofollow, never noreferrer; there is no form and no referrer meta (D22)', async () => {
    deploy(DEPLOYED, 'ready');
    const doc = await landing();
    const links = roleLinks(doc);
    // The hero's agent, its two other personas, the final band's three and the header's call to action.
    expect(links.map((link) => link.dataset.persona).sort()).toEqual(['admin', 'admin', 'agent', 'agent', 'agent', 'employee', 'employee']);
    for (const link of links) {
      expect(link.getAttribute('rel')).toBe('nofollow');
      expect(link.hasAttribute('target')).toBe(false);
      expect(link.getAttribute('href')).toMatch(/^https:\/\/(help|desk|admin)\.example\.com\/demo\?persona=(employee|agent|admin)&demo=1$/);
    }
    expect(doc.querySelectorAll('form')).toHaveLength(0);
    expect(doc.querySelectorAll('a[rel~="noreferrer"], a[target], meta[name="referrer"]')).toHaveLength(0);
  });

  it('puts the three role buttons in the final band, names and titles from the persona table', async () => {
    deploy(DEPLOYED, 'ready');
    const doc = await landing();
    const roles = [...doc.querySelectorAll<HTMLAnchorElement>('.app-Final a.app-Role')];
    // The avatars are decorative (hidden from assistive technology); the words are what is read.
    expect(roles.map((role) => role.querySelector('.app-Role__text')?.textContent)).toEqual([
      'Explore the demo as EmployeeEmma ClarkeFinance Manager · Help Portal',
      'Explore the demo as AgentAlex MorganService Desk team lead · Service Desk',
      'Explore the demo as AdminJordan LeeIT Service Manager · Administration',
    ]);
    // X-m24: the strip already says when it resets, so the band does not.
    expect(doc.querySelector('.app-Final')?.textContent).not.toContain('resets every day');
  });

  it('says a role is unavailable rather than linking to an origin this deployment lacks', async () => {
    deploy({ ...DEPLOYED, ADMIN_ORIGIN: undefined }, 'ready');
    const doc = await landing();
    expect(doc.querySelector('a[data-persona="admin"]')).toBeNull();
    expect(doc.querySelector('[data-persona-unavailable="admin"]')?.textContent).toContain("This part of the demo isn't available right now.");
    expect(await violations()).toEqual([]);
  });

  it('shows the header call to action only when there is a Service Desk to open', async () => {
    deploy(DEPLOYED, 'ready');
    let doc = await landing();
    const cta = doc.querySelector<HTMLAnchorElement>('.app-SiteHeader__cta')!;
    expect(cta.getAttribute('href')).toBe('https://desk.example.com/demo?persona=agent&demo=1');
    expect(cta.getAttribute('aria-label')).toBe('Try the demo — explore the Service Desk as Alex Morgan');
    deploy({ ...DEPLOYED, WORKBENCH_ORIGIN: undefined }, 'ready');
    doc = await landing();
    expect(doc.querySelector('.app-SiteHeader__cta')).toBeNull();
    expect(doc.querySelector('.app-Hero__primary .app-Unavailable')).not.toBeNull();
  });
});

describe('the demo strip, the sections and the hint', () => {
  it('starts with the public strip and the header, anchors Features and How the demo works, and links Sign in', async () => {
    deploy(DEPLOYED, 'building');
    const doc = await landing();
    const landingRoot = doc.querySelector('.app-Landing')!;
    expect(landingRoot.firstElementChild?.classList.contains('itsm-SystemBar')).toBe(true);
    expect(doc.querySelector('.itsm-SystemBar')?.getAttribute('aria-label')).toBe('Demo environment');
    const nav = doc.querySelector('nav[aria-label="On this page"]')!;
    expect([...nav.querySelectorAll('a')].map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Features', '#explore'],
      ['How the demo works', '#how-it-works'],
    ]);
    expect(doc.querySelector('.app-SiteHeader__signIn')?.getAttribute('href')).toBe('/sign-in');
    expect(doc.getElementById('how-it-works')?.querySelectorAll('ol > li')).toHaveLength(5);
  });

  it('shows four spotlights and six cards, each "Try it" only once its route is in this build (H4, RV6)', async () => {
    deploy(DEPLOYED, 'ready');
    const doc = await landing();
    expect(doc.querySelectorAll('.app-Spot')).toHaveLength(4);
    expect(doc.querySelectorAll('.app-Card')).toHaveLength(6);
    const expected = [...SPOTLIGHTS, ...CARDS].filter((item) => !(item.tryIt.needs && isServiceDeskRoutePending(item.tryIt.needs))).length;
    expect(doc.querySelectorAll('.app-TryIt')).toHaveLength(expected);
    const who = doc.querySelector('#spot-S1')!.closest('.app-Spot')!.querySelector('.app-TryIt__who')!;
    // The avatar beside the words is decorative; the words are the persona chip.
    expect([...who.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.textContent).join('')).toBe('As Alex · Agent');
  });

  it('draws every screenshot as a labelled stand-in with sample data until the pictures exist, never "coming soon" (X-M9)', async () => {
    deploy(DEPLOYED, 'ready');
    const doc = await landing();
    const previews = [...doc.querySelectorAll('[data-shot-preview]')];
    expect(previews).toHaveLength(10);
    for (const preview of previews) {
      expect(preview.getAttribute('role')).toBe('img');
      expect(preview.getAttribute('aria-label')).toMatch(/in the demo/);
      expect(preview.textContent).toContain('Sample data');
    }
    expect(doc.body.textContent).not.toMatch(/coming soon/i);
  });

  it('draws a captured shot as a lazy <picture> that reserves its size', () => {
    const markup = renderToStaticMarkup(
      <Shot
        id="board"
        variant="card"
        manifest={{ board: { width: 1440, height: 900, avif: [{ src: '/a-720.avif', width: 720 }], webp: [{ src: '/a-720.webp', width: 720 }, { src: '/a-1080.webp', width: 1080 }] } }}
      />,
    );
    const host = document.createElement('div');
    host.innerHTML = markup;
    const img = host.querySelector('img')!;
    expect(img.getAttribute('src')).toBe('/a-1080.webp');
    expect([img.getAttribute('width'), img.getAttribute('height'), img.getAttribute('loading')]).toEqual(['1440', '900', 'lazy']);
    expect(img.getAttribute('alt')).toMatch(/board in the demo/);
    expect(host.querySelector('source[type="image/avif"]')?.getAttribute('srcset')).toBe('/a-720.avif 720w');
  });

  it('marks the next reset and whether the demo is on on <html>, and ends the body with the continue hint', async () => {
    deploy(DEPLOYED, 'ready');
    const doc = await landing();
    const reset = Number(doc.documentElement.dataset.nextReset);
    expect(reset).toBeGreaterThan(Date.now());
    expect(reset - Date.now()).toBeLessThanOrEqual(25 * 3_600_000);
    expect(doc.documentElement.dataset.demo).toBe('on');
    expect(doc.body.lastElementChild?.tagName).toBe('SCRIPT');
    expect(doc.body.lastElementChild?.textContent).toBe(HINT_LISTEN);
    expect(doc.documentElement.className.split(' ')).toEqual(['v-font-inter', 'v-font-inter-ext', 'v-font-jakarta', 'v-font-jakarta-ext']);
  });

  it('starts with a skip link to the one main', async () => {
    deploy(DEPLOYED, 'ready');
    const doc = await landing();
    const first = doc.querySelector('a');
    expect(first?.textContent).toBe('Skip to main content');
    expect(first?.getAttribute('href')).toBe('#main');
    expect(doc.querySelectorAll('main')).toHaveLength(1);
    expect(doc.getElementById('main')?.tagName).toBe('MAIN');
    expect(doc.documentElement.getAttribute('lang')).toBe('en-GB');
  });
});

describe('with DEMO_MODE off', () => {
  it('is a product page: no strip, no role link, no "How the demo works", and Sign in in their place', async () => {
    deploy({ ...DEPLOYED, DEMO_MODE: 'off' });
    const doc = await landing();
    expect(doc.documentElement.dataset.demo).toBe('off');
    expect(doc.querySelector('.itsm-SystemBar')).toBeNull();
    expect(doc.querySelector('.app-Pill')).toBeNull();
    expect(roleLinks(doc)).toHaveLength(0);
    expect(doc.getElementById('how-it-works')).toBeNull();
    expect(doc.querySelector('nav[aria-label="On this page"]')?.textContent).toBe('Features');
    expect([...doc.querySelectorAll<HTMLAnchorElement>('.app-Hero__offRow a')].map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Sign in', '/sign-in'],
      ["See what's inside", '#explore'],
    ]);
    expect(doc.querySelector('.app-Final h2')?.textContent).toBe('Sign in to IT Service Management');
    expect(doc.querySelectorAll('.app-TryIt')).toHaveLength(0);
    // The preview still shows, and still says it is sample data.
    expect(doc.querySelector('[data-hero-preview]')?.textContent).toContain('Sample data');
  });

  it('passes axe as a whole page', async () => {
    deploy({ ...DEPLOYED, DEMO_MODE: 'off' });
    await landing();
    expect(await violations()).toEqual([]);
  });
});

describe('accessibility', () => {
  it('passes axe as a whole page in the demo, page-level rules included', async () => {
    deploy(DEPLOYED, 'preparing');
    await landing();
    expect(await violations()).toEqual([]);
    const passed = (await audit()).passes.map((rule) => rule.id);
    expect(passed).toEqual(expect.arrayContaining(['bypass', 'html-has-lang', 'html-lang-valid', 'landmark-main-is-top-level', 'landmark-no-duplicate-main', 'heading-order']));
  }, 30_000);

  it('makes the preview one image with one sentence, inert, and its caption says it is not a customer’s', async () => {
    deploy(DEPLOYED, 'ready');
    const doc = await landing();
    const screen = doc.querySelector('.app-DeviceFrame__screen')!;
    expect(screen.getAttribute('role')).toBe('img');
    expect(screen.hasAttribute('inert')).toBe(true);
    expect(screen.getAttribute('aria-label')).toMatch(/^A preview of the Service Desk overview with sample data/);
    expect(doc.querySelector('.app-DeviceFrame > figcaption')?.textContent).toBe('Illustrative sample data, not results from a customer.');
  });
});

describe('the metadata', () => {
  it('titles the site for the demo and lets an owner domain be indexed', () => {
    deploy(DEPLOYED);
    const metadata = generateMetadata();
    expect(metadata.title).toEqual({ default: 'IT Service Management · Interactive demo', template: '%s · IT Service Management' });
    expect(metadata.description).toMatch(/^Explore IT Service Management with a fictional company/);
    expect(metadata.robots).toEqual({ index: true, follow: true });
    expect(String(metadata.metadataBase)).toBe('https://www.example.com/');
    expect(viewport.themeColor).toBe('#0b1120');
  });

  it('keeps a Railway-generated host out of the index, and drops the demo from the title when it is off', () => {
    deploy({ ...DEPLOYED, SITE_ORIGIN: 'https://site-production-1a2b.up.railway.app', DEMO_MODE: 'off' });
    const metadata = generateMetadata();
    expect(metadata.robots).toEqual({ index: false, follow: true });
    expect(metadata.title).toEqual({ default: 'IT Service Management', template: '%s · IT Service Management' });
  });
});

describe('the 404', () => {
  it('is a page of its own with a way home, and passes axe', async () => {
    deploy(DEPLOYED);
    const doc = load(<NotFound />);
    expect([...doc.querySelectorAll('h1')].map((heading) => heading.textContent)).toEqual(['We couldn’t find that page']);
    expect(doc.querySelector<HTMLAnchorElement>('a[data-action="home"]')?.getAttribute('href')).toBe('/');
    expect(await violations()).toEqual([]);
  });
});
