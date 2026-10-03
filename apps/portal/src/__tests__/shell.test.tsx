// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { act, forwardRef, type AnchorHTMLAttributes, type ReactNode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildAreaModel, type AreaModel } from '@itsm/contracts/areas';
import { DEMO_COPY } from '@itsm/contracts/demo';
import { ItsmProvider } from '@itsm/ui';
import { portalFrame, type PortalCan } from '../navigation.js';
import { cleanupDocument, click, render } from './support/render.js';

/**
 * The portal frame, rendered (SPEC §5.4, WP14 acceptance; v3 §3.6–§3.8): the
 * pills and the docked tab bar, Approvals kept out of both and put in the
 * avatar's count, *New request* only where the page does not have it, "How
 * can we help?" from anywhere, the session-ended and offline states — and the
 * v3 frame: the area lockup or switcher from the person's areas, the demo bar
 * first, and a demo visit's own words when it ends.
 */

/* ---- Next, as the frame sees it ---------------------------------------- */

let pathname = '/';
const router = { push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() };

vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('../app/AppLink.js', () => ({
  AppLink: forwardRef<HTMLAnchorElement, AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; prefetch?: unknown; replace?: unknown; scroll?: unknown }>(
    function AppLink({ prefetch, replace, scroll, ...props }, ref) {
      void [prefetch, replace, scroll];
      return <a ref={ref} {...props} />;
    },
  ),
}));

vi.mock('../client/api.js', () => ({
  api: {
    notifications: vi.fn(async () => ({ unread: 0, data: [] })),
    markNotificationRead: vi.fn(async () => ({ marked: 0 })),
    search: vi.fn(async () => ({ data: [], meta: { engine: 'meilisearch' } })),
    myTickets: vi.fn(async () => ({ data: [] })),
    catalogue: vi.fn(async () => ({ data: [] })),
  },
}));

// The real sheet is WP26's two-step flow; here, a stand-in that shows what it was asked for.
vi.mock('../help/HelpSheet.js', () => ({
  default: ({ open, request }: { open: boolean; request?: { step?: string; text?: string } }) =>
    open ? (
      <div role="dialog" aria-label="How can we help?">
        {request?.step ?? 'describe'}:{request?.text ?? ''}
      </div>
    ) : null,
}));

const { DEMO_SESSION_ENDED, PortalShell, signInHrefFor, useHelpFlow } = await import('../components/PortalShell.js');
const { reportSessionEnded } = await import('../client/useAction.js');

/* ---- A browser jsdom does not quite provide ----------------------------- */

beforeAll(() => {
  const scope = globalThis as Record<string, unknown>;
  class Observer {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): [] {
      return [];
    }
  }
  scope.ResizeObserver ??= Observer;
  scope.IntersectionObserver ??= Observer;
  Element.prototype.scrollIntoView ??= () => undefined;
});

function setViewport(width: number): void {
  vi.stubGlobal('matchMedia', (query: string) => {
    const conditions = [...query.matchAll(/\((min|max)-width:\s*([\d.]+)(rem|px)\)/g)];
    const matches =
      conditions.length > 0 &&
      conditions.every(([, kind, value, unit]) => {
        const px = Number(value) * (unit === 'rem' ? 16 : 1);
        return kind === 'min' ? width >= px : width <= px;
      });
    return { matches, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false };
  });
}

function setOnline(online: boolean): void {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
  act(() => {
    window.dispatchEvent(new Event(online ? 'online' : 'offline'));
  });
}

beforeEach(() => {
  pathname = '/';
  setViewport(1280);
  setOnline(true);
});

afterEach(() => {
  cleanupDocument();
  localStorage.clear();
  vi.unstubAllGlobals();
});

/* ---- Mounting ----------------------------------------------------------- */

const everyone: PortalCan = { readCatalogue: true, readKnowledge: true, readApprovals: true, createTickets: true, search: true };

const ORIGINS = { workbench: 'https://desk.example', admin: 'https://admin.example', site: 'https://itsm.example' };
/** A requester: the Help Portal alone, so a lockup. */
const requesterAreas = buildAreaModel({ app: 'portal', held: ['ticket.create', 'ticket.read'], session: { kind: 'oidc' }, origins: ORIGINS, workspace: 'Acme' });
/** A team lead: all three areas, so the switcher. */
const staffAreas = buildAreaModel({ app: 'portal', held: ['ticket.update', 'audit.read'], session: { kind: 'oidc' }, origins: ORIGINS, workspace: 'Acme' });
/** Emma Clarke's demo visit. */
const demoAreas = buildAreaModel({ app: 'portal', held: [], session: { kind: 'demo', persona: 'employee' }, origins: ORIGINS, workspace: 'Northwind Traders (UK)' });

function Link({ href, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }): ReactNode {
  return (
    <a href={href} {...rest}>
      {children}
    </a>
  );
}

function OpenHelp(): ReactNode {
  const help = useHelpFlow();
  return (
    <button type="button" onClick={() => help.open({ step: 'details', text: 'VPN keeps dropping' })}>
      Report it again
    </button>
  );
}

function mount({
  can = everyone,
  waiting = 0,
  page,
  areas = requesterAreas,
  systemBar,
}: { can?: PortalCan; waiting?: number; page?: ReactNode; areas?: AreaModel; systemBar?: ReactNode } = {}): void {
  render(
    <ItsmProvider
      app="portal"
      Link={Link}
      router={router}
      usePathname={() => pathname}
      useSearchParams={() => new URLSearchParams()}
      locale="en-GB"
      timeZone="Europe/London"
    >
      <PortalShell
        user={{ id: 'u1', name: 'Ada Lovelace', detail: 'Finance' }}
        areas={areas}
        areaKeywords={{ workbench: ['ticketing'] }}
        frame={portalFrame(can, waiting)}
        can={can}
        systemBar={systemBar}
        approvalsWaiting={waiting}
        renderedAt="2026-09-30T09:42:00Z"
      >
        <h1 tabIndex={-1}>Page</h1>
        {page}
      </PortalShell>
    </ItsmProvider>,
  );
}

async function settle(): Promise<void> {
  // Lazy chunks resolve on later ticks; a few turns of the loop let them land.
  for (let turn = 0; turn < 5; turn += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

/** Waits for a lazily loaded piece to draw (the first import of a module is slow under the test runner). */
async function until(condition: () => boolean, timeoutMs = 4000): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error('timed out waiting for the frame');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
}

function linksIn(label: string): HTMLAnchorElement[] {
  const nav = [...document.querySelectorAll('nav')].find((element) => element.getAttribute('aria-label') === label);
  if (!nav) throw new Error(`no navigation named ${label}`);
  return [...nav.querySelectorAll('a')];
}

/* ---- The tests ---------------------------------------------------------- */

describe('the pills and the tab bar', () => {
  it('draw Home, My requests, Services, Knowledge, with the current page marked once', () => {
    pathname = '/tickets/INC-000123';
    mount();
    const pills = linksIn('Main');
    expect(pills.map((link) => link.textContent)).toEqual(['Home', 'My requests', 'Services', 'Knowledge']);
    expect(pills.filter((link) => link.getAttribute('aria-current') === 'page').map((link) => link.textContent)).toEqual(['My requests']);
  });

  it('sit in the v3 top bar beside the product mark, which goes Home', () => {
    mount();
    const mark = document.querySelector<HTMLAnchorElement>('a.itsm-TopBar__brand')!;
    expect(mark.getAttribute('aria-label')).toBe('IT Service Management — Help Portal home');
    expect(mark.getAttribute('href')).toBe('/');
  });

  it('dock five tabs with Me last', () => {
    mount();
    expect(linksIn('Tab bar').map((link) => link.getAttribute('href'))).toEqual(['/', '/tickets', '/catalogue', '/knowledge', '/profile']);
  });

  it('never carry Approvals, even with decisions waiting; the avatar and Me carry the count', () => {
    mount({ waiting: 2 });
    for (const label of ['Main', 'Tab bar']) expect(linksIn(label).map((link) => link.getAttribute('href'))).not.toContain('/approvals');
    // The account button by its class: a person with more than one area also has the switcher's menu button (v3 §3.6).
    const avatar = document.querySelector('button.itsm-UserMenu')!;
    expect(avatar.textContent).toContain('2 approvals waiting');
    expect(linksIn('Tab bar').at(-1)!.textContent).toContain('2');
  });
});

describe('the areas (v3 §3.6, A2 §6.2)', () => {
  it('shows a requester the "Help Portal" lockup: nothing to press, no Switch area', () => {
    mount({ areas: requesterAreas });
    const lockup = document.querySelector('.itsm-TopBar .itsm-AreaSwitcher')!;
    expect(lockup.getAttribute('data-display')).toBe('lockup');
    expect(lockup.querySelector('.itsm-AreaSwitcher__name')?.textContent).toBe('Help Portal');
    expect(lockup.tagName).not.toBe('BUTTON');
    expect(document.querySelector('.itsm-TopBar button.itsm-AreaSwitcher')).toBeNull();
  });

  it('gives anyone with another area the visible switcher, named for where they are', () => {
    mount({ areas: staffAreas });
    const switcher = document.querySelector<HTMLButtonElement>('.itsm-TopBar button.itsm-AreaSwitcher')!;
    expect(switcher.getAttribute('aria-haspopup')).toBe('menu');
    expect(switcher.getAttribute('aria-label')).toBe('Switch area. Current: Help Portal');
    expect(switcher.textContent).toContain('Help Portal');
  });

  it('gives every demo visit the switcher too, Employee included (D7)', () => {
    mount({ areas: demoAreas });
    expect(document.querySelector('.itsm-TopBar button.itsm-AreaSwitcher')).not.toBeNull();
  });

  it('draws the demo bar first, straight after the skip links, above the top bar', () => {
    mount({ areas: demoAreas, systemBar: <div className="stub-DemoBar" role="region" aria-label="Demo environment" /> });
    const root = document.querySelector('.itsm-AppShell')!;
    const children = [...root.children];
    const bar = children.findIndex((child) => child.classList.contains('stub-DemoBar'));
    expect(bar).toBeGreaterThan(-1);
    expect(children.slice(0, bar).every((child) => child.matches('.itsm-SkipLinks, nav, [class*="SkipLink"]'))).toBe(true);
    expect(children.findIndex((child) => child.querySelector('.itsm-TopBar') !== null || child.classList.contains('itsm-TopBar'))).toBeGreaterThan(bar);
    expect(root.getAttribute('data-system-bar')).toBe('');
  });

  it('draws no bar, and leaves no trace of one, outside a demo visit', () => {
    mount({ areas: staffAreas });
    expect(document.querySelector('.itsm-AppShell')!.hasAttribute('data-system-bar')).toBe(false);
    expect(document.querySelector('.itsm-SystemBar')).toBeNull();
  });

  it('passes the frame only the v3 props (RV1: the wave-3 alias guard)', () => {
    const source = readFileSync(fileURLToPath(new URL('../components/PortalShell.tsx', import.meta.url)), 'utf8');
    expect(source).not.toMatch(/\bswitcher\b|sidebarHeaderExtra|tenantName|AppSwitcherItem/);
    const brand = /brand=\{\{([^}]*)\}\}/.exec(source)?.[1] ?? '';
    expect(brand).toContain('href');
    expect(brand).not.toMatch(/\b(name|tenant|app)\s*:/);
  });
});

describe('New request', () => {
  const newRequest = (): HTMLButtonElement | undefined => [...document.querySelectorAll('button')].find((button) => button.textContent === 'New request');

  it('is not in the top bar on Home or My requests, where the page has it', () => {
    for (const path of ['/', '/tickets']) {
      pathname = path;
      mount();
      expect(newRequest(), path).toBeUndefined();
      cleanupDocument();
    }
  });

  it('opens "How can we help?" everywhere else', async () => {
    pathname = '/knowledge';
    mount();
    click(newRequest()!);
    await settle();
    expect(document.querySelector('[role="dialog"][aria-label="How can we help?"]')?.textContent).toBe('describe:');
  });

  it('is not offered to somebody who cannot report anything', () => {
    pathname = '/knowledge';
    mount({ can: { ...everyone, createTickets: false } });
    expect(newRequest()).toBeUndefined();
  });
});

describe('the help flow from a page', () => {
  it('opens at the step and with the words the page asked for', async () => {
    pathname = '/tickets/INC-000123';
    mount({ page: <OpenHelp /> });
    click([...document.querySelectorAll('button')].find((button) => button.textContent === 'Report it again')!);
    await settle();
    expect(document.querySelector('[role="dialog"][aria-label="How can we help?"]')?.textContent).toBe('details:VPN keeps dropping');
  });

  it('goes to the cached report page instead when offline', () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign, pathname: '/tickets', search: '' });
    pathname = '/tickets/INC-000123';
    mount({ page: <OpenHelp /> });
    setOnline(false);
    click([...document.querySelectorAll('button')].find((button) => button.textContent === 'Report it again')!);
    expect(assign).toHaveBeenCalledWith('/report');
  });
});

describe('the frame’s states', () => {
  it('shows nothing about the connection while all is well', async () => {
    mount();
    await settle();
    expect(document.querySelector('.itsm-GlobalBanner')).toBeNull();
    expect(document.body.textContent).not.toContain('Session ended');
  });

  it('says when the session ended in the background, with Sign in again, and steals no focus', async () => {
    mount();
    await settle();
    const focused = document.activeElement;
    act(() => reportSessionEnded('background'));
    await until(() => document.body.textContent!.includes('Your session ended'));
    expect([...document.querySelectorAll('button')].some((button) => button.textContent === 'Sign in again')).toBe(true);
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(document.activeElement).toBe(focused);
  });

  it('asks straight away when something the person did found the session gone', async () => {
    mount();
    await settle();
    act(() => reportSessionEnded('action'));
    await until(() => document.querySelector('[role="alertdialog"]') !== null);
    await settle();
    const dialog = document.querySelector('[role="alertdialog"]');
    expect(dialog?.textContent).toContain('Your session ended');
    expect(document.activeElement?.textContent).toBe('Sign in again');
  });

  it('gives focus back to where the person was on Not now, and keeps saying so in the banner', async () => {
    mount({ page: <button type="button">Save reply</button> });
    await settle();
    const save = [...document.querySelectorAll('button')].find((button) => button.textContent === 'Save reply')!;
    save.focus();
    act(() => reportSessionEnded('action'));
    await until(() => document.querySelector('[role="alertdialog"]') !== null);
    await settle();
    click([...document.querySelectorAll('[role="alertdialog"] button')].find((button) => button.textContent === 'Not now')!);
    await settle();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(document.activeElement).toBe(save);
    await until(() => document.querySelector('.itsm-GlobalBanner') !== null);
    expect(document.querySelector('.itsm-GlobalBanner')?.textContent).toContain('Your session ended');
  });

  it('says a demo visit ended in the demo’s words, and continues the demo rather than signing in (§4.6.2, A3-S2)', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign, pathname: '/tickets/INC-000123', search: '?tab=details' });
    pathname = '/tickets/INC-000123';
    mount({ areas: demoAreas });
    await settle();
    act(() => reportSessionEnded('action'));
    await until(() => document.querySelector('[role="alertdialog"]') !== null);
    await settle();
    const dialog = document.querySelector('[role="alertdialog"]')!;
    expect(dialog.textContent).toContain('Your demo session ended');
    expect(dialog.textContent).toContain('Pick up where you left off');
    click([...dialog.querySelectorAll('button')].find((button) => button.textContent === 'Continue the demo')!);
    expect(assign).toHaveBeenCalledWith('/api/session/login?redirectTo=%2Ftickets%2FINC-000123%3Ftab%3Ddetails&demo=1');
  });

  it('words a demo visit’s ending exactly as the contract does', () => {
    expect(DEMO_SESSION_ENDED.title).toBe(DEMO_COPY.sessionEnded);
    expect(DEMO_SESSION_ENDED.action).toBe(DEMO_COPY.continueDemo);
    expect(signInHrefFor('/tickets?x=1', false)).toBe('/api/session/login?redirectTo=%2Ftickets%3Fx%3D1');
    expect(signInHrefFor('/tickets?x=1', true)).toBe('/api/session/login?redirectTo=%2Ftickets%3Fx%3D1&demo=1');
  });

  it('says a page shown offline is a copy, and from when', async () => {
    // A copy from today is named by its time alone, an older one by weekday as
    // well; pin "now" to the day the fixture was rendered so the sentence does
    // not change with the calendar. Only Date is faked: the waits stay real.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-30T12:00:00Z'));
    try {
      mount();
      await settle();
      setOnline(false);
      await until(() => document.body.textContent!.includes('You’re offline'));
      expect(document.body.textContent).toContain('This is the copy from 10:42');
    } finally {
      vi.useRealTimers();
    }
  });
});
