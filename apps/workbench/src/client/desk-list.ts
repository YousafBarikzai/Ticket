import { ApiError, type Ticket } from '@itsm/sdk';
import type { BulkChange, ListPage, ListRow } from '../inbox/queries.js';
import { api } from './api.js';

/**
 * The inbox list from the browser (SPEC D16): one read of this app's own
 * aggregation handler, and the three writes the list makes itself.
 *
 * Here, in `src/client/`, because this is the one folder of the app allowed
 * to call `fetch` — every request goes to this origin (`/api/desk/list`, or
 * the SDK's `/api/proxy`), never to the API directly.
 */

/** Set by the service worker on a response it served from its cache (`@itsm/pwa`, network-first on `/api/desk/*`). */
const FROM_CACHE_HEADER = 'x-itsm-from-cache';

/**
 * One page of a view: `search` is `listSearch(view)`, `cursor` the previous
 * page's `nextCursor`. Failures are `ApiError`s — a 401 when the session
 * ended, the API's own status otherwise, 0 for no network — so the list
 * handles them exactly as it handles the SDK's.
 *
 * A page the service worker answered from its cache says when that copy was
 * made (`cachedAt`, from its `date`), so the list can say how old it is.
 */
export async function fetchDeskList(search: string, cursor: string | null, signal?: AbortSignal): Promise<ListPage> {
  const path = `/api/desk/list?${search}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
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
  const page = body as ListPage;
  const fromCache = response.headers.get(FROM_CACHE_HEADER) === '1';
  return fromCache ? { ...page, cachedAt: response.headers.get('date') ?? new Date().toISOString() } : page;
}

/**
 * The write for one row. Each carries the version the row was read at, so a
 * ticket somebody changed since it loaded is a 409 to report, never a silent
 * overwrite of their change.
 */
export function writeFor(change: BulkChange): (row: ListRow) => Promise<Ticket> {
  switch (change.kind) {
    case 'assign':
      return (row) => api.assign(row.number, change.assigneeId, undefined, row.version);
    case 'status':
      return (row) => api.transition(row.number, change.to, row.version);
    case 'priority':
      return (row) => api.updateTicket(row.number, { priority: change.priority }, row.version);
  }
}

/** A ticket as it is now, for the label on a row that left the view ("Now assigned to Jo"); `null` when it can no longer be read. */
export async function currentTicket(number: string): Promise<Ticket | null> {
  try {
    return await api.ticket(number);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 403 || error.status === 404)) return null;
    throw error;
  }
}

export interface PersonHit {
  readonly id: string;
  readonly name: string;
  readonly detail?: string;
}

/** People for the Assignee and Requester filters and "Assign to…". Needs `identity.user.read`. */
export async function searchPeople(query: string): Promise<PersonHit[]> {
  const users = await api.users({ ...(query.trim() ? { q: query.trim() } : {}), limit: 8 });
  return users.map((user) => ({ id: user.id.toLowerCase(), name: user.displayName || user.email, ...(user.email ? { detail: user.email } : {}) }));
}
