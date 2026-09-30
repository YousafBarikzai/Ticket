import type { QueryClient } from '@tanstack/react-query';
import {
  ApiError,
  type CategoryRow,
  type SlaTimer,
  type TeamListRow,
  type Ticket,
  type TimelineAttachment,
  type TimelineEntry,
} from '@itsm/sdk';
import type { PeopleMap } from '../inbox/presentation.js';
import { registerTicketPrefetch } from '../inbox/queries.js';
import { api } from './api.js';
import { deskKeys } from './query-client.js';

/**
 * One ticket as the workspace reads it (SPEC §6.2, D16): the ticket, its
 * conversation, its timers, names for the people in it and what the reader
 * may do — in one request to this app's own aggregation handler,
 * `GET /api/desk/tickets/[id]`, cached under `['ticket', number]`.
 *
 * Here, in `src/client/`, because this is the folder of the app allowed to
 * call `fetch`. The types are plain data, so the server's loader and the
 * handler build exactly the shape the client caches (and the page seeds).
 */

/** What the reader may do on this ticket: permission booleans from `/me`, and `note` from the timeline itself. */
export interface WorkspacePermissions {
  /** `ticket.comment.public`. */
  readonly reply: boolean;
  /** `ticket.comment.internal` on *this* ticket (the timeline says whether internal notes were included). */
  readonly note: boolean;
  readonly transition: boolean;
  readonly assign: boolean;
  /** `PATCH`: title, priority, category. */
  readonly update: boolean;
  /** Raise a follow-up. */
  readonly create: boolean;
  readonly watch: boolean;
  /** `identity.user.read`: search people for "Assign to…". */
  readonly readPeople: boolean;
}

export interface WorkspaceViewer {
  readonly id: string | null;
  readonly name: string;
  /** For the live stream: a ticket in one of these teams already reaches this tab through `group:<id>`. */
  readonly teamIds: readonly string[];
  readonly can: WorkspacePermissions;
}

export interface TicketBundle {
  readonly ticket: Ticket;
  readonly entries: readonly TimelineEntry[];
  readonly attachments: readonly TimelineAttachment[];
  /** Whether internal notes were included (the agent view). */
  readonly includesInternal: boolean;
  /** Whether events were included (people who work the desk). */
  readonly includesEvents: boolean;
  /** Every SLA timer, or `null` when they could not be read (no SLA module, no right to read them). */
  readonly timers: readonly SlaTimer[] | null;
  /** Names for the ids in the ticket and its history; an id the reader may not resolve is absent. */
  readonly people: PeopleMap;
  readonly viewer: WorkspaceViewer;
  /** When the server assembled it (ISO 8601). */
  readonly loadedAt: string;
  /** Set when the service worker answered from its copy (offline): when that copy was made. */
  readonly cachedAt?: string | null;
}

/* ------------------------------------------------------------ Assembling */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether a route parameter is a ticket's id rather than its number (a UUID redirects to the number URL). */
export function isTicketUuid(value: string): boolean {
  return UUID.test(value);
}

/**
 * The ids in a ticket worth a name: its people, every comment's author,
 * every event's actor, and whoever an assignment event names.
 */
export function bundlePeopleIds(ticket: Ticket, entries: readonly TimelineEntry[]): string[] {
  const ids = new Set<string>();
  const add = (value: unknown): void => {
    if (typeof value === 'string' && UUID.test(value)) ids.add(value.toLowerCase());
  };
  add(ticket.requesterId);
  add(ticket.assigneeId);
  add(ticket.affectedUserId);
  for (const entry of entries) {
    if (entry.kind === 'comment') add(entry.authorId);
    else if (entry.kind === 'task') add(entry.assigneeId);
    else {
      add(entry.actorId);
      add(entry.payload?.assigneeId);
    }
  }
  return [...ids].sort();
}

/** The permission booleans, from the keys the reader holds (any scope: the API decides per ticket). */
export function permissionsFrom(held: ReadonlySet<string>, includesInternal: boolean): WorkspacePermissions {
  return {
    reply: held.has('ticket.comment.public'),
    note: includesInternal && held.has('ticket.comment.internal'),
    transition: held.has('ticket.transition'),
    assign: held.has('ticket.assign'),
    update: held.has('ticket.update'),
    create: held.has('ticket.create'),
    watch: held.has('ticket.watch'),
    readPeople: held.has('identity.user.read'),
  };
}

/* ---------------------------------------------------------------- Reading */

/** Set by the service worker on a response it served from its cache. */
const FROM_CACHE_HEADER = 'x-itsm-from-cache';

/**
 * The bundle, by number (or id). Failures are `ApiError`s — 401 when the
 * session ended, 403/404 when the ticket is not the reader's to see, 0 for
 * no network — so the workspace handles them as it handles the SDK's.
 */
export async function fetchDeskTicket(idOrNumber: string, signal?: AbortSignal): Promise<TicketBundle> {
  const path = `/api/desk/tickets/${encodeURIComponent(idOrNumber)}`;
  let response: Response;
  try {
    response = await fetch(path, { headers: { accept: 'application/json' }, cache: 'no-store', ...(signal ? { signal } : {}) });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ApiError(0, null, 'The network is unavailable.');
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const problem = body && typeof body === 'object' && 'status' in body ? (body as ConstructorParameters<typeof ApiError>[1]) : null;
    throw new ApiError(response.status, problem, problem?.detail ?? problem?.title ?? response.statusText);
  }
  const bundle = body as TicketBundle;
  const fromCache = response.headers.get(FROM_CACHE_HEADER) === '1';
  return fromCache ? { ...bundle, cachedAt: response.headers.get('date') ?? new Date().toISOString() } : bundle;
}

/** A ticket is fresh for fifteen seconds; the live stream and a refocus decide after that. */
export const TICKET_STALE_MS = 15_000;

/** The one definition of the ticket's query: the workspace reads it, the list prefetches it. */
export function ticketQuery(number: string) {
  return {
    queryKey: deskKeys.ticket(number),
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchDeskTicket(number, signal),
    staleTime: TICKET_STALE_MS,
  } as const;
}

/** Warms the cache for a ticket the person is about to open (hover, the rows either side). */
export function prefetchDeskTicket(client: QueryClient, number: string): void {
  void client.prefetchQuery(ticketQuery(number));
}

// The inbox list warms tickets through this seam (WP23): registered as soon
// as the workspace's code is on the page, which is also when the list is.
if (typeof window !== 'undefined') registerTicketPrefetch(prefetchDeskTicket);

/* ------------------------------------------------------ The directories */

/**
 * The tenant's teams (A6) and ticket categories (WA2), for the Team and
 * Category chips: one read per tab, kept ten minutes. `null` when this API
 * cannot say (an older API without the route, or a refusal) — the chip is
 * then read-only rather than a picker of nothing.
 */
export const directoryKeys = {
  teams: () => ['desk', 'teams'] as const,
  categories: () => ['desk', 'categories'] as const,
} as const;

export const DIRECTORY_STALE_MS = 10 * 60_000;

export interface TeamSummary {
  readonly id: string;
  readonly name: string;
}

export interface CategorySummary {
  readonly id: string;
  readonly name: string;
  /** The full path, "Hardware / Printing": what the chip and the picker show. */
  readonly path: string;
}

async function orNull<T>(work: Promise<T>): Promise<T | null> {
  try {
    return await work;
  } catch (error) {
    if (error instanceof ApiError && (error.status === 0 || error.retryable)) throw error;
    return null;
  }
}

export function toTeams(rows: readonly TeamListRow[]): TeamSummary[] {
  return rows
    .map((row) => ({ id: row.id.toLowerCase(), name: row.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function toCategories(rows: readonly CategoryRow[]): CategorySummary[] {
  return rows
    .filter((row) => row.isActive)
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((row) => ({ id: row.id.toLowerCase(), name: row.name, path: row.path.trim() || row.name }));
}

export function teamsQuery() {
  return {
    queryKey: directoryKeys.teams(),
    queryFn: async () => {
      const rows = await orNull(api.teams());
      return rows ? toTeams(rows) : null;
    },
    staleTime: DIRECTORY_STALE_MS,
  } as const;
}

export function categoriesQuery() {
  return {
    queryKey: directoryKeys.categories(),
    queryFn: async () => {
      const rows = await orNull(api.categories());
      return rows ? toCategories(rows) : null;
    },
    staleTime: DIRECTORY_STALE_MS,
  } as const;
}
