// @vitest-environment jsdom
import { act, forwardRef, type AnchorHTMLAttributes, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let pathname = '/rules';
const router = { refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), forward: vi.fn() };
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(),
}));

const { buildAreaModel } = await import('@itsm/contracts/areas');
const { ItsmProvider } = await import('@itsm/ui');
const { AdminShell, PublishNavBadges, helpItems, signInAgainUrl } = await import('../components/AdminShell.js');
const { areaCommands, goToCommands, createCommands, findIn, findSettings, fold, setCommandPaletteOpen } = await import('../client/palette.js');
const { notificationHref } = await import('../client/live.js');
const { accessGroups } = await import('../components/AdminOverlays.js');
const { Forbidden } = await import('../components/Forbidden.js');
const { cleanupDocument, render } = await import('./support/render.js');

/**
 * The frame, rendered: the sidebar is the person's own navigation, ⌘K / Ctrl
 * K opens the palette from inside a text field (D14), the palette finds
 * pages by the words people use, and a refused page keeps its header — on
 * the v3 frame props only (SPEC v3 §3.10, RV1): the person's areas, the
 * links into the other areas built from them, the demo bar and the frame's
 * chip as slots.
 */

const ORIGINS = { portal: 'https://help.acme.test', workbench: 'https://desk.acme.test', admin: 'https://admin.acme.test', site: 'https://itsm.example' };

/** An administrator who also works tickets: all three areas. */
const STAFF = buildAreaModel({ app: 'admin', held: ['admin.setting.read', 'ticket.update'], session: { kind: 'oidc' }, origins: ORIGINS, workspace: 'Acme' });
/** A platform operator only: Administration and the Help Portal. */
const OPERATOR = buildAreaModel({ app: 'admin', held: ['platform.tenant.manage'], session: { kind: 'oidc' }, origins: { admin: ORIGINS.admin }, workspace: 'Acme' });
/** Jordan Lee in the demo. */
const DEMO = buildAreaModel({
  app: 'admin',
  held: ['admin.setting.read'],
  session: { kind: 'demo', persona: 'admin' },
  origins: ORIGINS,
  workspace: 'Northwind Traders (UK)',
  agentTeamIds: ['team-sd'],
});
const KEYWORDS = { portal: ['portal', 'help'], workbench: ['ticketing', 'desk'], admin: ['admin', 'settings'] } as const;

const Link = forwardRef<HTMLAnchorElement, AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; prefetch?: boolean | null }>(function Link(
  { prefetch: _prefetch, ...props },
  ref,
) {
  return <a ref={ref} {...props} />;
});

function grants(...keys: string[]): { key: string; scope: string }[] {
  return keys.map((key) => ({ key, scope: 'any' }));
}

function Frame({
  permissions,
  areas = OPERATOR,
  systemBar,
  context,
  children,
}: {
  readonly permissions: { key: string; scope: string }[];
  readonly areas?: typeof STAFF;
  readonly systemBar?: ReactNode;
  readonly context?: ReactNode;
  readonly children?: ReactNode;
}): ReactNode {
  return (
    <ItsmProvider
      app="admin"
      Link={Link}
      router={router}
      usePathname={() => pathname}
      useSearchParams={() => new URLSearchParams()}
      locale="en-GB"
      timeZone="Europe/London"
    >
      <AdminShell
        person={{ name: 'Ada Admin', detail: 'Acme' }}
        permissions={permissions}
        areas={areas}
        areaKeywords={KEYWORDS}
        links={{ knowledge: 'https://help.acme.test/knowledge', serviceDeskTickets: 'https://desk.acme.test/tickets/' }}
        systemBar={systemBar}
        context={context}
      >
        {children ?? (
          <main>
            <h1>Rules</h1>
            <input aria-label="Search rules" />
          </main>
        )}
      </AdminShell>
    </ItsmProvider>
  );
}

beforeEach(() => {
  pathname = '/rules';
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: /min-width/.test(query),
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }));
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ unread: 2, data: [] }), { status: 200, headers: { 'content-type': 'application/json' } })),
  );
});

afterEach(() => {
  act(() => setCommandPaletteOpen(false));
  cleanupDocument();
  vi.unstubAllGlobals();
});

async function settle(): Promise<void> {
  for (let index = 0; index < 5; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
}

describe('the frame', () => {
  it('draws the person’s own navigation, with the current page marked', async () => {
    const { container } = render(<Frame permissions={grants('rules.rule.read', 'ticket.read', 'notification.read')} />);
    await settle();
    const nav = container.querySelector('nav[aria-label="Administration"]')!;
    const labels = [...nav.querySelectorAll('a')].map((link) => link.textContent?.trim());
    expect(labels).toEqual(expect.arrayContaining(['Command centre', 'Tickets', 'Rules']));
    expect(labels).not.toContain('Workflows');
    expect(labels).not.toContain('Tenants');
    expect(nav.querySelector('a[aria-current="page"]')?.getAttribute('href')).toBe('/rules');
  });

  it('titles the page in the v3 top bar from the current nav item, with the product lockup linking home', async () => {
    const { container } = render(<Frame permissions={grants('rules.rule.read')} />);
    await settle();
    expect(container.querySelectorAll('header.itsm-AppTopBar')).toHaveLength(1);
    expect(container.querySelector('.itsm-AppTopBar__title')?.textContent).toBe('Rules');
    const home = container.querySelector('a.itsm-Sidebar__home');
    expect(home?.getAttribute('href')).toBe('/');
    expect(home?.textContent).toContain('IT Service Management');
    expect(home?.textContent).toContain('Acme');
  });

  it('offers the person’s areas from the Area card, never a v2 brand menu', async () => {
    const { container } = render(<Frame permissions={grants('rules.rule.read')} areas={STAFF} />);
    await settle();
    const card = container.querySelector<HTMLButtonElement>('.itsm-Sidebar button.itsm-AreaSwitcher');
    expect(card?.getAttribute('aria-label') ?? card?.textContent).toMatch(/Administration/);
    expect(card?.getAttribute('aria-haspopup')).toBe('menu');
    expect(container.querySelector('button.itsm-Sidebar__brand')).toBeNull();
  });

  it('draws a one-area person a lockup, with no way out to offer', async () => {
    const lone = buildAreaModel({ app: 'admin', held: ['admin.setting.read'], session: { kind: 'oidc' }, origins: { admin: ORIGINS.admin } });
    const { container } = render(<Frame permissions={grants('rules.rule.read')} areas={lone} />);
    await settle();
    expect(lone.visible).toBe(false);
    expect(container.querySelector('.itsm-Sidebar .itsm-AreaSwitcher')?.getAttribute('data-display')).toBe('lockup');
  });

  it('puts the demo bar first and the frame’s chip in the top bar, as slots', async () => {
    const { container } = render(
      <Frame
        permissions={grants('rules.rule.read')}
        areas={DEMO}
        systemBar={<div className="itsm-SystemBar" role="region" aria-label="Demo environment" />}
        context={<span className="test-chip">MI-0004 · Sev 2</span>}
      />,
    );
    await settle();
    const root = container.querySelector('.itsm-AppShell')!;
    expect(root.hasAttribute('data-system-bar')).toBe(true);
    // The bar comes before the frame's grid, after the skip links.
    const order = [...root.children].map((child) => child.className);
    expect(order.findIndex((name) => name.includes('itsm-SystemBar'))).toBeLessThan(order.findIndex((name) => name.includes('itsm-AppShell__frame')));
    expect(container.querySelector('.itsm-AppTopBar .test-chip')?.textContent).toBe('MI-0004 · Sev 2');
  });

  it('shows the platform group to an operator only', async () => {
    const { container } = render(<Frame permissions={grants('platform.tenant.manage')} />);
    await settle();
    const links = [...container.querySelectorAll('nav[aria-label="Administration"] a')].map((link) => link.getAttribute('href'));
    expect(links).toEqual(expect.arrayContaining(['/tenants', '/plans']));
  });

  it('opens the command palette with Ctrl K from inside a text field', async () => {
    const { container } = render(<Frame permissions={grants('rules.rule.read', 'workload.read')} />);
    await settle();
    const field = container.querySelector<HTMLInputElement>('input[aria-label="Search rules"]')!;
    field.focus();
    await act(async () => {
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }));
    });
    await settle();
    const input = document.body.querySelector<HTMLInputElement>('input.itsm-CommandPalette__input');
    expect(input).not.toBeNull();
    expect(document.activeElement).toBe(input);
    // "Go to" lists the pages this person may open.
    const options = [...document.body.querySelectorAll('[role="option"]')].map((option) => option.textContent ?? '');
    expect(options.some((text) => text.includes('Workforce'))).toBe(true);
    expect(options.some((text) => text.includes('Integrations'))).toBe(false);
  });

  it('goes to a page with g then its letter, only where the person may open it', async () => {
    render(<Frame permissions={grants('ticket.read')} />);
    await settle();
    const press = (key: string): void => {
      act(() => {
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      });
    };
    press('g');
    press('t');
    expect(router.push).toHaveBeenLastCalledWith('/tickets');
    router.push.mockClear();
    press('g');
    press('r');
    expect(router.push).not.toHaveBeenCalled();
  });

  it('shows streamed badge counts beside their items', async () => {
    const { container } = render(
      <>
        <Frame permissions={grants('workflow.read')} />
        <PublishNavBadges values={{ failedRuns: { value: 3 } }} />
      </>,
    );
    await settle();
    const workflows = [...container.querySelectorAll('nav[aria-label="Administration"] a')].find((link) => link.getAttribute('href') === '/workflows');
    expect(workflows?.textContent).toContain('3');
    act(() => {
      render(<PublishNavBadges values={{}} />);
    });
  });
});

describe('Switch area in the palette (SPEC v3 §3.9)', () => {
  it('offers the other areas by name, words and description, linking where the area menu does', () => {
    const items = areaCommands({ model: STAFF, keywords: KEYWORDS });
    expect(items.map((item) => item.label)).toEqual(['Switch to Help Portal', 'Switch to Service Desk']);
    const desk = items.find((item) => item.id === 'area-workbench')!;
    expect(desk.href).toBe('https://desk.acme.test/resume');
    expect(desk.keywords).toEqual(expect.arrayContaining(['ticketing', 'Service Desk']));
    expect(desk.description).toBe('Work tickets, queues and SLAs');
    expect(items.some((item) => item.id === 'area-home')).toBe(false);
  });

  it('says who each area opens as in the demo, and ends with the site', () => {
    const items = areaCommands({ model: DEMO, keywords: KEYWORDS });
    const portal = items.find((item) => item.id === 'area-portal')!;
    expect(portal.href).toBe('https://help.acme.test/demo?persona=employee&demo=1&redirectTo=%2Fresume');
    expect(portal.description).toBe("Get help, request things and follow your requests · You'll continue as Emma Clarke, Finance Manager");
    expect(items.at(-1)).toMatchObject({ id: 'area-home', label: 'IT Service Management home', href: 'https://itsm.example/' });
  });

  it('offers nothing to a person with one area', () => {
    const lone = buildAreaModel({ app: 'admin', held: [], session: { kind: 'oidc' }, origins: {} });
    expect(areaCommands({ model: lone, keywords: KEYWORDS })).toEqual([]);
    expect(areaCommands(null)).toEqual([]);
  });

  it('lists the group after Go to when ⌘K opens', async () => {
    const { container } = render(<Frame permissions={grants('rules.rule.read')} areas={STAFF} />);
    await settle();
    const field = container.querySelector<HTMLInputElement>('input[aria-label="Search rules"]')!;
    field.focus();
    await act(async () => {
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }));
    });
    await settle();
    const groups = [...document.body.querySelectorAll('.itsm-CommandPalette__group')].map((group) => group.textContent ?? '');
    expect(groups.indexOf('Switch area')).toBe(groups.indexOf('Go to') + 1);
    const options = [...document.body.querySelectorAll('[role="option"]')].map((option) => option.textContent ?? '');
    expect(options.some((text) => text.includes('Switch to Service Desk'))).toBe(true);
  });
});

describe('the Help menu and the links into other areas', () => {
  it('offers the knowledge base and the shortcuts to everyone', () => {
    const items = helpItems(STAFF, 'https://help.acme.test/knowledge');
    expect(items.map((item) => ('label' in item ? item.label : ''))).toEqual(['Knowledge base · Help Portal', 'Keyboard shortcuts…']);
    expect(items[0]).toMatchObject({ href: 'https://help.acme.test/knowledge' });
    expect(items[0]).not.toHaveProperty('description');
  });

  it('adds how the demo works and the site in the demo, and who the Help Portal opens as', () => {
    const items = helpItems(DEMO, 'https://help.acme.test/demo?persona=employee&demo=1&redirectTo=%2Fknowledge');
    expect(items.map((item) => ('label' in item ? item.label : ''))).toEqual([
      'Knowledge base · Help Portal',
      'Keyboard shortcuts…',
      'How the demo works',
      'IT Service Management home',
    ]);
    expect(items[0]).toMatchObject({ description: 'You’ll continue as Emma Clarke' });
    expect(items[2]).toMatchObject({ href: 'https://itsm.example/#how-it-works' });
    expect(items[3]).toMatchObject({ href: 'https://itsm.example/' });
  });

  it('leaves the knowledge base out when the Help Portal is not configured', () => {
    expect(helpItems(OPERATOR, null).map((item) => ('id' in item ? item.id : ''))).toEqual(['shortcuts']);
  });

  it('opens a notification’s ticket in the Service Desk, or in this console when it cannot', () => {
    const item = { id: 'n1', subject: 'Breach', eventType: 'sla.timer.breached', createdAt: '2026-10-02T09:00:00Z', ticketId: 't-1', ticketNumber: 'INC-000004' };
    expect(notificationHref(item, 'https://desk.acme.test/tickets/')).toBe('https://desk.acme.test/tickets/INC-000004');
    expect(notificationHref({ ...item, ticketNumber: undefined }, 'https://desk.acme.test/tickets/')).toBe('https://desk.acme.test/tickets/t-1');
    expect(notificationHref(item, null)).toBe('/tickets?open=ticket:INC-000004');
    expect(notificationHref({ id: 'n2', subject: 'Hello', eventType: 'x', createdAt: '2026-10-02T09:00:00Z' }, null)).toBe('/');
  });

  it('asks the BFF to reopen a demo visit rather than sign in (D22)', () => {
    expect(signInAgainUrl('/rules?x=1', false)).toBe('/api/session/login?redirectTo=%2Frules%3Fx%3D1');
    expect(signInAgainUrl('/rules', true)).toBe('/api/session/login?redirectTo=%2Frules&demo=1');
  });
});

describe('the palette', () => {
  it('finds pages by the words people use for them', () => {
    const everything = { permissions: grants('workload.read', 'admin.setting.read', 'sla.policy.read', 'catalogue.manage') };
    const items = goToCommands(everything);
    const find = (word: string): string[] =>
      items.filter((item) => [item.label, ...(item.keywords ?? [])].some((text) => fold(text).includes(fold(word)))).map((item) => item.label);
    expect(find('queues')).toContain('Workforce');
    expect(find('configuration')).toContain('Settings');
    expect(find('flags')).toContain('Settings');
    expect(find('sla')).toContain('Service levels');
    expect(find('forms')).toContain('Services & requests');
  });

  it('offers creation only to people who may create', () => {
    expect(createCommands({ permissions: grants('rules.rule.read') })).toEqual([]);
    expect(createCommands({ permissions: grants('sla.policy.manage') }).map((item) => item.label)).toContain('New SLA policy');
  });

  it('finds settings and features by the names Settings gives them, and opens the tab that lists them', () => {
    const settings = [
      { key: 'ai.tone', description: 'OD-07 tone for drafted replies' },
      { key: 'ticket.defaultPriority', description: 'Priority when none is given' },
    ];
    const flags = [{ key: 'rules.engine.enabled', module: 'rules', description: 'flag cache TTL applies', value: true }];
    expect(findSettings(settings, flags, 'reply tone')).toEqual([
      { id: 'setting-ai.tone', label: 'Reply tone', description: 'Setting · AI', icon: 'settings', href: '/settings/ai?q=reply+tone#setting-ai-tone' },
    ]);
    expect(findSettings(settings, flags, 'priority').map((item) => item.href)).toEqual(['/settings?q=priority#setting-ticket-defaultPriority']);
    const [flag] = findSettings(settings, flags, 'rules.engine');
    expect(flag).toMatchObject({ description: 'Feature · On', href: '/settings/features?q=rules.engine#flag-rules-engine-enabled' });
    expect(flag!.label).not.toContain('.');
  });

  it('matches every word, accents aside, best first', () => {
    const rows = [{ name: 'VIP requester' }, { name: 'Escalate VIP' }, { name: 'Café opening hours' }];
    expect(findIn(rows, 'vip', (row) => [row.name]).map((row) => row.name)).toEqual(['VIP requester', 'Escalate VIP']);
    expect(findIn(rows, 'cafe hours', (row) => [row.name]).map((row) => row.name)).toEqual(['Café opening hours']);
    expect(findIn(rows, '   ', (row) => [row.name])).toEqual([]);
  });
});

describe('Your access', () => {
  it('lists permissions in words, grouped, each once at its widest scope', () => {
    const groups = accessGroups({
      permissions: [
        { key: 'ticket.read', scope: 'team' },
        { key: 'ticket.read', scope: 'any' },
        { key: 'rules.rule.read', scope: 'any' },
      ],
    });
    expect(groups).toEqual([
      { area: 'Rules', entries: [{ key: 'rules.rule.read', label: 'Read rules', scope: 'any' }] },
      { area: 'Tickets', entries: [{ key: 'ticket.read', label: 'Read tickets', scope: 'any' }] },
    ]);
  });
});

describe('Forbidden', () => {
  it('keeps the page’s header and names the permission to ask for', async () => {
    const { container } = render(
      <ItsmProvider app="admin" Link={Link} router={router} usePathname={() => pathname} useSearchParams={() => new URLSearchParams()} locale="en-GB" timeZone="UTC">
        <Forbidden route="/rules" />
      </ItsmProvider>,
    );
    await settle();
    expect(container.querySelector('h1')?.textContent).toBe('Rules');
    expect(container.textContent).toContain("You don't have access to Rules");
    expect(container.textContent).toContain('Read rules');
  });
});
