// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { act, cloneElement, forwardRef, isValidElement, Suspense, type AnchorHTMLAttributes, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApprovalRequest, ArticleSummary, CatalogueItem, Me, PublicStatus, Ticket } from '@itsm/sdk';
import { ApiError } from '@itsm/sdk';
import { ItsmProvider } from '@itsm/ui';
import { structuralVariables, themeVariables } from '@itsm/ui/tokens';
import { cleanupDocument, click, clickAsync, render, type } from './support/render.js';

/**
 * Home and the results page (SPEC §6.3 `/` and `/search?q=`, X-34, F36):
 * the greeting in the person's own zone; one list of their requests with
 * what needs them pinned first and its action on the row; errors that say
 * so instead of "Nothing open"; three topics; the status card; the search
 * combobox with its 300 ms suggestions and "Report '…' as an issue" last;
 * "Yes, it's fixed" from the row; never a priority.
 */

vi.mock('server-only', () => ({}));

let pathname = '/';
const router = { push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() };
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(),
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
  notFound: () => {
    throw new Error('not found');
  },
}));

vi.mock('../app/AppLink.js', () => ({
  AppLink: forwardRef<HTMLAnchorElement, AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; prefetch?: unknown }>(function AppLink({ prefetch, ...props }, ref) {
    void prefetch;
    return <a ref={ref} {...props} />;
  }),
}));

const helpFlow = { open: vi.fn(), available: true };
vi.mock('../components/PortalShell.js', () => ({ useHelpFlow: () => helpFlow }));

const browserApi = {
  search: vi.fn(async (_q: string, _o?: unknown) => ({ data: [] as unknown[], meta: { facets: {}, engine: 'meilisearch' } })),
  catalogue: vi.fn(async () => ({ data: [] as unknown[] })),
  myTickets: vi.fn(async (_f?: unknown) => ({ data: [] as unknown[], nextCursor: null })),
  transition: vi.fn(async (_n: string, _to: string, _v: number) => ({})),
  ticket: vi.fn(async (_n: string) => ({}) as unknown),
};
vi.mock('../client/api.js', () => ({ api: browserApi }));

// "Yes, it's fixed" falls back to a message when the API will not close a request for a requester.
const submitOrQueue = vi.fn(async (_input: unknown) => ({ ok: true as const, queued: false, idempotencyKey: 'key-1' }));
vi.mock('@itsm/pwa', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@itsm/pwa')>()),
  submitOrQueue: (input: unknown) => submitOrQueue(input),
  newIdempotencyKey: () => 'key-1',
}));

const notify = vi.fn();
vi.mock('@itsm/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@itsm/ui')>();
  return { ...actual, notify: Object.assign((...args: unknown[]) => notify(...args), { dismiss: vi.fn(), promise: vi.fn(), progress: vi.fn() }) };
});

/* ---- The server, as the pages see it ----------------------------------- */

let permissions: string[] = [];
let approvals: readonly ApprovalRequest[] | null = null;
const serverApi = {
  myTickets: vi.fn(async (_f?: unknown) => ({ data: [] as Ticket[], nextCursor: null })),
  catalogue: vi.fn(async () => ({ data: [] as CatalogueItem[] })),
  knowledge: vi.fn(async (_f?: unknown) => [] as ArticleSummary[]),
  publicStatus: vi.fn(async (_slug: string) => null as PublicStatus | null),
  search: vi.fn(async (_q: string, _o?: unknown) => ({ data: [] as unknown[], meta: { facets: {}, engine: 'meilisearch' } })),
};

const me = (): Me => ({
  actor: { type: 'user', id: 'u1', displayName: 'Ada Lovelace' },
  tenant: { id: 't', name: 'Acme', slug: 'acme', region: 'eu' },
  permissions: permissions.map((key) => ({ key, scope: null })),
  organisations: [],
  teamIds: [],
  locale: 'en-GB',
  timeZone: 'Europe/London',
});

vi.mock('../server/session.js', () => ({
  requireSession: async () => ({ id: 's1' }),
  currentMe: async () => me(),
  currentApprovals: async () => approvals,
  heldPermissions: (person: Me) => new Set(person.permissions.map((permission) => permission.key)),
  apiFor: () => serverApi,
}));

const home = await import('../app/(portal)/(home)/page.js');
const search = await import('../app/(portal)/search/page.js');
const model = await import('../home/model.js');
const { HomeSearch } = await import('../home/HomeSearch.js');
const { ResolutionActions } = await import('../home/ResolutionActions.js');
// "Yes, it's fixed" loads its rules on first use; loaded once here so a press is a matter of promises.
await import('../requests/resolution.js');
await import('@itsm/pwa');
const { YourRequestsSkeleton } = await import('../home/sections.js');
const { FOCUS_HOME_SEARCH } = await import('../home/events.js');
const { forgetCatalogue, SUGGEST_DELAY_MS } = await import('../help/suggestions.js');

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

function setPhone(phone: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: phone && query.includes('max-width'),
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  }));
}

/* ---- Fixtures ------------------------------------------------------------ */

function ticket(number: string, status: string, updatedAt: string, extra: Partial<Ticket> = {}): Ticket {
  return {
    id: `id-${number}`,
    number,
    type: number.startsWith('REQ') ? 'request' : 'incident',
    title: `Title of ${number}`,
    description: null,
    status,
    statusCategory: 'open',
    priority: 'P1',
    impact: 'high',
    urgency: 'high',
    requesterId: 'u1',
    affectedUserId: null,
    assigneeId: null,
    groupId: null,
    serviceId: null,
    categoryId: null,
    orgId: null,
    sourceChannel: 'portal',
    parentId: null,
    dueAt: null,
    resolvedAt: null,
    closedAt: null,
    reopenCount: 0,
    custom: {},
    version: 3,
    createdAt: updatedAt,
    updatedAt,
    ...extra,
  };
}

function approval(id: string, title: string | null, requestedAt = '2026-09-28T09:00:00Z'): ApprovalRequest {
  return {
    id,
    policyId: 'p',
    policyVersion: 1,
    subjectType: 'request',
    subjectId: 's',
    ticketId: null,
    status: 'pending',
    outcome: null,
    requestedBy: null,
    requestedAt,
    decidedAt: null,
    dueAt: null,
    version: 1,
    stepCount: 1,
    currentStep: { sequence: 1, name: 'Manager approval', status: 'open', dueAt: null, quorum: 1, decidedCount: 0 },
    subject: title ? { kind: 'request', ticketNumber: 'REQ-000077', title, requesterName: 'Jo' } : null,
  };
}

const catalogueItems: CatalogueItem[] = [
  { key: 'reset', name: 'Password reset', description: null, shortSummary: 'Get back in', formKey: null, service: 'Access & accounts', serviceKey: 'access' },
  { key: 'laptop', name: 'New laptop', description: null, shortSummary: null, formKey: null, service: 'Hardware', serviceKey: 'hardware' },
];

const article = (key: string, title: string, viewCount: number): ArticleSummary => ({
  id: key,
  key,
  title,
  status: 'published',
  audience: 'all',
  categoryId: null,
  keywords: [],
  viewCount,
  helpfulCount: 0,
  unhelpfulCount: 0,
  reviewDueAt: null,
  updatedAt: '2026-09-01T00:00:00Z',
  publishedAt: '2026-09-01T00:00:00Z',
});

const status: PublicStatus = {
  page: { slug: 'acme', name: 'Acme status', description: null, supportUrl: null, path: '/status/acme' },
  overall: 'degraded',
  components: [
    { key: 'vpn', name: 'VPN', description: null, group: null, status: 'degraded' },
    { key: 'mail', name: 'Email', description: null, group: null, status: 'operational' },
  ],
  incidents: [{ id: 'i1', title: 'VPN degraded', impact: 'minor', status: 'investigating', startedAt: '2026-09-30T08:00:00Z', resolvedAt: null, components: ['vpn'], updates: [] }],
  maintenance: [],
  generatedAt: '2026-09-30T09:00:00Z',
};

beforeEach(() => {
  pathname = '/';
  permissions = ['ticket.create', 'search.query', 'knowledge.read', 'catalogue.read', 'approval.read'];
  approvals = null;
  for (const mock of [...Object.values(serverApi), ...Object.values(browserApi)]) mock.mockReset();
  serverApi.myTickets.mockResolvedValue({ data: [], nextCursor: null });
  serverApi.catalogue.mockResolvedValue({ data: catalogueItems });
  serverApi.knowledge.mockResolvedValue([]);
  serverApi.publicStatus.mockResolvedValue(null);
  serverApi.search.mockResolvedValue({ data: [], meta: { facets: {}, engine: 'meilisearch' } });
  browserApi.search.mockResolvedValue({ data: [], meta: { facets: {}, engine: 'meilisearch' } });
  browserApi.catalogue.mockResolvedValue({ data: catalogueItems });
  browserApi.myTickets.mockResolvedValue({ data: [], nextCursor: null });
  helpFlow.open.mockClear();
  helpFlow.available = true;
  router.push.mockClear();
  router.refresh.mockClear();
  notify.mockClear();
  submitOrQueue.mockClear();
  forgetCatalogue();
  setPhone(false);
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
  delete process.env.PORTAL_CHANNELS;
});

afterEach(() => {
  cleanupDocument();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/* ---- Rendering a server page in a test ----------------------------------- */

/**
 * Stands in for the server-components renderer: awaits every async
 * component (the page's sections), opens every `<Suspense>` onto what it
 * resolved to, and leaves the rest for React in the browser.
 */
async function resolveServer(node: ReactNode): Promise<ReactNode> {
  if (Array.isArray(node)) return Promise.all(node.map((child) => resolveServer(child as ReactNode)));
  if (!isValidElement(node)) return node;
  const element = node as ReactElement<{ children?: ReactNode }>;
  if (element.type === Suspense) return resolveServer(element.props.children);
  if (typeof element.type === 'function' && element.type.constructor.name === 'AsyncFunction') {
    return resolveServer(await (element.type as (props: unknown) => Promise<ReactNode>)(element.props));
  }
  const { children } = element.props;
  if (children === undefined) return element;
  // Static children go back as arguments, the way JSX passed them (an array prop would read as a keyed list).
  if (Array.isArray(children)) return cloneElement(element, undefined, ...((await resolveServer(children)) as ReactNode[]));
  return cloneElement(element, undefined, await resolveServer(children));
}

function Link({ href, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }): ReactNode {
  return (
    <a href={href} {...rest}>
      {children}
    </a>
  );
}

function Provider({ children }: { children: ReactNode }): ReactNode {
  return (
    <ItsmProvider app="portal" Link={Link} router={router} usePathname={() => pathname} useSearchParams={() => new URLSearchParams()} locale="en-GB" timeZone="Europe/London" storageScope="u1">
      {children}
    </ItsmProvider>
  );
}

async function show(page: Promise<ReactNode>): Promise<void> {
  const tree = await resolveServer(await page);
  render(<Provider>{tree}</Provider>);
  await act(async () => {
    await Promise.resolve();
  });
}

function text(): string {
  return document.body.textContent?.replace(/\s+/g, ' ') ?? '';
}

function button(name: string): HTMLElement {
  const found = [...document.querySelectorAll<HTMLElement>('button, a')].find((node) => node.textContent?.replace(/\s+/g, ' ').trim().startsWith(name));
  if (!found) throw new Error(`no “${name}” in: ${text()}`);
  return found;
}

function rows(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('.app-RequestRow')];
}

/* ---- The rules, as data ---------------------------------------------------- */

describe('Home’s rules', () => {
  it('greets by the clock where the person is, with their first name', () => {
    const at = (iso: string) => new Date(iso);
    expect(model.greetingFor(at('2026-09-30T07:30:00Z'), 'Europe/London', 'Ada Lovelace')).toBe('Good morning, Ada');
    expect(model.greetingFor(at('2026-09-30T12:30:00Z'), 'Europe/London', 'Ada Lovelace')).toBe('Good afternoon, Ada');
    expect(model.greetingFor(at('2026-09-30T12:30:00Z'), 'America/Los_Angeles', null)).toBe('Good morning');
    expect(model.greetingFor(at('2026-09-30T20:00:00Z'), 'Europe/London', '  ')).toBe('Good evening');
    expect(model.todayLabel(at('2026-09-30T23:30:00Z'), 'en-GB', 'Europe/London')).toBe('Thursday 1 October');
    expect(model.todayLabel(at('2026-09-30T12:00:00Z'), 'en-GB', 'Not/AZone')).toBe('Wednesday 30 September');
  });

  it('lists one approval row first, then what is theirs to move, then the rest; five at most', () => {
    const tickets = [
      ticket('INC-000010', 'in_progress', '2026-09-30T10:00:00Z'),
      ticket('INC-000011', 'resolved', '2026-09-20T10:00:00Z'),
      ticket('INC-000012', 'new', '2026-09-29T10:00:00Z'),
      ticket('INC-000013', 'pending_requester', '2026-09-10T10:00:00Z'),
      ticket('INC-000014', 'in_progress', '2026-09-28T10:00:00Z'),
      ticket('INC-000015', 'in_progress', '2026-09-27T10:00:00Z'),
    ];
    const listed = model.homeRows(tickets, [approval('a1', 'Adobe licence for Jo')]);
    expect(listed.map((row) => row.ticket.number || row.key)).toEqual(['REQ-000077', 'INC-000011', 'INC-000013', 'INC-000010', 'INC-000012']);
    expect(listed.map((row) => row.action)).toEqual(['review', 'confirm', 'reply', null, null]);
    expect(listed[0]!.href).toBe('/approvals?open=approval%3Aa1');

    const many = model.homeRows([], [approval('a1', null, '2026-09-01T00:00:00Z'), approval('a2', null, '2026-09-02T00:00:00Z')]);
    expect(many).toHaveLength(1);
    expect(many[0]).toMatchObject({ href: '/approvals', ticket: { title: '2 requests need your approval', updatedAt: '2026-09-02T00:00:00Z' } });
    expect(model.approvalTitle(approval('a3', null))).toBe('Manager approval');
    // Only requester-safe fields travel to the row.
    expect(Object.keys(listed[1]!.ticket).sort()).toEqual(['number', 'status', 'title', 'type', 'updatedAt']);
  });

  it('says the status in words, the popular answers only when there are three, and the channels as configured', () => {
    expect(model.statusSummary(status)).toEqual({
      overall: { label: 'Some services have problems', tone: 'warning', icon: 'triangle-alert' },
      components: [{ key: 'vpn', name: 'VPN', state: { label: 'Degraded', tone: 'warning', icon: 'triangle-alert' } }],
    });
    expect(model.statusSummary({ ...status, overall: 'operational', components: [] }).overall.label).toBe('All services running');
    expect(model.popularAnswers([article('a', 'A', 1), article('b', 'B', 9)])).toEqual([]);
    expect(model.popularAnswers([article('a', 'A', 1), article('b', 'B', 9), article('c', 'C', 5), article('d', 'D', 0)]).map((answer) => answer.key)).toEqual(['b', 'c', 'a']);
    expect(model.parseChannels(' Email, teams,,email, <script>, slack ')).toEqual(['email', 'teams', 'slack']);
    expect(model.parseChannels(undefined)).toEqual([]);
    expect(model.updatedLabel('2026-09-30T09:42:00Z', new Date('2026-09-30T12:00:00Z'), 'en-GB', 'Europe/London')).toBe('10:42');
    expect(model.updatedLabel('2026-09-28T09:42:00Z', new Date('2026-09-30T12:00:00Z'), 'en-GB', 'Europe/London')).toBe('28 Sept, 10:42');
  });
});

/* ---- Home ---------------------------------------------------------------------- */

describe('Home', () => {
  it('opens with the date, a greeting, one sentence, the search and New request', async () => {
    expect(home.metadata).toEqual({ title: 'Home' });
    await show(home.default());
    const heading = document.querySelector('h1');
    expect(heading?.textContent).toMatch(/^Good (morning|afternoon|evening), Ada$/);
    expect(heading?.getAttribute('tabindex')).toBe('-1');
    expect(document.querySelector('.app-Home__date')?.textContent).toMatch(/^[A-Z][a-z]+day \d{1,2} [A-Z][a-z]+$/);
    expect(text()).toContain('Search for an answer, or tell us what’s wrong.');
    expect(document.querySelector('[role="combobox"]')).not.toBeNull();

    click(button('New request'));
    expect(helpFlow.open).toHaveBeenCalledWith();
  });

  it('pins what needs them first, with its action on the row, and never shows a priority', async () => {
    approvals = [approval('ap1', 'Adobe licence for Jo')];
    serverApi.myTickets.mockResolvedValue({
      data: [
        ticket('INC-000001', 'pending_requester', '2026-09-29T10:00:00Z'),
        ticket('INC-000002', 'resolved', '2026-09-28T10:00:00Z'),
        ticket('REQ-000003', 'in_progress', '2026-09-30T10:00:00Z'),
        ticket('INC-000004', 'new', '2026-09-27T10:00:00Z'),
        ticket('INC-000005', 'new', '2026-09-26T10:00:00Z'),
      ],
      nextCursor: null,
    });
    await show(home.default());

    expect(serverApi.myTickets).toHaveBeenCalledWith({ statusCategory: 'open,paused,resolved', limit: 20 });
    const listed = rows();
    expect(listed).toHaveLength(5);
    expect(listed[0]!.textContent).toContain('Approval waiting');
    expect(listed[0]!.querySelector('a[href="/approvals?open=approval%3Aap1"]')).not.toBeNull();
    expect(listed[1]!.textContent).toContain('Title of INC-000001');
    expect(listed[1]!.querySelector('a[href="/tickets/INC-000001#reply"]')?.textContent).toContain('Reply');
    expect(listed[2]!.textContent).toContain('Yes, it’s fixed');
    expect(listed[2]!.querySelector('a[href="/tickets/INC-000002?fixed=no"]')).not.toBeNull();
    expect(listed[3]!.textContent).toContain('Title of REQ-000003');
    expect((button('See all') as HTMLAnchorElement).getAttribute('href')).toBe('/tickets');
    expect(text()).not.toMatch(/\bP1\b|priority|impact/i);
  });

  it('says it could not load the requests — never "Nothing open" — and offers Retry', async () => {
    serverApi.myTickets.mockRejectedValue(new ApiError(503, null, 'down'));
    await show(home.default());
    expect(text()).toContain('Couldn’t load your requests');
    expect(text()).not.toContain('Nothing open');
    await clickAsync(button('Retry'));
    expect(router.refresh).toHaveBeenCalled();
  });

  it('is calm about having nothing open', async () => {
    await show(home.default());
    expect(text()).toContain('Nothing open. That’s the goal.');
    expect(rows()).toHaveLength(0);
  });

  it('leads the topics to the matching services, and "Something else?" back to the search', async () => {
    await show(home.default());
    expect((button('Access & accounts') as HTMLAnchorElement).getAttribute('href')).toBe('/catalogue#access');
    expect((button('Devices & equipment') as HTMLAnchorElement).getAttribute('href')).toBe('/catalogue#hardware');
    click(button('Something else?'));
    expect(document.activeElement?.getAttribute('role')).toBe('combobox');
  });

  it('leaves the topics out for somebody who cannot see Services, and New request for somebody who cannot report', async () => {
    permissions = ['search.query', 'knowledge.read'];
    helpFlow.available = false;
    await show(home.default());
    expect(serverApi.catalogue).not.toHaveBeenCalled();
    expect(text()).not.toContain('Browse by topic');
    expect(text()).not.toContain('New request');
  });

  it('shows an open incident, the service status, popular answers and the other channels', async () => {
    process.env.PORTAL_CHANNELS = 'email,teams';
    serverApi.publicStatus.mockResolvedValue(status);
    serverApi.knowledge.mockResolvedValue([article('a', 'Reset your password', 90), article('b', 'Set up the VPN', 50), article('c', 'Book a desk', 10)]);
    await show(home.default());

    expect(serverApi.publicStatus).toHaveBeenCalledWith('acme');
    expect(serverApi.knowledge).toHaveBeenCalledWith({ status: 'published', limit: 200 });
    expect(text()).toContain('VPN degraded. We’re on it.');
    const follow = button('Follow updates') as HTMLAnchorElement;
    expect(follow.getAttribute('href')).toMatch(/\/status\/acme$/);
    expect(text()).toContain('Some services have problems');
    expect(text()).toContain('VPN');
    const answers = [...document.querySelectorAll('.app-Good__links a')].map((link) => link.textContent);
    expect(answers).toEqual(['Reset your password', 'Set up the VPN', 'Book a desk']);
    expect(text()).toContain('Other ways to reach us');
    expect([...document.querySelectorAll('.app-Good__channel')].map((node) => node.textContent)).toEqual(['Email', 'Teams']);
  });

  it('says it could not check the status rather than claiming all is well', async () => {
    serverApi.publicStatus.mockRejectedValue(new Error('down'));
    await show(home.default());
    expect(text()).toContain('Couldn’t check service status just now.');
    expect(text()).not.toContain('All services running');
  });

  it('holds its requests’ place with a list-shaped skeleton while they load', () => {
    render(<YourRequestsSkeleton />);
    expect(document.querySelector('h2')?.textContent).toBe('Your requests');
    expect(document.querySelector('.itsm-SkeletonList')).not.toBeNull();
  });
});

/* ---- The search field -------------------------------------------------------------- */

describe('Home’s search', () => {
  const can = { search: true, readKnowledge: true, readCatalogue: true, createTickets: true };
  const hit = { entityType: 'knowledge', entityId: 'a1', title: 'Set up the VPN', snippet: 'the <b>VPN</b> client', rank: 1, facets: { key: 'set-up-vpn' } };

  function input(): HTMLInputElement {
    return document.querySelector('[role="combobox"]') as HTMLInputElement;
  }

  function key(name: string): void {
    act(() => {
      input().dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
    });
  }

  async function typeAndWait(value: string): Promise<void> {
    act(() => input().focus());
    type(input(), value);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SUGGEST_DELAY_MS);
    });
    for (let turn = 0; turn < 3; turn += 1) {
      await act(async () => {
        await Promise.resolve();
      });
    }
  }

  it('is a combobox whose list groups answers, services and requests, with the report row last', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    browserApi.search.mockResolvedValue({ data: [hit], meta: { facets: {}, engine: 'meilisearch' } });
    browserApi.myTickets.mockResolvedValue({ data: [ticket('INC-000009', 'pending_requester', '2026-09-29T10:00:00Z', { title: 'VPN drops' })], nextCursor: null });
    render(
      <Provider>
        <HomeSearch can={can} />
      </Provider>,
    );
    const field = input();
    expect(field.getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById(field.getAttribute('aria-controls')!)?.getAttribute('role')).toBe('listbox');

    await typeAndWait('vpn');
    expect(browserApi.search).toHaveBeenCalledWith('vpn', { types: 'knowledge', limit: 4 });
    expect(field.getAttribute('aria-expanded')).toBe('true');
    const groups = [...document.querySelectorAll('[role="group"]')].map((group) => document.getElementById(group.getAttribute('aria-labelledby')!)?.textContent);
    expect(groups).toEqual(['Answers', 'Your requests']);
    const options = [...document.querySelectorAll('[role="option"]')];
    expect(options.at(-1)?.textContent).toBe('Report ‘vpn’ as an issue');
    expect(document.querySelector('[role="option"] mark')?.textContent).toBe('VPN');

    key('ArrowDown');
    expect(field.getAttribute('aria-activedescendant')).toBe(options[0]!.id);
    expect(options[0]!.getAttribute('aria-selected')).toBe('true');
    key('Enter');
    expect(router.push).toHaveBeenCalledWith('/knowledge/set-up-vpn');
  });

  it('shows every result on /search when Enter is pressed with nothing chosen', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    render(
      <Provider>
        <HomeSearch can={can} />
      </Provider>,
    );
    await typeAndWait('printer toner');
    key('Enter');
    expect(router.push).toHaveBeenCalledWith('/search?q=printer%20toner');
  });

  it('reports what was typed from the last row, and closes then clears on Escape', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    render(
      <Provider>
        <HomeSearch can={can} />
      </Provider>,
    );
    await typeAndWait('scanner');
    key('ArrowUp');
    key('Enter');
    expect(helpFlow.open).toHaveBeenCalledWith({ step: 'details', text: 'scanner' });

    act(() => input().focus());
    type(input(), 'scanner broken');
    expect(input().getAttribute('aria-expanded')).toBe('true');
    key('Escape');
    expect(input().getAttribute('aria-expanded')).toBe('false');
    key('Escape');
    expect(input().value).toBe('');
  });

  it('comes into focus with / and from "Something else?"', () => {
    render(
      <Provider>
        <HomeSearch can={can} />
      </Provider>,
    );
    act(() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true }));
    });
    expect(document.activeElement).toBe(input());
    act(() => input().blur());
    act(() => {
      window.dispatchEvent(new Event(FOCUS_HOME_SEARCH));
    });
    expect(document.activeElement).toBe(input());
  });

  it('opens the full-screen flow on a phone, where a list would be squeezed', () => {
    setPhone(true);
    render(
      <Provider>
        <HomeSearch can={can} />
      </Provider>,
    );
    expect(document.querySelector('[role="combobox"]')).toBeNull();
    click(document.querySelector('.app-HomeSearch__trigger')!);
    expect(helpFlow.open).toHaveBeenCalledWith({ step: 'describe' });
  });
});

/* ---- "Is it fixed?" from the row -------------------------------------------------- */

describe('Yes, it’s fixed', () => {
  function mountActions(): void {
    render(
      <Provider>
        <ResolutionActions number="INC-000002" version={3} title="Printer" />
      </Provider>,
    );
  }

  it('closes the request on the version the page read', async () => {
    mountActions();
    await clickAsync(button('Yes, it’s fixed'));
    expect(browserApi.transition).toHaveBeenCalledWith('INC-000002', 'closed', 3, undefined);
    expect(notify).toHaveBeenCalledWith('Thanks, we’ve closed it', { tone: 'success' });
    expect(router.refresh).toHaveBeenCalled();
  });

  it('reads it again after a conflict and closes the fresh version once', async () => {
    browserApi.transition.mockRejectedValueOnce(new ApiError(409, null, 'conflict'));
    browserApi.ticket.mockResolvedValue({ status: 'resolved', version: 4 });
    mountActions();
    await clickAsync(button('Yes, it’s fixed'));
    expect(browserApi.transition).toHaveBeenLastCalledWith('INC-000002', 'closed', 4, undefined);
    expect(notify).toHaveBeenCalledWith('Thanks, we’ve closed it', { tone: 'success' });
  });

  it('counts a close that landed but lost its answer as done, not as a failure', async () => {
    browserApi.transition.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    browserApi.ticket.mockResolvedValue({ status: 'closed', version: 4 });
    mountActions();
    await clickAsync(button('Yes, it’s fixed'));
    expect(browserApi.transition).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith('Thanks, we’ve closed it', { tone: 'success' });
    expect(notify).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ tone: 'danger' }));
  });

  it('confirms with a message when the API will not close it for a requester, and thanks them on the row', async () => {
    browserApi.transition.mockRejectedValueOnce(new ApiError(403, null, 'forbidden'));
    browserApi.ticket.mockResolvedValue({ status: 'resolved', version: 3 });
    mountActions();
    await clickAsync(button('Yes, it’s fixed'));
    expect(submitOrQueue).toHaveBeenCalledTimes(1);
    expect(submitOrQueue.mock.calls[0]![0]).toMatchObject({ body: { body: 'Confirmed fixed. Thanks!', visibility: 'public', channel: 'portal' }, idempotencyKey: 'key-1' });
    expect(text()).toContain('Thanks for confirming');
  });

  it('says so when the request has moved on meanwhile', async () => {
    browserApi.transition.mockRejectedValueOnce(new ApiError(428, null, 'precondition'));
    browserApi.ticket.mockResolvedValue({ status: 'reopened', version: 5 });
    mountActions();
    await clickAsync(button('Yes, it’s fixed'));
    expect(browserApi.transition).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith('This request has moved on since the page loaded', { tone: 'info' });
  });

  it('keeps the rules and the outbox out of Home’s first load, loading them when a row can be confirmed', () => {
    // Paths through a variable: Vite rewrites `new URL('<literal>', import.meta.url)` into an asset URL.
    const read = (path: string): string => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
    const hook = read('../requests/useConfirmFixed.ts');
    expect(hook).not.toMatch(/^import (?!type )[^;]*from '(\.\/resolution\.js|@itsm\/pwa)';/m);
    expect(hook).toContain("import('./resolution.js')");
    const row = read('../home/ResolutionActions.tsx');
    expect(row).not.toMatch(/from '(@itsm\/pwa|\.\.\/requests\/resolution\.js)'/);
  });

  it('needs a connection', () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
    mountActions();
    expect(button('Yes, it’s fixed').getAttribute('aria-disabled')).toBe('true');
    expect(text()).toContain('Needs a connection');
  });
});

/* ---- /search?q= -------------------------------------------------------------------------- */

describe('/search', () => {
  const params = (q?: string) => Promise.resolve(q === undefined ? {} : { q });

  it('names the search, and lists answers, services and requests with "See all" and the report action last', async () => {
    serverApi.search.mockResolvedValue({ data: [{ entityType: 'knowledge', entityId: 'a1', title: 'Set up the VPN', snippet: 'the <b>VPN</b> <img src=x onerror=alert(1)>', rank: 1, facets: { key: 'set-up-vpn' } }], meta: { facets: {}, engine: 'meilisearch' } });
    serverApi.catalogue.mockResolvedValue({ data: [{ key: 'vpn-access', name: 'VPN access', description: null, shortSummary: 'Remote access', formKey: null, service: 'Network', serviceKey: 'network' }, ...catalogueItems] });
    serverApi.myTickets.mockResolvedValue({ data: [ticket('INC-000009', 'new', '2026-09-29T10:00:00Z', { title: 'VPN drops' })], nextCursor: null });

    expect(await search.generateMetadata({ searchParams: params('vpn') })).toEqual({ title: 'Results for ‘vpn’' });
    await show(search.default({ searchParams: params('vpn') }));

    expect(document.querySelector('h1')?.textContent).toBe('Results for ‘vpn’');
    expect(serverApi.search).toHaveBeenCalledWith('vpn', { types: 'knowledge', limit: 6 });
    expect(serverApi.myTickets).toHaveBeenCalledWith({ q: 'vpn', limit: 6 });
    expect([...document.querySelectorAll('h2')].map((heading) => heading.textContent)).toEqual(['Answers', 'Services', 'Your requests']);
    const seeAll = [...document.querySelectorAll<HTMLAnchorElement>('.app-Results__head a')].map((link) => link.getAttribute('href'));
    expect(seeAll).toEqual(['/knowledge?q=vpn', '/catalogue?q=vpn', '/tickets?show=all&q=vpn']);
    expect(document.querySelector('.app-Results__snippet mark')?.textContent).toBe('VPN');
    expect(document.querySelector('.app-Results__snippet img')).toBeNull();
    expect(text()).toContain('VPN access');
    expect(text()).not.toContain('Password reset');
    expect(rows()).toHaveLength(1);

    click(button('Report ‘vpn’ as an issue'));
    expect(helpFlow.open).toHaveBeenCalledWith({ step: 'details', text: 'vpn' });
  });

  it('offers to report it when nothing matched', async () => {
    await show(search.default({ searchParams: params('zzz') }));
    expect(text()).toContain('Nothing matched ‘zzz’');
    expect(button('Report ‘zzz’ as an issue')).toBeTruthy();
  });

  it('lets a section fail on its own', async () => {
    serverApi.search.mockRejectedValue(new ApiError(503, null, 'down'));
    serverApi.myTickets.mockResolvedValue({ data: [ticket('INC-000009', 'new', '2026-09-29T10:00:00Z')], nextCursor: null });
    await show(search.default({ searchParams: params('vpn') }));
    expect(text()).toContain('Couldn’t load answers');
    expect(rows()).toHaveLength(1);
  });

  it('is a plain search page without words, and explains itself without the permission', async () => {
    await show(search.default({ searchParams: params('  ') }));
    expect(document.querySelector('h1')?.textContent).toBe('Search');
    expect(serverApi.search).not.toHaveBeenCalled();
    cleanupDocument();

    permissions = ['ticket.create'];
    await show(search.default({ searchParams: params('vpn') }));
    expect(text()).toContain('Search isn’t available to you');
    expect(serverApi.search).not.toHaveBeenCalled();
  });
});

/* ---- Styles ------------------------------------------------------------------------ */

describe('the styles for Home, the flow and the results', () => {
  it('reference no variable the design system does not emit', () => {
    const defined = new Set([...Object.keys(structuralVariables()), ...Object.keys(themeVariables('apple'))]);
    for (const path of ['../home/home.css', '../help/help.css', '../app/(portal)/search/search.css']) {
      const css = readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
      const used = [...new Set([...css.matchAll(/var\((--itsm-[a-zA-Z0-9-]+)/g)].map((match) => match[1]!))];
      expect(used.length, path).toBeGreaterThan(10);
      expect(used.filter((variable) => !defined.has(variable)), path).toEqual([]);
      // App rules may place a design-system part in context; they never restyle one on its own.
      expect(css, path).not.toMatch(/^\s*\.itsm-/m);
    }
  });
});
