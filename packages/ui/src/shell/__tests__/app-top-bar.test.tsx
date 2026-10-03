// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestProvider } from '../../provider/__tests__/support/provider.js';
import { resetRecentsForTesting } from '../../provider/recents.js';
import { componentStylesheet } from '../../styles/index.js';
import { AppShell } from '../../web/AppShell.js';
import { expectNoViolations } from '../../web/__tests__/support/audit.js';
import { cleanupDocument, focus, press, render, settle } from '../../web/__tests__/support/render.js';
import { AppTopBar, ContextChip, contextChips, resolveBarTitle } from '../AppTopBar.js';
import type { NavModel } from '../nav.js';
import { PageHeader } from '../PageHeader.js';
import { resetShortcutsDialog } from '../shortcuts.js';
import { resetSidebarMemoryForTesting } from '../Sidebar.js';
import { adminAreas, adminNav, createLocation, demoAreas, setViewport, sidebarProps } from './support.js';

/**
 * The sidebar frame's top bar (A2 §15.1): the title contract — the nav
 * model's title and purpose in the server HTML, the page's once it publishes,
 * "‹ Rules" on a record page — the chips, search by column width, one banner
 * landmark, and the phone's compact area switcher (RV5).
 */

vi.mock('../../web/IconButtonTooltip.js', () => ({ IconButtonTooltip: () => null }));

beforeEach(() => {
  window.localStorage.clear();
  resetRecentsForTesting();
  resetSidebarMemoryForTesting();
});

afterEach(() => {
  cleanupDocument();
  resetShortcutsDialog();
  document.documentElement.removeAttribute('data-itsm-theme');
  vi.unstubAllGlobals();
});

const q = <T extends Element = HTMLElement>(selector: string): T | null => document.querySelector<T>(selector);
const all = (selector: string): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(selector)];

const nav: NavModel = {
  ...adminNav,
  sections: adminNav.sections.map((section) => ({
    ...section,
    items: section.items.map((item) => (item.id === 'rules' ? { ...item, description: 'Route and update tickets as they arrive' } : item)),
  })),
  routes: [{ pattern: '/incidents/[id]', title: 'My work', href: '/inbox/mine', purpose: 'Open tickets assigned to you, soonest due first' }],
};

function Framed({ path, children, ...overrides }: { readonly path: string; readonly children?: ReactNode } & Partial<Parameters<typeof AppShell>[0]>): ReactNode {
  const location = createLocation(path);
  return (
    <location.Provider>
      <AppShell {...sidebarProps({ nav, ...(overrides as object) })}>{children}</AppShell>
    </location.Provider>
  );
}

describe('the title contract', () => {
  it('puts the current nav item’s label and purpose in the server HTML', () => {
    const html = renderToString(
      <TestProvider usePathname={() => '/rules/vip-requester'}>
        <AppTopBar areas={adminAreas} nav={nav} />
      </TestProvider>,
    );
    expect(html).toMatch(/<span class="itsm-AppTopBar__title" title="Rules">Rules<\/span>/);
    expect(html).toContain('Route and update tickets as they arrive');
  });

  it('lets a published page title and purpose win once the page is hydrated', async () => {
    setViewport(1440);
    render(
      <Framed path="/rules">
        <PageHeader title="Automation rules" purpose="Everything that runs on its own" />
      </Framed>,
    );
    await settle();
    expect(q('.itsm-AppTopBar__title')?.textContent).toBe('Automation rules');
    expect(q('.itsm-AppTopBar__purpose')?.textContent).toBe('Everything that runs on its own');
  });

  it('shows "‹ Rules" back to the list on a record page, whose h1 stays visible', async () => {
    setViewport(1440);
    render(
      <Framed path="/rules/vip-requester">
        <PageHeader title="VIP requester" barTitle="section" />
      </Framed>,
    );
    await settle();
    const back = q<HTMLAnchorElement>('.itsm-AppTopBar__back')!;
    expect(back.getAttribute('href')).toBe('/rules');
    expect(back.textContent).toBe('Back to Rules');
    expect(q('.itsm-AppTopBar__purpose')?.textContent).toBe('Route and update tickets as they arrive');
    expect(q('main h1')!.className).not.toContain('itsm-visually-hidden');
  });

  it('titles a route under no nav item from the model’s routes, as a record of its section', () => {
    expect(resolveBarTitle({ nav, page: null, pathname: '/incidents/INC-000123', fallback: 'Service Desk' })).toEqual({
      mode: 'section',
      title: 'My work',
      back: { href: '/inbox/mine', label: 'My work' },
      purpose: 'Open tickets assigned to you, soonest due first',
    });
    // Under nothing at all: the area's name.
    expect(resolveBarTitle({ nav, page: null, pathname: '/nowhere', fallback: 'Administration' })).toEqual({ mode: 'page', title: 'Administration' });
    // A page's own back link serves a record page under no item and no route.
    expect(resolveBarTitle({ nav, page: { title: 'Run 42', barTitle: 'section', back: { href: '/runs', label: 'Runs' } }, pathname: '/x/42', fallback: 'Administration' })).toMatchObject({
      mode: 'section',
      back: { href: '/runs', label: 'Runs' },
    });
  });
});

describe('the chips', () => {
  it('shows at most two, the frame’s first', async () => {
    setViewport(1440);
    render(
      <Framed path="/rules" context={<ContextChip label="MI-0004 · VPN sign-in failures · Sev 2" compactLabel="MI-0004 · Sev 2" icon="siren" tone="danger" href="/tickets/INC-000004" />}>
        <PageHeader title="Rules" context={[<ContextChip key="a" label="Last 30 days" icon="calendar" />, <ContextChip key="b" label="Northern region" />]} />
      </Framed>,
    );
    await settle();
    const chips = all('.itsm-AppTopBar__chip');
    expect(chips.map((chip) => chip.querySelector('.itsm-ContextChip__label')?.textContent)).toEqual(['MI-0004 · VPN sign-in failures · Sev 2', 'Last 30 days']);
    expect(chips[0]!.querySelector('a')?.getAttribute('data-tone')).toBe('danger');
    expect(chips[0]!.querySelector('a')?.getAttribute('title')).toBe('MI-0004 · VPN sign-in failures · Sev 2');
    // The compact words are for the eye only; the full words stay the chip's name.
    expect(chips[0]!.querySelector('.itsm-ContextChip__compact')?.getAttribute('aria-hidden')).toBe('true');
    // The page's chips are in the bar, not repeated beside the hidden heading.
    expect(q('main .itsm-ContextChip')).toBeNull();
  });

  it('keeps frame chips first even without page chips', () => {
    expect(contextChips(<span key="f">frame</span>, null)).toHaveLength(1);
    expect(contextChips(null, null)).toEqual([]);
  });

  it('shows words at 1440 px, one chip’s words at 1280 px, icons at 1024 px and none below', () => {
    const sheet = componentStylesheet;
    expect(sheet).toMatch(/\.itsm-AppTopBar__chips \{\s*display: none;/);
    expect(sheet).toMatch(/@media \(min-width: 64rem\) \{[^@]*\.itsm-AppTopBar__chips \{\s*display: flex;/);
    expect(sheet).toMatch(/@media \(min-width: 80rem\) \{[^@]*\.itsm-AppTopBar__chip\[data-chip="1"\] \.itsm-ContextChip__compact \{\s*display: inline;/);
    expect(sheet).toMatch(/@media \(min-width: 90rem\) \{[^@]*\.itsm-AppTopBar__chip \.itsm-ContextChip\[data-icon\] \.itsm-ContextChip__label \{\s*position: static;/);
  });
});

describe('search, help and the account', () => {
  it('sizes the search field by its column: 236, 200 under 1200 px, the magnifier under 960 px', () => {
    const sheet = componentStylesheet;
    expect(sheet).toMatch(/\.itsm-SearchTrigger \{[^}]*inline-size: 14\.75rem;/);
    expect(sheet).toMatch(/@media \(min-width: 64rem\) \{\s*@container itsm-column \(max-width: 74\.9375rem\) \{\s*\.itsm-AppTopBar__search \{\s*inline-size: 12\.5rem;/);
    expect(sheet).toMatch(/@container itsm-column \(max-width: 59\.9375rem\) \{\s*\.itsm-AppTopBar__search \{[^}]*inline-size: calc\(var\(--itsm-control-height-md\) - var\(--itsm-space-3xs\)\);/);
    expect(sheet).toMatch(/\.itsm-AppShell__column \{[^}]*container-name: itsm-column itsm-page;/);
  });

  it('opens a Help menu loaded when wanted', async () => {
    setViewport(1440);
    render(<Framed path="/rules" help={{ items: [{ id: 'kb', label: 'Knowledge base · Help Portal', href: 'https://help.example/knowledge' }, { id: 'keys', label: 'Keyboard shortcuts…' }] }} />);
    const help = q<HTMLButtonElement>('.itsm-AppTopBar button[aria-label="Help"]')!;
    expect(help.getAttribute('aria-haspopup')).toBe('menu');
    focus(help);
    await act(async () => {
      await vi.dynamicImportSettled();
    });
    await settle();
    press(q('.itsm-AppTopBar button[aria-label="Help"]')!, 'Enter');
    await settle();
    expect(all('[role="menu"] [role="menuitem"]').map((item) => item.textContent)).toEqual(['Knowledge base · Help Portal', 'Keyboard shortcuts…']);
  });

  it('opens the account menu with the person’s areas first', async () => {
    setViewport(1440);
    render(<Framed path="/rules" />);
    const avatar = q<HTMLButtonElement>('.itsm-AppTopBar .itsm-UserMenu')!;
    focus(avatar);
    await act(async () => {
      await vi.dynamicImportSettled();
    });
    await settle();
    press(q('.itsm-AppTopBar .itsm-UserMenu')!, 'Enter');
    await settle();
    const group = q('[role="menu"] .itsm-UserMenu__areas')!;
    expect(group.getAttribute('role')).toBe('group');
    expect(document.getElementById(group.getAttribute('aria-labelledby')!)?.textContent).toBe('Switch area');
  });
});

describe('landmarks and phones', () => {
  it.each([1440, 390])('draws one banner landmark at %i px', (width) => {
    setViewport(width);
    render(<Framed path="/rules" />);
    expect(all('header.itsm-AppTopBar')).toHaveLength(1);
    expect(all('header').filter((header) => !header.closest('main'))).toHaveLength(1);
  });

  it('puts the compact area switcher before the title on a top-level page at 390 px', () => {
    setViewport(390);
    render(
      <Framed path="/rules">
        <PageHeader title="Rules" />
      </Framed>,
    );
    const area = q<HTMLButtonElement>('.itsm-AppTopBar button.itsm-AppTopBar__area')!;
    expect(area.getAttribute('aria-label')).toBe('Switch area. Current: Administration');
    expect(area.compareDocumentPosition(q('.itsm-AppTopBar__title')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Shown below 768 px only, as a 32 × 44 chevron.
    expect(componentStylesheet).toMatch(/\.itsm-AppTopBar \.itsm-AppTopBar__area \{\s*display: none;/);
    expect(componentStylesheet).toMatch(/@media \(max-width: 47\.9375rem\) \{\s*\.itsm-AppTopBar \.itsm-AppTopBar__area \{\s*display: inline-flex;/);
    expect(componentStylesheet).toMatch(/button\.itsm-AreaSwitcher\.itsm-AppTopBar__area \{[^}]*inline-size: 2rem;[^}]*block-size: var\(--itsm-control-height-lg\);/);
  });

  it('leaves the compact switcher out on a record page, which keeps "‹ back"', async () => {
    setViewport(390);
    render(
      <Framed path="/rules/vip">
        <PageHeader title="VIP requester" barTitle="section" />
      </Framed>,
    );
    await settle();
    expect(q('.itsm-AppTopBar__area')).toBeNull();
    expect(q('.itsm-AppTopBar__back')).not.toBeNull();
  });

  it('leaves it out for a person with one area', async () => {
    setViewport(390);
    const { requesterAreas } = await import('./support.js');
    render(<Framed path="/rules" areas={{ ...requesterAreas, current: 'admin', areas: [{ ...requesterAreas.areas[0]!, id: 'admin', name: 'Administration', current: true }] }} />);
    expect(q('.itsm-AppTopBar__area')).toBeNull();
  });
});

describe('the top bar passes axe', () => {
  it.each(['apple', 'apple-dark'])('in the %s theme, at 1440 and 390 px, with chips', async (theme) => {
    document.documentElement.setAttribute('data-itsm-theme', theme);
    for (const width of [1440, 390]) {
      setViewport(width);
      render(
        <Framed path="/rules" areas={demoAreas('admin')} context={<ContextChip label="MI-0004 · VPN sign-in failures · Sev 2" icon="siren" tone="danger" href="/tickets/INC-000004" />}>
          <PageHeader title="Rules" context={<ContextChip label="Last 30 days" icon="calendar" />} />
        </Framed>,
      );
      await settle();
      await expectNoViolations();
      cleanupDocument();
    }
  });
});
