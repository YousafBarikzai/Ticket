// @vitest-environment jsdom
import axe from 'axe-core';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
// `next/font` is a build-time transform; outside Next it has nothing to load.
vi.mock('next/font/local', () => ({
  default: (options: { variable: string }) => ({ className: 'font', variable: options.variable.replace(/^--/, 'v-'), style: {} }),
}));

const { default: RootLayout, generateMetadata } = await import('../app/layout.js');
const { default: HoldingPage } = await import('../app/page.js');
const { default: NotFound } = await import('../app/not-found.js');

/**
 * The holding page, as a whole document (SPEC v3 WP-10; A5 §3.13).
 *
 * The page and the root layout are rendered to HTML on the server path —
 * `renderToStaticMarkup`, as Next renders a server component — and loaded into
 * jsdom as a document, so the checks below are about what a browser receives:
 * where each link goes, that nothing is a form, and an axe run that includes
 * the page-level rules a component fragment cannot answer (one `h1`, a `main`
 * landmark, a skip link, a language).
 */

const DEPLOYED = {
  NODE_ENV: 'production',
  SITE_ORIGIN: 'https://www.example.com',
  PORTAL_ORIGIN: 'https://help.example.com',
  WORKBENCH_ORIGIN: 'https://desk.example.com',
  ADMIN_ORIGIN: 'https://admin.example.com',
  DEMO_MODE: 'on',
};

function deploy(env: Readonly<Record<string, string | undefined>>): void {
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value ?? '');
}

/** The page inside the root layout, loaded as the document. */
function load(page: ReactElement): Document {
  const html = renderToStaticMarkup(RootLayout({ children: page }) as ReactElement);
  document.open();
  document.write(`<!doctype html>${html}`);
  document.close();
  return document;
}

/** axe over the whole document. Contrast needs a layout engine jsdom lacks; it is computed from the tokens instead. */
async function audit(): Promise<axe.AxeResults> {
  return axe.run(document, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] },
    rules: {
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
  return results.violations.map((violation) => `${violation.id}: ${violation.help} (${violation.nodes.map((node) => node.html).join(' | ')})`);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the holding page', () => {
  it('names the product once, as the only h1, with one sentence under it', () => {
    deploy(DEPLOYED);
    const doc = load(<HoldingPage />);
    const headings = [...doc.querySelectorAll('h1')];
    expect(headings.map((heading) => heading.textContent)).toEqual(['IT Service Management']);
    expect(doc.querySelector('.app-Holding__lead')?.textContent).toMatch(/^Give employees one place to ask for help/);
  });

  it('offers a work-account sign-in for each area, as plain same-tab links with account=1', () => {
    deploy(DEPLOYED);
    const doc = load(<HoldingPage />);
    const links = [...doc.querySelectorAll<HTMLAnchorElement>('a[data-area]')];
    expect(links.map((link) => [link.dataset.area, link.getAttribute('href')])).toEqual([
      ['portal', 'https://help.example.com/api/session/login?account=1&redirectTo=%2Fresume'],
      ['workbench', 'https://desk.example.com/api/session/login?account=1&redirectTo=%2Fresume'],
      ['admin', 'https://admin.example.com/api/session/login?account=1&redirectTo=%2Fresume'],
    ]);
    for (const link of links) {
      // Same tab, no rel: a plain navigation through the identity provider.
      expect(link.hasAttribute('target')).toBe(false);
      expect(link.hasAttribute('rel')).toBe(false);
    }
    expect(links.map((link) => link.getAttribute('aria-label'))).toEqual([
      'Sign in to Help Portal — Get help, request things and follow your requests',
      'Sign in to Service Desk — Work tickets, queues and SLAs',
      'Sign in to Administration — Set up rules, SLAs, people and reports',
    ]);
  });

  it('has no form anywhere, and no link that drops the Referer', () => {
    // C3: a cross-origin form would be blocked by `form-action 'self'`, and a
    // `noreferrer` would cost the demo its one-click entry (D22).
    deploy(DEPLOYED);
    const doc = load(<HoldingPage />);
    expect(doc.querySelectorAll('form')).toHaveLength(0);
    expect(doc.querySelectorAll('a[rel~="noreferrer"], meta[name="referrer"]')).toHaveLength(0);
  });

  it('says an area is unavailable rather than linking to an origin this deployment lacks', () => {
    deploy({ ...DEPLOYED, ADMIN_ORIGIN: undefined });
    const doc = load(<HoldingPage />);
    expect(doc.querySelector('a[data-area="admin"]')).toBeNull();
    const unavailable = doc.querySelector('[data-area="admin"][data-unavailable]');
    expect(unavailable?.textContent).toContain("This part isn't available right now.");
    expect(doc.querySelectorAll('a[data-area]')).toHaveLength(2);
  });

  it('starts with a skip link to main, and marks whether the demo is on for the post-deploy check', () => {
    deploy(DEPLOYED);
    const doc = load(<HoldingPage />);
    const first = doc.querySelector('a');
    expect(first?.textContent).toBe('Skip to main content');
    expect(first?.getAttribute('href')).toBe('#main');
    expect(doc.getElementById('main')?.tagName).toBe('MAIN');
    expect(doc.documentElement.getAttribute('lang')).toBe('en-GB');
    expect(doc.documentElement.dataset.demo).toBe('on');
    deploy({ ...DEPLOYED, DEMO_MODE: 'off' });
    expect(load(<HoldingPage />).documentElement.dataset.demo).toBe('off');
  });

  it('passes axe as a whole page, page-level rules included', async () => {
    deploy(DEPLOYED);
    load(<HoldingPage />);
    expect(await violations()).toEqual([]);
    // The page-level rules a component fragment cannot answer did run here,
    // and passed. (`landmark-one-main` and `page-has-heading-one` come back
    // "incomplete" in jsdom, which cannot tell what is visible; the one `h1`
    // and the `main` landmark are asserted by hand above instead.)
    const passed = (await audit()).passes.map((rule) => rule.id);
    expect(passed).toEqual(
      expect.arrayContaining(['bypass', 'html-has-lang', 'html-lang-valid', 'region', 'landmark-main-is-top-level', 'landmark-no-duplicate-main', 'heading-order']),
    );
  });

  it('passes axe with an area unavailable', async () => {
    deploy({ ...DEPLOYED, WORKBENCH_ORIGIN: undefined });
    load(<HoldingPage />);
    expect(await violations()).toEqual([]);
  });
});

describe('the metadata', () => {
  it('titles the site and lets an owner domain be indexed', () => {
    deploy(DEPLOYED);
    const metadata = generateMetadata();
    expect(metadata.title).toEqual({ default: 'IT Service Management', template: '%s · IT Service Management' });
    expect(metadata.robots).toEqual({ index: true, follow: true });
    expect(String(metadata.metadataBase)).toBe('https://www.example.com/');
  });

  it('keeps a Railway-generated host out of the index', () => {
    deploy({ ...DEPLOYED, SITE_ORIGIN: 'https://site-production-1a2b.up.railway.app' });
    expect(generateMetadata().robots).toEqual({ index: false, follow: true });
  });
});

describe('the 404', () => {
  it('is a page of its own with a way home, and passes axe', async () => {
    deploy(DEPLOYED);
    const doc = load(<NotFound />);
    expect([...doc.querySelectorAll('h1')].map((heading) => heading.textContent)).toEqual(['We couldn’t find that page']);
    expect(doc.querySelector<HTMLAnchorElement>('a[data-action="home"]')?.getAttribute('href')).toBe('/');
    expect(doc.getElementById('main')?.tagName).toBe('MAIN');
    expect(await violations()).toEqual([]);
  });
});
