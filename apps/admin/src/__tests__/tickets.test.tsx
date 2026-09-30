// @vitest-environment jsdom
import { act, forwardRef, type AnchorHTMLAttributes, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type Ticket } from '@itsm/sdk';

vi.mock('server-only', () => ({}));

let search = '';
const router = { refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), forward: vi.fn() };
vi.mock('next/navigation', () => ({
  usePathname: () => '/tickets',
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(search),
}));

const ticketFixture = (overrides: Partial<Ticket> = {}): Ticket => ({
  id: '00000000-0000-4000-8000-000000000001',
  number: 'INC-000042',
  type: 'incident',
  title: 'Printer on fire',
  description: '<p>Smoke &amp; flames</p><p>Second floor</p>',
  status: 'in_progress',
  statusCategory: 'open',
  priority: 'P2',
  impact: 'high',
  urgency: 'medium',
  requesterId: '00000000-0000-4000-8000-0000000000aa',
  affectedUserId: null,
  assigneeId: '00000000-0000-4000-8000-0000000000bb',
  groupId: '00000000-0000-4000-8000-0000000000cc',
  serviceId: null,
  categoryId: null,
  orgId: null,
  sourceChannel: 'email',
  parentId: null,
  dueAt: '2026-10-01T12:00:00Z',
  resolvedAt: null,
  closedAt: null,
  reopenCount: 0,
  custom: {},
  version: 3,
  createdAt: '2026-09-30T08:00:00Z',
  updatedAt: '2026-09-30T08:00:00Z',
  ...overrides,
});

const ticket = vi.fn(async (_number: string) => ticketFixture());
const ticketSla = vi.fn(async (_number: string) => ({
  ticketId: 't',
  timers: [
    { id: 'x', targetType: 'resolution', state: 'running', startedAt: '2026-09-30T08:00:00Z', dueAt: '2026-10-01T12:00:00Z', remainingMs: 7_200_000, elapsedMs: 0, warningsFired: 0, metAt: null, breachedAt: null },
  ],
}));
const tickets = vi.fn(async () => ({ data: [ticketFixture({ id: '00000000-0000-4000-8000-000000000002', number: 'INC-000043', assigneeId: '00000000-0000-4000-8000-0000000000dd' })], nextCursor: null }));
const users = vi.fn(async () => [
  { id: '00000000-0000-4000-8000-0000000000aa', displayName: 'Ada Requester', email: 'ada@example.com', status: 'active', primaryOrgId: null, isExternal: false },
  { id: '00000000-0000-4000-8000-0000000000dd', displayName: 'Dee Agent', email: 'dee@example.com', status: 'active', primaryOrgId: null, isExternal: false },
]);
vi.mock('../client/api.js', () => ({ api: { observe: { ticket, ticketSla, tickets }, tenant: { users } } }));

const { ItsmProvider } = await import('@itsm/ui');
const { TicketsView } = await import('../components/tickets/TicketsView.js');
const presentation = await import('../components/tickets/presentation.js');
const { cleanupDocument, clickAsync, render } = await import('./support/render.js');

/**
 * Tickets (SPEC §6.1, X-13): the query string it answers to — including the
 * legacy `?status=…&assignee=none` links — the filter it sends the API, rows
 * with names instead of ids, and the read-only drawer whose one action opens
 * the workbench.
 */

const Link = forwardRef<HTMLAnchorElement, AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; prefetch?: boolean | null }>(function Link(
  { prefetch: _prefetch, ...props },
  ref,
) {
  return <a ref={ref} {...props} />;
});

function Frame({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <ItsmProvider
      app="admin"
      Link={Link}
      router={router}
      usePathname={() => '/tickets'}
      useSearchParams={() => new URLSearchParams(search)}
      locale="en-GB"
      timeZone="Europe/London"
    >
      {children}
    </ItsmProvider>
  );
}

beforeEach(() => {
  search = '';
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
});

afterEach(() => {
  cleanupDocument();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

const text = (element: Element | null | undefined): string => (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('the query string', () => {
  it('keeps the legacy links working: status and assignee=none mean what they always meant', () => {
    const query = presentation.readTicketQuery(new URLSearchParams('status=open&assignee=none'));
    expect(query.scope).toBe('open');
    expect(query.assignee).toBe('none');
    expect(presentation.ticketFilter(query)).toEqual({ statusCategory: 'open', assignee: 'none', sort: '-createdAt', limit: 50 });
    for (const status of ['paused', 'resolved', 'closed'] as const) {
      expect(presentation.ticketFilter(presentation.readTicketQuery({ status })).statusCategory).toBe(status);
    }
  });

  it('opens on Open work, and "All" sends no category at all', () => {
    expect(presentation.readTicketQuery({}).scope).toBe('open');
    expect(presentation.readTicketQuery({ status: 'everything' }).scope).toBe('open');
    expect(presentation.ticketFilter(presentation.readTicketQuery({ status: 'all' }))).not.toHaveProperty('statusCategory');
  });

  it('sends the filters the table writes, in the API’s spelling, and drops what the API would refuse', () => {
    const query = presentation.readTicketQuery(
      new URLSearchParams('q=printer&priority=p1,P2,P9&type=incident,bogus&assignee=robert&team=not-a-uuid&service=00000000-0000-4000-8000-0000000000ee&sort=dueAt'),
    );
    expect(presentation.ticketFilter(query)).toEqual({
      statusCategory: 'open',
      q: 'printer',
      priority: 'P1,P2',
      type: 'incident',
      service: '00000000-0000-4000-8000-0000000000ee',
      sort: 'dueAt',
      limit: 50,
    });
    expect(presentation.readTicketQuery({ sort: 'title' }).sort).toBe('-createdAt');
    expect(presentation.ticketFilter(presentation.readTicketQuery({ assignee: '00000000-0000-4000-8000-0000000000bb', team: '00000000-0000-4000-8000-0000000000cc' }))).toMatchObject({
      assignee: '00000000-0000-4000-8000-0000000000bb',
      group: '00000000-0000-4000-8000-0000000000cc',
    });
  });

  it('keeps every other parameter when the scope changes, and closes a drawer', () => {
    expect(presentation.scopeHref('status=open&assignee=none&open=ticket:INC-1', 'paused')).toBe('/tickets?status=paused&assignee=none');
    expect(presentation.scopeHref('status=closed&q=vpn', 'open')).toBe('/tickets?q=vpn');
    expect(presentation.drawerTicket('ticket:INC-000042')).toBe('INC-000042');
    expect(presentation.drawerTicket('rule:vip')).toBeNull();
    expect(presentation.isFiltered(presentation.readTicketQuery({ status: 'closed' }))).toBe(false);
    expect(presentation.isFiltered(presentation.readTicketQuery({ q: 'x' }))).toBe(true);
  });
});

describe('a ticket in words', () => {
  it('names people and teams, and says so when it cannot', () => {
    const row = presentation.ticketRow(
      ticketFixture(),
      (id) => (id === '00000000-0000-4000-8000-0000000000bb' ? 'Bea Agent' : null),
      () => null,
    );
    expect(row.assignee).toEqual({ id: '00000000-0000-4000-8000-0000000000bb', name: 'Bea Agent' });
    expect(row.teamName).toBe('Unknown team');
    expect(presentation.ticketRow(ticketFixture({ assigneeId: null, groupId: null }), () => null, () => null)).toMatchObject({ assignee: null, teamName: null });
    expect(presentation.ticketRow(ticketFixture(), () => null, () => null).assignee?.name).toBe('Unknown person');
  });

  it('reads statuses, types and priorities as words', () => {
    expect(presentation.statusLook('pending_requester', 'paused')).toEqual({ label: 'Waiting on requester', tone: 'neutral', icon: 'pause' });
    expect(presentation.statusLook('awaiting_parts', 'paused').label).toBe('Awaiting parts');
    expect(presentation.typeLabel('question')).toBe('Question');
    expect(presentation.priorityText(ticketFixture())).toBe('P2 · High (high impact, medium urgency)');
    expect(presentation.isOverdue({ dueAt: '2026-09-30T08:00:00Z', statusCategory: 'open' }, Date.parse('2026-09-30T09:00:00Z'))).toBe(true);
    expect(presentation.isOverdue({ dueAt: '2026-09-30T08:00:00Z', statusCategory: 'resolved' }, Date.parse('2026-09-30T09:00:00Z'))).toBe(false);
  });

  it('shows a description as text, never as markup', () => {
    expect(presentation.plainText('<p>Smoke &amp; flames</p><p>Second floor</p><script>alert(1)</script><style>p{}</style>')).toBe('Smoke & flames\nSecond floor');
    expect(presentation.plainText('Plain text\n\n\n\nkept')).toBe('Plain text\n\nkept');
  });

  it('links to the workbench only when it is configured', () => {
    expect(presentation.workbenchHref('https://desk.example/', 'INC-000042')).toBe('https://desk.example/tickets/INC-000042');
    expect(presentation.workbenchHref(undefined, 'INC-000042')).toBeUndefined();
  });
});

describe('the finder', () => {
  const query = presentation.readTicketQuery({});
  const scopes = presentation.SCOPES.map((scope) => ({ value: scope.value, label: scope.label, href: presentation.scopeHref('', scope.value) }));
  const rows = [presentation.ticketRow(ticketFixture(), () => 'Bea Agent', () => 'Service desk')];

  it('draws rows with names, a priority pill in words and the status scope as links', () => {
    const { container } = render(
      <Frame>
        <TicketsView rows={rows} nextCursor={null} query={query} scopes={scopes} people={{}} filtered={false} teams={[{ value: '00000000-0000-4000-8000-0000000000cc', label: 'Service desk' }]} />
      </Frame>,
    );
    const table = container.querySelector('table')!;
    expect(text(table)).toContain('INC-000042');
    expect(text(table)).toContain('Printer on fire');
    expect(text(table)).toContain('Bea Agent');
    expect(text(table)).toContain('Service desk');
    expect(text(table)).not.toContain('00000000-');
    const scope = container.querySelector('nav[aria-label="Status"]')!;
    expect([...scope.querySelectorAll('a')].map((link) => [text(link), link.getAttribute('href')])).toContainEqual(['Paused', '/tickets?status=paused']);
    expect(scope.querySelector('[aria-current="page"]')?.textContent).toContain('Open');
  });

  it('says so when nothing is open, and offers no bulk actions', () => {
    const { container } = render(
      <Frame>
        <TicketsView rows={[]} nextCursor={null} query={query} scopes={scopes} people={{}} filtered={false} />
      </Frame>,
    );
    expect(text(container)).toContain('No open tickets');
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
  });

  it('opens a read-only summary with Open in Workbench, loading the ticket and naming its people', async () => {
    search = 'open=ticket:INC-000042';
    await act(async () => {
      render(
        <Frame>
          <TicketsView rows={rows} nextCursor={null} query={query} scopes={scopes} people={{}} filtered={false} workbenchOrigin="https://desk.example" />
        </Frame>,
      );
    });
    const drawer = document.querySelector('[role="dialog"]')!;
    expect(ticket).toHaveBeenCalledWith('INC-000042');
    expect(ticketSla).toHaveBeenCalledWith('INC-000042');
    const open = [...drawer.querySelectorAll('a')].find((link) => text(link) === 'Open in Workbench')!;
    expect(open.getAttribute('href')).toBe('https://desk.example/tickets/INC-000042');
    // Same tab: not an external link.
    expect(open.getAttribute('target')).toBeNull();
    expect(text(drawer)).toContain('Ada Requester');
    expect(text(drawer)).toContain('P2 · High (high impact, medium urgency)');
    expect(text(drawer)).toContain('Smoke & flames');
    expect(drawer.querySelectorAll('input, textarea, select')).toHaveLength(0);
  });

  it('gives the number to copy when there is no workbench to open', async () => {
    search = 'open=ticket:INC-000042';
    await act(async () => {
      render(
        <Frame>
          <TicketsView rows={rows} nextCursor={null} query={query} scopes={scopes} people={{}} filtered={false} />
        </Frame>,
      );
    });
    const drawer = document.querySelector('[role="dialog"]')!;
    expect([...drawer.querySelectorAll('a')].some((link) => text(link) === 'Open in Workbench')).toBe(false);
    expect(drawer.querySelector('button[aria-label="Copy INC-000042"]')).not.toBeNull();
  });

  it('says a ticket that has gone is gone', async () => {
    ticket.mockRejectedValueOnce(new ApiError(404, null, 'Ticket not found'));
    search = 'open=ticket:INC-999999';
    await act(async () => {
      render(
        <Frame>
          <TicketsView rows={rows} nextCursor={null} query={query} scopes={scopes} people={{}} filtered={false} />
        </Frame>,
      );
    });
    expect(text(document.querySelector('[role="dialog"]'))).toContain('That ticket no longer exists');
  });

  it('appends the next fifty with the same filter, naming the new assignees in one call', async () => {
    const { container } = render(
      <Frame>
        <TicketsView rows={rows} nextCursor="c2" query={presentation.readTicketQuery({ assignee: 'none', status: 'open' })} scopes={scopes} people={{}} filtered />
      </Frame>,
    );
    const more = [...container.querySelectorAll('button')].find((button) => /more/i.test(text(button)))!;
    await clickAsync(more);
    expect(tickets).toHaveBeenCalledWith({ statusCategory: 'open', assignee: 'none', sort: '-createdAt', limit: 50, cursor: 'c2' });
    expect(users).toHaveBeenCalledTimes(1);
    expect(text(container.querySelector('table'))).toContain('Dee Agent');
  });
});
