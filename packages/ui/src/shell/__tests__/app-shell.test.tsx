// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetRecentsForTesting } from '../../provider/recents.js';
import { componentStylesheet } from '../../styles/index.js';
import { AppShell } from '../../web/AppShell.js';
import { activeElement, cleanupDocument, click, focus, press, render, settle } from '../../web/__tests__/support/render.js';
import { PageHeader } from '../PageHeader.js';
import { resetShortcutsDialog } from '../shortcuts.js';
import { resetSidebarMemoryForTesting } from '../Sidebar.js';
import { createLocation, setViewport, sidebarProps, topnavProps } from './support.js';

vi.mock('../../web/IconButtonTooltip.js', () => ({ IconButtonTooltip: () => null }));

beforeEach(() => {
  window.localStorage.clear();
  resetRecentsForTesting();
  resetSidebarMemoryForTesting();
  document.documentElement.removeAttribute('data-itsm-nav');
});

afterEach(() => {
  cleanupDocument();
  resetShortcutsDialog();
  vi.unstubAllGlobals();
});

const q = <T extends Element = HTMLElement>(selector: string): T | null => document.querySelector<T>(selector);
const all = (selector: string): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(selector)];

function Framed({ location, children, props }: { readonly location: ReturnType<typeof createLocation>; readonly children?: ReactNode; readonly props: Parameters<typeof AppShell>[0] }): ReactNode {
  return (
    <location.Provider>
      <AppShell {...props}>{children}</AppShell>
    </location.Provider>
  );
}

describe('AppShell, sidebar variant', () => {
  it('draws the landmarks in order: skip link first, banner, navigation, main', () => {
    setViewport(1440);
    const location = createLocation('/rules');
    render(<Framed location={location} props={sidebarProps()}><PageHeader title="Rules" /></Framed>);

    const focusables = all('a[href], button, input, [tabindex]:not([tabindex="-1"])');
    expect(focusables[0]?.textContent).toBe('Skip to content');
    expect(focusables[0]?.getAttribute('href')).toBe('#main-content');

    expect(all('header.itsm-TopBar')).toHaveLength(1);
    expect(q('nav[aria-label="Administration"]')).not.toBeNull();
    const main = q('main')!;
    expect(main.id).toBe('main-content');
    expect(main.getAttribute('tabindex')).toBe('-1');
    expect(main.querySelectorAll('h1')).toHaveLength(1);
    // Nothing announces itself before the page content (SPEC §4.9).
    const status = q('[role="status"]');
    expect(status === null || Boolean(main.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  });

  it('marks the one current page with aria-current, most specific match first', () => {
    setViewport(1440);
    const location = createLocation('/cmdb/assets');
    render(<Framed location={location} props={sidebarProps()} />);
    const current = all('.itsm-Sidebar [aria-current="page"]');
    expect(current.map((element) => element.textContent)).toEqual(['Assets']);
    // The collapsed-by-default CMDB section opens because it holds the current page.
    expect(current[0]!.closest('ul')!.hasAttribute('data-collapsed')).toBe(false);
  });

  it('names counts with the link: "Rules, 3 drafts", capping at 99+', () => {
    setViewport(1440);
    render(<Framed location={createLocation('/')} props={sidebarProps()} />);
    const rules = all('.itsm-Sidebar__item').find((link) => link.getAttribute('href') === '/rules')!;
    expect(rules.textContent).toBe('Rules3, 3 drafts');
    const workflows = all('.itsm-Sidebar__item').find((link) => link.getAttribute('href') === '/workflows')!;
    expect(workflows.querySelector('.itsm-NavBadge__count')?.textContent).toBe('99+');
    expect(workflows.querySelector('.itsm-NavBadge')?.getAttribute('data-tone')).toBe('danger');
  });

  it('collapses a section with its heading button and remembers it on this device', () => {
    setViewport(1440);
    const view = render(<Framed location={createLocation('/')} props={sidebarProps()} />);
    const toggle = all('.itsm-Sidebar__sectionToggle').find((button) => button.textContent === 'Automation')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const list = document.getElementById(toggle.getAttribute('aria-controls')!)!;
    expect(list.getAttribute('aria-labelledby')).toBe(toggle.id);

    click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(list.hasAttribute('data-collapsed')).toBe(true);
    expect(JSON.parse(window.localStorage.getItem('itsm-nav-collapsed:admin')!)).toEqual({ automation: true });

    view.unmount();
    resetSidebarMemoryForTesting();
    render(<Framed location={createLocation('/')} props={sidebarProps()} />);
    const again = all('.itsm-Sidebar__sectionToggle').find((button) => button.textContent === 'Automation')!;
    expect(again.getAttribute('aria-expanded')).toBe('false');
  });

  it('shows Pinned and Recent from this device, and unpins', () => {
    setViewport(1440);
    window.localStorage.setItem('itsm-pins:admin', JSON.stringify([{ id: 'rule:vip', label: 'VIP requester', href: '/rules/vip', kind: 'rule' }]));
    window.localStorage.setItem(
      'itsm-recents:admin',
      JSON.stringify([
        { id: 'rule:vip', label: 'VIP requester', href: '/rules/vip', kind: 'rule' },
        { id: 'wf:onboard', label: 'Onboarding', href: '/workflows/onboard', kind: 'workflow' },
      ]),
    );
    render(<Framed location={createLocation('/')} props={sidebarProps()} />);
    const labels = all('.itsm-Sidebar__sectionLabel').map((label) => label.textContent);
    expect(labels.slice(0, 2)).toEqual(['Pinned', 'Recent']);
    // A pinned item is not listed again under Recent.
    const recent = document.getElementById(all('.itsm-Sidebar__sectionLabel')[1]!.id)!.nextElementSibling!;
    expect(recent.textContent).toBe('Onboarding');

    click(q('button[aria-label="Unpin VIP requester"]')!);
    expect(all('.itsm-Sidebar__sectionLabel').map((label) => label.textContent)).not.toContain('Pinned');
  });

  it('collapses to the rail with [ at 1280 px and up, remembered as prefs.nav', async () => {
    setViewport(1440);
    render(<Framed location={createLocation('/')} props={sidebarProps()} />);
    await settle();
    const toggle = q('.itsm-Sidebar__toggle')!;
    expect(toggle.getAttribute('aria-label')).toBe('Collapse sidebar');
    expect(toggle.getAttribute('aria-keyshortcuts')).toBe('[');

    press(document.body, '[');
    expect(document.documentElement.getAttribute('data-itsm-nav')).toBe('rail');
    expect(JSON.parse(window.localStorage.getItem('itsm-prefs')!)).toMatchObject({ nav: 'rail' });
    expect(q('.itsm-Sidebar__toggle')!.getAttribute('aria-label')).toBe('Expand sidebar');

    click(q('.itsm-Sidebar__toggle')!);
    expect(document.documentElement.hasAttribute('data-itsm-nav')).toBe(false);
  });

  it('leaves [ alone while typing', async () => {
    setViewport(1440);
    render(
      <Framed location={createLocation('/')} props={sidebarProps()}>
        <input aria-label="Name" id="name" />
      </Framed>,
    );
    await settle();
    const input = document.getElementById('name')!;
    focus(input);
    press(input, '[');
    expect(document.documentElement.hasAttribute('data-itsm-nav')).toBe(false);
  });

  it('below 1280 px, [ shows the whole sidebar as a sheet instead, which closes on navigation', async () => {
    setViewport(1024);
    const location = createLocation('/rules');
    render(<Framed location={location} props={sidebarProps()} />);
    await settle();
    expect(q('.itsm-Sidebar__toggle')!.getAttribute('aria-label')).toBe('Show full navigation');

    press(document.body, '[');
    await act(async () => {
      await vi.dynamicImportSettled();
    });
    await settle();
    const sheet = q('[role="dialog"]')!;
    expect(sheet).not.toBeNull();
    expect(sheet.textContent).toContain('Administration');
    expect(document.documentElement.hasAttribute('data-itsm-nav')).toBe(false);
    expect(all('.itsm-Sidebar[data-mode="sheet"] [aria-current="page"]').map((link) => link.textContent)).toEqual(['Rules3, 3 drafts']);

    act(() => location.go('/workflows'));
    await settle();
    expect(q('[role="dialog"]')).toBeNull();
  });

  it('below 1024 px, ☰ in the compact bar opens the navigation sheet and focus returns to it', async () => {
    setViewport(390);
    render(
      <Framed location={createLocation('/rules')} props={sidebarProps()}>
        <PageHeader title="Rules" />
      </Framed>,
    );
    await settle();
    const bar = q('.itsm-AppShell__compactBar')!;
    // The page's title, published by PageHeader.
    expect(bar.querySelector('.itsm-TopBar__title')?.textContent).toBe('Rules');
    const menu = bar.querySelector<HTMLButtonElement>('button[aria-label="Open navigation"]')!;
    expect(menu.getAttribute('aria-haspopup')).toBe('dialog');

    focus(menu);
    click(menu);
    await act(async () => {
      await vi.dynamicImportSettled();
    });
    await settle();
    expect(menu.getAttribute('aria-expanded')).toBe('true');
    const sheet = q('[role="dialog"]')!;
    expect(sheet.querySelector('nav[aria-label="Administration"]')).not.toBeNull();
    // The sheet lists the other apps as links.
    expect([...sheet.querySelectorAll('a')].some((link) => link.textContent === 'Workbench')).toBe(true);

    press(activeElement()!, 'Escape');
    await settle();
    expect(q('[role="dialog"]')).toBeNull();
    expect(activeElement()).toBe(menu);
  });

  it('binds ⌘K (Ctrl K) to onOpenSearch, inside text fields too', async () => {
    setViewport(1440);
    const onOpenSearch = vi.fn();
    render(
      <Framed location={createLocation('/')} props={sidebarProps({ onOpenSearch })}>
        <input aria-label="Name" id="name" />
      </Framed>,
    );
    await settle();
    const input = document.getElementById('name')!;
    focus(input);
    press(input, 'k', { ctrlKey: true });
    expect(onOpenSearch).toHaveBeenCalledTimes(1);

    click(q('.itsm-Sidebar .itsm-SearchTrigger')!);
    expect(onOpenSearch).toHaveBeenCalledTimes(2);
  });

  it('opens the keyboard shortcuts with ?, listing what is bound', async () => {
    setViewport(1440);
    render(<Framed location={createLocation('/')} props={sidebarProps()} />);
    await settle();
    press(document.body, '?');
    await act(async () => {
      await vi.dynamicImportSettled();
    });
    await settle();
    const dialog = q('[role="dialog"]')!;
    expect(dialog.textContent).toContain('Keyboard shortcuts');
    expect(dialog.textContent).toContain('Collapse or expand the sidebar');
    expect(dialog.textContent).toContain('Search and commands');
  });

  it('offers the other apps from the brand, as a menu loaded when wanted', async () => {
    setViewport(1440);
    render(<Framed location={createLocation('/')} props={sidebarProps()} />);
    const brand = q<HTMLButtonElement>('button.itsm-Sidebar__brand')!;
    expect(brand.getAttribute('aria-haspopup')).toBe('menu');
    expect(brand.textContent).toContain('Administration');
    expect(brand.textContent).toContain('Acme');
    focus(brand);
    await act(async () => {
      await vi.dynamicImportSettled();
    });
    await settle();
    press(q('button.itsm-Sidebar__brand')!, 'Enter');
    await settle();
    const items = all('[role="menu"] [role="menuitem"]');
    expect(items.map((item) => item.textContent)).toEqual(['Workbench']);
    expect(items[0]!.getAttribute('href')).toBe('https://desk.example/inbox');
  });

  it('renders one sign-out form for the page, outside every menu, that the account menus submit', () => {
    setViewport(1440);
    render(<Framed location={createLocation('/')} props={sidebarProps()} />);
    const forms = all('form#itsm-signout');
    expect(forms).toHaveLength(1);
    expect(forms[0]!.getAttribute('method')).toBe('post');
    expect(forms[0]!.getAttribute('action')).toBe('/api/session/logout');
    // Two account buttons (sidebar footer and compact bar), one form.
    expect(all('.itsm-UserMenu')).toHaveLength(2);
  });
});

describe('AppShell, top-nav variant (portal)', () => {
  it('draws the top bar with centred pills, the current one marked, and a docked tab bar', () => {
    setViewport(1440);
    render(<Framed location={createLocation('/tickets/42')} props={topnavProps()} />);
    const pills = q('nav[aria-label="Help portal"]')!;
    expect(pills.closest('header')).not.toBeNull();
    expect(all('nav[aria-label="Help portal"] [aria-current="page"]').map((link) => link.textContent)).toEqual(['My requests']);

    const tabs = q('nav[aria-label="Tab bar"]')!;
    expect(tabs.closest('.itsm-BottomDock')).not.toBeNull();
    expect(tabs.querySelectorAll('a')).toHaveLength(5);
    expect(tabs.querySelector('[aria-current="page"]')?.textContent).toBe('Requests');
    const me = [...tabs.querySelectorAll('a')].find((link) => link.getAttribute('href') === '/profile')!;
    expect(me.textContent).toContain('2 approvals waiting');
    // The dock comes after main, so the tab bar never precedes the content.
    expect(q('main')!.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('puts ‹ Back and the title in the compact bar on inner pages', () => {
    setViewport(390);
    render(
      <Framed location={createLocation('/tickets/42')} props={topnavProps()}>
        <PageHeader title="Printer jammed" back={{ href: '/tickets', label: 'My requests' }} />
      </Framed>,
    );
    const shell = q('.itsm-AppShell')!;
    expect(shell.hasAttribute('data-has-back')).toBe(true);
    const back = q<HTMLAnchorElement>('.itsm-AppShell__back')!;
    expect(back.getAttribute('href')).toBe('/tickets');
    expect(back.textContent).toBe('My requests');
    expect(q('.itsm-TopBar__title')?.textContent).toBe('Printer jammed');
  });

  it('shows the account badge in the avatar button’s name', () => {
    setViewport(1440);
    render(<Framed location={createLocation('/')} props={topnavProps()} />);
    const account = q('.itsm-UserMenu')!;
    expect(account.getAttribute('aria-haspopup')).toBe('menu');
    expect(account.textContent).toContain('Ada Lovelace');
    expect(account.textContent).toContain('2 approvals waiting');
  });
});

describe('AppShell at 390, 768, 1024, 1280 and 1440 px', () => {
  /*
   * jsdom has no layout, so the widths are checked where they are decided:
   * the DOM (identical at every width — CSS alone moves between full
   * sidebar, rail and sheet, so server and client always agree), the media
   * rules that do the moving, and the few behaviours script decides by width.
   */
  const widths = [390, 768, 1024, 1280, 1440] as const;

  it.each(widths)('renders the same landmarks at %i px', (width) => {
    setViewport(width);
    render(<Framed location={createLocation('/rules')} props={sidebarProps()}><PageHeader title="Rules" /></Framed>);
    expect(all('header')).toHaveLength(2); // the compact bar, and PageHeader's header inside main
    expect(all('main')).toHaveLength(1);
    expect(all('nav[aria-label="Administration"]')).toHaveLength(1);
    expect(q('.itsm-AppShell')!.getAttribute('data-variant')).toBe('sidebar');
  });

  it.each([
    [390, 'Show full navigation'],
    [768, 'Show full navigation'],
    [1024, 'Show full navigation'],
    [1280, 'Collapse sidebar'],
    [1440, 'Collapse sidebar'],
  ] as const)('at %i px the PanelLeft button reads "%s"', async (width, label) => {
    setViewport(width);
    render(<Framed location={createLocation('/')} props={sidebarProps()} />);
    await settle();
    expect(q('.itsm-Sidebar__toggle')!.getAttribute('aria-label')).toBe(label);
  });

  it('moves between compact bar, rail and full sidebar with viewport rules only', () => {
    const sheet = componentStylesheet;
    // Below 1024: no sidebar column; the compact bar shows.
    expect(sheet).toMatch(/\.itsm-AppShell\[data-variant="sidebar"\] > \.itsm-AppShell__sidebar \{\s*display: none;/);
    // 1024 and up: the sidebar column, the rail width, the compact bar hidden.
    expect(sheet).toMatch(/@media \(min-width: 64rem\) \{\s*\.itsm-AppShell\[data-variant="sidebar"\] \{\s*--_sidebar-w: var\(--itsm-sidebar-rail\);/);
    // 1280 and up: the full width, unless the person collapsed it.
    expect(sheet).toMatch(/@media \(min-width: 80rem\) \{\s*:root:not\(\[data-itsm-nav="rail"\]\) \.itsm-AppShell\[data-variant="sidebar"\] \{\s*--_sidebar-w: var\(--itsm-sidebar-width\);/);
    // The rail look applies in the 1024–1279 band and when collapsed at 1280+.
    expect(sheet).toMatch(/@media \(min-width: 64rem\) \{\s*@media \(max-width: 79\.9375rem\) \{\s*\.itsm-Sidebar\[data-mode="docked"\] \{\s*--_rail: 1;/);
    expect(sheet).toContain(':root[data-itsm-nav="rail"] .itsm-Sidebar[data-mode="docked"] {\n  --_rail: 1;');
    // The portal: pills from 768, the tab bar below it.
    expect(sheet).toMatch(/@media \(min-width: 48rem\) \{\s*\.itsm-AppShell__pills \{\s*display: block;/);
    expect(sheet).toMatch(/@media \(min-width: 48rem\) \{\s*\.itsm-TabBar \{\s*display: none;/);
  });
});

describe('AppShell without a variant (deprecated)', () => {
  it('still draws the pre-redesign frame for the apps that have not moved', () => {
    render(
      <AppShell brand={<strong>Administration</strong>} navItems={[{ id: 'rules', label: 'Rules', href: '/rules', current: true }]} navLabel="Administration">
        <p>Body</p>
      </AppShell>,
    );
    expect(q('.itsm-AppShell--legacy')).not.toBeNull();
    expect(q('.itsm-AppShell__skipLink')?.textContent).toBe('Skip to main content');
    expect(q('nav[aria-label="Administration"] [aria-current="page"]')?.textContent).toBe('Rules');
    expect(q('header[role="banner"] button[aria-label="Show navigation"]')).not.toBeNull();
  });
});
