// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, cloneElement, isValidElement, Suspense, type AnchorHTMLAttributes, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AREAS, SERVICE_DESK_OVERVIEW_PURPOSE } from '@itsm/contracts/areas';
import { HEALTH_VERDICT_LABELS } from '@itsm/contracts/health';
import { createClient, workbench, type Me, type SlaTimer, type Ticket } from '@itsm/sdk';
import { ItsmProvider } from '@itsm/ui';
import { cleanupDocument, clickAsync, render } from './support/render.js';

/**
 * The Service Desk Overview (SPEC v3 §7.1.1; A6 §5.2, §9.1, §11 rows 1–3
 * and 13), rendered as the server renders it — every async card awaited,
 * every `<Suspense>` opened — against the real SDK over a fake API that
 * answers the ticket grammar (R2, R2g), the clocks, the bell, the major
 * incidents, on call and the analytics batch, and logs every request.
 *
 * Alex Morgan's morning (A6 §5.2.7) is the fixture: one ticket breached
 * yesterday at 15:10, one due in 40 minutes, a customer's reply, three
 * waiting on others, an unassigned P2 in the team and MI-0004 running.
 */

const NOW = new Date('2026-10-02T09:00:00.000Z'); // Fri 2 Oct, 10:00 in London
const ME = 'aaaaaaaa-0000-4000-8000-000000000001';
const PRIYA = 'aaaaaaaa-0000-4000-8000-000000000002';
const EMMA = 'aaaaaaaa-0000-4000-8000-000000000003';
const DANIEL = 'aaaaaaaa-0000-4000-8000-000000000004';
const RYAN = 'aaaaaaaa-0000-4000-8000-000000000005';
const SERVICE_DESK = 'bbbbbbbb-0000-4000-8000-000000000001';
const NETWORK = 'bbbbbbbb-0000-4000-8000-000000000002';
const IDENTITY = 'bbbbbbbb-0000-4000-8000-000000000003';
const MI_TICKET = 'cccccccc-0000-4000-8000-000000000004';

/* ------------------------------------------------------------------ mocks */

vi.mock('server-only', () => ({}));

const router = { push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() };
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => router,
  usePathname: () => '/overview',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@itsm/pwa/live', () => ({ useLive: () => ({ state: 'live', retry: () => undefined }) }));

vi.mock('../app/AppLink.js', () => ({
  AppLink: ({ href, children, prefetch, replace, scroll, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; prefetch?: unknown; replace?: unknown; scroll?: unknown }) => {
    void prefetch;
    void replace;
    void scroll;
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    );
  },
}));

const notify = vi.hoisted(() => vi.fn());
vi.mock('@itsm/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@itsm/ui')>();
  return { ...actual, notify: Object.assign((...args: unknown[]) => notify(...args), { dismiss: vi.fn(), promise: vi.fn(), progress: vi.fn() }) };
});

const browser = vi.hoisted(() => ({ assign: vi.fn(async (_number: string, _assignee: string | null) => ({})) }));
vi.mock('../client/api.js', () => ({ api: browser }));

/** The pending set as the integrators will leave it, per test (RV6): `null` keeps the contracts' own. */
const pending = vi.hoisted(() => ({ team: null as boolean | null }));
vi.mock('../navigation.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../navigation.js')>();
  return { ...actual, isPending: (route: string) => (route === '/team' && pending.team !== null ? pending.team : actual.isPending(route)) };
});

/* ---------------------------------------------------------- the fake API */

interface World {
  permissions: { key: string; scope: string | null }[];
  teamIds: string[];
  tickets: Ticket[];
  timers: Record<string, SlaTimer[]>;
  /** A request whose path and query match is answered with this status. */
  fail: { match: (path: string, query: URLSearchParams) => boolean; status: number }[];
  rotations: boolean;
  /** Whether the analytics batch answers 403 for the whole call. */
  analyticsForbidden: boolean;
  incidents: boolean;
}

let world: World;
let calls: string[] = [];

function ticket(number: string, extra: Partial<Ticket>): Ticket {
  return {
    id: `dddddddd-0000-4000-8000-${number.replace(/\D/g, '').padStart(12, '0')}`,
    number,
    type: number.startsWith('REQ') ? 'request' : 'incident',
    title: `Title of ${number}`,
    description: null,
    status: 'in_progress',
    statusCategory: 'open',
    priority: 'P3',
    impact: 'medium',
    urgency: 'medium',
    requesterId: EMMA,
    affectedUserId: null,
    assigneeId: ME,
    groupId: SERVICE_DESK,
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
    createdAt: '2026-09-29T08:00:00.000Z',
    updatedAt: '2026-10-01T08:00:00.000Z',
    ...extra,
  };
}

function waiting(number: string, status: string, updatedAt: string, extra: Partial<Ticket> = {}): Ticket {
  return ticket(number, { status, statusCategory: 'paused', updatedAt, ...extra });
}

function resolved(number: string, resolvedAt: string, extra: Partial<Ticket> = {}): Ticket {
  return ticket(number, { status: 'resolved', statusCategory: 'resolved', resolvedAt, createdAt: new Date(Date.parse(resolvedAt) - 86_400_000).toISOString(), ...extra });
}

const ALEX_TICKETS: Ticket[] = [
  ticket('INC-004503', { priority: 'P2', title: 'Teams camera not detected after the Windows update', dueAt: '2026-10-01T14:10:00.000Z' }),
  ticket('INC-004521', { title: 'Shared mailbox not showing in Outlook', dueAt: '2026-10-02T09:40:00.000Z', createdAt: '2026-10-01T09:00:00.000Z' }),
  ticket('INC-004530', { title: 'Outlook keeps asking for my password', dueAt: '2026-10-02T14:00:00.000Z' }),
  ticket('REQ-004541', { title: 'BambooHR access', status: 'new', dueAt: '2026-10-02T15:30:00.000Z', createdAt: '2026-10-02T07:00:00.000Z' }),
  ticket('INC-004540', { priority: 'P4', title: 'Docked laptop shows no external screens', status: 'new', dueAt: '2026-10-03T08:00:00.000Z', createdAt: '2026-10-02T06:00:00.000Z' }),
  ticket('INC-004512', { priority: 'P2', title: 'Printer queue stuck on floor 3', dueAt: '2026-10-05T08:00:00.000Z' }),
  waiting('INC-004515', 'pending_requester', '2026-09-30T09:00:00.000Z'),
  waiting('INC-004516', 'pending_third_party', '2026-09-27T09:00:00.000Z', { priority: 'P4' }),
  waiting('REQ-004517', 'pending_approval', '2026-10-01T09:00:00.000Z', { priority: 'P4' }),
  // The team's.
  ticket('INC-004550', { assigneeId: PRIYA, dueAt: '2026-10-02T12:00:00.000Z' }),
  ticket('INC-004551', { assigneeId: null, priority: 'P2', status: 'new', title: 'Finance share unreachable', createdAt: '2026-10-02T07:00:00.000Z', dueAt: '2026-10-02T13:00:00.000Z' }),
  ticket('INC-004552', { assigneeId: null, priority: 'P4', status: 'new', createdAt: '2026-10-02T08:30:00.000Z' }),
  waiting('INC-004553', 'pending_requester', '2026-09-20T09:00:00.000Z', { assigneeId: PRIYA }),
  // Resolved: five of Alex's in the last 30 days, two in the 30 before; Priya's.
  resolved('INC-004401', '2026-09-05T10:00:00.000Z'),
  resolved('INC-004402', '2026-09-12T10:00:00.000Z'),
  resolved('INC-004403', '2026-09-20T10:00:00.000Z'),
  resolved('INC-004404', '2026-09-28T10:00:00.000Z'),
  resolved('INC-004405', '2026-10-01T10:00:00.000Z'),
  resolved('INC-004301', '2026-08-20T10:00:00.000Z'),
  resolved('INC-004302', '2026-08-25T10:00:00.000Z'),
  resolved('INC-004406', '2026-09-30T10:00:00.000Z', { assigneeId: PRIYA }),
];

function clock(state: string, dueAt: string | null, elapsedMin: number, remainingMin: number, extra: Partial<SlaTimer> = {}): SlaTimer[] {
  return [
    {
      id: 'timer',
      targetType: 'resolution',
      state,
      startedAt: '2026-10-01T08:00:00.000Z',
      dueAt,
      remainingMs: remainingMin * 60_000,
      elapsedMs: elapsedMin * 60_000,
      warningsFired: 0,
      metAt: null,
      breachedAt: null,
      ...extra,
    },
  ];
}

const ALEX_TIMERS: Record<string, SlaTimer[]> = {
  'INC-004503': clock('breached', null, 600, -120, { breachedAt: '2026-10-01T14:10:00.000Z' }),
  'INC-004521': clock('running', '2026-10-02T09:40:00.000Z', 440, 40),
  'INC-004530': clock('running', '2026-10-02T14:00:00.000Z', 120, 300),
  'REQ-004541': clock('running', '2026-10-02T15:30:00.000Z', 60, 390),
  'INC-004540': clock('running', '2026-10-03T08:00:00.000Z', 30, 600),
  'INC-004512': clock('running', '2026-10-05T08:00:00.000Z', 30, 1200),
  'INC-004550': clock('running', '2026-10-02T12:00:00.000Z', 200, 180),
  'INC-004551': clock('running', '2026-10-02T13:00:00.000Z', 60, 240),
};

const PEOPLE: Record<string, string> = { [ME]: 'Alex Morgan', [PRIYA]: 'Priya Shah', [EMMA]: 'Emma Clarke', [DANIEL]: 'Daniel Hughes', [RYAN]: 'Ryan Webb' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function problem(status: number, code: string): Response {
  return json({ type: `https://docs.itsm.example/problems/${code}`, title: code.replace(/_/g, ' '), status, correlationId: 'c-1' }, status);
}

const at = (iso: string | null): number | null => (iso ? Date.parse(iso) : null);

/** The ticket grammar (R2), as the API applies it to a reader in the Service Desk team. */
function matching(query: URLSearchParams, now: number): { rows: Ticket[]; applied: string[] } {
  const applied: string[] = [];
  const get = (key: string): string | null => {
    const value = query.get(`filter[${key}]`);
    if (value !== null) applied.push(key);
    return value;
  };
  const list = (value: string | null): string[] | null => (value === null ? null : value.split(','));
  const assignee = get('assignee');
  const categories = list(get('statusCategory'));
  const statuses = list(get('status'));
  const priorities = list(get('priority'));
  const sla = get('sla');
  const window = (key: string) => (get(key) === null ? null : Date.parse(query.get(`filter[${key}]`)!));
  const dueAfter = window('dueAfter');
  const dueBefore = window('dueBefore');
  const resolvedAfter = window('resolvedAfter');
  const resolvedBefore = window('resolvedBefore');
  const rows = world.tickets.filter((row) => {
    if (assignee === 'me' && row.assigneeId !== ME) return false;
    if (assignee === 'none' && row.assigneeId !== null) return false;
    if (categories && !categories.includes(row.statusCategory)) return false;
    if (statuses && !statuses.includes(row.status)) return false;
    if (priorities && !priorities.includes(row.priority)) return false;
    const due = at(row.dueAt);
    if (sla === 'breached' && !(row.statusCategory === 'open' && due !== null && due <= now)) return false;
    if (sla === 'due_soon' && !(row.statusCategory === 'open' && due !== null && due > now && due <= now + 3_600_000)) return false;
    if (dueAfter !== null && (due === null || due < dueAfter)) return false;
    if (dueBefore !== null && (due === null || due >= dueBefore)) return false;
    const done = at(row.resolvedAt);
    if (resolvedAfter !== null && (done === null || done < resolvedAfter)) return false;
    if (resolvedBefore !== null && (done === null || done >= resolvedBefore)) return false;
    return true;
  });
  return { rows, applied: applied.sort() };
}

function sorted(rows: Ticket[], sort: string | null): Ticket[] {
  const key = (sort ?? '-createdAt').replace('-', '') as 'createdAt' | 'dueAt';
  const sign = sort?.startsWith('-') ? -1 : 1;
  return [...rows].sort((a, b) => {
    const x = at(a[key]);
    const y = at(b[key]);
    if (x === null && y === null) return 0;
    if (x === null) return 1;
    if (y === null) return -1;
    return sign * (x - y);
  });
}

function slaBucket(row: Ticket, now: number): string {
  if (row.statusCategory === 'paused') return 'paused';
  const due = at(row.dueAt);
  if (due === null) return 'no_target';
  if (due <= now) return 'breached';
  if (due <= now + 3_600_000) return 'due_soon';
  return 'due_later';
}

async function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(String(input));
  const method = init?.method ?? 'GET';
  const path = url.pathname;
  const query = url.searchParams;
  calls.push(`${method} ${path}`);
  for (const fault of world.fail) if (fault.match(path, query)) return problem(fault.status, fault.status === 403 ? 'forbidden' : 'internal');
  const now = NOW.getTime();

  if (path === '/api/v1/tickets') {
    const { rows, applied } = matching(query, now);
    const limit = Number(query.get('limit') ?? 50);
    const offset = Number(query.get('cursor') ?? 0);
    const page = sorted(rows, query.get('sort')).slice(offset, offset + limit);
    return json({ data: page, nextCursor: offset + limit < rows.length ? String(offset + limit) : null, applied });
  }
  if (path === '/api/v1/tickets/count') {
    const { rows, applied } = matching(query, now);
    // The API's own cap (WA1): past 1,000 it says "at least".
    return json({ count: Math.min(rows.length, 1000), capped: rows.length >= 1000, applied });
  }
  if (path === '/api/v1/tickets/counts') {
    const groupBy = query.get('groupBy')!;
    const scoped = new URLSearchParams(query);
    if (groupBy === 'sla' && !scoped.has('filter[statusCategory]')) scoped.set('filter[statusCategory]', 'open,paused');
    const { rows, applied } = matching(scoped, now);
    const groups = new Map<string | null, number>();
    for (const row of rows) {
      const key = groupBy === 'sla' ? slaBucket(row, now) : groupBy === 'priority' ? row.priority : groupBy === 'status' ? row.status : null;
      groups.set(key, (groups.get(key) ?? 0) + 1);
    }
    return json({ groupBy, groups: [...groups].map(([key, count]) => ({ key, count })), total: rows.length, applied });
  }
  const sla = /^\/api\/v1\/tickets\/([^/]+)\/sla$/.exec(path);
  if (sla) {
    const number = decodeURIComponent(sla[1]!);
    return json({ ticketId: number, timers: world.timers[number] ?? [] });
  }
  const assign = /^\/api\/v1\/tickets\/([^/]+)\/assign$/.exec(path);
  if (assign && method === 'POST') return json({});
  if (path === '/api/v1/notifications') {
    const replied = world.tickets.find((row) => row.number === 'INC-004530');
    return json({
      unread: 2,
      data: [
        ...(replied ? [{ id: 'n1', subject: 'Reply', body: 'Thanks', ticketId: replied.id, eventType: 'ticket.comment.added', readAt: null, createdAt: '2026-10-02T07:00:00.000Z' }] : []),
        { id: 'n2', subject: 'Assigned', body: 'x', ticketId: null, eventType: 'ticket.assigned', readAt: null, createdAt: '2026-10-02T06:00:00.000Z' },
      ],
    });
  }
  if (path === '/api/v1/major-incidents') {
    return json({
      data: world.incidents
        ? [
            {
              number: 'MI-0004',
              title: 'VPN sign-in failures for remote staff',
              severity: 'SEV2',
              status: 'mitigating',
              commanderId: PRIYA,
              customerFacing: true,
              declaredAt: '2026-10-02T07:30:00.000Z',
              resolvedAt: null,
              nextUpdateDueAt: '2026-10-02T09:52:00.000Z',
            },
          ]
        : [],
    });
  }
  if (path === '/api/v1/major-incidents/MI-0004') return json({ number: 'MI-0004', ticketId: MI_TICKET });
  if (path === '/api/v1/workload/rotations') {
    return json({
      data: world.rotations
        ? [
            { key: 'network', name: 'Network on call', teamId: NETWORK, timeZone: 'Europe/London', cadence: 'weekly', members: [DANIEL], handoverAt: '09:00' },
            { key: 'identity', name: 'Identity on call', teamId: IDENTITY, timeZone: 'Europe/London', cadence: 'weekly', members: [RYAN], handoverAt: '09:00' },
          ]
        : [],
    });
  }
  const onCall = /^\/api\/v1\/workload\/rotations\/([^/]+)\/on-call$/.exec(path);
  if (onCall) {
    const key = onCall[1]!;
    const team = key === 'network' ? NETWORK : IDENTITY;
    const user = key === 'network' ? DANIEL : RYAN;
    return json({
      rotation: { key, name: `${key} on call`, teamId: team, timeZone: 'Europe/London' },
      at: NOW.toISOString(),
      userId: user,
      via: 'rotation',
      upcoming: [{ at: '2026-10-05T08:00:00.000Z', userId: PRIYA, covered: true }],
      overrides: [],
    });
  }
  if (path === '/api/v1/workload/availability') {
    return json({
      data: [
        { userId: DANIEL, status: 'available', effectiveStatus: 'available', reason: null, until: null, capacity: null, source: 'manual', updatedAt: NOW.toISOString() },
        { userId: RYAN, status: 'busy', effectiveStatus: 'busy', reason: null, until: null, capacity: null, source: 'manual', updatedAt: NOW.toISOString() },
      ],
    });
  }
  if (path === '/api/v1/users') {
    const ids = (query.get('ids') ?? '').split(',').filter(Boolean);
    return json({ data: ids.filter((id) => PEOPLE[id]).map((id) => ({ id, displayName: PEOPLE[id], email: `${id}@example.test` })) });
  }
  if (path === '/api/v1/teams') {
    return json({
      data: [
        { id: SERVICE_DESK, key: 'service-desk', name: 'Service Desk', orgId: 'o', memberCount: 6 },
        { id: NETWORK, key: 'network', name: 'Network', orgId: 'o', memberCount: 4 },
        { id: IDENTITY, key: 'identity', name: 'Identity & Security', orgId: 'o', memberCount: 3 },
      ],
    });
  }
  if (path === '/api/v1/analytics/query/batch') {
    if (world.analyticsForbidden) return problem(403, 'forbidden');
    const body = JSON.parse(String(init?.body)) as { queries: { id: string; metricKey: string; groupBy?: string }[] };
    const days = Array.from({ length: 30 }, (_, index) => new Date(Date.UTC(2026, 8, 3 + index)).toISOString());
    return json({
      results: body.queries.map((question) => {
        const period = { from: days[0], to: NOW.toISOString() };
        if (question.id === 'raised') return { id: question.id, ok: true, result: { metric: { key: 'tickets.created' }, period, bucket: 'day', series: days.map((day, index) => ({ at: day, value: index === 29 ? 12 : 13 })), source: 'facts' } };
        if (question.id === 'resolved') return { id: question.id, ok: true, result: { metric: { key: 'tickets.resolved' }, period, bucket: 'day', series: days.map((day) => ({ at: day, value: 14 })), source: 'facts' } };
        if (question.id === 'attainment') return { id: question.id, ok: true, result: { metric: { key: 'sla.attainment' }, period, value: 85.4, source: 'facts', target: { value: 90, unit: 'percent', source: 'setting' } } };
        return {
          id: question.id,
          ok: true,
          result: {
            metric: { key: 'sla.attainment' },
            period,
            source: 'facts',
            groups: [
              { key: 'response', value: 92, label: null },
              { key: 'update', value: 80, label: null },
              { key: 'resolution', value: 84, label: null },
            ],
          },
        };
      }),
    });
  }
  return problem(404, 'not_found');
}

/* ------------------------------------------------- the server, as the page sees it */

const AGENT = ['ticket.read', 'ticket.update', 'ticket.create', 'ticket.assign', 'incident.major.read', 'search.query'];
const LEAD = [...AGENT, 'analytics.read', 'workload.read'];

function me(): Me {
  return {
    actor: { type: 'user', id: ME, displayName: 'Alex Morgan' },
    tenant: { id: 't', name: 'Northwind Traders', slug: 'northwind', region: 'eu' },
    permissions: world.permissions,
    organisations: [],
    teamIds: world.teamIds,
    locale: 'en-GB',
    timeZone: 'Europe/London',
  };
}

vi.mock('../server/session.js', () => ({
  currentMe: async () => me(),
  currentSession: async () => ({ id: 's1', kind: 'oidc' }),
  requireSession: async () => ({ id: 's1', kind: 'oidc' }),
  heldPermissions: (person: Me) => new Set(person.permissions.map((permission) => permission.key)),
  apiFor: () => workbench(createClient({ baseUrl: 'http://api.test', fetch: fakeFetch })),
  currentTeams: async () => [
    { id: SERVICE_DESK, key: 'service-desk', name: 'Service Desk', orgId: 'o', memberCount: 6 },
    { id: NETWORK, key: 'network', name: 'Network', orgId: 'o', memberCount: 4 },
    { id: IDENTITY, key: 'identity', name: 'Identity & Security', orgId: 'o', memberCount: 3 },
  ],
}));

const page = await import('../app/(desk)/overview/page.js');
const { default: Home } = await import('../app/page.js');
await import('../overview/AssignableAttention.js');

/* ------------------------------------------------------------- rendering */

/**
 * Stands in for the server-components renderer: awaits every async
 * component, opens every `<Suspense>` onto what it resolved to, and leaves
 * the rest for React in the browser (the portal's `home.test.tsx` pattern).
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

async function show(params: Record<string, string> = {}): Promise<HTMLElement> {
  const tree = await resolveServer(await page.default({ searchParams: Promise.resolve(params) }));
  let container!: HTMLElement;
  await act(async () => {
    container = render(
      <ItsmProvider app="workbench" Link={Link} router={router} usePathname={() => '/overview'} useSearchParams={() => new URLSearchParams()} locale="en-GB" timeZone="Europe/London" storageScope={ME}>
        {tree}
      </ItsmProvider>,
    ).container;
  });
  return container;
}

function text(node: Element | null | undefined = document.body): string {
  return (node?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function card(title: string): HTMLElement | null {
  const heading = [...document.querySelectorAll('h2, h3')].find((node) => text(node) === title);
  return (heading?.closest('.itsm-Card') as HTMLElement | null) ?? null;
}

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
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  }));
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  world = {
    permissions: LEAD.map((key) => ({ key, scope: key === 'workload.read' ? 'any' : 'team' })),
    teamIds: [SERVICE_DESK],
    tickets: ALEX_TICKETS.map((row) => ({ ...row })),
    timers: ALEX_TIMERS,
    fail: [],
    rotations: true,
    analyticsForbidden: false,
    incidents: true,
  };
  calls = [];
  pending.team = null;
  router.refresh.mockReset();
  browser.assign.mockClear();
  notify.mockReset();
});

afterEach(() => {
  cleanupDocument();
  vi.useRealTimers();
});

/* ------------------------------------------------------------------ tests */

describe('the area’s home', () => {
  it('the root opens the Overview', () => {
    let thrown: unknown;
    try {
      Home();
    } catch (error) {
      thrown = error;
    }
    expect(AREAS.workbench.home).toBe('/overview');
    expect(String((thrown as { digest?: string }).digest)).toContain(';/overview;');
  });

  it('is titled Overview, with the area’s purpose line, and no "As at" chip', async () => {
    expect(page.metadata.title).toBe('Overview');
    expect(page.dynamic).toBe('force-dynamic');
    const container = await show();
    expect(text(container.querySelector('h1'))).toBe('Overview');
    expect(text(container)).toContain(SERVICE_DESK_OVERVIEW_PURPOSE);
    expect(container.querySelectorAll('.itsm-ContextChip')).toHaveLength(0);
  });
});

describe('the page (A6 §5.2; §11 row 1)', () => {
  it('renders the toolbar, the hero, six tiles and the cards in order', async () => {
    const container = await show();
    const order = [...container.querySelectorAll('.app-Overview__toolbar, .itsm-HeroCard, .itsm-StatGrid, .itsm-Card')].map((node) =>
      node.classList.contains('app-Overview__toolbar')
        ? 'toolbar'
        : node.classList.contains('itsm-HeroCard')
          ? 'hero'
          : node.classList.contains('itsm-StatGrid')
            ? 'kpis'
            : text(node.querySelector('h2')),
    );
    expect(order).toEqual([
      'toolbar',
      'hero',
      'kpis',
      'Needs you',
      'Time left',
      'Raised vs resolved',
      'SLA met',
      'My work by priority',
      'Team queue by status',
      'Waiting on others',
      'On call now',
    ]);
  });

  it('has exactly one "As at", the toolbar’s, in the reader’s zone (X-M4)', async () => {
    const container = await show();
    const asAt = container.querySelectorAll('[data-as-at="page"]');
    expect(asAt).toHaveLength(1);
    expect(text(asAt[0])).toBe('As at Fri 2 Oct, 10:00');
    expect(asAt[0]!.closest('.app-Overview__toolbar')).not.toBeNull();
    // Nowhere else on the page says "As at" but the time series' own today marker and its table twin.
    const elsewhere = [...container.querySelectorAll('*')].filter(
      (node) => node.children.length === 0 && /As at/.test(node.textContent ?? '') && !node.closest('[data-as-at="page"]') && !node.closest('.itsm-ChartCard'),
    );
    expect(elsewhere).toEqual([]);
  });

  it('draws six tiles, each with a spark or a visual, linked to its view (X-M5)', async () => {
    const container = await show();
    const tiles = [...container.querySelectorAll('.itsm-StatGrid .itsm-StatCard')];
    expect(tiles).toHaveLength(6);
    for (const tile of tiles) expect(tile.querySelector('.itsm-StatCard__spark'), text(tile)).not.toBeNull();
    expect(tiles.map((tile) => text(tile.querySelector('.itsm-StatCard__label')))).toEqual([
      'Open',
      'Due today',
      'Breached',
      'Waiting on others',
      'Unassigned in my teams',
      'Resolved · 30 days',
    ]);
    expect(tiles.map((tile) => tile.querySelector('.itsm-StatCard__label a')?.getAttribute('href'))).toEqual([
      '/inbox/mine',
      '/inbox/mine',
      '/inbox/mine',
      '/inbox/waiting',
      '/inbox/unassigned',
      '/inbox/resolved',
    ]);
    // The trend tiles carry their lines, the others their strips and bullet.
    expect(tiles[0]!.querySelector('[data-kind="trend"]')).not.toBeNull();
    expect(tiles[5]!.querySelector('[data-kind="trend"]')).not.toBeNull();
    for (const index of [1, 2, 3, 4]) expect(tiles[index]!.querySelector('[data-kind="visual"]')).not.toBeNull();
    // No dashed "No trend yet" anywhere on a desk with history.
    expect(container.querySelector('.itsm-Sparkline[data-empty]')).toBeNull();
  });

  it('reads Alex’s figures from the ticket grammar, with the priority split and the waits (A6 §5.2.7)', async () => {
    const container = await show();
    const tiles = [...container.querySelectorAll('.itsm-StatGrid .itsm-StatCard')];
    const value = (index: number): string => text(tiles[index]!.querySelector('.itsm-StatCard__number'));
    expect(value(0)).toBe('9');
    expect(text(tiles[0])).toContain('2 P2 · 4 P3 · 3 P4');
    expect(value(1)).toBe('3');
    expect(text(tiles[1])).toContain('1 within the hour');
    expect(value(2)).toBe('1');
    expect(text(tiles[2])).toContain('Oldest 18 hours ago');
    expect(value(3)).toBe('3');
    expect(text(tiles[3])).toContain('Longest 5 days');
    expect(value(4)).toBe('2');
    expect(text(tiles[4])).toContain('Oldest 2 h');
    expect(value(5)).toBe('5');
    // The delta against the previous 30 days, as the pill says it to a screen reader.
    expect(text(tiles[5])).toContain('vs previous 30 days');
  });
});

describe('the hero (A6 §5.2.3; §11 row 1)', () => {
  it('says Off track, with what made it, the next breach, the chips, a sentence and four dimensions', async () => {
    const container = await show();
    const hero = container.querySelector('.itsm-HeroCard')!;
    expect(hero.getAttribute('data-variant')).toBe('navy');
    expect(text(hero.querySelector('.itsm-HeroCard__kicker'))).toBe('Queue health');
    expect(text(hero.querySelector('.itsm-HeroCard__verdict'))).toContain(HEALTH_VERDICT_LABELS.off_track);
    expect(text(hero)).toContain('Next breach in 40 min');
    expect(text(hero)).not.toContain('As at');
    const chips = [...hero.querySelectorAll('.itsm-HeroCard__chip')].map((chip) => text(chip));
    expect(chips).toEqual(['1 breached', '1 due within the hour', '1 customer replied', '3 waiting on others']);
    expect(text(hero)).toContain('INC-004503 passed its resolution target yesterday at 15:10; INC-004521 is due in 40 min');
    const dimensions = [...hero.querySelectorAll('.itsm-HeroCard__dimension')].map((node) => text(node));
    expect(dimensions).toHaveLength(4);
    expect(dimensions[0]).toContain('My work');
    expect(dimensions[0]).toContain(HEALTH_VERDICT_LABELS.off_track);
    expect(dimensions[0]).toContain('9 open · 1 breached · next due 40 min');
    expect(dimensions[1]).toContain('Team queue');
    expect(dimensions[1]).toContain(HEALTH_VERDICT_LABELS.at_risk);
    expect(dimensions[1]).toContain('2 unassigned · oldest 2 h');
    expect(dimensions[2]).toContain('3 waiting · longest 5 days');
    expect(dimensions[3]).toContain('MI-0004 · Sev 2 · Mitigating · next update 10:52');
    // The aside: the next breach and the share of its business time used.
    expect(text(hero)).toContain('Next breach');
    expect(text(hero)).toContain('INC-004521');
    const meter = hero.querySelector('[role="meter"]');
    expect(meter?.getAttribute('aria-valuetext')).toContain('92%');
    expect(text(hero.querySelector('button'))).toContain('Why?');
  });

  it('is On track on an empty desk, says nothing is due today, and has good news in Needs you (A6 §5.2.8)', async () => {
    world.tickets = [];
    world.incidents = false;
    const container = await show();
    const hero = container.querySelector('.itsm-HeroCard')!;
    expect(text(hero.querySelector('.itsm-HeroCard__verdict'))).toContain(HEALTH_VERDICT_LABELS.on_track);
    expect(text(hero)).toContain('Nothing due today');
    expect(text(hero)).toContain('Next deadline');
    expect(text(hero)).toContain('None today');
    expect(hero.querySelectorAll('.itsm-HeroCard__chip')).toHaveLength(0);
    expect(text(card('Needs you'))).toContain('Nothing needs you right now');
    expect(text(card('Needs you'))).toContain('Checked 10:00');
    const tiles = [...container.querySelectorAll('.itsm-StatGrid .itsm-StatCard')];
    expect(tiles.map((tile) => text(tile.querySelector('.itsm-StatCard__number')))).toEqual(['0', '0', '0', '0', '0', '0']);
    for (const tile of tiles) expect(tile.querySelector('.itsm-StatCard__spark')).not.toBeNull();
  });
});

describe('D9: analytics (A6 §3.3; §11 row 2)', () => {
  it('an agent without analytics sees no trend card and the page asks nothing of /analytics', async () => {
    world.permissions = AGENT.map((key) => ({ key, scope: 'team' }));
    world.rotations = false;
    const container = await show();
    expect(card('Raised vs resolved')).toBeNull();
    expect(card('SLA met')).toBeNull();
    expect(calls.filter((call) => call.includes('/analytics'))).toEqual([]);
    // The KPI row is the same for everyone (D9).
    expect(container.querySelectorAll('.itsm-StatGrid .itsm-StatCard')).toHaveLength(6);
    expect(text(container.querySelector('.itsm-StatGrid .itsm-StatCard__number'))).toBe('9');
    // On call shows only what the reader may see; with no rotation it is not drawn, and Waiting takes the row.
    expect(card('On call now')).toBeNull();
    expect(card('Waiting on others')?.closest('.itsm-GridItem')?.getAttribute('data-span')).toBe('12');
  });

  it('a lead sees both cards from one batch, the target from the answer and the today marker', async () => {
    await show();
    expect(calls.filter((call) => call === 'POST /api/v1/analytics/query/batch').length).toBeGreaterThan(0);
    const trend = card('Raised vs resolved')!;
    expect(text(trend.querySelector('.itsm-ChartCard__headline'))).toBe('Resolved 420, raised 389 in 30 days: the queue fell by 31');
    expect(trend.querySelector('.itsm-ChartReader, [data-reader]')).not.toBeNull();
    const sla = card('SLA met')!;
    expect(text(sla.querySelector('.itsm-ChartCard__headline'))).toBe('85% of targets met in 30 days, 5 points under the 90% target; updates fell furthest short');
    expect(text(sla)).toContain('Response 92% · Update 80% · Resolution 84%');
  });

  it('renders nothing for a 403 from analytics — no card, no problem', async () => {
    world.analyticsForbidden = true;
    const container = await show();
    expect(card('Raised vs resolved')).toBeNull();
    expect(card('SLA met')).toBeNull();
    expect(container.querySelector('.app-CardProblem')).toBeNull();
  });
});

describe('the footer to Team performance (RV6)', () => {
  it('is absent while /team is pending', async () => {
    await show();
    expect(card('Raised vs resolved')!.querySelector('a[href="/team"]')).toBeNull();
  });

  it('is present once /team ships, with no edit here', async () => {
    pending.team = false;
    await show();
    const link = card('Raised vs resolved')!.querySelector('a[href="/team"]');
    expect(link).not.toBeNull();
    expect(text(link)).toContain('Open team performance');
  });
});

describe('the toolbar (A6 §5.2.2; §11 row 3)', () => {
  it('offers scope and period as links that mark the current one', async () => {
    const container = await show();
    const scope = container.querySelector('nav[aria-label="Scope"]')!;
    expect([...scope.querySelectorAll('a')].map((link) => [text(link), link.getAttribute('href'), link.getAttribute('aria-current')])).toEqual([
      ['Mine', '/overview', 'page'],
      ['My teams', '/overview?scope=team', null],
    ]);
    const period = container.querySelector('nav[aria-label="Period"]')!;
    expect([...period.querySelectorAll('a')].map((link) => [text(link), link.getAttribute('href'), link.getAttribute('aria-current')])).toEqual([
      ['7 days', '/overview?range=7d', null],
      ['30 days', '/overview', 'page'],
      ['90 days', '/overview?range=90d', null],
    ]);
    expect(container.querySelector('.app-Overview__toolbar a[href="/inbox/mine"]')).not.toBeNull();
  });

  it('says "All teams" for a reader of every team, and no scope at all for somebody with neither teams nor that reach', async () => {
    world.permissions = world.permissions.map((grant) => (grant.key === 'ticket.read' ? { ...grant, scope: 'any' } : grant));
    let container = await show();
    expect(text(container.querySelector('nav[aria-label="Scope"]'))).toContain('All teams');
    cleanupDocument();
    world.permissions = LEAD.map((key) => ({ key, scope: 'team' }));
    world.teamIds = [];
    container = await show({ scope: 'team' });
    expect(container.querySelector('nav[aria-label="Scope"]')).toBeNull();
  });

  it('switches to 90 days: the Resolved tile, the trend and the SLA card change their period and headline', async () => {
    const container = await show({ range: '90d' });
    const tiles = [...container.querySelectorAll('.itsm-StatGrid .itsm-StatCard')];
    expect(text(tiles[5]!.querySelector('.itsm-StatCard__label'))).toBe('Resolved · 90 days');
    expect(text(tiles[5]!.querySelector('.itsm-StatCard__number'))).toBe('7');
    expect(text(card('Raised vs resolved')?.querySelector('.itsm-ChartCard__headline'))).toContain('in 90 days');
    expect(text(card('SLA met')?.querySelector('.itsm-ChartCard__headline'))).toContain('in 90 days');
  });

  it('draws no series from an incomplete read: a long range past what is read gets a bullet, and Open its own fortnight', async () => {
    // 1,100 resolved between 30 and 80 days ago: more than the five pages a sparkline reads.
    for (let index = 0; index < 1_100; index += 1) {
      world.tickets.push(resolved(`INC-9${String(index).padStart(5, '0')}`, new Date(NOW.getTime() - (30 + (index % 50)) * 86_400_000).toISOString()));
    }
    const container = await show({ range: '90d' });
    const tiles = [...container.querySelectorAll('.itsm-StatGrid .itsm-StatCard')];
    // The count caps at 1,000: "999+", said "at least 999", and no change claimed against it.
    expect(text(tiles[5]!.querySelector('.itsm-StatCard__number'))).toBe('999+');
    expect(text(tiles[5])).toContain('at least 999');
    expect(tiles[5]!.querySelector('.itsm-StatCard__delta')).toBeNull();
    expect(tiles[5]!.querySelector('[data-kind="visual"]')).not.toBeNull();
    expect(tiles[5]!.querySelector('.itsm-Sparkline')).toBeNull();
    // The Open series needs only the last 14 days, which were read whole.
    expect(tiles[0]!.querySelector('[data-kind="trend"]')).not.toBeNull();
  }, 20_000);

  it('reads the teams’ work under My teams: open across the team, the tiles to the team’s views', async () => {
    const container = await show({ scope: 'team' });
    const tiles = [...container.querySelectorAll('.itsm-StatGrid .itsm-StatCard')];
    expect(text(tiles[0]!.querySelector('.itsm-StatCard__number'))).toBe('13');
    expect(tiles[0]!.querySelector('.itsm-StatCard__label a')?.getAttribute('href')).toBe('/inbox/all');
    expect(text(card('Team work by priority'))).toContain('in your teams');
  });
});

describe('Needs you (A6 §5.2.5)', () => {
  it('counts every tab, hides the empty ones but All, and lists the most pressing first', async () => {
    await show();
    const needs = card('Needs you')!;
    // The tab's own words, then the count as drawn (the Count's spoken copy is for the ear).
    const tabs = [...needs.querySelectorAll('.itsm-AttentionList__tab')].map(
      (tab) => `${[...tab.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.textContent).join('').trim()} ${text(tab.querySelector('.itsm-Count__value'))}`,
    );
    expect(tabs).toEqual(['All 7', 'Breached 1', 'Due soon 1', 'Replied 1', 'New for you 2', 'Waiting long 1', 'Unassigned urgent 1']);
    expect(needs.querySelector('.itsm-AttentionList__tab[aria-current="page"]')?.getAttribute('href')).toBe('/overview#needs-you');
    expect(text(needs.querySelector('.itsm-Card__headline'))).toBe('7 things need you · 1 breached');
    const rows = [...needs.querySelectorAll('.itsm-AttentionList__row')];
    expect(text(rows[0])).toContain('INC-004503');
    expect(text(rows[0])).toContain('Breached 18 h ago');
    expect(text(rows[1])).toContain('Due in 40 min');
    expect(text(rows[2])).toContain('Unassigned · P2');
    expect(text(rows[2])).toContain('Unassigned');
  });

  it('opens a tab by the URL, and offers "Assign to me" on Unassigned urgent', async () => {
    await show({ attention: 'unassigned-urgent' });
    const needs = card('Needs you')!;
    for (let attempt = 0; attempt < 100 && !needs.querySelector('.itsm-AttentionList__actions'); attempt += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
    }
    const button = [...needs.querySelectorAll('button')].find((node) => text(node) === 'Assign to me');
    expect(button).toBeDefined();
    await clickAsync(button!);
    expect(browser.assign).toHaveBeenCalledWith('INC-004551', ME);
    expect(router.refresh).toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith('INC-004551 is yours now', { tone: 'success' });
  });

  it('offers no assignment to somebody who may not assign', async () => {
    world.permissions = world.permissions.filter((grant) => grant.key !== 'ticket.assign');
    await show({ attention: 'unassigned-urgent' });
    expect([...card('Needs you')!.querySelectorAll('button')].some((node) => text(node) === 'Assign to me')).toBe(false);
  });
});

describe('the other cards', () => {
  it('Time left: the six soonest clocks as time used, the breach first', async () => {
    await show();
    const time = card('Time left')!;
    expect(text(time.querySelector('.itsm-ChartCard__headline'))).toBe('1 of 6 running clocks is past its target');
    const rows = [...time.querySelectorAll('li')];
    expect(rows).toHaveLength(6);
    expect(text(rows[0])).toContain('INC-004503');
    expect(text(rows[0])).toContain('Breached');
    expect(text(rows[1])).toContain('40 min left');
  });

  it('My work by priority and Team queue by status, each segment a link to its tickets', async () => {
    await show();
    const priority = card('My work by priority')!;
    expect(text(priority.querySelector('.itsm-ChartCard__headline'))).toBe('2 of your 9 are P2; none is P1');
    expect(priority.querySelector('a[href="/inbox/mine?priority=P2"]')).not.toBeNull();
    const status = card('Team queue by status')!;
    expect(text(status.querySelector('.itsm-ChartCard__headline'))).toBe('13 open in your teams: 4 new, 5 in progress, 4 waiting');
    expect(text(status)).toContain('2 unassigned');
    expect(status.querySelector('a[href="/inbox/all?status=new"]')).not.toBeNull();
  });

  it('Waiting on others: longest without a change first, a long wait in words as well as colour', async () => {
    await show();
    const table = card('Waiting on others')!.querySelector('table')!;
    expect([...table.querySelectorAll('thead th')].map((cell) => text(cell))).toEqual(['Ticket', 'Title', 'Waiting on', 'No change for', 'Requester']);
    const rows = [...table.querySelectorAll('tbody tr')].map((row) => [...row.querySelectorAll('td')].map((cell) => text(cell)));
    expect(rows.map((row) => row[0])).toEqual(['INC-004516', 'INC-004515', 'REQ-004517']);
    expect(rows[0]!.slice(0, 4)).toEqual(['INC-004516', 'Title of INC-004516', 'Supplier', '5 days, a long wait']);
    expect(rows[0]![4]).toContain('Emma Clarke');
    expect(table.querySelector('td[data-long]')).not.toBeNull();
    expect(card('Waiting on others')!.querySelector('a[href="/inbox/waiting"]')).not.toBeNull();
  });

  it('On call now: who, for which team, until when, and their availability in words', async () => {
    await show();
    const onCall = card('On call now')!;
    const rows = [...onCall.querySelectorAll('li')].map((row) => text(row));
    expect(rows[0]).toContain('Daniel Hughes');
    expect(rows[0]).toContain('Network · until Mon 09:00');
    expect(rows[0]).toContain('Available');
    expect(rows[1]).toContain('Ryan Webb');
    expect(rows[1]).toContain('Busy');
  });
});

describe('a major incident below 1024 px (A6 §5.2.5)', () => {
  it('stands above the toolbar as a danger banner with the incident’s link, hidden from 1024 px by the stylesheet', async () => {
    const container = await show();
    const banner = container.querySelector('.app-Overview__incident')!;
    expect(banner).not.toBeNull();
    expect(banner.compareDocumentPosition(container.querySelector('.app-Overview__toolbar')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(text(banner)).toContain('Major incident');
    expect(text(banner)).toContain('MI-0004 · VPN sign-in failures for remote staff · Sev 2 · Mitigating · next update 10:52');
    // The war room is pending, so the link is the incident's ticket (RV6).
    expect(banner.querySelector(`a[href="/tickets/${MI_TICKET}"]`)).not.toBeNull();
    // Paths from the file's own location: under jsdom `URL` is the DOM's, which `fileURLToPath` refuses.
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'overview', 'overview.css'), 'utf8');
    expect(css.replace(/\s+/g, ' ')).toContain('@media (min-width: 64rem) { .app-Overview__incident { display: none; } }');
  });

  it('is not drawn when nothing is running, or for a reader who may not see major incidents', async () => {
    world.incidents = false;
    let container = await show();
    expect(container.querySelector('.app-Overview__incident')).toBeNull();
    cleanupDocument();
    world.incidents = true;
    world.permissions = world.permissions.filter((grant) => grant.key !== 'incident.major.read');
    calls = [];
    container = await show();
    expect(container.querySelector('.app-Overview__incident')).toBeNull();
    expect(calls.filter((call) => call.includes('/major-incidents'))).toEqual([]);
  });
});

describe('failures stay local (A6 §3.2 rule 1)', () => {
  it('a card whose read fails shows CardProblem while the rest render', async () => {
    world.fail = [{ match: (path, query) => path === '/api/v1/tickets' && (query.get('filter[status]') ?? '').startsWith('pending'), status: 500 }];
    const container = await show();
    const waitingCard = card('Waiting on others')!;
    expect(waitingCard.querySelector('.app-CardProblem')).not.toBeNull();
    expect(text(waitingCard)).toContain('Try again');
    expect(container.querySelector('.itsm-HeroCard')).not.toBeNull();
    expect(container.querySelectorAll('.itsm-StatGrid .itsm-StatCard')).toHaveLength(6);
    expect(card('Needs you')!.querySelector('.app-CardProblem')).toBeNull();
  });

  it('falls back to the rows, honestly, on an API without grouped counts', async () => {
    world.fail = [{ match: (path) => path === '/api/v1/tickets/counts', status: 404 }];
    const container = await show();
    const tiles = [...container.querySelectorAll('.itsm-StatGrid .itsm-StatCard')];
    expect(text(tiles[0]!.querySelector('.itsm-StatCard__number'))).toBe('9');
    expect(text(tiles[2]!.querySelector('.itsm-StatCard__number'))).toBe('1');
    expect(text(card('Team queue by status')?.querySelector('.itsm-ChartCard__headline'))).toBe('13 open in your teams: 4 new, 5 in progress, 4 waiting');
  });
});

describe('the gate', () => {
  it('tells somebody without ticket.read why, and reads nothing', async () => {
    world.permissions = [{ key: 'search.query', scope: 'any' }];
    const container = await show();
    expect(text(container)).toContain('Your account can’t read tickets');
    expect(text(container)).toContain('Ask an administrator for the agent role.');
    expect(calls).toEqual([]);
  });
});

describe('the phone (A6 §5.2.9)', () => {
  it('has section chips to jump between the cards, each to an anchor that exists', async () => {
    const container = await show();
    const jumps = container.querySelector('nav[aria-label="Sections"]')!;
    const targets = [...jumps.querySelectorAll('a')].map((link) => link.getAttribute('href')!);
    expect(targets).toEqual(['#health', '#needs-you', '#time-left', '#trend', '#team']);
    for (const target of targets) expect(container.querySelector(target), target).not.toBeNull();
  });
});

/* -------------------------------------------------------------------- axe */

interface AxeRule {
  readonly id: string;
  readonly nodes: readonly { readonly html: string }[];
}
interface Axe {
  run(context: Element, options: Record<string, unknown>): Promise<{ violations: AxeRule[] }>;
}
const axe = createRequire(createRequire(import.meta.url).resolve('@itsm/ui'))('axe-core') as Axe;
/** Rules a detached fragment cannot answer, and rules that need a layout engine jsdom lacks. */
const OFF = ['region', 'html-has-lang', 'bypass', 'document-title', 'html-lang-valid', 'color-contrast', 'color-contrast-enhanced', 'target-size'];

describe('accessibility', () => {
  it('is axe clean, for a lead and on an empty desk', async () => {
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    for (const setup of [() => undefined, () => ((world.tickets = []), (world.incidents = false))]) {
      setup();
      const container = await show();
      const results = await axe.run(container, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] },
        rules: Object.fromEntries(OFF.map((rule) => [rule, { enabled: false }])),
      });
      expect(results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.html).join(' | ')}`)).toEqual([]);
      cleanupDocument();
    }
  }, 30_000);
});
