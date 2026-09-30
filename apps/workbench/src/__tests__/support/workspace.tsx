import { act, forwardRef, type AnchorHTMLAttributes, type ReactElement } from 'react';
import { vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LiveProvider } from '@itsm/pwa/live';
import type { SlaTimer, Ticket, TimelineEntry } from '@itsm/sdk';
import { ItsmProvider } from '@itsm/ui';
import { directoryKeys, type TicketBundle, type WorkspacePermissions } from '../../client/desk-ticket.js';
import { deskKeys } from '../../client/query-client.js';
import { TicketWorkspace } from '../../workspace/TicketWorkspace.js';
import { ADA, JO, ME } from './inbox.js';
import { render } from './render.js';

/**
 * Fixtures for the ticket workspace's tests: a ticket, its history and the
 * bundle the workspace caches, and `mountWorkspace`, which renders the
 * workspace the way the inbox pane and the ticket page do — inside the
 * provider, a query cache seeded with the bundle and one live stream.
 *
 * `./inbox.js` installs the jsdom stand-ins (ResizeObserver, pointer events)
 * and provides the fake stream and the recording `fetch`.
 */

export { ADA, JO, ME };

export const TEAM = '00000000-0000-4000-8000-0000000000f1';
export const OTHER_TEAM = '00000000-0000-4000-8000-0000000000f2';

export const ALL: WorkspacePermissions = {
  reply: true,
  note: true,
  transition: true,
  assign: true,
  update: true,
  create: true,
  watch: true,
  readPeople: true,
};

export function ticket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: '00000000-0000-4000-8000-000000000123',
    number: 'INC-000123',
    type: 'incident',
    title: 'VPN keeps dropping',
    description: 'Since this morning the VPN drops every ten minutes.',
    status: 'in_progress',
    statusCategory: 'open',
    priority: 'P3',
    impact: 'medium',
    urgency: 'medium',
    requesterId: ADA,
    affectedUserId: null,
    assigneeId: ME,
    groupId: TEAM,
    serviceId: null,
    categoryId: null,
    orgId: null,
    sourceChannel: 'email',
    parentId: null,
    dueAt: null,
    resolvedAt: null,
    closedAt: null,
    reopenCount: 0,
    custom: {},
    version: 4,
    createdAt: '2026-09-29T08:00:00.000Z',
    updatedAt: '2026-09-30T09:00:00.000Z',
    ...overrides,
  };
}

export const HISTORY: readonly TimelineEntry[] = [
  { kind: 'event', id: 'e-1', at: '2026-09-29T08:00:05.000Z', type: 'created', actorType: 'user', actorId: ADA, payload: { channel: 'email' } },
  { kind: 'comment', id: 'c-1', at: '2026-09-29T09:00:00.000Z', visibility: 'public', authorId: ME, body: 'Have you tried restarting it?', channel: 'api' },
  { kind: 'event', id: 'e-2', at: '2026-09-29T09:01:00.000Z', type: 'status.changed', actorType: 'user', actorId: ME, payload: { from: 'new', to: 'in_progress', reason: null } },
  { kind: 'comment', id: 'c-2', at: '2026-09-30T08:30:00.000Z', visibility: 'public', authorId: ADA, body: 'Yes, twice. Still dropping.', channel: 'email' },
  { kind: 'comment', id: 'c-3', at: '2026-09-30T08:45:00.000Z', visibility: 'internal', authorId: JO, body: 'Probably the new firewall rule.', channel: 'api' },
];

export const TIMERS: readonly SlaTimer[] = [
  {
    id: 'sla-1',
    targetType: 'resolution',
    state: 'running',
    startedAt: '2026-09-29T08:00:00.000Z',
    dueAt: '2026-09-30T12:10:00.000Z',
    remainingMs: 130 * 60_000,
    elapsedMs: 600 * 60_000,
    warningsFired: 0,
    metAt: null,
    breachedAt: null,
  },
];

export function bundle(overrides: Partial<TicketBundle> & { readonly ticket?: Ticket; readonly can?: Partial<WorkspacePermissions> } = {}): TicketBundle {
  const { can, ...rest } = overrides;
  return {
    ticket: ticket(),
    entries: HISTORY,
    attachments: [],
    includesInternal: true,
    includesEvents: true,
    timers: TIMERS,
    people: {
      [ADA]: { name: 'Ada Lovelace', initials: 'AL' },
      [JO]: { name: 'Jo Bloggs', initials: 'JB' },
      [ME]: { name: 'Sam Agent', initials: 'SA' },
    },
    viewer: { id: ME, name: 'Sam Agent', teamIds: [TEAM], can: { ...ALL, ...can } },
    loadedAt: '2026-09-30T09:00:00.000Z',
    ...rest,
  };
}

const Link = forwardRef<HTMLAnchorElement, AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; prefetch?: boolean | null }>(function Link(
  { prefetch: _prefetch, ...props },
  ref,
) {
  return <a ref={ref} {...props} />;
});

export const router = { push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() };

export interface MountWorkspaceOptions {
  readonly bundle?: TicketBundle | null;
  readonly mode?: 'pane' | 'page';
  readonly teams?: readonly { id: string; name: string }[] | null;
}

/** Renders the workspace and lets its first asynchronous work (the outbox's first read) settle. */
export async function mountWorkspace({ bundle: seeded = bundle(), mode = 'pane', teams = [{ id: TEAM, name: 'Network' }, { id: OTHER_TEAM, name: 'Service desk' }] }: MountWorkspaceOptions = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000, refetchOnWindowFocus: false } } });
  const number = seeded?.ticket.number ?? 'INC-000123';
  if (seeded) client.setQueryData(deskKeys.ticket(number), seeded);
  client.setQueryData(directoryKeys.teams(), teams);
  client.setQueryData(directoryKeys.categories(), null);
  const element: ReactElement = (
    <ItsmProvider
      app="workbench"
      Link={Link}
      router={router}
      usePathname={() => (mode === 'page' ? `/tickets/${number}` : '/inbox/mine')}
      useSearchParams={() => new URLSearchParams()}
      locale="en-GB"
      timeZone="Europe/London"
    >
      <QueryClientProvider client={client}>
        <LiveProvider topics={[`group:${TEAM}`]}>
          <TicketWorkspace ticketId={number} mode={mode} />
        </LiveProvider>
      </QueryClientProvider>
    </ItsmProvider>
  );
  const rendered = render(element);
  await flush(1);
  return { ...rendered, client, number };
}

/** The cached bundle, as the workspace sees it now. */
export function cached(client: QueryClient, number = 'INC-000123'): TicketBundle | undefined {
  return client.getQueryData<TicketBundle>(deskKeys.ticket(number));
}

/** Lets promises, animation frames and React's updates settle. */
export async function flush(times = 3): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
}

/** Waits for an assertion to pass, letting the page settle inside `act` between tries. */
export async function until(assertion: () => void, attempts = 60): Promise<void> {
  let last: unknown;
  for (let index = 0; index < attempts; index += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      last = error;
    }
    await flush(1);
  }
  throw last;
}

export function buttonNamed(name: string | RegExp, root: ParentNode = document): HTMLButtonElement | null {
  const buttons = [...root.querySelectorAll<HTMLButtonElement>('button')];
  return (
    buttons.find((button) => {
      const label = button.getAttribute('aria-label') ?? button.textContent ?? '';
      return typeof name === 'string' ? label.trim() === name : name.test(label);
    }) ?? null
  );
}

export function menuItem(name: string | RegExp): HTMLElement | null {
  const items = [...document.querySelectorAll<HTMLElement>('[role^="menuitem"]')];
  return items.find((item) => (typeof name === 'string' ? item.textContent?.trim() === name : name.test(item.textContent ?? ''))) ?? null;
}
