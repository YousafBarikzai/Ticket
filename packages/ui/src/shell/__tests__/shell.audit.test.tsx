// @vitest-environment jsdom
import { act, useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, it, vi } from 'vitest';
import { destroyAnnouncer, installAnnouncer } from '../../a11y/announcer.js';
import { useHotkey } from '../../a11y/hotkeys.js';
import { TestProvider } from '../../provider/__tests__/support/provider.js';
import { resetRecentsForTesting } from '../../provider/recents.js';
import { AppShell } from '../../web/AppShell.js';
import { CommandPalette } from '../../web/CommandPalette.js';
import { expectNoViolations } from '../../web/__tests__/support/audit.js';
import { cleanupDocument, click, focus, press, render, settle, typeInto } from '../../web/__tests__/support/render.js';
import { BottomDock } from '../BottomDock.js';
import { Breadcrumbs } from '../Breadcrumbs.js';
import { HierNav } from '../HierNav.js';
import { NotificationCenter, type NotificationItem } from '../NotificationCenter.js';
import { PageHeader } from '../PageHeader.js';
import { RouteFocus } from '../RouteFocus.js';
import { RouteProgress } from '../RouteProgress.js';
import { SearchTrigger } from '../SearchTrigger.js';
import { ShortcutsDialog } from '../ShortcutsDialog.js';
import { resetShortcutsDialog } from '../shortcuts.js';
import { resetSidebarMemoryForTesting } from '../Sidebar.js';
import { SkipLinks } from '../SkipLinks.js';
import { SplitView } from '../SplitView.js';
import { TabBar } from '../TabBar.js';
import { TabNav } from '../TabNav.js';
import { TopBar } from '../TopBar.js';
import { TopNavShell } from '../TopNavShell.js';
import { UserMenu } from '../UserMenu.js';
import { createLocation, setViewport, sidebarProps, topnavProps } from './support.js';

vi.mock('../../web/IconButtonTooltip.js', () => ({ IconButtonTooltip: () => null }));
vi.mock('../../overlays/Toaster.js', () => ({ Toaster: () => null }));

beforeEach(() => {
  window.localStorage.clear();
  resetRecentsForTesting();
  resetSidebarMemoryForTesting();
  installAnnouncer(document);
});

afterEach(() => {
  cleanupDocument();
  destroyAnnouncer();
  resetShortcutsDialog();
  vi.unstubAllGlobals();
});

async function loaded(): Promise<void> {
  await act(async () => {
    await vi.dynamicImportSettled();
  });
  await settle();
}

const now = Date.now();
const notifications: NotificationItem[] = [
  { id: 'n1', subject: 'Assigned to you: Printer jammed', body: 'Ada raised it from the portal.', eventType: 'ticket.assigned', createdAt: new Date(now - 60_000).toISOString(), readAt: null },
  { id: 'n2', subject: 'SLA breached: VPN down', eventType: 'sla.breached.lead', createdAt: new Date(now - 90_000).toISOString(), readAt: null },
  { id: 'n3', subject: 'Approved: Laptop', eventType: 'approval.decided', createdAt: new Date(now - 3 * 86_400_000).toISOString(), readAt: new Date(now).toISOString() },
];

function Bell(): ReactNode {
  return <NotificationCenter unread={2} emergency load={async () => ({ items: notifications, unread: 2 })} markRead={async () => undefined} hrefFor={(item) => `/tickets/${item.id}`} />;
}

function Page(): ReactNode {
  return (
    <>
      <PageHeader
        title="Rules"
        breadcrumbs={[{ label: 'Automation', href: '/rules' }, { label: 'Rules' }]}
        status={<span>Live</span>}
        primaryAction={{ id: 'new', label: 'New rule', icon: 'plus', shortcut: 'c' }}
        secondaryActions={[{ id: 'import', label: 'Import' }]}
        overflow={[{ id: 'export', label: 'Export' }]}
        tabs={[
          { id: 'rules', label: 'Rules', href: '/rules' },
          { id: 'runs', label: 'Runs', href: '/rules/runs', badge: { value: 3, label: '3 failed' } },
        ]}
        viewOnly={{ label: 'Rules', permission: 'Manage rules' }}
      />
      <p>Rules route tickets as they arrive.</p>
    </>
  );
}

describe('the frame passes axe', () => {
  it.each([1440, 1024, 390])('AppShell sidebar at %i px, with a page', async (width) => {
    setViewport(width);
    window.localStorage.setItem('itsm-pins:admin', JSON.stringify([{ id: 'rule:vip', label: 'VIP requester', href: '/rules/vip', kind: 'rule' }]));
    window.localStorage.setItem('itsm-recents:admin', JSON.stringify([{ id: 'wf:1', label: 'Onboarding', href: '/workflows/1', kind: 'workflow' }]));
    const location = createLocation('/rules');
    render(
      <location.Provider>
        <AppShell {...sidebarProps({ bell: <Bell />, status: <span>Offline · 2 waiting</span>, sidebarHeaderExtra: <button type="button" aria-label="New ticket">+</button> })}>
          <Page />
        </AppShell>
      </location.Provider>,
    );
    await settle();
    await expectNoViolations(document.body);
  });

  it('AppShell sidebar with its navigation sheet open', async () => {
    setViewport(390);
    const location = createLocation('/rules');
    render(
      <location.Provider>
        <AppShell {...sidebarProps({ bell: <Bell /> })}>
          <Page />
        </AppShell>
      </location.Provider>,
    );
    click(document.querySelector('button[aria-label="Open navigation"]')!);
    await loaded();
    await expectNoViolations(document.body);
  });

  it.each([1440, 390])('AppShell top-nav at %i px, with a back link', async (width) => {
    setViewport(width);
    const location = createLocation('/tickets/42');
    render(
      <location.Provider app="portal">
        <AppShell {...topnavProps({ bell: <Bell />, topBarAction: <a href="/report">New request</a> })}>
          <PageHeader title="Printer jammed" back={{ href: '/tickets', label: 'My requests' }} />
        </AppShell>
      </location.Provider>,
    );
    await settle();
    await expectNoViolations(document.body);
  });

  it.each([1440, 320])('TopNavShell at %i px', async (width) => {
    setViewport(width);
    const location = createLocation('/tickets');
    const { variant, ...props } = topnavProps({ bell: <Bell /> });
    void variant;
    render(
      <location.Provider app="portal">
        <TopNavShell {...props}>
          <PageHeader title="My requests" />
        </TopNavShell>
      </location.Provider>,
    );
    await settle();
    await expectNoViolations(document.body);
  });

  it('TopBar, SearchTrigger, SkipLinks, RouteProgress and RouteFocus on their own', async () => {
    render(
      <TestProvider>
        <SkipLinks links={[{ label: 'Skip to content', targetId: 'main' }]} />
        <RouteProgress />
        <RouteFocus />
        <TopBar brand={{ name: 'Help', href: '/', app: 'portal' }} title="Printer jammed" end={<SearchTrigger placeholder="Search help" shortcut="mod+k" onOpen={() => undefined} />} />
        <main id="main" tabIndex={-1}>
          <h1 tabIndex={-1}>Home</h1>
        </main>
      </TestProvider>,
    );
    await expectNoViolations(document.body);
  });

  it('TabBar in a BottomDock with a contextual bar', async () => {
    render(
      <TestProvider app="portal">
        <main>
          <h1>Printer jammed</h1>
        </main>
        <BottomDock
          bar={
            <form aria-label="Reply">
              <label>
                Reply <input />
              </label>
            </form>
          }
          tabBar={<TabBar items={topnavProps().bottomTabs!} />}
        />
      </TestProvider>,
    );
    await expectNoViolations(document.body);
  });

  it('SplitView, with a collapsed pane', async () => {
    render(
      <TestProvider app="workbench">
        <main>
          <h1>My work</h1>
          <SplitView
            panes={[
              { id: 'list', label: 'Tickets', min: 300, max: 520, defaultSize: 360, children: <p>list</p> },
              { id: 'detail', label: 'Conversation', as: 'article', min: 480, children: <p>detail</p> },
              { id: 'inspector', label: 'Details', as: 'aside', min: 280, max: 400, defaultSize: 320, collapsible: true, children: <p>details</p> },
            ]}
          />
        </main>
      </TestProvider>,
    );
    await expectNoViolations(document.body);
    press(document.querySelectorAll<HTMLElement>('[role="separator"]')[1]!, 'Enter');
    await expectNoViolations(document.body);
  });

  it('UserMenu, open', async () => {
    render(
      <TestProvider>
        <main>
          <h1>Home</h1>
          <UserMenu name="Ada Lovelace" detail="Acme" density shortcuts help={{ href: '/help' }} signOut={{ action: '/api/session/logout' }} badge={{ value: 2, label: '2 approvals waiting' }} switcher={[{ app: 'workbench', label: 'Workbench', href: '/w' }]} />
        </main>
      </TestProvider>,
    );
    await expectNoViolations(document.body);
    focus(document.querySelector<HTMLElement>('.itsm-UserMenu')!);
    await loaded();
    press(document.querySelector<HTMLElement>('.itsm-UserMenu')!, 'Enter');
    await settle();
    await expectNoViolations(document.body);
  });

  it.each([1440, 390])('NotificationCenter, open at %i px', async (width) => {
    setViewport(width);
    render(
      <TestProvider>
        <main>
          <h1>Home</h1>
          <Bell />
        </main>
      </TestProvider>,
    );
    click(document.querySelector<HTMLElement>('.itsm-NotificationCenter__bell')!);
    await loaded();
    await settle();
    await expectNoViolations(document.body);
  });

  it('PageHeader with everything, and its View only popover open', async () => {
    render(
      <TestProvider>
        <main>
          <Page />
        </main>
      </TestProvider>,
    );
    await expectNoViolations(document.body);
    click(document.querySelector<HTMLElement>('.itsm-PageHeader__viewOnly')!);
    await loaded();
    await expectNoViolations(document.body);
  });

  it('Breadcrumbs (folded), TabNav and HierNav', async () => {
    const location = createLocation('/cmdb?class=server');
    render(
      <location.Provider>
        <main>
          <h1>Configuration items</h1>
          <Breadcrumbs
            items={[
              { label: 'CMDB', href: '/cmdb' },
              { label: 'Classes', href: '/cmdb/classes' },
              { label: 'Servers', href: '/cmdb?class=server' },
              { label: 'web-01' },
            ]}
          />
          <TabNav
            label="CMDB"
            items={[
              { id: 'cis', label: 'Configuration items', href: '/cmdb' },
              { id: 'assets', label: 'Assets', href: '/cmdb/assets', badge: { value: 4, tone: 'danger', label: '4 warranties ending' } },
            ]}
          />
          <HierNav
            label="Classes"
            items={[
              { id: 'all', label: 'All classes', href: '/cmdb', count: 120 },
              { id: 'server', label: 'Servers', href: '/cmdb?class=server', count: 40, children: [{ id: 'linux', label: 'Linux', href: '/cmdb?class=server&os=linux', count: 30 }] },
            ]}
          />
        </main>
      </location.Provider>,
    );
    await expectNoViolations(document.body);
  });

  it('ShortcutsDialog, open', async () => {
    function Bound(): ReactNode {
      useHotkey({ keys: 'c', handler: () => undefined, description: 'New ticket', group: 'Tickets' });
      useHotkey({ keys: 'g m', handler: () => undefined, description: 'Go to My work', group: 'Navigation' });
      return null;
    }
    function Harness(): ReactNode {
      const [open, setOpen] = useState(true);
      return (
        <TestProvider app="workbench">
          <Bound />
          <main>
            <h1>My work</h1>
          </main>
          <ShortcutsDialog open={open} onOpenChange={setOpen} />
        </TestProvider>
      );
    }
    render(<Harness />);
    await settle();
    await expectNoViolations(document.body);
  });

  it('CommandPalette: groups, a nested page, and no results with a fallback row', async () => {
    window.localStorage.setItem('itsm-recents:admin', JSON.stringify([{ id: 'INC-1', label: 'INC-000001 Printer jammed', href: '/tickets/1', kind: 'ticket' }]));
    function Harness(): ReactNode {
      const [open, setOpen] = useState(true);
      return (
        <TestProvider>
          <main>
            <h1>Rules</h1>
          </main>
          <CommandPalette
            open={open}
            onOpenChange={setOpen}
            fallback={(query) => ({ id: 'search', label: `Search tickets for ‘${query}’`, icon: 'search', href: `/tickets?q=${query}` })}
            providers={[
              {
                id: 'nav',
                group: 'Go to',
                items: [
                  { id: 'rules', label: 'Rules', href: '/rules', icon: 'automation', shortcut: 'g r' },
                  { id: 'assign', label: 'Assign to…', icon: 'user', children: () => [{ id: 'jo', label: 'Jo Resolver', meta: 'Available', run: () => undefined }] },
                  { id: 'delete', label: 'Delete rule', tone: 'danger', description: 'Removes it everywhere', run: () => undefined },
                  { id: 'off', label: 'Publish rule', disabled: true, run: () => undefined },
                ],
              },
            ]}
          />
        </TestProvider>
      );
    }
    render(<Harness />);
    await settle();
    await expectNoViolations(document.body);

    const input = document.querySelector<HTMLInputElement>('.itsm-CommandPalette__input')!;
    typeInto(input, 'assign');
    press(input, 'Enter');
    await settle();
    await expectNoViolations(document.body);

    press(input, 'Escape');
    typeInto(input, 'printer toner');
    await expectNoViolations(document.body);
  });
});
