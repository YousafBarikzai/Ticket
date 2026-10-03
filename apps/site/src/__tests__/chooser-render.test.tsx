// @vitest-environment jsdom
import axe from 'axe-core';
import type { ReactElement, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEMO_PERSONAS } from '@itsm/contracts/demo';
import type { SiteDemoState } from '../server/demo-status.js';

vi.mock('server-only', () => ({}));

const demoState = vi.hoisted(() => ({ current: null as SiteDemoState | null }));
vi.mock('../server/demo-status.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../server/demo-status.js')>();
  return {
    ...actual,
    // The real read without a network: `off` when DEMO_MODE is off, else the state a test sets.
    getDemoStatus: async (config: { demo: boolean }) => (config.demo ? demoState.current : { mode: 'off' }),
  };
});

const { default: SignInPage, generateMetadata } = await import('../app/sign-in/page.js');

/**
 * The sign-in chooser rendered as a server component, loaded into jsdom as a
 * document (A5 §13.1 "render", §6.3–§6.7): the order of the parts for each
 * entry, where each link goes and how, the hidden continue cards, the
 * unavailable states, the status banner, and an axe run.
 */

const DEPLOYED = {
  NODE_ENV: 'production',
  SITE_ORIGIN: 'https://www.example.com',
  PORTAL_ORIGIN: 'https://help.example.com',
  WORKBENCH_ORIGIN: 'https://desk.example.com',
  ADMIN_ORIGIN: 'https://admin.example.com',
  API_BASE_URL: 'https://api.example.com',
  DEMO_MODE: 'on',
};

const CLOCK = { serverNow: 0, nextResetAt: 3_600_000, periodMs: 86_400_000, resetLabel: '00:00 UK time', timeZone: 'Europe/London' };

function deploy(env: Readonly<Record<string, string | undefined>>, state: 'ready' | 'preparing' | 'paused' | 'unknown' = 'ready'): void {
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value ?? '');
  demoState.current = { mode: 'on', state, etaSec: 240, clock: CLOCK };
}

async function load(search: Record<string, string> = {}): Promise<Document> {
  const page = (await SignInPage({ searchParams: Promise.resolve(search) })) as ReactNode;
  const html = renderToStaticMarkup(page as ReactElement);
  document.open();
  document.write(`<!doctype html><html lang="en-GB"><head><title>Sign in</title></head><body>${html}</body></html>`);
  document.close();
  return document;
}

async function violations(): Promise<string[]> {
  const results = await axe.run(document, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] },
    rules: { 'color-contrast': { enabled: false }, 'color-contrast-enhanced': { enabled: false }, 'target-size': { enabled: false } },
  });
  return results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(' | ')}`);
}

/** The chooser's parts in document order, by what marks each. */
function order(doc: Document): string[] {
  return [...doc.querySelectorAll('[data-continue], a[data-persona]:not(.app-ContinueCard__link), .app-Chooser__divider, [data-area]')]
    .map((el) => (el.matches('[data-continue]') ? 'continue' : el.matches('[data-persona]') ? 'persona' : el.matches('[data-area]') ? 'area' : 'or'))
    .filter((part, index, all) => part !== all[index - 1]);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('/sign-in', () => {
  it('?start=demo puts the demo first: continue, personas, or, work account', async () => {
    deploy(DEPLOYED);
    const doc = await load({ start: 'demo' });
    expect([...doc.querySelectorAll('h1')].map((h) => h.textContent)).toEqual(['Explore the demo']);
    expect(doc.body.textContent).toContain("You'll be signed in to a shared demo for Northwind Traders (UK), a fictional company. No sign-up.");
    expect(order(doc)).toEqual(['continue', 'persona', 'or', 'area']);
    expect(doc.querySelector('h2')?.textContent).toBe('Sign in with your work account');
    expect((await generateMetadata({ searchParams: Promise.resolve({ start: 'demo' }) })).title).toBe('Explore the demo');
  });

  it('by default puts the work account first, then the demo under its own heading', async () => {
    deploy(DEPLOYED);
    const doc = await load();
    expect(doc.querySelector('h1')?.textContent).toBe('Sign in');
    expect(order(doc)).toEqual(['area', 'or', 'continue', 'persona']);
    expect([...doc.querySelectorAll('h2')].map((h) => h.textContent)).toEqual(['Explore the demo']);
    const meta = await generateMetadata({ searchParams: Promise.resolve({}) });
    expect(meta.title).toBe('Sign in');
    expect(meta.robots).toEqual({ index: false, follow: true });
  });

  it('links each work-account row to the app’s login with account=1 and redirectTo=/resume', async () => {
    deploy(DEPLOYED);
    const doc = await load();
    const rows = [...doc.querySelectorAll<HTMLAnchorElement>('a.app-AreaRow')];
    expect(rows.map((a) => a.getAttribute('href'))).toEqual([
      'https://help.example.com/api/session/login?account=1&redirectTo=%2Fresume',
      'https://desk.example.com/api/session/login?account=1&redirectTo=%2Fresume',
      'https://admin.example.com/api/session/login?account=1&redirectTo=%2Fresume',
    ]);
    expect(rows[1]!.textContent).toBe('Sign in to Service Desk — Work tickets, queues and SLAs');
    expect(doc.body.textContent).toContain('No account yet? Ask your IT team to invite you.');
  });

  it('links each persona card to its app’s /demo, as plain nofollow anchors that keep the Referer', async () => {
    deploy(DEPLOYED);
    const doc = await load({ start: 'demo' });
    const cards = [...doc.querySelectorAll<HTMLAnchorElement>('a.app-PersonaCard')];
    expect(cards.map((a) => [a.dataset.persona, a.getAttribute('href')])).toEqual([
      ['employee', 'https://help.example.com/demo?persona=employee&demo=1'],
      ['agent', 'https://desk.example.com/demo?persona=agent&demo=1'],
      ['admin', 'https://admin.example.com/demo?persona=admin&demo=1'],
    ]);
    for (const [index, card] of cards.entries()) {
      const persona = DEMO_PERSONAS[index]!;
      expect(card.textContent).toContain(persona.name);
      expect(card.textContent).toContain(persona.title);
    }
    expect(cards[1]!.textContent).toContain('Service Desk team lead · Service Desk');
    for (const link of doc.querySelectorAll('a')) {
      expect(link.hasAttribute('target')).toBe(false);
      expect(link.getAttribute('rel') ?? '').not.toContain('noreferrer');
    }
    for (const link of doc.querySelectorAll('a[data-persona]')) expect(link.getAttribute('rel')).toContain('nofollow');
    expect(doc.querySelectorAll('form')).toHaveLength(0);
  });

  it('renders a hidden continue card per persona into /resume, with the reader script after them', async () => {
    deploy(DEPLOYED);
    const doc = await load({ start: 'demo' });
    const cards = [...doc.querySelectorAll<HTMLElement>('[data-continue]')];
    expect(cards.map((c) => [c.dataset.continue, c.hidden])).toEqual([
      ['employee', true],
      ['agent', true],
      ['admin', true],
    ]);
    expect(cards[1]!.querySelector('a')?.getAttribute('href')).toBe('https://desk.example.com/demo?persona=agent&demo=1&redirectTo=%2Fresume');
    expect(cards[1]!.textContent).toContain('Return to the Service Desk as Alex Morgan.');
    expect(cards[1]!.querySelector('button[type="button"][data-forget]')?.getAttribute('aria-label')).toBe('Forget the demo I was using');
    expect(cards.at(-1)!.nextElementSibling?.tagName).toBe('SCRIPT');
  });

  it('shows the demo notes and, while preparing or paused, the status banner', async () => {
    deploy(DEPLOYED, 'preparing');
    let doc = await load({ start: 'demo' });
    expect(doc.querySelector('.app-DemoNotes')?.textContent).toBe(
      "Demo data resets every day at 00:00 UK time · Shared with other visitors · Please don't enter real personal data.",
    );
    expect(doc.body.textContent).toContain('The demo is being prepared with fresh data.');
    deploy(DEPLOYED, 'paused');
    doc = await load({ start: 'demo' });
    expect(doc.body.textContent).toContain('The demo is paused for maintenance. Please try again shortly.');
    deploy(DEPLOYED, 'unknown');
    doc = await load({ start: 'demo' });
    expect(doc.querySelector('.app-Chooser__status')).toBeNull();
  });

  it('with DEMO_MODE off shows only the work account and never mentions a demo', async () => {
    deploy({ ...DEPLOYED, DEMO_MODE: 'off' });
    const doc = await load({ start: 'demo' });
    expect(doc.querySelector('h1')?.textContent).toBe('Sign in');
    expect(order(doc)).toEqual(['area']);
    expect(doc.querySelectorAll('[data-persona], [data-continue], script')).toHaveLength(0);
    expect(doc.body.textContent).not.toMatch(/demo/i);
    expect((await generateMetadata({ searchParams: Promise.resolve({ start: 'demo' }) })).title).toBe('Sign in');
  });

  it('says a part is unavailable instead of linking to an origin the deployment lacks', async () => {
    deploy({ ...DEPLOYED, WORKBENCH_ORIGIN: undefined });
    const doc = await load({ start: 'demo' });
    expect(doc.querySelector('a[href*="undefined"]')).toBeNull();
    expect(doc.querySelector('.app-PersonaCard[data-unavailable]')?.textContent).toContain("This part of the demo isn't available right now.");
    expect(doc.querySelector('.app-AreaRow[data-unavailable]')?.textContent).toContain("This part of the demo isn't available right now.");
    expect(doc.querySelector('[data-continue="agent"]')).toBeNull();
  });

  it('has the legal links and passes axe, demo first and work account first', async () => {
    deploy(DEPLOYED);
    for (const search of [{ start: 'demo' }, {}] as Record<string, string>[]) {
      const doc = await load(search);
      expect([...doc.querySelectorAll('nav[aria-label="Legal"] a')].map((a) => a.getAttribute('href'))).toEqual(['/privacy', '/cookies', '/terms']);
      expect(await violations()).toEqual([]);
    }
  });
});
