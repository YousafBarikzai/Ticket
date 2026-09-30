import { ApiError, builders, createClient, type FieldRow, type PriorityMatrixRow, type TicketLinkRow, type TriageSuggestion, type UserRow, type WatcherRow } from '@itsm/sdk';
import { api } from '../../client/api.js';
import { deskKeys } from '../../client/query-client.js';

/**
 * What the inspector reads besides the ticket's bundle (SPEC §6.2): the AI's
 * triage, the desk's custom fields, the ticket's connections, the requester
 * and the priority matrix — each its own small query, so a section that
 * cannot be read (an older API, a right the reader lacks) is simply absent
 * while the rest works.
 *
 * Triage sits *under* the ticket's own key (`['ticket', number, 'triage']`):
 * everything that re-reads the ticket — a write, a live notice, `refresh()`
 * after an accept — re-reads it too, so a suggestion somebody has just made
 * moot never lingers. The connections sit beside it, so a status change does
 * not cost three more requests.
 */

export const inspectorKeys = {
  triage: (number: string) => [...deskKeys.ticket(number), 'triage'] as const,
  fields: () => ['desk', 'field-definitions'] as const,
  matrix: () => ['desk', 'priority-matrix'] as const,
  links: (number: string) => ['ticket-connections', number, 'links'] as const,
  watchers: (number: string) => ['ticket-connections', number, 'watchers'] as const,
  tags: (number: string) => ['ticket-connections', number, 'tags'] as const,
  person: (id: string) => ['person', id] as const,
  openFrom: (requesterId: string) => ['requester-open', requesterId] as const,
} as const;

/** Ten minutes: definitions and the matrix change when an administrator edits them, not while a ticket is open. */
const DIRECTORY_MS = 10 * 60_000;
const TICKET_MS = 15_000;

/** A read the reader may not make, or an API without the route: `null`, and the section is hidden. A network failure still throws. */
export async function unlessRefused<T>(work: Promise<T>): Promise<T | null> {
  try {
    return await work;
  } catch (error) {
    if (error instanceof ApiError && (error.status === 403 || error.status === 404 || error.status === 405 || error.status === 501)) return null;
    throw error;
  }
}

export function triageQuery(number: string, ticketId: string, enabled: boolean) {
  return {
    queryKey: inspectorKeys.triage(number),
    queryFn: async (): Promise<TriageSuggestion | null> => (await unlessRefused(api.triageSuggestion(ticketId)))?.data ?? null,
    staleTime: TICKET_MS,
    enabled,
  } as const;
}

export function fieldsQuery() {
  return {
    queryKey: inspectorKeys.fields(),
    queryFn: (): Promise<FieldRow[] | null> => unlessRefused(api.fieldDefinitions()),
    staleTime: DIRECTORY_MS,
  } as const;
}

/**
 * The desk's impact × urgency grid. Reading it needs `sla.policy.read`, which
 * most agents do not hold: `null` then, and the preview falls back to the
 * recommended grid, labelled as such.
 *
 * The workbench's own client has no SLA resource, so this one call is made
 * through the builders' — created per call, on the same `/api/proxy`, so the
 * session cookie rides along and a test's stand-in `fetch` is the one used.
 */
export function matrixQuery(enabled = true) {
  return {
    queryKey: inspectorKeys.matrix(),
    queryFn: (): Promise<PriorityMatrixRow[] | null> =>
      unlessRefused(builders(createClient({ baseUrl: '/api/proxy' })).sla.priorityMatrix()).then((rows) => (rows && rows.length > 0 ? rows : null)),
    staleTime: DIRECTORY_MS,
    enabled,
  } as const;
}

export function linksQuery(number: string, enabled: boolean) {
  return {
    queryKey: inspectorKeys.links(number),
    queryFn: (): Promise<TicketLinkRow[] | null> => unlessRefused(api.ticketLinks(number)),
    staleTime: TICKET_MS,
    enabled,
  } as const;
}

export function watchersQuery(number: string, enabled: boolean) {
  return {
    queryKey: inspectorKeys.watchers(number),
    queryFn: (): Promise<WatcherRow[] | null> => unlessRefused(api.ticketWatchers(number)),
    staleTime: TICKET_MS,
    enabled,
  } as const;
}

export function tagsQuery(number: string, enabled: boolean) {
  return {
    queryKey: inspectorKeys.tags(number),
    queryFn: (): Promise<string[] | null> => unlessRefused(api.tags(number)),
    staleTime: TICKET_MS,
    enabled,
  } as const;
}

/** A person's directory entry (name, e-mail, organisation), with `identity.user.read`. */
export function personQuery(id: string | null, enabled: boolean) {
  return {
    queryKey: inspectorKeys.person(id ?? ''),
    queryFn: (): Promise<UserRow | null> => unlessRefused(api.user(id!)),
    staleTime: DIRECTORY_MS,
    enabled: enabled && id !== null,
  } as const;
}

/** How many open tickets a requester has, a few at most: "Other open tickets from Ada (2)". */
export const OPEN_FROM_LIMIT = 6;

export interface OpenFrom {
  /** Their open tickets' numbers, this one included if it is open. */
  readonly numbers: readonly string[];
  /** More than the page held. */
  readonly more: boolean;
}

export function openFromQuery(requesterId: string | null, enabled: boolean) {
  return {
    queryKey: inspectorKeys.openFrom(requesterId ?? ''),
    queryFn: async (): Promise<OpenFrom | null> => {
      const page = await unlessRefused(api.tickets({ requester: requesterId!, statusCategory: 'open,paused', limit: OPEN_FROM_LIMIT }));
      return page ? { numbers: page.data.map((row) => row.number), more: page.nextCursor != null } : null;
    },
    staleTime: 60_000,
    enabled: enabled && requesterId !== null,
  } as const;
}
