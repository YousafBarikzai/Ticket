// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetRecentsForTesting } from '../../provider/recents.js';
import { componentStylesheet } from '../../styles/index.js';
import { AppShell, setNavigationSheetOpen } from '../../web/AppShell.js';
import { activeElement, cleanupDocument, click, focus, press, render, settle } from '../../web/__tests__/support/render.js';
import { resetAreaHopForTesting } from '../AreaMenuPanel.js';
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
  resetAreaHopForTesting();
  act(() => setNavigationSheetOpen(false));
  vi.unstubAllGlobals();
});

const q = <T extends Element = HTMLElement>(selector: string): T | null => document.querySelector<T>(selector);
const all = (selector: string): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(selector)];

async function loaded(): Promise<void> {
  await act(async () => {
    await vi.dynamicImportSettled();
  });
  await settle();
}

function Framed({ location, children, props }: { readonly location: ReturnType<typeof createLocation>; readonly children?: ReactNode; readonly props: Parameters<typeof AppShell>[0] }): ReactNode {
  return (
    <location.Provider>
      <AppShell {...props}>{children}</AppShell>
    </location.Provider>
  );
}

describe('AppShell, sidebar variant', () => {
  it('draws the landmarks in order: skip link first, the top bar as the one banner, navigation, main', () => {
    setViewport(1440);
    const location = createLocation('/rules');
    render(<Framed location={location} props={sidebarProps()}><PageHeader title="Rules" /></Framed>);

    const focusables = all('a[href], button, input, [tabindex]:not([tabindex="-1"])');
    expect(focusables[0]?.textContent).toBe('Skip to content');
    expect(focusables[0]?.getAttribute('href')).toBe('#main-content');

    // One top bar at every width (D7): the v2 compact bar is gone.
    expect(all('header.itsm-AppTopBar')).toHaveLength(1);
    expect(all('header.itsm-TopBar')).toHaveLength(0);
    expect(q('nav[aria-label="Administration"]')).not.toBeNull();
    const main = q('main')!;
    expect(main.id).toBe('main-content');
    expect(main.getAttribute('tabindex')).toBe('-1');
    expect(main.querySelectorAll('h1')).toHaveLength(1);
    // Nothing announces itself before the page content (SPEC §4.9).
    const status = q('[role="status"]');
    expect(status === null || Boolean(main.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  });

  it('puts the system bar first after the skip links, and the notice slot after main', () => {
    setViewport(1440);
    render(
      <Framed location={createLocation('/rules')} props={sidebarProps({ systemBar: <div role="region" aria-label="Demo environment" className="itsm-SystemBar" /> })}>
        <p>Page</p>
      </Framed>,
    );
    const root = q('.itsm-AppShell')!;
    expect(root.hasAttribute('data-system-bar')).toBe(true);
    const children = [...root.children];
    const bar = q('[aria-label="Demo environment"]')!;
    expect(children.indexOf(bar)).toBe(children.indexOf(q('.itsm-SkipLinks')!) + 1);
    const notice = document.getElementById('itsm-system-notice')!;
    expect(notice.parentElement).toBe(root);
    expect(q('main')!.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(q('main')!.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });

  it('shows the page title in the top bar and keeps the h1 in main as a visually hidden focus target', () => {
    setViewport(1440);
    render(
      <Framed location={createLocation('/rules')} props={sidebarProps()}>
        <PageHeader title="Rules" purpose="Route tickets as they arrive" />
      </Framed>,
    );
    expect(q('.itsm-AppTopBar__title')?.textContent).toBe('Rules');
    expect(q('.itsm-AppTopBar__purpose')?.textContent).toBe('Route tickets as they arrive');
    const h1 = q('main h1')!;
    expect(h1.textContent).toBe('Rules');
    expect(h1.className).toContain('itsm-visually-hidden-focusable');
    expect(h1.getAttribute('tabindex')).toBe('-1');
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

  it('names counts with the link: "Rules, 3 drafts", capping at 99+, and keeps a rail badge for danger counts only', () => {
    setViewport(1440);
    render(<Framed location={createLocation('/')} props={sidebarProps()} />);
    const rules = all('.itsm-Sidebar__item').find((link) => link.getAttribute('href') === '/rules')!;
    expect(rules.textContent).toBe('Rules3, 3 drafts');
    expect(rules.querySelector('.itsm-Sidebar__railCount')).toBeNull();
    const workflows = all('.itsm-Sidebar__item').find((link) => link.getAttribute('href') === '/workflows')!;
    expect(workflows.querySelector('.itsm-NavBadge__count')?.textContent).toBe('99+');
    expect(workflows.querySelector('.itsm-NavBadge')?.getAttribute('data-tone')).toBe('danger');
    const rail = workflows.querySelector('.itsm-Sidebar__railCount')!;
    expect(rail.textContent).toBe('9+');
    expect(rail.getAttribute('aria-hidden')).toBe('true');
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

  it('shows Pinned and Recent from this device after the sections, and unpins', () => {
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
    const labels = all('.itsm-Sidebar[data-mode="docked"] .itsm-Sidebar__sectionLabel').map((label) => label.textContent);
    // The primary sections keep their places; this device's lists follow them (A2 §5.3.4).
    expect(labels).toEqual(['Service desk', 'Automation', 'CMDB', 'Pinned', 'Recent']);
    // A pinned item is not listed again under Recent.
    const recentLabel = all('.itsm-Sidebar__sectionLabel').find((label) => label.textContent === 'Recent')!;
    expect(recentLabel.nextElementSibling!.textContent).toBe('Onboarding');

    click(q('button[aria-label="Unpin VIP requester"]')!);
    expect(all('.itsm-Sidebar__sectionLabel').map((label) => label.textContent)).not.toContain('Pinned');
  });

  it('collapses to the rail with [ or the foot’s Collapse at 1280 px and up, remembered as prefs.nav', async () => {
    setViewport(1440);
    render(<Framed location={createLocation('/')} props={sidebarProps()} />);
    await settle();
    const collapse = q('.itsm-Sidebar__collapse')!;
    expect(collapse.textContent).toBe('Collapse');
    expect(collapse.getAttribute('aria-keyshortcuts')).toBe('[');
    expect(collapse.closest('.itsm-Sidebar__foot')).not.toBeNull();

    press(document.body, '[');
    expect(document.documentElement.getAttribute('data-itsm-nav')).toBe('rail');
    expect(JSON.parse(window.localStorage.getItem('itsm-prefs')!)).toMatchObject({ nav: 'rail' });
    expect(q('.itsm-Sidebar__collapse')!.textContent).toBe('Expand sidebar');

    click(q('.itsm-Sidebar__collapse')!);
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
    expect(q('.itsm-Sidebar__collapse')!.textContent).toBe('Show full navigation');

    press(document.body, '[');
    await loaded();
    const sheet = q('[role="dialog"]')!;
    expect(sheet).not.toBeNull();
    expect(sheet.textContent).toContain('IT Service Management');
    expect(document.documentElement.hasAttribute('data-itsm-nav')).toBe(false);
    expect(all('.itsm-Sidebar[data-mode="sheet"] [aria-current="page"]').map((link) => link.textContent)).toEqual(['Rules3, 3 drafts']);

    act(() => location.go('/workflows'));
    await settle();
    expect(q('[role="dialog"]')).toBeNull();
  });

  it('below 1024 px, ☰ in the top bar opens the navigation sheet with the areas, and focus returns to it', async () => {
    setViewport(390);
    render(
      <Framed location={createLocation('/rules')} props={sidebarProps()}>
        <PageHeader title="Rules" />
      </Framed>,
    );
    await settle();
    const bar = q('.itsm-AppTopBar')!;
    expect(bar.querySelector('.itsm-AppTopBar__title')?.textContent).toBe('Rules');
    const menu = bar.querySelector<HTMLButtonElement>('button[aria-label="Open navigation"]')!;
    expect(menu.getAttribute('aria-haspopup')).toBe('dialog');

    focus(menu);
    click(menu);
    await loaded();
    expect(menu.getAttribute('aria-expanded')).toBe('true');
    expect(menu.getAttribute('aria-controls')).toBe('itsm-nav-sheet');
    const sheet = q('[role="dialog"]')!;
    expect(sheet.querySelector('#itsm-nav-sheet')).not.toBeNull();
    expect(sheet.querySelector('nav[aria-label="Administration"]')).not.toBeNull();
    // The sheet lists the areas as plain links, the current one checked.
    const rows = [...sheet.querySelectorAll<HTMLAnchorElement>('.itsm-AreaList__row')];
    expect(rows.map((row) => row.querySelector('.itsm-AreaList__name')!.firstChild!.textContent)).toEqual(['Help Portal', 'Service Desk', 'Administration']);
    expect(rows.find((row) => row.getAttribute('aria-current') === 'true')?.textContent).toContain('Administration');
    expect(rows[1]!.getAttribute('href')).toBe('https://desk.example/resume');

    press(activeElement()!, 'Escape');
    await settle();
    expect(q('[role="dialog"]')).toBeNull();
    expect(activeElement()).toBe(menu);
  });

  it('opens the sheet for the More tab of a phone tab bar, which shows it is open', async () => {
    setViewport(390);
    const more = { id: 'more', label: 'More', icon: 'menu' as const, haspopup: 'dialog' as const, controls: 'itsm-nav-sheet', onSelect: () => setNavigationSheetOpen(true) };
    render(<Framed location={createLocation('/rules')} props={sidebarProps({ bottomTabs: [{ id: 'home', label: 'Overview', href: '/', icon: 'home' }, more] })} />);
    const tabs = q('nav[aria-label="Tab bar"]')!;
    const button = tabs.querySelector<HTMLButtonElement>('button')!;
    expect(button.textContent).toBe('More');
    expect(button.getAttribute('aria-haspopup')).toBe('dialog');
    click(button);
    await loaded();
    expect(q('[role="dialog"] #itsm-nav-sheet')).not.toBeNull();
    // The Service Desk's own Search tab: the top bar drops its search below 768 px.
    expect(q('.itsm-AppTopBar')!.hasAttribute('data-tab-search')).toBe(true);
  });

  it('binds ⌘K (Ctrl K) to onOpenSearch, inside text fields too, and puts search in the top bar', async () => {
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

    expect(q('.itsm-Sidebar .itsm-SearchTrigger')).toBeNull();
    click(q('.itsm-AppTopBar .itsm-SearchTrigger')!);
    expect(onOpenSearch).toHaveBeenCalledTimes(2);
  });

  it('opens the keyboard shortcuts with ?, listing what is bound', async () => {
    setViewport(1440);
    render(<Framed location={createLocation('/')} props={sidebarProps()} />);
    await settle();
    press(document.body, '?');
    await loaded();
    const dialog = q('[role="dialog"]')!;
    expect(dialog.textContent).toContain('Keyboard shortcuts');
    expect(dialog.textContent).toContain('Collapse or expand the sidebar');
    expect(dialog.textContent).toContain('Search and commands');
  });

  it('offers the other areas from the Area card, as a menu loaded when wanted; the brand is a link home', async () => {
    setViewport(1440);
    render(<Framed location={createLocation('/')} props={sidebarProps()} />);
    const home = q<HTMLAnchorElement>('a.itsm-Sidebar__home')!;
    expect(home.getAttribute('href')).toBe('/');
    expect(home.getAttribute('aria-label')).toBe('IT Service Management — Administration home');
    expect(home.textContent).toContain('Acme');

    const card = q<HTMLButtonElement>('.itsm-Sidebar button.itsm-AreaSwitcher')!;
    expect(card.getAttribute('aria-haspopup')).toBe('menu');
    expect(card.getAttribute('aria-label')).toBe('Switch area. Current: Administration');
    expect(card.getAttribute('data-display')).toBe('card');
    focus(card);
    await loaded();
    press(q('.itsm-Sidebar button.itsm-AreaSwitcher')!, 'Enter');
    await settle();
    const items = all('[role="menu"] [role="menuitem"]');
    expect(items.map((item) => item.querySelector('.itsm-Menu__itemLabel')!.firstChild!.textContent)).toEqual(['Help Portal', 'Service Desk', 'Administration']);
    expect(items[2]!.getAttribute('aria-current')).toBe('true');
    expect(items[1]!.getAttribute('href')).toBe('https://desk.example/resume');
  });

  it('renders one sign-out form for the page, outside every menu, that the account menus submit', () => {
    setViewport(1440);
    render(<Framed location={createLocation('/')} props={sidebarProps()} />);
    const forms = all('form#itsm-signout');
    expect(forms).toHaveLength(1);
    expect(forms[0]!.getAttribute('method')).toBe('post');
    expect(forms[0]!.getAttribute('action')).toBe('/api/session/logout');
    // Two account buttons (the sidebar's user card and the top bar's avatar), one form.
    expect(all('.itsm-UserMenu')).toHaveLength(2);
    expect(q('.itsm-Sidebar__foot .itsm-UserMenu--row')).not.toBeNull();
    expect(q('.itsm-AppTopBar .itsm-UserMenu--avatar')).not.toBeNull();
  });

  it('puts the sidebar action under the Area card, accepting the v2 sidebarHeaderExtra too', () => {
    setViewport(1440);
    render(<Framed location={createLocation('/')} props={sidebarProps({ sidebarAction: <button type="button">New ticket</button> })} />);
    const action = q('.itsm-Sidebar[data-mode="docked"] .itsm-Sidebar__action')!;
    expect(action.textContent).toBe('New ticket');
    expect(action.previousElementSibling?.className).toBe('itsm-Sidebar__area');
    cleanupDocument();
    render(<Framed location={createLocation('/')} props={sidebarProps({ sidebarHeaderExtra: <button type="button">Compose</button> })} />);
    expect(q('.itsm-Sidebar[data-mode="docked"] .itsm-Sidebar__action')?.textContent).toBe('Compose');
  });
});

describe('AppShell, top-nav variant (Help Portal)', () => {
  it('draws the top bar with the product mark, the area lockup, centred pills and a docked tab bar', () => {
    setViewport(1440);
    render(<Framed location={createLocation('/tickets/42')} props={topnavProps()} />);
    const brand = q<HTMLAnchorElement>('.itsm-TopBar__brand')!;
    expect(brand.getAttribute('aria-label')).toBe('IT Service Management — Help Portal home');
    // A requester has one area: a lockup, not a button.
    expect(q('.itsm-TopBar .itsm-AreaSwitcher')?.getAttribute('data-display')).toBe('lockup');
    expect(q('.itsm-TopBar button.itsm-AreaSwitcher')).toBeNull();

    const pills = q('nav[aria-label="Help Portal"]')!;
    expect(pills.closest('header')).not.toBeNull();
    expect(all('nav[aria-label="Help Portal"] [aria-current="page"]').map((link) => link.textContent)).toEqual(['My requests']);

    const tabs = q('nav[aria-label="Tab bar"]')!;
    expect(tabs.closest('.itsm-BottomDock')).not.toBeNull();
    expect(tabs.querySelectorAll('a')).toHaveLength(5);
    expect(tabs.querySelector('[aria-current="page"]')?.textContent).toBe('Requests');
    const me = [...tabs.querySelectorAll('a')].find((link) => link.getAttribute('href') === '/profile')!;
    expect(me.textContent).toContain('2 approvals waiting');
    // The dock comes after main, so the tab bar never precedes the content.
    expect(q('main')!.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows the visible switcher "Help Portal" to a person with more than one area', async () => {
    setViewport(1440);
    const { agentPortalAreas } = await import('./support.js');
    render(<Framed location={createLocation('/')} props={topnavProps({ areas: agentPortalAreas })} />);
    const switcher = q<HTMLButtonElement>('.itsm-TopBar button.itsm-AreaSwitcher')!;
    expect(switcher.getAttribute('data-display')).toBe('compact');
    expect(switcher.getAttribute('aria-label')).toBe('Switch area. Current: Help Portal');
    expect(switcher.querySelector('.itsm-AreaSwitcher__name')?.textContent).toBe('Help Portal');
  });

  it('puts ‹ Back and the title in the top bar on inner pages', () => {
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
    // The portal keeps its visible heading.
    expect(q('main h1')!.className).not.toContain('itsm-visually-hidden');
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
    expect(all('header')).toHaveLength(2); // the top bar, and PageHeader's header inside main
    expect(all('header.itsm-AppTopBar')).toHaveLength(1);
    expect(all('main')).toHaveLength(1);
    expect(all('nav[aria-label="Administration"]')).toHaveLength(1);
    expect(q('.itsm-AppShell')!.getAttribute('data-variant')).toBe('sidebar');
  });

  it.each([
    [390, 'Show full navigation'],
    [768, 'Show full navigation'],
    [1024, 'Show full navigation'],
    [1280, 'Collapse'],
    [1440, 'Collapse'],
  ] as const)('at %i px the Collapse button reads "%s"', async (width, label) => {
    setViewport(width);
    render(<Framed location={createLocation('/')} props={sidebarProps()} />);
    await settle();
    expect(q('.itsm-Sidebar__collapse')!.textContent).toBe(label);
  });

  it('moves between sheet, rail and full sidebar with viewport rules only', () => {
    const sheet = componentStylesheet;
    // Below 1024: no sidebar column; ☰ in the top bar opens the sheet.
    expect(sheet).toMatch(/\.itsm-AppShell__frame > \.itsm-AppShell__sidebar \{\s*display: none;/);
    expect(sheet).toMatch(/@media \(min-width: 64rem\) \{[^}]*\.itsm-AppTopBar__menu,\s*\.itsm-AppTopBar__status \{\s*display: none;/);
    // 1024 and up: the sidebar column at the rail width.
    expect(sheet).toMatch(/@media \(min-width: 64rem\) \{\s*\.itsm-AppShell\[data-variant="sidebar"\] \{\s*--_sidebar-w: var\(--itsm-sidebar-rail\);/);
    // 1280 and up: the full width, unless the person collapsed it.
    expect(sheet).toMatch(/@media \(min-width: 80rem\) \{\s*:root:not\(\[data-itsm-nav="rail"\]\) \.itsm-AppShell\[data-variant="sidebar"\] \{\s*--_sidebar-w: var\(--itsm-sidebar-width\);/);
    // The rail look applies in the 1024–1279 band and when collapsed at 1280+.
    expect(sheet).toMatch(/@media \(min-width: 64rem\) \{\s*@media \(max-width: 79\.9375rem\) \{\s*\.itsm-Sidebar\[data-mode="docked"\] \{\s*--_rail: 1;/);
    expect(sheet).toContain(':root[data-itsm-nav="rail"] .itsm-Sidebar[data-mode="docked"] {\n  --_rail: 1;');
    // The rail keeps the way between areas: a 44 px tile with its ⇕ badge.
    expect(sheet).toMatch(/\.itsm-Sidebar\[data-mode="docked"\] \.itsm-AreaSwitcher__chevron \{\s*position: absolute;/);
    // The portal: pills from 768, the tab bar below it.
    expect(sheet).toMatch(/@media \(min-width: 48rem\) \{\s*\.itsm-AppShell__pills \{\s*display: block;/);
    expect(sheet).toMatch(/@media \(min-width: 48rem\) \{\s*\.itsm-TabBar \{\s*display: none;/);
  });

  it('offsets everything sticky by the system bar: one variable, set only by the system bar', () => {
    const sheet = componentStylesheet;
    expect(sheet).toMatch(/\.itsm-AppShell\[data-variant\] \{[^}]*--_sticky-top: var\(--itsm-frame-top\);/);
    expect(sheet).toMatch(/\.itsm-AppTopBar \{\s*position: sticky;\s*inset-block-start: var\(--itsm-system-bar-h\);/);
    expect(sheet).toMatch(/\.itsm-TopBar \{\s*position: sticky;\s*inset-block-start: var\(--itsm-system-bar-h\);/);
    expect(sheet).toMatch(/\.itsm-RouteProgress \{\s*position: fixed;\s*inset-block-start: var\(--itsm-system-bar-h\);/);
    expect(sheet).toContain(':where(html):has(.itsm-AppShell[data-variant]) {\n  scroll-padding-block-start: calc(var(--itsm-frame-top) + var(--itsm-space-xs));');
    // The frame publishes no offset of its own (R4): only SystemBar.styles declares the variable.
    const declarations = [...sheet.matchAll(/--itsm-system-bar-h\s*:/g)];
    expect(declarations).toHaveLength(1);
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
