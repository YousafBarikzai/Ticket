// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, useState, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { destroyAnnouncer, installAnnouncer } from '../../a11y/announcer.js';
import { useHotkey } from '../../a11y/hotkeys.js';
import { TestProvider } from '../../provider/__tests__/support/provider.js';
import { activeElement, cleanupDocument, click, focus, pointerDown, pointerMove, pointerUp, press, render, settle } from '../../web/__tests__/support/render.js';
import { BottomDock, BottomDockHost } from '../BottomDock.js';
import { Breadcrumbs } from '../Breadcrumbs.js';
import { useFullScreenFlow } from '../flow.js';
import { HierNav } from '../HierNav.js';
import { NotificationCenter, resetEmergencyAnnouncement, type NotificationItem } from '../NotificationCenter.js';
import { PageHeader } from '../PageHeader.js';
import { RouteProgress, useRoutePending } from '../RouteProgress.js';
import { SearchTrigger } from '../SearchTrigger.js';
import { ShortcutsDialog } from '../ShortcutsDialog.js';
import { resetShortcutsDialog } from '../shortcuts.js';
import { SkipLinks } from '../SkipLinks.js';
import { SplitView } from '../SplitView.js';
import { TabBar } from '../TabBar.js';
import { TabNav } from '../TabNav.js';
import { tabNavStyles } from '../TabNav.styles.js';
import { UserMenu } from '../UserMenu.js';
import { createLocation, setViewport } from './support.js';

vi.mock('../../web/IconButtonTooltip.js', () => ({ IconButtonTooltip: () => null }));

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  installAnnouncer(document);
});

afterEach(() => {
  cleanupDocument();
  destroyAnnouncer();
  resetShortcutsDialog();
  resetEmergencyAnnouncement();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.documentElement.style.removeProperty('--itsm-bottom-dock-height');
});

const q = <T extends Element = HTMLElement>(selector: string): T | null => document.querySelector<T>(selector);
const all = (selector: string): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(selector)];

async function loaded(): Promise<void> {
  await act(async () => {
    await vi.dynamicImportSettled();
  });
  await settle();
}

/* ------------------------------------------------------------------ */

describe('TabBar', () => {
  const items = [
    { id: 'home', label: 'Home', href: '/', icon: 'home' as const },
    { id: 'requests', label: 'Requests', href: '/tickets', icon: 'ticket' as const },
  ];

  function installViewport(height: number): { resize(height: number): void } {
    const listeners = new Set<() => void>();
    const viewport = { height, addEventListener: (_: string, fn: () => void) => listeners.add(fn), removeEventListener: (_: string, fn: () => void) => listeners.delete(fn) };
    vi.stubGlobal('visualViewport', viewport);
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
    return {
      resize(next) {
        viewport.height = next;
        act(() => {
          for (const listener of listeners) listener();
        });
      },
    };
  }

  it('marks the current tab and hides while the software keyboard is up', () => {
    const viewport = installViewport(800);
    const location = createLocation('/tickets/7');
    render(
      <location.Provider app="portal">
        <input aria-label="Search" id="field" />
        <TabBar items={items} />
      </location.Provider>,
    );
    const bar = q('nav.itsm-TabBar')!;
    expect(bar.getAttribute('aria-label')).toBe('Tab bar');
    expect(bar.querySelector('[aria-current="page"]')?.textContent).toBe('Requests');
    expect(bar.hidden).toBe(false);

    focus(document.getElementById('field')!);
    viewport.resize(420);
    expect(bar.hidden).toBe(true);
    expect(bar.getAttribute('data-keyboard')).toBe('open');

    viewport.resize(800);
    expect(bar.hidden).toBe(false);
  });

  it('does not hide for a shrunken viewport alone (a pinch zoom), only with a field focused', () => {
    const viewport = installViewport(800);
    render(<TabBar items={items} />);
    viewport.resize(300);
    expect(q<HTMLElement>('nav.itsm-TabBar')!.hidden).toBe(false);
  });

  it('steps aside during a full-screen flow', () => {
    function Flow({ on }: { readonly on: boolean }): ReactNode {
      useFullScreenFlow(on);
      return null;
    }
    const view = render(
      <>
        <TabBar items={items} />
        <Flow on />
      </>,
    );
    expect(q<HTMLElement>('nav.itsm-TabBar')!.hidden).toBe(true);
    view.rerender(
      <>
        <TabBar items={items} />
        <Flow on={false} />
      </>,
    );
    expect(q<HTMLElement>('nav.itsm-TabBar')!.hidden).toBe(false);
  });
});

/* ------------------------------------------------------------------ */

describe('BottomDock', () => {
  it('stacks the contextual bar above the tab bar', () => {
    render(<BottomDock tabBar={<nav aria-label="Tab bar">tabs</nav>} bar={<div id="bulk">bulk</div>} />);
    const dock = q('.itsm-BottomDock')!;
    const children = [...dock.children].map((child) => child.className);
    expect(children).toEqual(['itsm-BottomDock__bar', 'itsm-BottomDock__tabs']);
    expect(dock.querySelector('.itsm-BottomDock__bar #bulk')).not.toBeNull();
  });

  it('sends a page’s bar into the frame’s dock, the most recent one winning', () => {
    function Page({ second }: { readonly second: boolean }): ReactNode {
      return (
        <BottomDockHost tabBar={<nav aria-label="Tab bar">tabs</nav>}>
          <main>
            <BottomDock bar={<div id="composer">composer</div>} />
            {second ? <BottomDock bar={<div id="actions">actions</div>} /> : null}
          </main>
        </BottomDockHost>
      );
    }
    const view = render(<Page second={false} />);
    expect(all('.itsm-BottomDock')).toHaveLength(1);
    const slot = q('.itsm-BottomDock__bar')!;
    expect(slot.querySelector('#composer')).not.toBeNull();
    expect(q('main #composer')).toBeNull();

    view.rerender(<Page second />);
    expect(slot.querySelector('#actions')).not.toBeNull();
    expect(slot.querySelector('#composer')).toBeNull();

    view.rerender(<Page second={false} />);
    expect(slot.querySelector('#composer')).not.toBeNull();
  });

  it('publishes its height for scroll padding and toasts, and clears it when it goes', () => {
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ height: 92 } as DOMRect);
    const view = render(<BottomDock tabBar={<nav aria-label="Tab bar">tabs</nav>} />);
    expect(document.documentElement.style.getPropertyValue('--itsm-bottom-dock-height')).toBe('92px');
    view.unmount();
    expect(document.documentElement.style.getPropertyValue('--itsm-bottom-dock-height')).toBe('');
    rect.mockRestore();
  });
});

/* ------------------------------------------------------------------ */

describe('SplitView', () => {
  const panes = [
    { id: 'list', label: 'Tickets', min: 300, max: 520, defaultSize: 360, children: <p>list</p> },
    { id: 'detail', label: 'Conversation', as: 'article' as const, min: 480, children: <p>detail</p> },
    { id: 'inspector', label: 'Details', as: 'aside' as const, min: 280, max: 400, defaultSize: 320, collapsible: true, children: <p>details</p> },
  ];
  const separators = (): HTMLElement[] => all('[role="separator"]');

  it('names each pane and gives each separator its value', () => {
    render(<SplitView panes={panes} />);
    expect(q('section#list')?.getAttribute('aria-label')).toBe('Tickets');
    expect(q('article#detail')?.getAttribute('aria-label')).toBe('Conversation');
    expect(q('aside#inspector')?.getAttribute('aria-label')).toBe('Details');
    const [first, second] = separators();
    expect(first!.getAttribute('aria-controls')).toBe('list');
    expect(first!.getAttribute('aria-valuenow')).toBe('360');
    expect(first!.getAttribute('aria-valuemin')).toBe('300');
    expect(first!.getAttribute('aria-valuemax')).toBe('520');
    expect(first!.getAttribute('aria-label')).toBe('Resize Tickets');
    expect(second!.getAttribute('aria-controls')).toBe('inspector');
    expect(first!.tabIndex).toBe(0);
  });

  it('resizes with the arrow keys, Shift for bigger steps, Home and End for the bounds', () => {
    render(<SplitView panes={panes} persistKey="inbox" />);
    const [first] = separators();
    focus(first!);
    press(first!, 'ArrowRight');
    expect(first!.getAttribute('aria-valuenow')).toBe('376');
    press(first!, 'ArrowLeft', { shiftKey: true });
    expect(first!.getAttribute('aria-valuenow')).toBe('312');
    press(first!, 'Home');
    expect(first!.getAttribute('aria-valuenow')).toBe('300');
    press(first!, 'ArrowLeft');
    expect(first!.getAttribute('aria-valuenow')).toBe('300');
    press(first!, 'End');
    expect(first!.getAttribute('aria-valuenow')).toBe('520');
    expect(q<HTMLElement>('#list')!.style.inlineSize).toBe('520px');
    expect(JSON.parse(window.localStorage.getItem('itsm-split:inbox')!)).toMatchObject({ list: 520 });
  });

  it('grows the pane after the separator when the one before is fluid: → makes it smaller', () => {
    render(<SplitView panes={panes} />);
    const second = separators()[1]!;
    press(second, 'ArrowRight');
    expect(second.getAttribute('aria-valuenow')).toBe('304');
    press(second, 'ArrowLeft');
    press(second, 'ArrowLeft');
    expect(second.getAttribute('aria-valuenow')).toBe('336');
  });

  it('mirrors the arrows right to left', () => {
    render(
      <div dir="rtl" style={{ direction: 'rtl' }}>
        <SplitView panes={panes} />
      </div>,
    );
    const [first] = separators();
    press(first!, 'ArrowLeft');
    expect(first!.getAttribute('aria-valuenow')).toBe('376');
  });

  it('collapses a collapsible pane with Enter and restores it with a double-click', () => {
    render(<SplitView panes={panes} />);
    const second = separators()[1]!;
    press(second, 'Enter');
    expect(second.getAttribute('aria-valuenow')).toBe('0');
    expect(q('#inspector')!.hasAttribute('data-collapsed')).toBe(true);
    act(() => {
      second.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    expect(second.getAttribute('aria-valuenow')).toBe('320');
    expect(q('#inspector')!.hasAttribute('data-collapsed')).toBe(false);
  });

  it('drags with the pointer, within the bounds', () => {
    render(<SplitView panes={panes} />);
    const [first] = separators();
    pointerDown(first!, { clientX: 360 });
    pointerMove(first!, { clientX: 400 });
    expect(first!.getAttribute('aria-valuenow')).toBe('400');
    pointerMove(first!, { clientX: 900 });
    expect(first!.getAttribute('aria-valuenow')).toBe('520');
    pointerUp(first!);
  });

  it('remembers widths on this device', async () => {
    window.localStorage.setItem('itsm-split:inbox', JSON.stringify({ list: 410 }));
    render(<SplitView panes={panes} persistKey="inbox" />);
    await settle();
    expect(separators()[0]!.getAttribute('aria-valuenow')).toBe('410');
  });
});

/* ------------------------------------------------------------------ */

describe('SearchTrigger', () => {
  it('is a button that says it opens a dialog, with its shortcut', () => {
    const onOpen = vi.fn();
    render(<SearchTrigger placeholder="Search or jump to…" shortcut="mod+k" onOpen={onOpen} />);
    const button = q<HTMLButtonElement>('button.itsm-SearchTrigger')!;
    expect(button.getAttribute('aria-haspopup')).toBe('dialog');
    expect(button.getAttribute('aria-keyshortcuts')).toBe('Meta+K Control+K');
    expect(button.querySelector('.itsm-SearchTrigger__label')?.textContent).toBe('Search or jump to…');
    click(button);
    expect(onOpen).toHaveBeenCalledTimes(1);
    press(document.body, 'k', { metaKey: true });
    press(document.body, 'k', { ctrlKey: true });
    expect(onOpen.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('binds nothing when asked not to', () => {
    const onOpen = vi.fn();
    render(<SearchTrigger placeholder="Search" shortcut="mod+k" bindShortcut={false} onOpen={onOpen} />);
    press(document.body, 'k', { ctrlKey: true });
    expect(onOpen).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */

describe('UserMenu', () => {
  const props = { name: 'Ada Lovelace', detail: 'Acme', signOut: { action: '/api/session/logout' }, density: true, shortcuts: true, help: { href: '/help' } };

  it('renders a plain button until someone reaches for it: no menu library on first paint', () => {
    const html = renderToStaticMarkup(
      <TestProvider>
        <UserMenu {...props} />
      </TestProvider>,
    );
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('data-state');
    const form = html.slice(html.indexOf('<form'));
    expect(form).toContain('method="post"');
    expect(form).toContain('action="/api/session/logout"');
    expect(form).toContain('hidden');
  });

  it('loads the menu on focus without dropping focus, then opens it with Enter', async () => {
    render(
      <TestProvider>
        <UserMenu {...props} />
      </TestProvider>,
    );
    const button = q<HTMLButtonElement>('.itsm-UserMenu')!;
    focus(button);
    await loaded();
    const trigger = q<HTMLButtonElement>('.itsm-UserMenu')!;
    expect(trigger.getAttribute('data-state')).toBe('closed');
    expect(activeElement()).toBe(trigger);

    press(trigger, 'Enter');
    await settle();
    const menu = q('[role="menu"]')!;
    expect(menu.getAttribute('aria-label')).toBe('Account');
    const labels = all('[role="menu"] [role^="menuitem"]').map((item) => item.querySelector('.itsm-Menu__itemLabel')?.textContent ?? item.textContent);
    expect(labels).toEqual(['Automatic', 'Light', 'Dark', 'Increase contrast', 'Comfortable', 'Compact', 'Keyboard shortcuts…', 'Help', 'Sign out']);
  });

  it('honours a press made while the menu was on its way', async () => {
    render(
      <TestProvider>
        <UserMenu {...props} />
      </TestProvider>,
    );
    pointerDown(q('.itsm-UserMenu')!);
    await loaded();
    expect(q('[role="menu"]')).not.toBeNull();
  });

  it('signs out with a submit button naming the hidden POST form outside the menu', async () => {
    render(
      <TestProvider>
        <UserMenu {...props} />
      </TestProvider>,
    );
    focus(q('.itsm-UserMenu')!);
    await loaded();
    press(q('.itsm-UserMenu')!, 'Enter');
    await settle();
    const signOut = all('[role="menu"] [role="menuitem"]').find((item) => item.textContent === 'Sign out')!;
    expect(signOut.tagName).toBe('BUTTON');
    expect(signOut.getAttribute('type')).toBe('submit');
    const form = document.getElementById(signOut.getAttribute('form')!) as HTMLFormElement;
    expect(form.tagName).toBe('FORM');
    expect(form.method).toBe('post');
    expect(form.getAttribute('action')).toBe('/api/session/logout');
    expect(form.closest('[role="menu"]')).toBeNull();

    const submitted = vi.fn((event: Event) => event.preventDefault());
    form.addEventListener('submit', submitted);
    click(signOut);
    expect(submitted).toHaveBeenCalledTimes(1);
  });

  it('asks first when told to, and does not sign out on "no"', async () => {
    const beforeSubmit = vi.fn(async () => false);
    render(
      <TestProvider>
        <UserMenu {...props} signOut={{ action: '/api/session/logout', beforeSubmit }} />
      </TestProvider>,
    );
    focus(q('.itsm-UserMenu')!);
    await loaded();
    press(q('.itsm-UserMenu')!, 'Enter');
    await settle();
    const signOut = all('[role="menuitem"]').find((item) => item.textContent === 'Sign out')!;
    const form = document.getElementById(signOut.getAttribute('form')!) as HTMLFormElement;
    const submitted = vi.fn((event: Event) => event.preventDefault());
    form.addEventListener('submit', submitted);
    const requestSubmit = vi.spyOn(form, 'requestSubmit').mockImplementation(() => undefined);
    click(signOut);
    await settle();
    expect(beforeSubmit).toHaveBeenCalledTimes(1);
    expect(submitted).not.toHaveBeenCalled();
    expect(requestSubmit).not.toHaveBeenCalled();
    expect(q('[role="menu"]')).toBeNull();
  });

  it('changes appearance and contrast from the menu', async () => {
    render(
      <TestProvider>
        <UserMenu {...props} />
      </TestProvider>,
    );
    await settle();
    focus(q('.itsm-UserMenu')!);
    await loaded();
    press(q('.itsm-UserMenu')!, 'Enter');
    await settle();
    click(all('[role="menuitemradio"]').find((item) => item.textContent === 'Dark')!);
    await settle();
    expect(JSON.parse(window.localStorage.getItem('itsm-prefs')!)).toMatchObject({ appearance: 'dark' });

    press(q('.itsm-UserMenu')!, 'Enter');
    await settle();
    const contrast = all('[role="menuitemcheckbox"]').find((item) => item.textContent === 'Increase contrast')!;
    expect(contrast.getAttribute('aria-checked')).toBe('false');
    click(contrast);
    await settle();
    expect(JSON.parse(window.localStorage.getItem('itsm-prefs')!)).toMatchObject({ contrast: 'more' });
  });
});

/* ------------------------------------------------------------------ */

describe('NotificationCenter', () => {
  const now = Date.now();
  const items: NotificationItem[] = [
    { id: 'n1', subject: 'Assigned to you: Printer jammed', eventType: 'ticket.assigned', createdAt: new Date(now - 60_000).toISOString(), readAt: null },
    { id: 'n2', subject: 'SLA breached: VPN down', eventType: 'sla.breached.lead', createdAt: new Date(now - 3 * 86_400_000).toISOString(), readAt: null },
    { id: 'n3', subject: 'Approved: Laptop', eventType: 'approval.decided', createdAt: new Date(now - 120_000).toISOString(), readAt: new Date(now).toISOString() },
  ];

  function Bell({ emergency = false, unread = 2, load = async () => ({ items, unread: 2 }), markRead = vi.fn(async () => undefined) }: Partial<Parameters<typeof NotificationCenter>[0]>): ReactNode {
    return (
      <TestProvider>
        <NotificationCenter unread={unread} emergency={emergency} load={load} markRead={markRead} hrefFor={(item) => `/tickets/${item.id}`} />
      </TestProvider>
    );
  }

  it('names the bell with its count, capped at 99+', () => {
    render(<Bell unread={140} />);
    const bell = q('.itsm-NotificationCenter__bell')!;
    expect(bell.getAttribute('aria-label')).toBe('Notifications, 99+ unread');
    expect(bell.getAttribute('aria-haspopup')).toBe('dialog');
    expect(q('.itsm-NotificationCenter__count')?.textContent).toBe('99+');
  });

  it('announces an emergency once, assertively, however many bells there are', async () => {
    vi.useFakeTimers();
    render(
      <>
        <Bell emergency />
        <Bell emergency />
      </>,
    );
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(document.querySelector('[data-itsm-live-region="assertive"]')?.textContent).toContain('service level has been breached');
    expect(all('.itsm-NotificationCenter__bell').every((bell) => bell.getAttribute('aria-label')!.endsWith('urgent'))).toBe(true);
    const spoken = document.querySelector('[data-itsm-live-region="assertive"]')!;
    spoken.textContent = '';
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(spoken.textContent).toBe('');
  });

  it('opens a panel with the emergency pinned first, then day groups, and marks all as read', async () => {
    setViewport(1440);
    const markRead = vi.fn(async () => undefined);
    render(<Bell markRead={markRead} />);
    const bell = q<HTMLButtonElement>('.itsm-NotificationCenter__bell')!;
    click(bell);
    await loaded();
    await settle();

    const panel = q('[role="dialog"]')!;
    expect(panel.getAttribute('aria-labelledby')).toBe(q('.itsm-NotificationPanel__title')!.id);
    const headings = all('.itsm-NotificationPanel__day').map((heading) => heading.textContent);
    expect(headings[0]).toBe('Needs attention');
    expect(headings[1]).toBe('Today');
    const first = q('.itsm-NotificationPanel__item')!;
    expect(first.textContent).toContain('Urgent: SLA breached: VPN down');
    expect(first.getAttribute('href')).toBe('/tickets/n2');
    expect(all('.itsm-NotificationPanel__item[data-unread]')).toHaveLength(2);

    click(all('button').find((button) => button.textContent === 'Mark all as read')!);
    await settle();
    expect(markRead).toHaveBeenCalledWith('all');
    expect(all('.itsm-NotificationPanel__item[data-unread]')).toHaveLength(0);
    expect(bell.getAttribute('aria-label')).toBe('Notifications');
  });

  it('marks one read and closes when it is followed', async () => {
    setViewport(1440);
    const markRead = vi.fn(async () => undefined);
    render(<Bell markRead={markRead} />);
    click(q('.itsm-NotificationCenter__bell')!);
    await loaded();
    await settle();
    const item = all('.itsm-NotificationPanel__item').find((link) => link.textContent?.includes('Printer jammed'))!;
    item.addEventListener('click', (event) => event.preventDefault());
    click(item);
    await settle();
    expect(markRead).toHaveBeenCalledWith('n1');
    expect(q('[role="dialog"]')).toBeNull();
    expect(q('.itsm-NotificationCenter__bell')!.getAttribute('aria-label')).toBe('Notifications, 1 unread');
  });

  it('says so when the list cannot load, and tries again', async () => {
    setViewport(1440);
    let fail = true;
    const load = vi.fn(async () => {
      if (fail) throw new Error('offline');
      return { items: [], unread: 0 };
    });
    render(<Bell load={load} />);
    click(q('.itsm-NotificationCenter__bell')!);
    await loaded();
    await settle();
    expect(q('[role="dialog"] [role="alert"]')?.textContent).toContain('Couldn’t load notifications');
    fail = false;
    click(all('button').find((button) => button.textContent === 'Try again')!);
    await settle();
    expect(q('[role="dialog"]')?.textContent).toContain('You’re all caught up');
  });

  it('is a bottom sheet on a phone', async () => {
    setViewport(390);
    render(<Bell />);
    click(q('.itsm-NotificationCenter__bell')!);
    await loaded();
    await settle();
    expect(q('.itsm-NotificationPanel__sheet')).not.toBeNull();
    expect(q('[role="dialog"]')?.textContent).toContain('Notifications');
  });
});

/* ------------------------------------------------------------------ */

describe('PageHeader', () => {
  it('renders the page’s only h1, focusable by script, with one primary action', () => {
    const onAction = vi.fn();
    render(
      <TestProvider>
        <PageHeader
          title="Rules"
          meta="12 live"
          primaryAction={{ id: 'new', label: 'New rule', icon: 'plus', variant: 'secondary', shortcut: 'c' }}
          secondaryActions={[{ id: 'import', label: 'Import', variant: 'primary' }]}
          onAction={onAction}
        />
      </TestProvider>,
    );
    const heading = q('h1')!;
    expect(all('h1')).toHaveLength(1);
    expect(heading.getAttribute('tabindex')).toBe('-1');
    expect(q('.itsm-PageHeader__meta')?.textContent).toBe('12 live');
    // A secondary never takes the primary's emphasis.
    expect(q('[data-action="import"]')!.className).not.toContain('itsm-Button--primary');
    click(q('[data-action="import"]')!);
    expect(onAction).toHaveBeenCalledWith('import');
    // The primary's shortcut presses it.
    press(document.body, 'c');
    expect(onAction).toHaveBeenCalledWith('new');
  });

  it('folds the secondaries into ⋯ below 768 px', async () => {
    setViewport(390);
    render(
      <TestProvider>
        <PageHeader title="Rules" secondaryActions={[{ id: 'import', label: 'Import' }]} overflow={[{ id: 'export', label: 'Export' }]} />
      </TestProvider>,
    );
    await settle();
    const more = q<HTMLButtonElement>('.itsm-PageHeader__more')!;
    focus(more);
    await loaded();
    press(q('.itsm-PageHeader__more')!, 'Enter');
    await settle();
    expect(all('[role="menu"] [role="menuitem"]').map((item) => item.textContent)).toEqual(['Import', 'Export']);
  });

  it('explains View only in a popover, loaded when wanted', async () => {
    render(
      <TestProvider>
        <PageHeader title="Rules" viewOnly={{ label: 'Rules', permission: 'Manage rules', key: 'rules.rule.manage' }} />
      </TestProvider>,
    );
    const pill = q<HTMLButtonElement>('.itsm-PageHeader__viewOnly')!;
    expect(pill.textContent).toBe('View only');
    expect(pill.getAttribute('aria-haspopup')).toBe('dialog');
    click(pill);
    await loaded();
    const popover = q('[role="dialog"]')!;
    expect(popover.textContent).toContain('You can see Rules but not change them. Ask an administrator for Manage rules.');
    // The technical key only for people who asked to see keys.
    expect(popover.textContent).not.toContain('rules.rule.manage');
  });

  it('shows breadcrumbs above, or a back link', () => {
    render(
      <TestProvider>
        <PageHeader title="VIP requester" breadcrumbs={[{ label: 'Rules', href: '/rules' }, { label: 'VIP requester' }]} />
        <PageHeader title="Printer jammed" back={{ href: '/tickets', label: 'My requests' }} />
      </TestProvider>,
    );
    expect(q('nav[aria-label="Breadcrumb"] [aria-current="page"]')?.textContent).toBe('VIP requester');
    expect(q<HTMLAnchorElement>('.itsm-PageHeader__back')?.getAttribute('href')).toBe('/tickets');
  });
});

/* ------------------------------------------------------------------ */

describe('Breadcrumbs, TabNav and HierNav', () => {
  it('Breadcrumbs: links for ancestors, the page as text, a fold for long trails and a way back', () => {
    render(
      <TestProvider>
        <Breadcrumbs
          items={[
            { label: 'Services & requests', href: '/catalogue' },
            { label: 'Forms', href: '/catalogue/forms' },
            { label: 'Hardware', href: '/catalogue/forms?group=hardware' },
            { label: 'New laptop' },
          ]}
        />
      </TestProvider>,
    );
    const nav = q('nav[aria-label="Breadcrumb"]')!;
    expect(nav.querySelector('ol')).not.toBeNull();
    expect(nav.querySelector('[aria-current="page"]')?.textContent).toBe('New laptop');
    expect(all('[data-fold]').map((item) => item.textContent)).toEqual(['Forms']);
    expect(q('.itsm-Breadcrumbs__moreButton')?.getAttribute('aria-label')).toBe('More pages in this trail');
    expect(q<HTMLAnchorElement>('.itsm-Breadcrumbs__parent')?.getAttribute('href')).toBe('/catalogue/forms?group=hardware');
  });

  it('TabNav: the current tab by path, the deepest winning', () => {
    const location = createLocation('/workflows/runs');
    render(
      <location.Provider>
        <TabNav
          label="Workflows"
          items={[
            { id: 'all', label: 'Workflows', href: '/workflows', match: 'exact' },
            { id: 'runs', label: 'Runs', href: '/workflows/runs', badge: { value: 4, tone: 'danger', label: '4 failed' } },
          ]}
        />
      </location.Provider>,
    );
    expect(q('nav[aria-label="Workflows"] [aria-current="page"]')?.textContent).toBe('Runs4, 4 failed');
    expect(all('[aria-current="page"]')).toHaveLength(1);
  });

  it('TabNav: a section’s count is the shared Count, accent on the current tab, spoken with its label', () => {
    const location = createLocation('/catalogue/register');
    render(
      <location.Provider>
        <TabNav
          label="Catalogue"
          items={[
            { id: 'register', label: 'Register', href: '/catalogue/register', count: 24 },
            { id: 'drafts', label: 'Drafts', href: '/catalogue/drafts', count: 3 },
            { id: 'retired', label: 'Retired', href: '/catalogue/retired', count: null },
          ]}
        />
      </location.Provider>,
    );
    const spoken = (node: Node): string => {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
      if (node instanceof Element && node.getAttribute('aria-hidden') === 'true') return '';
      return [...node.childNodes].map(spoken).join('');
    };
    const links = all('nav[aria-label="Catalogue"] a');
    expect(links.map((link) => spoken(link))).toEqual(['Register, 24', 'Drafts, 3', 'Retired']);
    expect(links.map((link) => link.querySelector('.itsm-Count')?.getAttribute('data-tone') ?? null)).toEqual(['accent', 'neutral', null]);
    expect(links[0]!.querySelector('.itsm-Count')?.getAttribute('data-size')).toBe('sm');
    // v3 underline tabs: 500 14/20 muted, 40 px, the rule drawn by the track so the indicator sits on it.
    const rule = (selector: string): string => {
      const start = tabNavStyles.indexOf(`${selector} {`);
      return start < 0 ? '' : tabNavStyles.slice(start, tabNavStyles.indexOf('}', start));
    };
    expect(rule('.itsm-TabNav__link')).toContain('color: var(--itsm-colour-text-muted)');
    expect(rule('.itsm-TabNav__link')).toContain('font-size: var(--itsm-text-body-size)');
    expect(rule('.itsm-TabNav__link')).toContain('min-block-size: calc(var(--itsm-control-height-md) + var(--itsm-space-2xs))');
    expect(rule('.itsm-TabNav__track')).toContain('box-shadow: inset 0 calc(-1 * var(--itsm-border-hair)) 0 var(--itsm-colour-border-subtle)');
    expect(tabNavStyles).toContain('.itsm-TabNav__track {\n    --_fade:');
  });

  it('HierNav: nested links, current by path and query, counts spoken', () => {
    const location = createLocation('/cmdb?class=server');
    render(
      <location.Provider>
        <HierNav
          label="Classes"
          items={[
            { id: 'all', label: 'All classes', href: '/cmdb', count: 120 },
            { id: 'server', label: 'Servers', href: '/cmdb?class=server', count: 40, children: [{ id: 'linux', label: 'Linux', href: '/cmdb?class=server&os=linux', count: 30 }] },
          ]}
        />
      </location.Provider>,
    );
    expect(all('[aria-current="page"]').map((link) => link.textContent)).toEqual(['Servers, 40']);
    expect(q('nav[aria-label="Classes"] ul ul')).not.toBeNull();
    expect(q('[role="tree"]')).toBeNull();
    act(() => location.go('/cmdb?class=server&os=linux'));
    expect(all('[aria-current="page"]').map((link) => link.textContent)).toEqual(['Linux, 30']);
    act(() => location.go('/cmdb'));
    expect(all('[aria-current="page"]').map((link) => link.textContent)).toEqual(['All classes, 120']);
  });
});

/* ------------------------------------------------------------------ */

describe('RouteProgress', () => {
  /** Lets the mutation observer's callback run inside act. */
  async function observed(): Promise<void> {
    await act(async () => {
      await Promise.resolve();
    });
  }

  it('shows only for a navigation slower than the delay, then runs out', async () => {
    vi.useFakeTimers();
    function Link({ pending }: { readonly pending: boolean }): ReactNode {
      return <span data-itsm-pending="" hidden={!pending} />;
    }
    const view = render(
      <>
        <RouteProgress />
        <Link pending={false} />
      </>,
    );
    const bar = q('.itsm-RouteProgress')!;
    expect(bar.getAttribute('aria-hidden')).toBe('true');
    view.rerender(
      <>
        <RouteProgress />
        <Link pending />
      </>,
    );
    await observed();
    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(bar.getAttribute('data-phase')).toBe('idle');
    act(() => {
      vi.advanceTimersByTime(10);
    });
    expect(bar.getAttribute('data-phase')).toBe('running');
    view.rerender(
      <>
        <RouteProgress />
        <Link pending={false} />
      </>,
    );
    await observed();
    expect(bar.getAttribute('data-phase')).toBe('finishing');
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(bar.getAttribute('data-phase')).toBe('idle');
  });

  it('stays quiet for a quick navigation, and follows reported transitions', () => {
    vi.useFakeTimers();
    function Filter({ pending }: { readonly pending: boolean }): ReactNode {
      useRoutePending(pending);
      return null;
    }
    const view = render(
      <>
        <RouteProgress delayMs={100} />
        <Filter pending />
      </>,
    );
    act(() => {
      vi.advanceTimersByTime(50);
    });
    view.rerender(
      <>
        <RouteProgress delayMs={100} />
        <Filter pending={false} />
      </>,
    );
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(q('.itsm-RouteProgress')!.getAttribute('data-phase')).toBe('idle');
  });
});

/* ------------------------------------------------------------------ */

describe('ShortcutsDialog', () => {
  function Bound(): ReactNode {
    useHotkey({ keys: 'c', handler: () => undefined, description: 'New ticket', group: 'Tickets' });
    useHotkey({ keys: 'mod+k', handler: () => undefined, description: 'Search and commands', group: 'General', allowInFields: true });
    return null;
  }
  function Harness(): ReactNode {
    const [open, setOpen] = useState(true);
    return (
      <TestProvider app="workbench">
        <Bound />
        <ShortcutsDialog open={open} onOpenChange={setOpen} />
      </TestProvider>
    );
  }

  it('lists the bound shortcuts by group, General first, with the single-key switch', async () => {
    render(<Harness />);
    await settle();
    const dialog = q('[role="dialog"]')!;
    const groups = all('.itsm-ShortcutsDialog__groupTitle').map((title) => title.textContent);
    expect(groups).toEqual(['General', 'Tickets']);
    expect(dialog.textContent).toContain('New ticket');
    const switches = all('[role="switch"]');
    expect(switches.map((control) => control.closest('label, div')?.textContent ?? '')).toHaveLength(2);

    const singleKeys = switches[0]!;
    expect(singleKeys.getAttribute('aria-checked')).toBe('true');
    click(singleKeys);
    await settle();
    expect(JSON.parse(window.localStorage.getItem('itsm-prefs')!)).toMatchObject({ shortcuts: 'off' });
    const row = all('.itsm-ShortcutsDialog__row').find((entry) => entry.textContent?.includes('New ticket'))!;
    expect(row.hasAttribute('data-off')).toBe(true);
    const search = all('.itsm-ShortcutsDialog__row').find((entry) => entry.textContent?.includes('Search and commands'))!;
    expect(search.hasAttribute('data-off')).toBe(false);
  });
});

/* ------------------------------------------------------------------ */

describe('SkipLinks', () => {
  it('is server-safe: no directive, no hooks, no handlers', () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../SkipLinks.tsx'), 'utf8');
    expect(source.startsWith("'use client'")).toBe(false);
    expect(source).not.toMatch(/\buse[A-Z]\w*\(/);
    expect(source).not.toMatch(/\bon[A-Z]\w*=/);
    const html = renderToStaticMarkup(<SkipLinks links={[{ label: 'Skip to content', targetId: 'main' }, { label: 'Skip to reply', targetId: 'reply' }]} />);
    expect(html).toContain('href="#main"');
    expect(html).toContain('Skip to reply');
  });
});
