// @vitest-environment jsdom
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, cloneElement, forwardRef, isValidElement, Suspense, type AnchorHTMLAttributes, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OutboxItem, QueueInput, SubmitResult } from '@itsm/pwa';
import type { ApprovalRequest, CatalogueItem, CatalogueItemDetail, Me, NotificationInbox, Page, SlaTimer, Ticket, Timeline, TimelineEntry } from '@itsm/sdk';
import { ApiError } from '@itsm/sdk';
import { ItsmProvider } from '@itsm/ui';
import { structuralVariables, themeVariables } from '@itsm/ui/tokens';
import { cleanupDocument, click, clickAsync, render, submit, type } from './support/render.js';

/**
 * My requests and a request's own page (SPEC §6.3 `/tickets`,
 * `/tickets/[id]`, X-35): the scopes and search in the URL, what needs the
 * requester first, Load more, honest empty and error states; one hero card;
 * a conversation built from public comments only (never events, internal
 * notes or task titles), with the description first; the composer with one
 * key per intent, "Sending…", queued offline and accurate refusals; the
 * details folded away; never a priority. And a real 404 (SPEC §5.5): a
 * missing request, service or article calls `notFound()` before anything is
 * drawn, with no skeleton above it.
 */

vi.mock('server-only', () => ({}));

let pathname = '/tickets';
const router = { push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() };
/** Throws, as Next's does, so nothing after it runs; counted so a test can tell it from any other throw. */
const notFound = vi.fn((): never => {
  throw new Error('not found');
});
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(),
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
  notFound: () => notFound(),
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
  myTickets: vi.fn(async (_f?: unknown): Promise<Page<Ticket>> => ({ data: [], nextCursor: null })),
  transition: vi.fn(async (_n: string, _to: string, _v: number, _reason?: string) => ({}) as unknown),
  ticket: vi.fn(async (_n: string) => ({ status: 'resolved', version: 3 })),
  notifications: vi.fn(async (_o?: unknown): Promise<NotificationInbox> => ({ unread: 0, data: [] })),
  markNotificationRead: vi.fn(async (_id: string) => ({ marked: 1 })),
};
vi.mock('../client/api.js', () => ({ api: browserApi }));

let keys = 0;
const submitOrQueue = vi.fn(async (input: QueueInput): Promise<SubmitResult> => ({ ok: true, queued: false, idempotencyKey: input.idempotencyKey ?? 'k' }));
const outbox = { items: [] as OutboxItem[], pending: 0, attention: [] as OutboxItem[], online: true, refresh: vi.fn(async () => undefined), retry: vi.fn(), dismiss: vi.fn() };
vi.mock('@itsm/pwa', () => ({
  submitOrQueue: (input: QueueInput) => submitOrQueue(input),
  newIdempotencyKey: () => `key-${++keys}`,
  useOutbox: () => outbox,
}));

const notify = vi.fn();
const announce = vi.fn();
vi.mock('@itsm/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@itsm/ui')>();
  return {
    ...actual,
    announce: (...args: unknown[]) => announce(...args),
    notify: Object.assign((...args: unknown[]) => notify(...args), { dismiss: vi.fn(), promise: vi.fn(), progress: vi.fn() }),
  };
});

/* ---- The server, as the pages see it ----------------------------------- */

let permissions: string[] = [];
const serverApi = {
  myTickets: vi.fn(async (_f?: Record<string, unknown>): Promise<Page<Ticket>> => ({ data: [], nextCursor: null })),
  notifications: vi.fn(async (_o?: unknown): Promise<NotificationInbox> => ({ unread: 0, data: [] })),
  ticket: vi.fn(async (_id: string): Promise<Ticket> => ticket('INC-000123', 'in_progress')),
  timeline: vi.fn(async (_id: string): Promise<Timeline> => ({ ticket: ticket('INC-000123', 'in_progress'), includesInternal: false, includesEvents: false, entries: [], attachments: [] })),
  slaTimers: vi.fn(async (_id: string) => ({ ticketId: 'id-INC-000123', timers: [] as SlaTimer[] })),
  approvals: vi.fn(async (_o?: unknown) => ({ data: [] as ApprovalRequest[] })),
  catalogue: vi.fn(async () => ({ data: [] as CatalogueItem[] })),
  catalogueItem: vi.fn(async (_key: string): Promise<CatalogueItemDetail> => {
    throw new ApiError(404, null, 'no such item');
  }),
};

const me = (): Me => ({
  actor: { type: 'user', id: 'u1', displayName: 'Ada Lovelace' },
  tenant: { id: 't', name: 'Acme', slug: 'acme', region: 'eu' },
  permissions: permissions.map((key) => ({ key, scope: 'own' })),
  organisations: [],
  teamIds: [],
  locale: 'en-GB',
  timeZone: 'Europe/London',
});

vi.mock('../server/session.js', () => ({
  requireSession: async () => ({ id: 's1' }),
  currentMe: async () => me(),
  heldPermissions: (person: Me) => new Set(person.permissions.map((permission) => permission.key)),
  apiFor: () => serverApi,
  loginHref: async () => '/api/session/login?redirectTo=%2Ftickets',
}));

vi.mock('../requests/server.js', () => ({
  readTicket: async (reference: string) => {
    try {
      return { ok: true, ticket: await serverApi.ticket(reference) };
    } catch (error) {
      return { ok: false, status: error instanceof ApiError ? error.status : 0 };
    }
  },
}));

const listPage = await import('../app/(portal)/tickets/(list)/page.js');
const detailPage = await import('../app/(portal)/tickets/[id]/page.js');
const model = await import('../requests/model.js');
const { Conversation } = await import('../requests/Conversation.js');

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

/* ---- Fixtures ------------------------------------------------------------ */

function ticket(number: string, status: string, extra: Partial<Ticket> = {}): Ticket {
  return {
    id: `id-${number}`,
    number,
    type: number.startsWith('REQ') ? 'request' : 'incident',
    title: `Title of ${number}`,
    description: 'Since Monday the VPN drops every few minutes.',
    status,
    statusCategory: 'open',
    priority: 'P1',
    impact: 'high',
    urgency: 'high',
    requesterId: 'u1',
    affectedUserId: null,
    assigneeId: 'agent-1',
    groupId: null,
    serviceId: null,
    categoryId: null,
    orgId: null,
    sourceChannel: 'portal',
    parentId: null,
    dueAt: null,
    resolvedAt: status === 'resolved' || status === 'closed' ? '2026-09-29T15:00:00Z' : null,
    closedAt: status === 'closed' ? '2026-09-30T08:00:00Z' : null,
    reopenCount: 0,
    custom: { costCentre: 'secret-cc-991' },
    version: 3,
    createdAt: '2026-09-28T08:02:00Z',
    updatedAt: '2026-09-30T09:15:00Z',
    ...extra,
  };
}

const entries: TimelineEntry[] = [
  { kind: 'comment', at: '2026-09-28T09:15:00Z', id: 'c1', visibility: 'public', authorId: 'agent-1', body: 'Could you try the new profile?', channel: 'api' },
  { kind: 'comment', at: '2026-09-28T09:20:00Z', id: 'c2', visibility: 'internal', authorId: 'agent-1', body: 'Internal: requester is a VIP', channel: 'api' },
  { kind: 'event', at: '2026-09-28T09:21:00Z', id: 'e1', type: 'status.changed', actorType: 'user', actorId: 'agent-1', payload: { from: 'new', to: 'in_progress', reason: 'secret-payload' } },
  { kind: 'task', at: '2026-09-28T09:22:00Z', id: 't1', title: 'Check the firewall logs', status: 'done', assigneeId: null },
  { kind: 'task', at: '2026-09-28T09:23:00Z', id: 't2', title: 'Escalate to networks', status: 'open', assigneeId: null },
  { kind: 'comment', at: '2026-09-29T10:00:00Z', id: 'c3', visibility: 'public', authorId: 'u1', body: 'Tried it.\nStill drops.', channel: 'portal' },
];

function timer(targetType: string, state: string, dueAt: string | null): SlaTimer {
  return { id: `${targetType}-${state}`, targetType, state, startedAt: '2026-09-28T08:02:00Z', dueAt, remainingMs: 0, elapsedMs: 0, warningsFired: 0, metAt: null, breachedAt: null };
}

beforeEach(() => {
  pathname = '/tickets';
  keys = 0;
  permissions = ['ticket.create', 'ticket.transition', 'ticket.comment.public', 'sla.read', 'notification.read', 'approval.read'];
  for (const mock of [...Object.values(serverApi), ...Object.values(browserApi)]) mock.mockReset();
  serverApi.myTickets.mockResolvedValue({ data: [], nextCursor: null });
  serverApi.notifications.mockResolvedValue({ unread: 0, data: [] });
  serverApi.ticket.mockImplementation(async (id: string) => ticket(id.startsWith('id-') ? id.slice(3) : id, 'in_progress'));
  serverApi.timeline.mockResolvedValue({ ticket: ticket('INC-000123', 'in_progress'), includesInternal: false, includesEvents: false, entries, attachments: [] });
  serverApi.slaTimers.mockResolvedValue({ ticketId: 'id-INC-000123', timers: [] });
  serverApi.approvals.mockResolvedValue({ data: [] });
  serverApi.catalogue.mockResolvedValue({ data: [] });
  serverApi.catalogueItem.mockRejectedValue(new ApiError(404, null, 'no such item'));
  browserApi.myTickets.mockResolvedValue({ data: [], nextCursor: null });
  browserApi.transition.mockResolvedValue({});
  browserApi.notifications.mockResolvedValue({ unread: 0, data: [] });
  browserApi.markNotificationRead.mockResolvedValue({ marked: 1 });
  submitOrQueue.mockReset();
  submitOrQueue.mockImplementation(async (input) => ({ ok: true, queued: false, idempotencyKey: input.idempotencyKey ?? 'k' }));
  for (const mock of [router.push, router.replace, router.refresh, helpFlow.open, notify, announce, outbox.refresh, notFound]) mock.mockClear();
  helpFlow.available = true;
  outbox.items = [];
  localStorage.clear();
  window.history.replaceState(null, '', '/');
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
});

afterEach(() => {
  cleanupDocument();
  vi.useRealTimers();
});

/* ---- Rendering a server page in a test ----------------------------------- */

/** Awaits every async component, opens every `<Suspense>` onto what it resolved to, and leaves the rest to React. */
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
  if (Array.isArray(children)) return cloneElement(element, undefined, ...((await resolveServer(children)) as ReactNode[]));
  return cloneElement(element, undefined, await resolveServer(children));
}

/** Every `<Suspense>` in a server page's own tree (not inside the components it renders). */
function suspenseIn(node: ReactNode): ReactElement<{ fallback: ReactNode; children?: ReactNode }>[] {
  if (Array.isArray(node)) return node.flatMap((child) => suspenseIn(child as ReactNode));
  if (!isValidElement(node)) return [];
  const element = node as ReactElement<{ fallback: ReactNode; children?: ReactNode }>;
  if (element.type === Suspense) return [element, ...suspenseIn(element.props.children)];
  return suspenseIn(element.props.children);
}

/** What the first flush of a server page shows: each `<Suspense>` as its fallback. */
function firstPaint(node: ReactNode): ReactNode {
  if (Array.isArray(node)) return node.map((child) => firstPaint(child as ReactNode));
  if (!isValidElement(node)) return node;
  const element = node as ReactElement<{ fallback?: ReactNode; children?: ReactNode }>;
  if (element.type === Suspense) return element.props.fallback;
  const { children } = element.props;
  if (children === undefined) return element;
  if (Array.isArray(children)) return cloneElement(element, undefined, ...(firstPaint(children) as ReactNode[]));
  return cloneElement(element, undefined, firstPaint(children));
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

const openList = (search: Record<string, string> = {}) =>
  show(listPage.default({ searchParams: Promise.resolve(search) }));

const openRequest = (id = 'INC-000123', search: Record<string, string> = {}) => {
  pathname = `/tickets/${id}`;
  return show(detailPage.default({ params: Promise.resolve({ id }), searchParams: Promise.resolve(search) }));
};

function text(): string {
  return document.body.textContent?.replace(/\s+/g, ' ') ?? '';
}

function control(name: string): HTMLElement {
  const found = [...document.querySelectorAll<HTMLElement>('button, a')].find((node) => node.textContent?.replace(/\s+/g, ' ').trim() === name);
  if (!found) throw new Error(`no “${name}” in: ${text()}`);
  return found;
}

function rowTitles(): string[] {
  return [...document.querySelectorAll('.app-RequestRow__title')].map((node) => node.textContent ?? '');
}

/* ---- The rules, as data ---------------------------------------------------- */

describe('the rules', () => {
  it('reads the scope and search from the URL, with Open as the default and ?all=1 still meaning All', () => {
    expect(model.scopeOf(undefined)).toBe('open');
    expect(model.scopeOf('needs')).toBe('needs');
    expect(model.scopeOf(['resolved', 'all'])).toBe('resolved');
    expect(model.scopeOf('nonsense')).toBe('open');
    expect(model.scopeOf(undefined, '1')).toBe('all');
    expect(model.queryOf(`  ${'v'.repeat(250)} `)).toHaveLength(200);
    expect(model.filterFor('open')).toEqual({ statusCategory: 'open,paused' });
    expect(model.filterFor('needs')).toEqual({ status: 'pending_requester' });
    expect(model.filterFor('resolved')).toEqual({ statusCategory: 'resolved' });
    expect(model.filterFor('all')).toEqual({});
    expect(model.listHref('open')).toBe('/tickets');
    expect(model.listHref('all', ' vpn ')).toBe('/tickets?show=all&q=vpn');
  });

  it('orders what needs them, then what is going on, then what waits for their word, then what is finished — stably', () => {
    const rows = ['closed', 'in_progress', 'resolved', 'pending_requester', 'new', 'cancelled', 'awaiting_parts'].map((status, index) => ({ status, index }));
    expect(model.inListOrder(rows).map((row) => row.status)).toEqual(['pending_requester', 'in_progress', 'new', 'awaiting_parts', 'resolved', 'closed', 'cancelled']);
  });

  it('gives each state one card: its words, its primary move and its quieter ones', () => {
    const summary = (status: string) => {
      const hero = model.heroFor(status);
      return [hero.title, hero.primary, hero.more.join('+'), hero.tone];
    };
    expect(summary('new')).toEqual(['Received', null, 'withdraw', 'neutral']);
    expect(summary('in_progress')).toEqual(['Being worked on', null, 'sorted', 'info']);
    expect(summary('pending_requester')).toEqual(['Waiting for you', 'reply', 'withdraw+sorted', 'hold']);
    expect(summary('pending_approval')).toEqual(['Waiting for approval', null, 'sorted', 'hold']);
    expect(summary('pending_third_party')).toEqual(['Waiting on a supplier', null, 'sorted', 'hold']);
    expect(summary('resolved')).toEqual(['Is it fixed?', 'confirm', '', 'success']);
    expect(summary('closed')).toEqual(['Closed', 'report-again', '', 'neutral']);
    expect(summary('cancelled')).toEqual(['Withdrawn', 'report-again', '', 'neutral']);
    expect(model.heroFor('closed').finished).toBe(true);
  });

  it('draws four steps, the current one saying who it waits for, dates from the request’s own timestamps', () => {
    const dates = { raised: '28 Sep', resolved: '29 Sep', closed: '30 Sep' };
    expect(model.stepsFor('pending_requester', dates).map((step) => [step.status, step.description ?? ''])).toEqual([
      ['complete', '28 Sep'],
      ['current', 'Waiting for you'],
      ['upcoming', ''],
      ['upcoming', ''],
    ]);
    expect(model.stepsFor('resolved', dates).map((step) => step.status)).toEqual(['complete', 'complete', 'current', 'upcoming']);
    expect(model.stepsFor('closed', dates).map((step) => [step.status, step.description ?? ''])).toEqual([
      ['complete', '28 Sep'],
      ['complete', ''],
      ['complete', '29 Sep'],
      ['complete', '30 Sep'],
    ]);
    const withdrawn = model.stepsFor('cancelled', { raised: '28 Sep', resolved: null, closed: '30 Sep' });
    expect(withdrawn.map((step) => [step.label, step.status])).toEqual([
      ['Received', 'complete'],
      ['Being worked on', 'skipped'],
      ['Resolved', 'skipped'],
      ['Withdrawn', 'complete'],
    ]);
  });

  it('says one sentence about time — never a priority or a target’s name', () => {
    const now = new Date('2026-09-30T09:00:00Z');
    const say = (status: string, timers: SlaTimer[] | null) => model.slaSentence(status, timers, now, 'en-GB', 'Europe/London');
    expect(say('new', [timer('response', 'running', '2026-09-30T13:30:00Z'), timer('resolution', 'running', '2026-10-01T16:00:00Z')])).toBe('We aim to reply by 14:30 today.');
    expect(say('in_progress', [timer('response', 'met', null), timer('resolution', 'running', '2026-10-01T16:00:00Z')])).toBe('We aim to have this sorted by 17:00 tomorrow.');
    expect(say('in_progress', [timer('update', 'running', '2026-10-02T13:00:00Z')])).toBe('We aim to update you by Fri 14:00.');
    expect(say('pending_requester', [timer('resolution', 'paused', '2026-10-01T16:00:00Z')])).toBe('Paused while we wait for you.');
    expect(say('in_progress', [timer('resolution', 'breached', '2026-09-29T16:00:00Z')])).toBe('This is taking longer than we aimed for. It’s still with us.');
    expect(say('in_progress', [timer('resolution', 'running', '2026-09-30T08:00:00Z')])).toBe('This is taking longer than we aimed for. It’s still with us.');
    expect(say('in_progress', [timer('approval', 'running', '2026-10-01T16:00:00Z')])).toBeNull();
    expect(say('resolved', [timer('resolution', 'running', '2026-10-01T16:00:00Z')])).toBeNull();
    expect(say('in_progress', null)).toBeNull();
    expect(say('in_progress', [])).toBeNull();
  });

  it('builds the conversation from the description and public comments only', () => {
    const conversation = model.conversationOf(ticket('INC-000123', 'in_progress'), entries, 'u1');
    expect(conversation.map((entry) => [entry.kind, entry.mine, entry.body])).toEqual([
      ['description', true, 'Since Monday the VPN drops every few minutes.'],
      ['comment', false, 'Could you try the new profile?'],
      ['comment', true, 'Tried it.\nStill drops.'],
    ]);
    expect(model.conversationOf(ticket('INC-000123', 'new', { description: '  ' }), null, 'u1')).toEqual([]);
    expect(model.conversationOf(ticket('INC-000123', 'new'), null, null)[0]?.mine).toBe(false);
  });

  it('counts tasks without naming them', () => {
    expect(model.taskProgress(entries)).toEqual({ done: 1, total: 2 });
    expect(model.taskProgressLabel({ done: 1, total: 2 })).toBe('Progress: 1 of 2 steps done');
    expect(model.taskProgress(entries.filter((entry) => entry.kind !== 'task'))).toBeNull();
    expect(model.taskProgress(null)).toBeNull();
  });

  it('says how far an approval has got', () => {
    const approval = {
      stepCount: 2,
      currentStep: { sequence: 1, name: 'Manager approval', status: 'open', dueAt: '2026-10-02T13:00:00Z', quorum: 1, decidedCount: 0 },
    } as ApprovalRequest;
    expect(model.approvalLine(approval, new Date('2026-09-30T09:00:00Z'), 'en-GB', 'Europe/London')).toBe('Step 1 of 2 · Manager approval · due Fri 14:00');
    expect(model.approvalLine(undefined, new Date(), 'en-GB', 'UTC')).toBeNull();
  });

  it('carries only requester-safe fields into a row', () => {
    const row = model.itemOf(ticket('INC-000123', 'new'));
    expect(Object.keys(row).sort()).toEqual(['id', 'number', 'status', 'title', 'type', 'updatedAt', 'version']);
  });
});

/* ---- My requests ---------------------------------------------------------- */

describe('My requests', () => {
  it('keeps the heading, offers New request, and scopes as links with the current one marked', async () => {
    serverApi.myTickets.mockImplementation(async (filter) =>
      filter?.status === 'pending_requester' ? { data: [ticket('INC-000002', 'pending_requester'), ticket('INC-000003', 'pending_requester')], nextCursor: null } : { data: [], nextCursor: null },
    );
    await openList();
    expect(document.querySelector('h1')?.textContent).toBe('My requests');
    await clickAsync(control('New request'));
    expect(helpFlow.open).toHaveBeenCalled();
    const links = [...document.querySelectorAll<HTMLAnchorElement>('nav[aria-label="Show requests"] a')];
    // What a screen reader says: `Count` draws its digits `aria-hidden` and
    // speaks ", 2" in hidden text, so the digits are left out of the words.
    const spoken = (link: HTMLAnchorElement) => {
      const copy = link.cloneNode(true) as HTMLElement;
      for (const hidden of copy.querySelectorAll('[aria-hidden="true"]')) hidden.remove();
      return copy.textContent?.replace(/\s+/g, ' ').trim();
    };
    expect(links.map((link) => [spoken(link), link.getAttribute('href'), link.getAttribute('aria-current')])).toEqual([
      ['Open', '/tickets', 'page'],
      ['Needs you, 2', '/tickets?show=needs', null],
      ['Resolved', '/tickets?show=resolved', null],
      ['All', '/tickets?show=all', null],
    ]);
  });

  it('asks for the scope’s filter and the search, the needs-you count and the unread dots together', async () => {
    await openList({ show: 'resolved', q: 'vpn' });
    expect(serverApi.myTickets).toHaveBeenCalledWith({ statusCategory: 'resolved', q: 'vpn', limit: 25 });
    expect(serverApi.myTickets).toHaveBeenCalledWith({ status: 'pending_requester', limit: 100 });
    expect(serverApi.notifications).toHaveBeenCalledWith({ unread: true, limit: 100 });
    expect(document.querySelector('[aria-current="page"]')?.textContent).toBe('Resolved');
    expect(document.querySelector<HTMLAnchorElement>('nav[aria-label="Show requests"] a')?.getAttribute('href')).toBe('/tickets?q=vpn');
  });

  it('lists what needs them first, with the move beside the link, an unread dot — and no priority', async () => {
    serverApi.myTickets.mockImplementation(async (filter) =>
      filter?.status === 'pending_requester'
        ? { data: [], nextCursor: null }
        : {
            data: [ticket('INC-000001', 'closed'), ticket('INC-000002', 'in_progress'), ticket('INC-000003', 'resolved'), ticket('INC-000004', 'pending_requester')],
            nextCursor: null,
          },
    );
    serverApi.notifications.mockResolvedValue({
      unread: 1,
      data: [{ id: 'n1', subject: 'Reply', body: '', ticketId: 'id-INC-000002', eventType: 'comment.added', readAt: null, createdAt: '2026-09-30T09:00:00Z' }],
    });
    await openList({ show: 'all' });
    expect(rowTitles()).toEqual(['Title of INC-000004', 'Title of INC-000002', 'Title of INC-000003', 'Title of INC-000001']);
    const reply = control('Reply to Title of INC-000004');
    expect(reply.getAttribute('href')).toBe('/tickets/INC-000004#reply');
    expect(control('No, Title of INC-000003 is still broken').getAttribute('href')).toBe('/tickets/INC-000003?fixed=no');
    const rows = [...document.querySelectorAll('.app-RequestRow')];
    expect(rows[1]?.hasAttribute('data-unread')).toBe(true);
    expect(rows.filter((row) => row.hasAttribute('data-unread'))).toHaveLength(1);
    expect(text()).not.toMatch(/\bP1\b|priority|impact/i);
  });

  it('Yes, it’s fixed on a row closes that request', async () => {
    serverApi.myTickets.mockResolvedValue({ data: [ticket('INC-000003', 'resolved', { version: 7 })], nextCursor: null });
    await openList({ show: 'resolved' });
    await clickAsync(control('Yes, it’s fixed: Title of INC-000003'));
    expect(browserApi.transition).toHaveBeenCalledWith('INC-000003', 'closed', 7, undefined);
    expect(router.refresh).toHaveBeenCalled();
  });

  it('after “Yes, it’s fixed” takes a row out of the list, focus lands on the row now in its place', async () => {
    const { RequestsBrowser } = await import('../requests/RequestsBrowser.js');
    const a = model.itemOf(ticket('INC-000003', 'resolved'));
    const b = model.itemOf(ticket('INC-000007', 'resolved'));
    const tree = (rows: typeof a[]) => (
      <Provider>
        <RequestsBrowser scope="resolved" q="" needsCount={null} initial={{ rows, nextCursor: null }} unread={[]} />
      </Provider>
    );
    const view = render(tree([a, b]));
    await clickAsync(control('Yes, it’s fixed: Title of INC-000003'));
    act(() => view.root.render(tree([b])));
    expect(document.activeElement?.getAttribute('href')).toBe('/tickets/INC-000007');
  });

  it('says an honest nothing for each scope, with the way on', async () => {
    await openList();
    expect(text()).toContain('Nothing open. That’s the goal.');
    expect(control('See all your requests').getAttribute('href')).toBe('/tickets?show=all');
    cleanupDocument();

    await openList({ show: 'needs' });
    expect(text()).toContain('Nothing needs you');
    cleanupDocument();

    await openList({ show: 'all' });
    expect(text()).toContain('You haven’t raised anything yet');
    await clickAsync(document.querySelector<HTMLElement>('.itsm-EmptyState button')!);
    expect(helpFlow.open).toHaveBeenCalled();
    cleanupDocument();

    await openList({ show: 'open', q: 'printer' });
    expect(text()).toContain('No requests match ‘printer’');
    expect(control('Clear search').getAttribute('href')).toBe('/tickets');
    expect(control('Search all your requests').getAttribute('href')).toBe('/tickets?show=all&q=printer');
  });

  it('says it could not load them — never “Nothing open” — and keeps the heading', async () => {
    serverApi.myTickets.mockRejectedValue(new ApiError(503, null, 'down'));
    await openList();
    expect(document.querySelector('h1')?.textContent).toBe('My requests');
    expect(text()).toContain('Couldn’t load your requests');
    expect(text()).not.toContain('Nothing open');
    await clickAsync(control('Retry'));
    expect(router.refresh).toHaveBeenCalled();
  });

  it('searches as typing pauses, replacing the URL and keeping the scope', async () => {
    vi.useFakeTimers();
    await openList({ show: 'all' });
    const input = document.querySelector<HTMLInputElement>('input[type="search"]')!;
    type(input, 'vpn ');
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(router.replace).toHaveBeenCalledWith('/tickets?show=all&q=vpn', { scroll: false });
    expect(input.value).toBe('vpn ');
  });

  it('Load more appends the next page from the cursor and moves focus to the first new row', async () => {
    serverApi.myTickets.mockImplementation(async (filter) =>
      filter?.status === 'pending_requester' ? { data: [], nextCursor: null } : { data: [ticket('INC-000010', 'in_progress')], nextCursor: 'c2' },
    );
    browserApi.myTickets.mockResolvedValue({ data: [ticket('INC-000009', 'new'), ticket('INC-000010', 'in_progress')], nextCursor: null });
    await openList();
    expect(text()).toContain('Showing 1 · more available');
    await clickAsync(control('Load more'));
    expect(browserApi.myTickets).toHaveBeenCalledWith({ statusCategory: 'open,paused', limit: 25, cursor: 'c2' });
    expect(rowTitles()).toEqual(['Title of INC-000010', 'Title of INC-000009']);
    expect(document.activeElement?.getAttribute('href')).toBe('/tickets/INC-000009');
    expect(announce).toHaveBeenCalledWith('1 more request');
    expect(text()).not.toContain('Load more');
  });
});

/* ---- A request ------------------------------------------------------------ */

describe('a request', () => {
  it('reads the request, its timeline and its clocks together, and draws one card', async () => {
    serverApi.slaTimers.mockResolvedValue({ ticketId: 'id-INC-000123', timers: [timer('resolution', 'running', '2099-10-01T16:00:00Z')] });
    await openRequest();
    expect(serverApi.ticket).toHaveBeenCalledWith('INC-000123');
    expect(serverApi.timeline).toHaveBeenCalledWith('INC-000123');
    expect(serverApi.slaTimers).toHaveBeenCalledWith('id-INC-000123');
    expect(control('My requests').getAttribute('href')).toBe('/tickets');
    expect(document.querySelector('.app-Request__meta')?.textContent).toMatch(/^Issue · INC-000123 · raised /);
    expect(document.querySelector('h1')?.textContent).toBe('Title of INC-000123');
    expect(document.querySelectorAll('.app-RequestHero')).toHaveLength(1);
    expect(document.querySelector('.app-RequestHero h2')?.textContent).toBe('Being worked on');
    expect(text()).toContain('We aim to have this sorted by');
    expect(text()).toContain('Progress: 1 of 2 steps done');
  });

  it('shows public messages only: never an internal note, an event, its payload, a task title, a custom field or a priority', async () => {
    await openRequest();
    const shown = text();
    expect(shown).toContain('Since Monday the VPN drops every few minutes.');
    expect(shown).toContain('Could you try the new profile?');
    expect(shown).not.toContain('VIP');
    expect(shown).not.toContain('secret-payload');
    expect(shown).not.toContain('Check the firewall logs');
    expect(shown).not.toContain('secret-cc-991');
    expect(shown).not.toMatch(/\bP1\b|priority|impact/i);
  });

  it('draws the description as the first “You” message and the desk as “Service desk”', async () => {
    await openRequest();
    const messages = [...document.querySelectorAll<HTMLElement>('.app-Conversation article')];
    expect(messages.map((message) => message.getAttribute('aria-label')?.split(',')[0])).toEqual(['You', 'Service desk', 'You']);
    expect(messages[0]?.getAttribute('aria-label')).toContain('original request');
    expect(messages[2]?.closest('li')?.getAttribute('data-side')).toBe('end');
    expect(messages[1]?.closest('li')?.getAttribute('data-side')).toBe('start');
  });

  it('marks its own unread notifications read once opened — and nobody else’s', async () => {
    const note = (id: string, ticketId: string | null, readAt: string | null = null) => ({ id, subject: 's', body: '', ticketId, eventType: 'comment.added', readAt, createdAt: '2026-09-30T09:00:00Z' });
    browserApi.notifications.mockResolvedValue({ unread: 3, data: [note('n1', 'id-INC-000123'), note('n2', 'id-INC-000999'), note('n3', 'id-INC-000123')] });
    await openRequest();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(browserApi.notifications).toHaveBeenCalledWith({ unread: true, limit: 100 });
    expect(browserApi.markNotificationRead.mock.calls.map(([id]) => id)).toEqual(['n1', 'n3']);
  });

  it('folds the details away: reference, type, raised, last update — nothing else', async () => {
    await openRequest();
    const details = document.querySelector('.app-RequestDetails');
    expect(details?.tagName).toBe('DETAILS');
    expect([...details!.querySelectorAll('dt')].map((term) => term.textContent)).toEqual(['Reference', 'Type', 'Raised', 'Last update']);
  });

  it('calls notFound() when the API says so, before drawing anything, and moves an id to its number', async () => {
    serverApi.ticket.mockRejectedValue(new ApiError(404, null, 'not found'));
    // Thrown from the page itself, so no element — and no Suspense boundary — exists yet: Next
    // can still answer 404, with the frame's not-found screen.
    await expect(detailPage.default({ params: Promise.resolve({ id: 'INC-000404' }), searchParams: Promise.resolve({}) })).rejects.toThrow('not found');
    expect(notFound).toHaveBeenCalledTimes(1);
    // The reads that need the request never start; the conversation's, begun beside it, is settled quietly.
    expect(serverApi.slaTimers).not.toHaveBeenCalled();
    expect(serverApi.approvals).not.toHaveBeenCalled();
    await expect(detailPage.generateMetadata({ params: Promise.resolve({ id: 'INC-000404' }) })).resolves.toEqual({ title: 'Not found', robots: { index: false } });

    serverApi.ticket.mockResolvedValue(ticket('INC-000123', 'resolved'));
    await expect(openRequest('0b0c4d1e-5c6a-4f6b-9d7e-2a1b3c4d5e6f', { fixed: 'no' })).rejects.toThrow('redirect /tickets/INC-000123?fixed=no');
    expect(notFound).toHaveBeenCalledTimes(1);
  });

  it('draws the heading as soon as the request is read, and streams the card and the conversation behind a skeleton of their shape', async () => {
    let release: () => void = () => undefined;
    serverApi.timeline.mockImplementation(
      () =>
        new Promise<Timeline>((resolve) => {
          release = () => resolve({ ticket: ticket('INC-000123', 'in_progress'), includesInternal: false, includesEvents: false, entries, attachments: [] });
        }),
    );
    // The page resolves while the timeline is still outstanding: only the request is waited for.
    const tree = await detailPage.default({ params: Promise.resolve({ id: 'INC-000123' }), searchParams: Promise.resolve({}) });
    const boundaries = suspenseIn(tree);
    expect(boundaries).toHaveLength(1);

    render(<Provider>{firstPaint(tree)}</Provider>);
    expect(document.querySelector('h1')?.textContent).toBe('Title of INC-000123');
    expect(control('My requests').getAttribute('href')).toBe('/tickets');
    expect(document.querySelector('.app-RequestDetails')).not.toBeNull();
    const skeleton = document.querySelector('.app-RequestHero--loading');
    expect(skeleton?.getAttribute('aria-hidden')).toBe('true');
    expect(document.querySelector('.app-RequestHero h2')).toBeNull();
    expect(document.querySelector('.app-Conversation')).toBeNull();
    // One status speaks for the whole skeleton (the other is the announcer's live region, silent).
    const said = [...document.querySelectorAll('[role="status"]')].map((node) => node.textContent?.replace(/\s+/g, ' ').trim()).filter(Boolean);
    expect(said).toEqual([expect.stringContaining('Loading the request…')]);
    release();
  });

  it('keeps the heading and offers Retry when the request cannot be read', async () => {
    serverApi.ticket.mockRejectedValue(new ApiError(503, null, 'down'));
    await openRequest();
    expect(document.querySelector('h1')?.textContent).toBe('INC-000123');
    expect(text()).toContain('Couldn’t load this request');
  });

  it('keeps the card when only the conversation fails', async () => {
    serverApi.timeline.mockRejectedValue(new ApiError(503, null, 'down'));
    await openRequest();
    expect(document.querySelectorAll('.app-RequestHero')).toHaveLength(1);
    expect(text()).toContain('Couldn’t load the conversation');
  });

  it('skips the clocks without sla.read and asks how far an approval has got when waiting for one', async () => {
    permissions = permissions.filter((key) => key !== 'sla.read');
    serverApi.ticket.mockResolvedValue(ticket('INC-000123', 'pending_approval'));
    serverApi.approvals.mockResolvedValue({
      data: [{ id: 'a1', stepCount: 2, currentStep: { sequence: 1, name: 'Manager approval', status: 'open', dueAt: null, quorum: 1, decidedCount: 0 } } as ApprovalRequest],
    });
    await openRequest();
    expect(serverApi.slaTimers).not.toHaveBeenCalled();
    expect(serverApi.approvals).toHaveBeenCalledWith({ ticketId: 'id-INC-000123' });
    expect(text()).toContain('Step 1 of 2 · Manager approval');
  });

  it('rests the composer as one line while the card asks something, open otherwise, gone once finished', async () => {
    serverApi.ticket.mockResolvedValue(ticket('INC-000123', 'resolved'));
    await openRequest();
    expect(document.querySelector('.app-Composer__rest')?.textContent).toBe('Add a message…');
    expect(document.querySelector('.app-Composer textarea')).toBeNull();
    click(document.querySelector('.app-Composer__rest')!);
    expect(document.activeElement).toBe(document.querySelector('.app-Composer textarea'));
    cleanupDocument();

    serverApi.ticket.mockResolvedValue(ticket('INC-000123', 'in_progress'));
    await openRequest();
    expect(document.querySelector('.app-Composer textarea')).not.toBeNull();
    expect(control('Send').className).toContain('primary');
    cleanupDocument();

    serverApi.ticket.mockResolvedValue(ticket('INC-000123', 'closed'));
    await openRequest();
    expect(document.querySelector('.app-Composer')).toBeNull();
    expect(text()).toContain('This request is finished');
  });

  it('opens the composer for #reply', async () => {
    window.history.replaceState(null, '', '/tickets/INC-000123#reply');
    serverApi.ticket.mockResolvedValue(ticket('INC-000123', 'pending_requester'));
    await openRequest();
    expect(document.activeElement).toBe(document.querySelector('.app-Composer textarea'));
  });

  it('opens “What’s still happening?” for ?fixed=no', async () => {
    serverApi.ticket.mockResolvedValue(ticket('INC-000123', 'resolved'));
    await openRequest('INC-000123', { fixed: 'no' });
    expect(document.activeElement).toBe(document.querySelector('.app-RequestHero__panel textarea'));
  });
});

/* ---- The conversation and its composer --------------------------------- */

function conversation(extra: Partial<Parameters<typeof Conversation>[0]> = {}) {
  return (
    <Provider>
      <Conversation
        number="INC-000123"
        readerId="u1"
        entries={model.conversationOf(ticket('INC-000123', 'in_progress'), entries, 'u1')}
        attachments={[]}
        composer="open"
        sendIsPrimary
        finished={false}
        unavailable={false}
        {...extra}
      />
    </Provider>
  );
}

function composerField(): HTMLTextAreaElement {
  return document.querySelector<HTMLTextAreaElement>('.app-Composer textarea')!;
}

describe('the composer', () => {
  it('sends with one key per intent, shows “Sending…” at once, then redraws', async () => {
    let finish: (value: SubmitResult) => void = () => undefined;
    submitOrQueue.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    render(conversation());
    type(composerField(), 'Here is the log');
    await submit(document.querySelector('.app-Composer form') as HTMLFormElement);
    expect(text()).toContain('Sending…');
    expect(composerField().value).toBe('');
    expect(submitOrQueue.mock.calls[0]![0]).toMatchObject({
      action: 'add-comment',
      path: '/api/proxy/api/v1/tickets/INC-000123/comments',
      body: { body: 'Here is the log', visibility: 'public', channel: 'portal' },
      idempotencyKey: 'key-1',
    });
    await act(async () => finish({ ok: true, queued: false, idempotencyKey: 'key-1' }));
    expect(router.refresh).toHaveBeenCalled();
    expect(announce).toHaveBeenCalledWith('Message sent');
  });

  it('gives the words back with an accurate reason, and Send again uses the same key', async () => {
    submitOrQueue.mockResolvedValueOnce({
      ok: false,
      queued: false,
      idempotencyKey: 'key-1',
      response: new Response(
        JSON.stringify({ type: 'x/validation_failed', title: 'invalid', status: 422, correlationId: 'c', errors: [{ field: 'body', code: 'too_big', message: 'That message is too long.' }] }),
        { status: 422 },
      ),
    });
    render(conversation());
    type(composerField(), 'Words');
    await submit(document.querySelector('.app-Composer form') as HTMLFormElement);
    expect(composerField().value).toBe('Words');
    expect(text()).toContain('That message is too long.');
    expect(text()).not.toContain('changed while');
    await submit(document.querySelector('.app-Composer form') as HTMLFormElement);
    expect(submitOrQueue.mock.calls.map(([input]) => input.idempotencyKey)).toEqual(['key-1', 'key-1']);
  });

  it('offline: queued with its key, said so, and shown in the conversation until it has gone', async () => {
    submitOrQueue.mockResolvedValueOnce({ ok: false, queued: true, idempotencyKey: 'key-1' });
    const view = render(conversation());
    type(composerField(), 'On the train');
    await submit(document.querySelector('.app-Composer form') as HTMLFormElement);
    expect(text()).toContain('Saved on this device. It will send when you’re back online.');
    expect(outbox.refresh).toHaveBeenCalled();

    outbox.items = [
      {
        id: 'o1',
        action: 'add-comment',
        path: '/api/proxy/api/v1/tickets/INC-000123/comments',
        method: 'POST',
        body: { body: 'On the train', visibility: 'public' },
        idempotencyKey: 'key-1',
        status: 'pending',
        attempts: 0,
        queuedAt: Date.parse('2026-09-30T09:30:00Z'),
        nextAttemptAt: 0,
        problem: null,
        summary: 'Message on INC-000123',
      },
      { id: 'o2', action: 'add-comment', path: '/api/proxy/api/v1/tickets/INC-000999/comments', method: 'POST', body: { body: 'Elsewhere' }, idempotencyKey: 'k', status: 'pending', attempts: 0, queuedAt: 0, nextAttemptAt: 0, problem: null, summary: '' },
    ];
    act(() => view.root.render(conversation({ entries: [...model.conversationOf(ticket('INC-000123', 'in_progress'), entries, 'u1')] })));
    expect(text()).toContain('On the train');
    expect(text()).toContain('Will send when you’re back online');
    expect(text()).not.toContain('Elsewhere');
  });

  it('a lost session goes to the frame, keeping the words', async () => {
    const { onSessionEnded } = await import('../client/useAction.js');
    const heard = vi.fn();
    const stop = onSessionEnded(heard);
    submitOrQueue.mockResolvedValueOnce({ ok: false, queued: false, idempotencyKey: 'key-1', response: new Response(null, { status: 401 }) });
    render(conversation());
    type(composerField(), 'Keep me');
    await submit(document.querySelector('.app-Composer form') as HTMLFormElement);
    stop();
    expect(heard).toHaveBeenCalledWith('action');
    expect(composerField().value).toBe('Keep me');
  });

  it('asks for words before sending nothing', async () => {
    render(conversation());
    await submit(document.querySelector('.app-Composer form') as HTMLFormElement);
    expect(text()).toContain('Write a message first.');
    expect(submitOrQueue).not.toHaveBeenCalled();
  });

  it('announces a new reply from the desk, and not one of theirs', () => {
    const base = model.conversationOf(ticket('INC-000123', 'in_progress'), entries, 'u1');
    const view = render(conversation({ entries: base }));
    act(() => view.root.render(conversation({ entries: [...base, { id: 'c9', at: '2026-09-30T10:00:00Z', body: 'Mine', mine: true, kind: 'comment' }] })));
    expect(announce).not.toHaveBeenCalledWith('New reply from the service desk');
    act(() =>
      view.root.render(
        conversation({
          entries: [...base, { id: 'c9', at: '2026-09-30T10:00:00Z', body: 'Mine', mine: true, kind: 'comment' }, { id: 'c10', at: '2026-09-30T10:05:00Z', body: 'Fixed?', mine: false, kind: 'comment' }],
        }),
      ),
    );
    expect(announce).toHaveBeenCalledWith('New reply from the service desk');
  });

  it('lists files read-only', () => {
    render(conversation({ attachments: [{ id: 'f1', name: 'vpn.log', size: 2048, mime: 'text/plain' }] }));
    expect(text()).toContain('vpn.log');
    expect(document.querySelector('.app-Conversation__files a')).toBeNull();
  });
});

/* ---- Real 404s (SPEC §5.5, A4 §5.4) ---------------------------------------- */

describe('a missing request, service or article is a real 404', () => {
  const portalDir = resolve(dirname(fileURLToPath(import.meta.url)), '../app/(portal)');
  const detailRoutes = ['tickets/[id]', 'catalogue/[key]', 'knowledge/[key]'];

  it('has no loading.tsx in any segment above a detail page, so nothing streams before its existence read', () => {
    for (const route of detailRoutes) {
      const [list] = route.split('/');
      // A loading.tsx is a Suspense boundary around every page below it.
      for (const segment of ['', list!, route]) expect(existsSync(join(portalDir, segment, 'loading.tsx')), `${route}: ${segment || '(portal)'}/loading.tsx`).toBe(false);
      expect(existsSync(join(portalDir, route, 'page.tsx'))).toBe(true);
    }
  });

  it('keeps every skeleton it moved, beside the page it stands in for, at the same URL', () => {
    for (const group of ['(home)', 'tickets/(list)', 'catalogue/(list)', 'knowledge/(list)']) {
      expect(existsSync(join(portalDir, group, 'page.tsx')), group).toBe(true);
      expect(existsSync(join(portalDir, group, 'loading.tsx')), group).toBe(true);
    }
    expect(existsSync(join(portalDir, 'page.tsx'))).toBe(false);
  });

  it('calls notFound() from each detail page and never returns a not-found screen of its own', () => {
    for (const route of detailRoutes) {
      const source = readFileSync(join(portalDir, route, 'page.tsx'), 'utf8');
      expect(source, route).toMatch(/\bnotFound\(\)/);
      expect(source, route).not.toMatch(/<NotFoundScreen/);
    }
  });

  it('calls notFound() for a service item that does not exist or is not theirs, before drawing anything', async () => {
    permissions = ['catalogue.read', 'ticket.create'];
    const itemPage = await import('../app/(portal)/catalogue/[key]/page.js');
    await expect(itemPage.default({ params: Promise.resolve({ key: 'no-such-item' }) })).rejects.toThrow('not found');
    expect(notFound).toHaveBeenCalledTimes(1);
    expect(serverApi.catalogueItem).toHaveBeenCalledWith('no-such-item');
    await expect(itemPage.generateMetadata({ params: Promise.resolve({ key: 'no-such-item' }) })).resolves.toEqual({ title: 'Not found', robots: { index: false } });
  });
});

/* ---- Styles -------------------------------------------------------------------- */

describe('the styles for the request pages', () => {
  it('reference no variable the design system does not emit, and never restyle a design-system part on its own', () => {
    const defined = new Set([...Object.keys(structuralVariables()), ...Object.keys(themeVariables('apple'))]);
    // Resolved from this file's path: a literal `new URL(…, import.meta.url)` is rewritten by the bundler into a served asset URL.
    const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../requests/requests.css'), 'utf8');
    const used = [...new Set([...css.matchAll(/var\((--itsm-[a-zA-Z0-9-]+)/g)].map((match) => match[1]!))];
    expect(used.length).toBeGreaterThan(10);
    expect(used.filter((variable) => !defined.has(variable))).toEqual([]);
    expect(css).not.toMatch(/^\s*\.itsm-/m);
  });
});
