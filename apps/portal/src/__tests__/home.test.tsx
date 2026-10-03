// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { act, cloneElement, forwardRef, isValidElement, Suspense, type AnchorHTMLAttributes, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApprovalRequest, ArticleSummary, CatalogueItem, Me, PublicStatus, Ticket } from '@itsm/sdk';
import { ApiError } from '@itsm/sdk';
import { ItsmProvider } from '@itsm/ui';
import { structuralVariables, themeVariables } from '@itsm/ui/tokens';
import { cleanupDocument, click, clickAsync, render, type } from './support/render.js';

/**
 * Home v3, the results page and the system pages (v3 §7.2, A6 §6.1, §6.8,
 * §6.12; SPEC §6.3, X-34, F36): the light hero with the kicker, the greeting
 * in the person's own zone and the four quick actions with their counts; the
 * status strip in the one component-state map's tones (degraded `high`); the
 * person's requests as cards with what needs them pinned first, its action
 * on the card and a mini stepper; errors that say so instead of "Nothing
 * open"; common requests; the aside with popular answers (views and the
 * helpful share), maintenance coming up and the channels; the search
 * combobox with its 300 ms suggestions and "Report '…' as an issue" last;
 * "Yes, it's fixed" from the card; counts on the results page's groups; the
 * not-found, error and offline pages; never a priority; axe on each.
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
  myTickets: vi.fn(async (_f?: unknown) => ({ data: [] as Ticket[], nextCursor: null as string | null })),
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
  currentMe: vi.fn(async () => me()),
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
const { QuickActionsSkeleton } = await import('../home/QuickActions.js');
const loading = await import('../app/(portal)/(home)/loading.js');
const sessionModule = await import('../server/session.js');
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
  return [...document.querySelectorAll<HTMLElement>('.app-RequestCard')];
}

/** The results page's request rows (the shared `RequestRow`). */
function requestRows(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('.app-RequestRow')];
}

/** What a screen reader says for a node: `Count` draws its digits `aria-hidden` and speaks them in hidden text. */
function spoken(node: Element): string {
  const copy = node.cloneNode(true) as HTMLElement;
  for (const hidden of copy.querySelectorAll('[aria-hidden="true"]')) hidden.remove();
  return copy.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

/* ---- axe, as the design system runs it ---------------------------------- */

interface AxeRule {
  readonly id: string;
  readonly nodes: readonly { readonly html: string }[];
}
interface Axe {
  run(context: Element, options: Record<string, unknown>): Promise<{ violations: AxeRule[] }>;
}
// axe-core is the design system's devDependency; this app has none of its own (rule 9), so it is resolved through `@itsm/ui`.
const axe = createRequire(createRequire(import.meta.url).resolve('@itsm/ui'))('axe-core') as Axe;
/** Rules a fragment cannot answer, and rules that need the layout engine jsdom lacks. */
const AXE_OFF = ['region', 'page-has-heading-one', 'html-has-lang', 'bypass', 'document-title', 'html-lang-valid', 'color-contrast', 'color-contrast-enhanced', 'target-size'];

async function violations(): Promise<string[]> {
  const results = await axe.run(document.body, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] },
    rules: Object.fromEntries(AXE_OFF.map((rule) => [rule, { enabled: false }])),
  });
  return results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.html).join(' | ')}`);
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
    expect(many[0]).toMatchObject({ href: '/approvals', ticket: { title: '2 approvals need you', updatedAt: '2026-09-02T00:00:00Z' }, approval: { count: 2, oldestAt: '2026-09-01T00:00:00Z' } });
    expect(model.approvalTitle(approval('a3', null))).toBe('Manager approval');
    // Only requester-safe fields travel to the row.
    expect(Object.keys(listed[1]!.ticket).sort()).toEqual(['number', 'status', 'title', 'type', 'updatedAt']);
  });

  it('says the status in words, in the one component-state map’s tones: degraded is high, never amber', () => {
    expect(model.statusSummary(status)).toEqual({
      overall: { label: 'Some services have problems', tone: 'high', icon: 'triangle-alert' },
      components: [{ key: 'vpn', name: 'VPN', state: { label: 'Degraded', tone: 'high', icon: 'triangle-alert' } }],
    });
    expect(model.statusSummary({ ...status, overall: 'operational', components: [] }).overall).toEqual({ label: 'All services running', tone: 'success', icon: 'circle-check' });
    expect(model.statusSummary({ ...status, overall: 'partial_outage' }).overall.tone).toBe('danger');
    expect(model.componentState('partial_outage').tone).toBe('danger');
    expect(model.componentState('maintenance')).toEqual({ label: 'Maintenance', tone: 'info', icon: 'wrench' });
    expect(model.componentState('toString').label).toBe('Unknown');
    for (const state of ['operational', 'degraded', 'partial_outage', 'major_outage', 'maintenance']) expect(model.componentState(state).tone, state).not.toBe('warning');
    // An open incident takes the worst affected component's tone, and a major one is red.
    expect(model.incidentTone(status, 'i1')).toBe('high');
    expect(model.incidentTone({ ...status, components: [{ ...status.components[0]!, status: 'major_outage' }] }, 'i1')).toBe('danger');
    expect(model.incidentTone({ ...status, incidents: [{ ...status.incidents[0]!, impact: 'major' }] }, 'i1')).toBe('danger');
    expect(model.incidentTone(null, 'i1')).toBe('high');
  });

  it('lists the four most read answers — none below three — with views and, from five votes, the helpful share', () => {
    expect(model.popularAnswers([article('a', 'A', 1), article('b', 'B', 9)])).toEqual([]);
    const four = model.popularAnswers([article('a', 'A', 1), article('b', 'B', 9), article('c', 'C', 5), article('d', 'D', 0), article('e', 'E', 0)]);
    expect(four.map((answer) => answer.key)).toEqual(['b', 'c', 'a', 'd']);
    expect(four[0]).toEqual({ key: 'b', title: 'B', views: 9, helpfulShare: null });
    const voted = model.popularAnswers([{ ...article('v', 'VPN', 412), helpfulCount: 91, unhelpfulCount: 9 }, { ...article('w', 'W', 3), helpfulCount: 3, unhelpfulCount: 1 }, article('x', 'X', 2)]);
    expect(voted.map((answer) => answer.helpfulShare)).toEqual([0.91, null, null]);
    expect(model.answerFacts(voted[0]!, 'en-GB')).toBe('412 views · 91% found this helpful');
    expect(model.answerFacts({ key: 'k', title: 'K', views: 1, helpfulShare: null }, 'en-GB')).toBe('1 view');
    expect(model.answerFacts({ key: 'k', title: 'K', views: 1234, helpfulShare: null }, 'en-GB')).toBe('1,234 views');
  });

  it('lists maintenance coming up in the next fourteen days, soonest first, where the person is', () => {
    const now = new Date('2026-10-02T09:00:00Z');
    const window = (id: string, startsAt: string, endsAt: string, state: 'scheduled' | 'in_progress' | 'completed' | 'cancelled' = 'scheduled') => ({
      id,
      title: `Window ${id}`,
      body: null,
      status: state,
      startsAt,
      endsAt,
      components: ['vpn', 'gone'],
    });
    const planned: PublicStatus = {
      ...status,
      maintenance: [
        window('late', '2026-10-30T08:00:00Z', '2026-10-30T10:00:00Z'),
        window('sat', '2026-10-10T07:00:00Z', '2026-10-10T11:00:00Z'),
        window('wed', '2026-10-07T18:00:00Z', '2026-10-07T20:00:00Z'),
        window('done', '2026-10-01T18:00:00Z', '2026-10-01T20:00:00Z', 'completed'),
        window('off', '2026-10-05T18:00:00Z', '2026-10-05T20:00:00Z', 'cancelled'),
        window('now', '2026-10-02T08:00:00Z', '2026-10-02T12:00:00Z', 'in_progress'),
      ],
    };
    const listed = model.comingUp(planned, now, 'en-GB', 'Europe/London');
    expect(listed.map((item) => item.id)).toEqual(['now', 'wed', 'sat']);
    expect(listed[1]).toMatchObject({ when: 'Wed 7 Oct, 19:00–21:00', affects: ['VPN', 'gone'], inProgress: false });
    expect(listed[0]!.inProgress).toBe(true);
    expect(model.windowLabel('2026-10-07T22:00:00Z', '2026-10-08T01:00:00Z', 'en-GB', 'Europe/London')).toBe('Wed 7 Oct, 23:00 – Thu 8 Oct, 02:00');
    expect(model.comingUp(null, now, 'en-GB', 'Europe/London')).toEqual([]);
  });

  it('counts the quick actions honestly: open is not yet resolved, a cut list says so, an unread count is not 0', () => {
    const tickets = { data: [{ status: 'new', statusCategory: 'open' }, { status: 'pending_requester', statusCategory: 'paused' }, { status: 'resolved', statusCategory: 'resolved' }], nextCursor: null };
    const counts = model.quickCounts(tickets, [approval('a1', null), approval('a2', null), approval('a3', null)]);
    expect(counts).toEqual({ open: 2, openCapped: false, approvals: 3 });
    expect(model.openLabel(counts)).toBe('2 open');
    expect(model.approvalsLabel(counts)).toBe('3 waiting');
    expect(model.openLabel(model.quickCounts({ ...tickets, nextCursor: 'c' }, null))).toBe('2+ open');
    expect(model.openLabel(model.quickCounts({ data: [], nextCursor: null }, []))).toBe('Nothing open');
    expect(model.approvalsLabel(model.quickCounts(null, []))).toBe('Nothing waiting');
    expect(model.openLabel(model.quickCounts(null, null))).toBeNull();
    expect(model.approvalsLabel(model.quickCounts(null, null))).toBeNull();
    expect(model.waitedFor('2026-10-01T09:00:00Z', new Date('2026-10-02T10:00:00Z'))).toBe('1 day');
    expect(model.waitedFor('2026-10-02T07:00:00Z', new Date('2026-10-02T10:00:00Z'))).toBe('3 hours');
    expect(model.waitedFor('2026-10-02T09:50:00Z', new Date('2026-10-02T10:00:00Z'))).toBe('under an hour');
  });

  it('draws a card’s mini stepper from the request page’s four stages', () => {
    const states = (status: string) => model.miniSteps(status).map((step) => step.status);
    expect(model.miniSteps('new').map((step) => step.label)).toEqual(['Received', 'Being worked on', 'Resolved', 'Closed']);
    expect(states('new')).toEqual(['current', 'upcoming', 'upcoming', 'upcoming']);
    expect(states('pending_requester')).toEqual(['complete', 'current', 'upcoming', 'upcoming']);
    expect(model.miniSteps('pending_requester')[1]!.description).toBe('Waiting for you');
    expect(states('resolved')).toEqual(['complete', 'complete', 'current', 'upcoming']);
    expect(states('cancelled')).toEqual(['complete', 'skipped', 'skipped', 'complete']);
    expect(model.miniSteps('cancelled')[3]!.label).toBe('Withdrawn');
  });

  it('keeps the channels as configured', () => {
    expect(model.parseChannels(' Email, teams,,email, <script>, slack ')).toEqual(['email', 'teams', 'slack']);
    expect(model.parseChannels(undefined)).toEqual([]);
    expect(model.updatedLabel('2026-09-30T09:42:00Z', new Date('2026-09-30T12:00:00Z'), 'en-GB', 'Europe/London')).toBe('10:42');
    expect(model.updatedLabel('2026-09-28T09:42:00Z', new Date('2026-09-30T12:00:00Z'), 'en-GB', 'Europe/London')).toBe('28 Sept, 10:42');
  });
});

/* ---- Home ---------------------------------------------------------------------- */

describe('Home', () => {
  it('opens with the kicker, a greeting, the date and one sentence on one line, the search, New request and four quick actions', async () => {
    expect(home.metadata).toEqual({ title: 'Home' });
    approvals = [approval('a1', null), approval('a2', null), approval('a3', null)];
    serverApi.myTickets.mockResolvedValue({
      data: [ticket('INC-000001', 'pending_requester', '2026-09-29T10:00:00Z', { statusCategory: 'paused' }), ticket('INC-000002', 'new', '2026-09-28T10:00:00Z'), ticket('INC-000003', 'resolved', '2026-09-27T10:00:00Z', { statusCategory: 'resolved' })],
      nextCursor: null,
    });
    await show(home.default());
    const hero = document.querySelector('.app-Home__hero')!;
    expect(hero.getAttribute('data-variant')).toBe('light');
    expect(hero.querySelector('.app-Home__kicker')?.textContent).toBe('Acme · Help Portal');
    const heading = document.querySelector('h1');
    expect(heading?.textContent).toMatch(/^Good (morning|afternoon|evening), Ada$/);
    expect(heading?.getAttribute('tabindex')).toBe('-1');
    const lede = hero.querySelector('.app-Home__lede')!;
    expect(lede.querySelector('.app-Home__date')?.textContent).toMatch(/^[A-Z][a-z]+day \d{1,2} [A-Z][a-z]+$/);
    expect(lede.textContent).toMatch(/ · Search for an answer, or tell us what’s wrong\.$/);
    expect(document.querySelector('[role="combobox"]')).not.toBeNull();

    const tiles = [...hero.querySelectorAll<HTMLElement>('[data-quick-action]')];
    expect(tiles.map((tile) => [tile.dataset.quickAction, tile.getAttribute('href'), spoken(tile)])).toEqual([
      ['report', null, 'Report an issue, Tell us what’s wrong'],
      ['request', '/catalogue', 'Request something, Browse services'],
      ['requests', '/tickets', 'My requests, 2 open'],
      ['approvals', '/approvals', 'Approvals, 3 waiting'],
    ]);
    expect(document.querySelector('nav[aria-label="Quick actions"]')).not.toBeNull();

    click(tiles[0]!);
    expect(helpFlow.open).toHaveBeenLastCalledWith({ step: 'describe' });
    click(button('New request'));
    expect(helpFlow.open).toHaveBeenLastCalledWith();
    expect(await violations()).toEqual([]);
  });

  it('names the demo company in the kicker in a demo visit, and says nothing waiting rather than 0', async () => {
    const base = me();
    vi.mocked(sessionModule.currentMe).mockResolvedValueOnce({ ...base, demo: { persona: 'employee', area: 'portal', generation: 3, company: 'Northwind Traders (UK)', disabledFeatures: [], personaUserIds: { employee: 'u1', agent: 'u2', admin: 'u3' }, agentTeamIds: [] } } as Me);
    approvals = [];
    await show(home.default());
    expect(document.querySelector('.app-Home__kicker')?.textContent).toBe('Northwind Traders (UK) · Help Portal');
    expect(spoken(document.querySelector('[data-quick-action="approvals"]')!)).toBe('Approvals, Nothing waiting');
    expect(spoken(document.querySelector('[data-quick-action="requests"]')!)).toBe('My requests, Nothing open');
  });

  it('pins what needs them first as cards, with the action on the card and a mini stepper, and never shows a priority', async () => {
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
    expect(listed[0]!.querySelector('.itsm-StatusPill')?.getAttribute('data-tone')).toBe('hold');
    expect(listed[0]!.querySelector('a[href="/approvals?open=approval%3Aap1"]')).not.toBeNull();
    expect(listed[0]!.textContent).toMatch(/Oldest \d+ days?/);
    expect(listed[0]!.querySelector('.itsm-Stepper')).toBeNull();
    expect(listed[1]!.textContent).toContain('Title of INC-000001');
    expect(listed[1]!.querySelector('.itsm-StatusPill')?.getAttribute('data-tone')).toBe('hold');
    expect(listed[1]!.querySelector('a[href="/tickets/INC-000001#reply"]')?.textContent).toContain('Reply');
    expect(listed[1]!.querySelector('.itsm-Stepper [aria-current="step"]')?.textContent).toContain('Being worked on');
    expect(listed[2]!.textContent).toContain('Yes, it’s fixed');
    expect(listed[2]!.querySelector('a[href="/tickets/INC-000002?fixed=no"]')).not.toBeNull();
    expect(listed[3]!.textContent).toContain('Title of REQ-000003');
    // The title is the card's one link, and the action is its sibling, never inside it.
    expect(listed[1]!.querySelector('.app-RequestCard__link')?.getAttribute('href')).toBe('/tickets/INC-000001');
    expect(listed[1]!.querySelector('.app-RequestCard__link a, .app-RequestCard__link button')).toBeNull();
    expect((button('See all') as HTMLAnchorElement).getAttribute('href')).toBe('/tickets');
    expect(text()).not.toMatch(/\bP1\b|priority|impact/i);
    expect(document.querySelector('.itsm-PriorityChip')).toBeNull();
    expect(await violations()).toEqual([]);
  });

  it('says it could not load the requests — never "Nothing open" — and offers Retry', async () => {
    serverApi.myTickets.mockRejectedValue(new ApiError(503, null, 'down'));
    await show(home.default());
    expect(text()).toContain('Couldn’t load your requests');
    expect(text()).not.toContain('Nothing open');
    // The tile says nothing rather than a 0 it did not read.
    expect(spoken(document.querySelector('[data-quick-action="requests"]')!)).toBe('My requests');
    await clickAsync(button('Retry'));
    expect(router.refresh).toHaveBeenCalled();
  });

  it('is calm about having nothing open', async () => {
    await show(home.default());
    expect(text()).toContain('Nothing open. That’s the goal.');
    expect(rows()).toHaveLength(0);
  });

  it('offers six common requests in the catalogue’s order, then all services', async () => {
    const many: CatalogueItem[] = Array.from({ length: 8 }, (_, index) => ({
      key: `item-${index}`,
      name: `Item ${index}`,
      description: null,
      shortSummary: index === 0 ? 'Get back in' : null,
      formKey: null,
      service: 'Hardware',
      serviceKey: 'hardware',
    }));
    serverApi.catalogue.mockResolvedValue({ data: many });
    await show(home.default());
    const section = document.querySelector('section[aria-labelledby="home-common"]')!;
    expect(section.querySelector('h2')?.textContent).toBe('Common requests');
    const cards = [...section.querySelectorAll<HTMLAnchorElement>('.app-CommonRequest__link')];
    expect(cards.map((card) => [card.textContent, card.getAttribute('href')])).toEqual(many.slice(0, 6).map((item) => [item.name, `/catalogue/${item.key}`]));
    expect(section.querySelector('.app-CommonRequest__summary')?.textContent).toBe('Get back in');
    expect(section.querySelectorAll('.itsm-IconTile')).toHaveLength(6);
    expect((button('Browse all services') as HTMLAnchorElement).getAttribute('href')).toBe('/catalogue');
    expect(text()).not.toMatch(/most requested/i);
  });

  it('leaves out what the person cannot use: Services, Approvals and New request', async () => {
    permissions = ['search.query', 'knowledge.read'];
    helpFlow.available = false;
    await show(home.default());
    expect(serverApi.catalogue).not.toHaveBeenCalled();
    expect(text()).not.toContain('Common requests');
    expect(text()).not.toContain('New request');
    expect([...document.querySelectorAll<HTMLElement>('[data-quick-action]')].map((tile) => tile.dataset.quickAction)).toEqual(['requests']);
  });

  it('says it could not load the common requests rather than leaving a gap', async () => {
    serverApi.catalogue.mockRejectedValue(new ApiError(503, null, 'down'));
    await show(home.default());
    expect(text()).toContain('Couldn’t load common requests');
  });

  it('shows an open incident in the strip in the component’s tone, and the aside: answers with views, coming up, channels', async () => {
    process.env.PORTAL_CHANNELS = 'email,teams';
    serverApi.publicStatus.mockResolvedValue({
      ...status,
      maintenance: [{ id: 'm1', title: 'Firewall firmware 9.1.4 — Leeds', body: null, status: 'scheduled', startsAt: new Date(Date.now() + 2 * 86_400_000).toISOString(), endsAt: new Date(Date.now() + 2 * 86_400_000 + 7_200_000).toISOString(), components: ['vpn'] }],
    });
    serverApi.knowledge.mockResolvedValue([
      { ...article('vpn-from-home', 'Connect to the VPN from home', 412), helpfulCount: 91, unhelpfulCount: 9 },
      article('b', 'Set up the VPN', 50),
      article('c', 'Book a desk', 10),
    ]);
    await show(home.default());

    expect(serverApi.publicStatus).toHaveBeenCalledWith('acme');
    expect(serverApi.knowledge).toHaveBeenCalledWith({ status: 'published', limit: 200 });
    const strip = document.querySelector('#home-status .app-StatusStrip')!;
    expect(strip.textContent).toContain('VPN degraded. We’re on it.');
    expect(strip.getAttribute('data-tone')).toBe('high');
    const follow = button('Follow updates') as HTMLAnchorElement;
    expect(follow.getAttribute('href')).toMatch(/\/status\/acme$/);

    const aside = document.querySelector('.app-HomeAside')!;
    expect([...aside.querySelectorAll('h2')].map((heading) => heading.textContent)).toEqual(['Popular answers', 'Coming up', 'Other ways to reach us']);
    const answers = [...aside.querySelectorAll('.app-HomeAside__answer')].map((item) => [item.querySelector('a')?.textContent, item.querySelector('.app-HomeAside__facts')?.textContent]);
    expect(answers).toEqual([
      ['Connect to the VPN from home', '412 views · 91% found this helpful'],
      ['Set up the VPN', '50 views'],
      ['Book a desk', '10 views'],
    ]);
    expect(aside.querySelector('.app-HomeAside__window')?.textContent).toContain('Firewall firmware 9.1.4 — Leeds');
    expect(aside.querySelector('.app-HomeAside__window')?.textContent).toContain('Affects VPN');
    expect([...aside.querySelectorAll('.app-HomeAside__channel')].map((node) => node.textContent)).toEqual(['Email', 'Teams']);
    expect(await violations()).toEqual([]);
  });

  it('says all is running in one calm line when it is, and nothing about status without a status page', async () => {
    serverApi.publicStatus.mockResolvedValue({ ...status, overall: 'operational', components: status.components.map((component) => ({ ...component, status: 'operational' as const })), incidents: [] });
    await show(home.default());
    const strip = document.querySelector('.app-StatusStrip')!;
    expect(strip.textContent).toMatch(/All services running.*Checked \d{2}:\d{2}/);
    expect(strip.getAttribute('data-tone')).toBe('success');
    expect((button('View status') as HTMLAnchorElement).getAttribute('href')).toMatch(/\/status\/acme$/);
    cleanupDocument();

    serverApi.publicStatus.mockResolvedValue(null);
    await show(home.default());
    expect(document.querySelector('.app-StatusStrip')).toBeNull();
  });

  it('draws a component that is down without an incident in red, never as all well', async () => {
    serverApi.publicStatus.mockResolvedValue({ ...status, overall: 'partial_outage', components: [{ ...status.components[0]!, status: 'partial_outage' }], incidents: [] });
    await show(home.default());
    const strip = document.querySelector('.app-StatusStrip')!;
    expect(strip.getAttribute('data-tone')).toBe('danger');
    expect(strip.textContent).toContain('Some services are down');
    expect(strip.textContent).toContain('VPN: partly down');
  });

  it('says it could not check the status rather than claiming all is well', async () => {
    serverApi.publicStatus.mockRejectedValue(new Error('down'));
    await show(home.default());
    expect(text()).toContain('Couldn’t check service status just now.');
    expect(text()).not.toContain('All services running');
  });

  it('holds its requests’ place with card-shaped ghosts, and the quick actions with four tiles, while they load', async () => {
    render(<YourRequestsSkeleton />);
    expect(document.querySelector('h2')?.textContent).toBe('Your requests');
    expect(document.querySelectorAll('.app-RequestCards--ghost .itsm-Skeleton')).toHaveLength(3);
    cleanupDocument();
    render(<QuickActionsSkeleton />);
    expect(document.querySelectorAll('.app-QuickActions__item')).toHaveLength(4);
    cleanupDocument();
    render(<Provider>{loading.default()}</Provider>);
    expect(document.querySelector('[role="status"]')?.textContent).toContain('Loading Home…');
    expect(document.querySelectorAll('.app-QuickActions__item')).toHaveLength(4);
    expect(await violations()).toEqual([]);
  });

  it('keeps Home’s new parts on the server: only the hero, the action buttons and the status refresh are client modules', () => {
    const read = (path: string): string => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
    for (const file of ['QuickActions.tsx', 'StatusStrip.tsx', 'RequestCard.tsx', 'CommonRequests.tsx', 'HomeAside.tsx', 'sections.tsx']) {
      expect(read(`../home/${file}`), file).not.toMatch(/^'use client'/m);
    }
    expect(read('../home/RefreshOnReturn.tsx')).toMatch(/^'use client'/);
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

  it('comes into focus with / and when another part of Home asks for it', () => {
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
    // Each group's heading carries its count, read as part of it (A6 §6.8).
    expect([...document.querySelectorAll('h2')].map((heading) => spoken(heading))).toEqual(['Answers, 1', 'Services, 1', 'Your requests, 1']);
    const seeAll = [...document.querySelectorAll<HTMLAnchorElement>('.app-Results__head a')].map((link) => link.getAttribute('href'));
    expect(seeAll).toEqual(['/knowledge?q=vpn', '/catalogue?q=vpn', '/tickets?show=all&q=vpn']);
    expect(document.querySelector('.app-Results__snippet mark')?.textContent).toBe('VPN');
    expect(document.querySelector('.app-Results__snippet img')).toBeNull();
    expect(text()).toContain('VPN access');
    expect(text()).not.toContain('Password reset');
    expect(requestRows()).toHaveLength(1);

    click(button('Report ‘vpn’ as an issue'));
    expect(helpFlow.open).toHaveBeenCalledWith({ step: 'details', text: 'vpn' });
  });

  it('counts each group in its heading, says "6+" for a group cut at the page’s limit, and leaves a failed group uncounted', async () => {
    const hits = Array.from({ length: 6 }, (_, index) => ({ entityType: 'knowledge', entityId: `a${index}`, title: `VPN ${index}`, snippet: '', rank: 1, facets: { key: `vpn-${index}` } }));
    serverApi.search.mockResolvedValue({ data: hits, meta: { facets: {}, engine: 'meilisearch' } });
    serverApi.catalogue.mockRejectedValue(new ApiError(503, null, 'down'));
    serverApi.myTickets.mockResolvedValue({ data: [ticket('INC-000009', 'new', '2026-09-29T10:00:00Z', { title: 'VPN drops' })], nextCursor: 'more' });
    await show(search.default({ searchParams: params('vpn') }));
    const headings = [...document.querySelectorAll('h2')];
    expect(headings.map((heading) => spoken(heading))).toEqual(['Answers, 6 or more', 'Services', 'Your requests, 1 or more']);
    expect(headings.map((heading) => heading.querySelector('[aria-hidden="true"]')?.textContent ?? null)).toEqual(['6+', null, '1+']);
    expect(await violations()).toEqual([]);
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
    expect(requestRows()).toHaveLength(1);
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

/* ---- The system pages: not found, a failed page, offline ------------------ */

describe('the system pages', () => {
  it('draws not found as a dashed placeholder with its h1, the way home and a search that needs no script', async () => {
    const { default: PortalNotFound } = await import('../app/(portal)/not-found.js');
    render(<Provider>{PortalNotFound()}</Provider>);
    const page = document.querySelector('.app-StatePage')!;
    expect(page.getAttribute('data-frame')).toBe('dashed');
    expect(document.querySelector('h1')?.textContent).toBe('We couldn’t find that');
    expect((button('Go to Home') as HTMLAnchorElement).getAttribute('href')).toBe('/');
    const form = document.querySelector<HTMLFormElement>('form[role="search"]')!;
    expect(form.getAttribute('action')).toBe('/search');
    expect(form.getAttribute('method')).toBe('get');
    expect(form.querySelector('input[name="q"]')?.getAttribute('aria-label')).toBe('Search help, services and your requests');
    expect(await violations()).toEqual([]);
    // Paths through a variable: Vite rewrites `new URL('<literal>', import.meta.url)` into an asset URL.
    const read = (path: string): string => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
    const screen = read('../components/NotFoundScreen.tsx');
    // Every route carries the not-found boundary, so it stays free of client code.
    expect(screen).not.toMatch(/^'use client'/m);
  });

  it('keeps a failed page’s h1, Try again, the way home and its id inside the dashed frame', async () => {
    const { default: PortalError } = await import('../app/(portal)/error.js');
    const retry = vi.fn();
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <Provider>
        <PortalError error={Object.assign(new Error('boom'), { digest: 'abc123' })} retry={retry} />
      </Provider>,
    );
    expect(document.querySelector('.app-StatePage__frame [data-itsm-error-boundary]')).not.toBeNull();
    expect(document.querySelector('h1')).not.toBeNull();
    expect((button('Go to Home') as HTMLAnchorElement).getAttribute('href')).toBe('/');
    expect(text()).toContain('abc123');
    click(button('Try again'));
    expect(retry).toHaveBeenCalled();
    expect(await violations()).toEqual([]);
    quiet.mockRestore();
  });

  it('names the Help Portal on the root error and not-found screens, never a bare "Help"', async () => {
    const { default: RootError } = await import('../app/error.js');
    const { default: RootNotFound } = await import('../app/not-found.js');
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <Provider>
        <RootError error={new Error('boom')} retry={vi.fn()} />
      </Provider>,
    );
    expect(document.querySelector('h1')?.textContent).toBe('The Help Portal couldn’t open');
    expect(text()).toContain('Help Portal');
    cleanupDocument();
    render(<Provider>{RootNotFound()}</Provider>);
    expect(document.querySelector('h1')?.textContent).toBe('We couldn’t find that page');
    expect(document.querySelector('.itsm-StatusScreen__product')?.textContent).toBe('Help Portal');
    expect(await violations()).toEqual([]);
    quiet.mockRestore();
  });

  it('builds /offline once, names the area and goes back to its home', async () => {
    const offline = await import('../app/offline/page.js');
    expect(offline.dynamic).toBe('force-static');
    render(<Provider>{offline.default()}</Provider>);
    await act(async () => {
      await Promise.resolve();
    });
    expect(document.querySelector('h1')?.textContent).toBe('You’re offline');
    expect(document.querySelector('.itsm-StatusScreen__product')?.textContent).toBe('Help Portal');
    expect((button('Back to Home') as HTMLAnchorElement).getAttribute('href')).toBe('/');
  });
});

/* ---- Styles ------------------------------------------------------------------------ */

describe('the styles for Home, the flow and the results', () => {
  it('reference no variable the design system does not emit', () => {
    const defined = new Set([...Object.keys(structuralVariables()), ...Object.keys(themeVariables('apple'))]);
    for (const path of ['../home/home.css', '../home/states.css', '../help/help.css', '../app/(portal)/search/search.css']) {
      const css = readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
      const used = [...new Set([...css.matchAll(/var\((--itsm-[a-zA-Z0-9-]+)/g)].map((match) => match[1]!))];
      expect(used.length, path).toBeGreaterThan(10);
      expect(used.filter((variable) => !defined.has(variable)), path).toEqual([]);
      // App rules may place a design-system part in context; they never restyle one on its own.
      expect(css, path).not.toMatch(/^\s*\.itsm-/m);
    }
  });
});
