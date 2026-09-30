import { act, forwardRef, type AnchorHTMLAttributes, type ReactElement } from 'react';
import { vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LiveProvider } from '@itsm/pwa/live';
import type { Ticket } from '@itsm/sdk';
import { ItsmProvider } from '@itsm/ui';
import { listKey, seedPages, type ListPage, type ListRow } from '../../inbox/queries.js';
import { TicketList, type InboxPermissions, type TicketListProps } from '../../inbox/TicketList.js';
import { inboxViewFrom, type SearchParams, type ViewId } from '../../inbox/views.js';
import { render } from './render.js';

/**
 * Fixtures for the inbox tests: rows, pages, a fake live stream, a fake
 * `fetch` that answers the list handler and the API proxy, and `mountList`,
 * which renders the list the way the page does — inside the provider, a
 * query cache seeded with the server's first page, and one live stream.
 *
 * jsdom has no layout, no pointer events and no idle callback; the stand-ins
 * below are the smallest that let the overlays open, and they report
 * nothing a test could come to depend on.
 */

(function installStandIns(): void {
  const scope = globalThis as Record<string, unknown>;
  scope.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
  scope.PointerEvent ??= class PointerEvent extends MouseEvent {
    readonly pointerId: number;
    readonly pointerType: string;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
      this.pointerType = init.pointerType ?? 'mouse';
    }
  };
  const element = Element.prototype as unknown as Record<string, unknown>;
  element.hasPointerCapture ??= () => false;
  element.setPointerCapture ??= () => undefined;
  element.releasePointerCapture ??= () => undefined;
  element.scrollIntoView ??= () => undefined;
})();

export const ME = '00000000-0000-4000-8000-00000000000a';
export const ADA = '00000000-0000-4000-8000-00000000000b';
export const JO = '00000000-0000-4000-8000-00000000000c';

export const ALL_RIGHTS: InboxPermissions = { read: true, assign: true, transition: true, update: true, readPeople: true };

let counter = 0;

export function row(overrides: Partial<ListRow> & { number?: string } = {}): ListRow {
  counter += 1;
  const number = overrides.number ?? `INC-${String(counter).padStart(6, '0')}`;
  return {
    id: overrides.id ?? `id-${number}`,
    number,
    type: 'incident',
    title: `Ticket ${number}`,
    status: 'in_progress',
    statusCategory: 'open',
    priority: 'P3',
    requesterId: ADA,
    assigneeId: null,
    groupId: null,
    dueAt: null,
    createdAt: '2026-09-30T08:00:00.000Z',
    updatedAt: '2026-09-30T09:00:00.000Z',
    version: 1,
    ...overrides,
  };
}

export function page(rows: readonly ListRow[], nextCursor: string | null = null): ListPage {
  return { rows, nextCursor, people: { [ADA]: { name: 'Ada Lovelace', initials: 'AL' }, [JO]: { name: 'Jo Bloggs', initials: 'JB' } } };
}

/** A ticket as the API answers a write or a read: the row plus what a row leaves out. */
export function apiTicket(from: ListRow, changes: Partial<Ticket> = {}): Ticket {
  return {
    ...from,
    description: null,
    impact: 'medium',
    urgency: 'medium',
    affectedUserId: null,
    serviceId: null,
    categoryId: null,
    orgId: null,
    sourceChannel: 'portal',
    parentId: null,
    resolvedAt: null,
    closedAt: null,
    reopenCount: 0,
    custom: {},
    ...changes,
  } as Ticket;
}

/* ------------------------------------------------------------ The stream */

export class FakeEventSource {
  static readonly CLOSED = 2;
  static opened: FakeEventSource[] = [];
  readonly listeners = new Map<string, ((event: unknown) => void)[]>();
  readyState = 1;
  onerror: ((event: unknown) => void) | null = null;
  constructor(readonly url: string) {
    FakeEventSource.opened.push(this);
  }
  addEventListener(name: string, handler: (event: unknown) => void): void {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), handler]);
  }
  emit(name: string, data: unknown): void {
    for (const handler of this.listeners.get(name) ?? []) handler({ data: JSON.stringify(data) });
  }
  close(): void {
    this.readyState = 2;
  }
}

export function stream(): FakeEventSource {
  const source = FakeEventSource.opened.at(-1);
  if (!source) throw new Error('no stream was opened');
  return source;
}

/* ------------------------------------------------------------- The wire */

export interface Call {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
}

export type Handler = (call: Call) => { status?: number; body?: unknown } | undefined;

/** A `fetch` that records every call and answers with the first handler that knows it. */
export function fakeFetch(...handlers: Handler[]): { readonly calls: Call[]; readonly fetch: typeof fetch } {
  const calls: Call[] = [];
  const impl = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const call: Call = {
      url: String(input),
      method: init.method ?? 'GET',
      headers: (init.headers ?? {}) as Record<string, string>,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    for (const handler of handlers) {
      const answer = handler(call);
      if (answer) {
        return new Response(answer.body === undefined ? null : JSON.stringify(answer.body), {
          status: answer.status ?? 200,
          headers: { 'content-type': 'application/json' },
        });
      }
    }
    return new Response(JSON.stringify({ status: 404, title: 'Not found' }), { status: 404 });
  });
  return { calls, fetch: impl as unknown as typeof fetch };
}

/* -------------------------------------------------------------- Mounting */

const Link = forwardRef<HTMLAnchorElement, AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; prefetch?: boolean | null }>(function Link(
  { prefetch: _prefetch, ...props },
  ref,
) {
  return <a ref={ref} {...props} />;
});

const router = { push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() };

export interface MountOptions {
  readonly view?: ViewId;
  readonly params?: SearchParams;
  readonly rows: readonly ListRow[];
  readonly nextCursor?: string | null;
  readonly props?: Partial<TicketListProps>;
  /** Nothing seeded: the list loads its first page itself. */
  readonly unseeded?: boolean;
}

export function mountList({ view: viewId = 'all', params = {}, rows, nextCursor = null, props = {}, unseeded = false }: MountOptions) {
  const view = inboxViewFrom({ kind: 'view', id: viewId }, params);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000, refetchOnWindowFocus: false } } });
  if (!unseeded) client.setQueryData(listKey(view), seedPages(page(rows, nextCursor)));
  const onOpen = vi.fn();
  const onFollow = vi.fn();
  const onClearFilters = vi.fn();
  const element: ReactElement = (
    <ItsmProvider
      app="workbench"
      Link={Link}
      router={router}
      usePathname={() => '/inbox/all'}
      useSearchParams={() => new URLSearchParams()}
      locale="en-GB"
      timeZone="Europe/London"
    >
      <QueryClientProvider client={client}>
        <LiveProvider topics={['group:team-1']}>
          <TicketList view={view} me={ME} meName="Sam Agent" can={ALL_RIGHTS} selected={null} onOpen={onOpen} onFollow={onFollow} onClearFilters={onClearFilters} {...props} />
        </LiveProvider>
      </QueryClientProvider>
    </ItsmProvider>
  );
  const rendered = render(element);
  return { ...rendered, view, client, onOpen, onFollow, onClearFilters };
}

/* ----------------------------------------------------------------- Reading */

export function rowElements(): HTMLLIElement[] {
  return [...document.querySelectorAll<HTMLLIElement>('.app-TicketRow')];
}

export function links(): HTMLAnchorElement[] {
  return [...document.querySelectorAll<HTMLAnchorElement>('.app-TicketRow__link')];
}

export function titles(): string[] {
  return [...document.querySelectorAll('.app-TicketRow__title')].map((element) => element.textContent ?? '');
}

export function key(target: Element, name: string, init: KeyboardEventInit = {}): void {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init }));
  });
}

export function pointerDown(target: Element): void {
  act(() => {
    target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerType: 'mouse' }));
  });
}

/** Stops the provider mounting the toast host when the page goes idle: toasts are asserted through a mocked `notify`. */
export function noIdle(): void {
  vi.stubGlobal('requestIdleCallback', () => 0);
  vi.stubGlobal('cancelIdleCallback', () => undefined);
}
