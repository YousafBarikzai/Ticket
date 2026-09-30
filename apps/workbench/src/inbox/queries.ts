import type { QueryClient } from '@tanstack/react-query';
import { ApiError, type Ticket } from '@itsm/sdk';
import type { Plural } from '@itsm/ui';
import { deskKeys } from '../client/query-client.js';
import { transitionsFrom } from '../queue/transitions.js';
import { personName, stateLabel, type PeopleMap } from './presentation.js';
import { inboxHref, isUuid, isViewId, type InboxView, type ViewRef } from './views.js';

/**
 * The inbox list's data, as plain functions (SPEC §6.2, D16).
 *
 * Kept free of React and of the browser so the server page, the list
 * handler, the components and the tests all read one definition of what a
 * row is, what a view's cache key is, how a live refresh folds into what the
 * person is looking at, and how a bulk change is planned, run and reported.
 * The rules are the interesting part, and rules are easiest to trust when
 * they can be called with a list and an answer checked.
 */

/* ---------------------------------------------------------------- A row */

/**
 * One row of the list: what a row shows and what a write from the list
 * needs (the version it was read at), nothing more. The API's ticket carries
 * the description and custom fields, which can be long; a list of fifty is
 * not the place to download them.
 */
export interface ListRow {
  readonly id: string;
  readonly number: string;
  readonly type: string;
  readonly title: string;
  readonly status: string;
  readonly statusCategory: string;
  readonly priority: string;
  readonly requesterId: string | null;
  readonly assigneeId: string | null;
  readonly groupId: string | null;
  readonly dueAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
}

export function toListRow(ticket: Ticket): ListRow {
  return {
    id: ticket.id,
    number: ticket.number,
    type: ticket.type,
    title: ticket.title,
    status: ticket.status,
    statusCategory: ticket.statusCategory,
    priority: ticket.priority,
    requesterId: ticket.requesterId,
    assigneeId: ticket.assigneeId,
    groupId: ticket.groupId,
    dueAt: ticket.dueAt,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
    version: ticket.version,
  };
}

/** One page of a view, as `GET /api/desk/list` answers it. */
export interface ListPage {
  readonly rows: readonly ListRow[];
  readonly nextCursor: string | null;
  /** Names for the requesters and assignees on this page; an id the reader may not resolve is absent. */
  readonly people: PeopleMap;
  /**
   * Set when the service worker answered from its copy (offline): when that
   * copy was made, for "Offline · showing the copy from 10:42".
   */
  readonly cachedAt?: string | null;
}

/** The ids on a page worth a name: requesters and assignees. */
export function peopleIdsOf(rows: readonly ListRow[]): string[] {
  return rows.flatMap((row) => [row.requesterId, row.assigneeId]).filter((id): id is string => id !== null);
}

export const TICKET_NOUN: Plural = { one: 'ticket', other: 'tickets' };

/* ------------------------------------------------------- A view's query */

/** `mine`, or `team:<uuid>` — the same spelling as `viewKey()` — back to the view it names. */
export function viewRefFromKey(value: string | null | undefined): ViewRef | null {
  if (!value) return null;
  if (isViewId(value)) return { kind: 'view', id: value };
  const team = /^team:(.+)$/.exec(value);
  return team && isUuid(team[1]!) ? { kind: 'team', teamId: team[1]!.toLowerCase() } : null;
}

/**
 * The query string `GET /api/desk/list` reads for a view: which view, then
 * the filters the person added, in one fixed order. It doubles as the cache
 * key's last part, so two spellings of one filter never cache twice and two
 * different filters never share rows. No cursor: paging is the query's own.
 */
export function listSearch(view: InboxView): string {
  const params = new URLSearchParams();
  params.set('view', view.key);
  const { filters } = view;
  for (const key of ['q', 'status', 'priority', 'type', 'assignee', 'requester', 'team'] as const) {
    if (filters[key]) params.set(key, filters[key]);
  }
  if (!view.fixedSort && view.sort !== view.defaultSort) params.set('sort', view.sort);
  return params.toString();
}

/** The cache key a view's list lives under: `['view', 'mine', 'view=mine&status=new']`. */
export function listKey(view: InboxView): readonly unknown[] {
  return deskKeys.view(view.key, listSearch(view));
}

/** The infinite query's data, as TanStack keeps it. */
export interface ListPages {
  readonly pages: readonly ListPage[];
  readonly pageParams: readonly (string | null)[];
}

/** A server-rendered first page, in the shape the client's infinite query expects to find in its cache. */
export function seedPages(page: ListPage): ListPages {
  return { pages: [page], pageParams: [null] };
}

/** Every loaded row, in the server's order, once each (a row that moved between pages is kept where it came first). */
export function rowsOf(data: { readonly pages: readonly ListPage[] } | undefined): readonly ListRow[] {
  if (!data) return [];
  const seen = new Set<string>();
  const rows: ListRow[] = [];
  for (const page of data.pages) {
    for (const row of page.rows) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      rows.push(row);
    }
  }
  return rows;
}

/** Every name the loaded pages brought, merged over the names already known. */
export function peopleOf(data: { readonly pages: readonly ListPage[] } | undefined, known: PeopleMap = {}): PeopleMap {
  if (!data) return known;
  return Object.assign({}, known, ...data.pages.map((page) => page.people));
}

/* ------------------------------------------------------------ Live rows */

/** A row as the list shows it: current, or left behind by a change that took it out of the view. */
export interface ShownRow {
  readonly row: ListRow;
  /** No longer in the view: it stays, still, with a label, until it is off-screen or the person acts (X-§8). */
  readonly moved?: boolean;
}

export interface ListState {
  readonly rows: readonly ShownRow[];
  /** Rows the view gained on its own, waiting behind "3 new · Show". */
  readonly held: readonly ListRow[];
  /** Rows changed in place by the last live refresh: they flash, at most five. */
  readonly changed: readonly string[];
}

export const EMPTY_LIST: ListState = { rows: [], held: [], changed: [] };

/** How many changed rows flash at once (SPEC §1.9): more than that is noise, not news. */
export const MAX_FLASH = 5;

function sameRow(a: ListRow, b: ListRow): boolean {
  return a.version === b.version && a.updatedAt === b.updatedAt;
}

/**
 * Folds a refresh the person did not ask for — a live notice, a refocus —
 * into what they are looking at, without moving anything under them
 * (SPEC §4.10 "Live updates", §6.2):
 *
 *   - a row still in the view is updated where it is (and flashes if it changed);
 *   - a row no longer in the view stays where it is, marked as moved;
 *   - a row the view gained waits behind the "N new" pill.
 *
 * With more pages to load, a row that appears after the last row already
 * shown is not news: it is the next page's first row nudged up by one that
 * left. It joins the end quietly, where "Load more" would have put it.
 */
export function reconcileLive(previous: ListState, server: readonly ListRow[], hadMore: boolean): ListState {
  const fresh = new Map(server.map((row) => [row.id, row]));
  const changed: string[] = [];
  const rows = previous.rows.map((entry): ShownRow => {
    const next = fresh.get(entry.row.id);
    if (!next) return entry.moved ? entry : { row: entry.row, moved: true };
    if (!sameRow(next, entry.row)) changed.push(next.id);
    return next === entry.row && !entry.moved ? entry : { row: next };
  });

  const shown = new Set(previous.rows.map((entry) => entry.row.id));
  let lastShown = -1;
  server.forEach((row, index) => {
    if (shown.has(row.id)) lastShown = index;
  });
  const held: ListRow[] = [];
  const spill: ShownRow[] = [];
  server.forEach((row, index) => {
    if (shown.has(row.id)) return;
    if (hadMore && index > lastShown) spill.push({ row });
    else held.push(row);
  });

  return { rows: spill.length > 0 ? [...rows, ...spill] : rows, held, changed: changed.slice(0, MAX_FLASH) };
}

/**
 * Shows the server's list as it is — after something the person did: a
 * filter, "Show", "Load more", a change of their own. Moved rows go, except
 * the ones that must never vanish under someone (the open ticket, the
 * focused row), which keep their place.
 */
export function applyServer(previous: ListState, server: readonly ListRow[], keep: ReadonlySet<string> = new Set()): ListState {
  const rows: ShownRow[] = server.map((row) => ({ row }));
  if (keep.size > 0) {
    const present = new Set(server.map((row) => row.id));
    previous.rows.forEach((entry, index) => {
      if (present.has(entry.row.id) || !keep.has(entry.row.id)) return;
      rows.splice(Math.min(index, rows.length), 0, { row: entry.row, moved: true });
    });
  }
  return { rows, held: [], changed: [] };
}

/** A moved row that has scrolled out of sight leaves. */
export function dropMoved(state: ListState, id: string): ListState {
  const rows = state.rows.filter((entry) => !(entry.moved && entry.row.id === id));
  return rows.length === state.rows.length ? state : { ...state, rows };
}

/** "3 new tickets", for the live region; `null` for none. */
export function newTicketsMessage(count: number): string | null {
  if (count <= 0) return null;
  return `${count} new ${count === 1 ? TICKET_NOUN.one : TICKET_NOUN.other}`;
}

/**
 * Why a row left the view, from what the ticket is now: "Now assigned to
 * Jo", "Now resolved". The label is static: the row does not move, it says
 * what happened.
 */
export function movedLabel(before: ListRow, after: Ticket | null, people: PeopleMap, me: string | null): string {
  if (!after) return 'No longer available to you';
  if (after.assigneeId !== before.assigneeId) {
    if (!after.assigneeId) return 'Now unassigned';
    if (after.assigneeId === me) return 'Now assigned to you';
    const name = people[after.assigneeId]?.name;
    return name ? `Now assigned to ${name}` : 'Now assigned to someone else';
  }
  if (after.status !== before.status) return `Now ${stateLabel(after.status).toLowerCase()}`;
  if (after.groupId !== before.groupId) return 'Moved to another team';
  if (after.priority !== before.priority) return `Now ${after.priority}`;
  return 'No longer in this view';
}

/* ------------------------------------------------------ Prefetching tickets */

/**
 * How the list warms a ticket before it is opened — on hover (150 ms of
 * intent) and for the rows either side of the current one (SPEC §6.2) — so
 * `j`/`k` and a click swap the ticket beside the list from the cache.
 *
 * The ticket's query is the workspace's (its key, its handler, its shape),
 * so the workspace registers how to prefetch one; until it does, nothing is
 * fetched. A seam rather than an import: the list must not guess another
 * screen's cache entry.
 */
export type TicketPrefetch = (client: QueryClient, number: string) => void;

let ticketPrefetch: TicketPrefetch | null = null;

/** Called once by the workspace; returns the function that removes it. */
export function registerTicketPrefetch(prefetch: TicketPrefetch): () => void {
  ticketPrefetch = prefetch;
  return () => {
    if (ticketPrefetch === prefetch) ticketPrefetch = null;
  };
}

export function prefetchTicket(client: QueryClient, number: string): void {
  try {
    ticketPrefetch?.(client, number);
  } catch {
    // Warming a cache is a courtesy; failing to must never break the list.
  }
}

/** How long a pointer must rest on a row before its ticket is fetched (SPEC §6.2). */
export const PREFETCH_INTENT_MS = 150;

/* --------------------------------------------------------- List context */

/**
 * The list a ticket was opened from, for the ticket's ‹ › and "‹ Back to My
 * work" (SPEC §6.2): the view's link without the selection, its name, and
 * the tickets in the order shown. Kept in `sessionStorage` (this tab only).
 */
export const LIST_CONTEXT_KEY = 'itsm-wb-list-context';

export interface ListContext {
  readonly href: string;
  readonly title: string;
  readonly numbers: readonly string[];
}

/** Enough to step through a long list; the ticket's arrows stop at the end of what was loaded. */
export const MAX_CONTEXT = 200;

export function listContext(view: InboxView, rows: readonly ShownRow[]): ListContext {
  return {
    href: inboxHref(view, { t: '' }),
    title: view.title,
    numbers: rows
      .filter((entry) => !entry.moved)
      .slice(0, MAX_CONTEXT)
      .map((entry) => entry.row.number),
  };
}

/* --------------------------------------------------------------- Unread */

/**
 * What this person has seen, on this device: each ticket's `updatedAt` when
 * they last had it open, and the moment the record began. Kept in
 * `localStorage` under an `itsm-wb-` key, which sign-out clears.
 */
export interface SeenRecord {
  readonly since: string;
  readonly seen: Readonly<Record<string, string>>;
}

/** A shared machine keeps one person's record apart from the next person's. */
export function seenStorageKey(scope?: string | null): string {
  return `itsm-wb-seen${scope ? `:${scope}` : ''}`;
}

/** Enough to cover several days of a busy desk; the oldest entries go first. */
export const MAX_SEEN = 500;

function time(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Unread: changed since the person last opened it here — for work that is
 * theirs or waiting to be picked up. Someone else's ticket changing is their
 * news, not yours, and marking it would turn All open into a wall of dots.
 * Nothing is unread before a record exists (the first visit is not a flood).
 */
export function isUnread(row: ListRow, record: SeenRecord | null, me: string | null): boolean {
  if (!record) return false;
  if (row.statusCategory === 'resolved' || row.statusCategory === 'closed') return false;
  if (row.assigneeId !== null && row.assigneeId !== me) return false;
  return time(row.updatedAt) > time(record.seen[row.id] ?? record.since);
}

export function markSeen(record: SeenRecord, rows: readonly Pick<ListRow, 'id' | 'updatedAt'>[]): SeenRecord {
  let changed = false;
  const seen: Record<string, string> = { ...record.seen };
  for (const row of rows) {
    if (seen[row.id] && time(seen[row.id]!) >= time(row.updatedAt)) continue;
    delete seen[row.id];
    seen[row.id] = row.updatedAt;
    changed = true;
  }
  if (!changed) return record;
  const ids = Object.keys(seen);
  for (const id of ids.slice(0, Math.max(0, ids.length - MAX_SEEN))) delete seen[id];
  return { since: record.since, seen };
}

export function parseSeen(raw: string | null): SeenRecord | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return null;
    const { since, seen } = value as { since?: unknown; seen?: unknown };
    if (typeof since !== 'string' || !seen || typeof seen !== 'object') return null;
    const clean: Record<string, string> = {};
    for (const [id, at] of Object.entries(seen as Record<string, unknown>)) if (typeof at === 'string') clean[id] = at;
    return { since, seen: clean };
  } catch {
    return null;
  }
}

/* ----------------------------------------------------------------- Bulk */

export type Priority = 'P1' | 'P2' | 'P3' | 'P4';
export const PRIORITIES: readonly Priority[] = ['P1', 'P2', 'P3', 'P4'];

/** One change, applied to one ticket or to every selected one. */
export type BulkChange =
  | { readonly kind: 'assign'; readonly assigneeId: string | null; readonly name?: string }
  | { readonly kind: 'status'; readonly to: string }
  | { readonly kind: 'priority'; readonly priority: Priority };

export interface BulkSkip {
  readonly row: ListRow;
  readonly reason: string;
}

export interface BulkPlan {
  readonly send: readonly ListRow[];
  readonly skipped: readonly BulkSkip[];
}

function assigneeWords(change: Extract<BulkChange, { kind: 'assign' }>, me: string | null): string {
  if (change.assigneeId === null) return 'unassigned';
  if (change.assigneeId === me) return 'assigned to you';
  return `assigned to ${change.name ?? 'them'}`;
}

/**
 * Which of the rows the change applies to. A row that already has what is
 * asked, or whose state cannot make the move, is skipped with the reason —
 * sending it would earn a refusal that says the same thing less clearly.
 */
export function planBulk(change: BulkChange, rows: readonly ListRow[], me: string | null): BulkPlan {
  const send: ListRow[] = [];
  const skipped: BulkSkip[] = [];
  for (const row of rows) {
    let reason: string | null = null;
    switch (change.kind) {
      case 'assign':
        if (row.assigneeId === change.assigneeId) reason = `Already ${assigneeWords(change, me)}`;
        break;
      case 'status':
        if (row.status === change.to) reason = `Already ${stateLabel(change.to).toLowerCase()}`;
        else if (!transitionsFrom(row.status).includes(change.to))
          reason = `Can’t move from ${stateLabel(row.status)} to ${stateLabel(change.to)}`;
        break;
      case 'priority':
        if (row.priority.toUpperCase() === change.priority) reason = `Already ${change.priority}`;
        break;
    }
    if (reason) skipped.push({ row, reason });
    else send.push(row);
  }
  return { send, skipped };
}

/**
 * The moves every selected ticket can make: the intersection of what each
 * one's state allows (SPEC §6.2), in the state machine's order.
 */
export function statusChoices(rows: readonly ListRow[]): string[] {
  if (rows.length === 0) return [];
  let choices = [...transitionsFrom(rows[0]!.status)];
  for (const row of rows.slice(1)) {
    const allowed = new Set(transitionsFrom(row.status));
    choices = choices.filter((state) => allowed.has(state));
  }
  return choices;
}

/** What the progress line says while a change runs. */
export function bulkVerb(change: BulkChange): string {
  switch (change.kind) {
    case 'assign':
      return change.assigneeId === null ? 'Unassigning' : 'Assigning';
    case 'status':
      return `Moving to ${stateLabel(change.to)}`;
    case 'priority':
      return `Setting ${change.priority}`;
  }
}

export interface BulkOutcome<T, R> {
  readonly item: T;
  /** `cancelled`: never sent, because the person pressed Cancel first. */
  readonly status: 'done' | 'failed' | 'cancelled';
  readonly value?: R;
  readonly error?: unknown;
}

export interface RunBulkOptions<T, R> {
  /** How many writes are in flight at once. Four: quick, without queueing up behind the API's rate limit. */
  readonly concurrency?: number;
  /** Cancel: stops dispatching; what is already in flight finishes and is reported. */
  readonly signal?: AbortSignal;
  /** After each write settles, with how many have. */
  readonly onSettled?: (outcome: BulkOutcome<T, R>, settled: number) => void;
}

export const BULK_CONCURRENCY = 4;

/**
 * Runs one write per item, at most `concurrency` at a time, and reports every
 * item: done, failed (with its error) or cancelled (never sent). The results
 * keep the items' order whatever order the writes finished in.
 */
export async function runBulk<T, R>(
  items: readonly T[],
  work: (item: T) => Promise<R>,
  { concurrency = BULK_CONCURRENCY, signal, onSettled }: RunBulkOptions<T, R> = {},
): Promise<BulkOutcome<T, R>[]> {
  const results: (BulkOutcome<T, R> | undefined)[] = new Array(items.length);
  let next = 0;
  let settled = 0;
  const lane = async (): Promise<void> => {
    while (next < items.length && !signal?.aborted) {
      const index = next++;
      const item = items[index]!;
      let outcome: BulkOutcome<T, R>;
      try {
        outcome = { item, status: 'done', value: await work(item) };
      } catch (error) {
        outcome = { item, status: 'failed', error };
      }
      results[index] = outcome;
      settled += 1;
      onSettled?.(outcome, settled);
    }
  };
  const lanes = Math.max(1, Math.min(Math.floor(concurrency), items.length));
  await Promise.all(Array.from({ length: items.length === 0 ? 0 : lanes }, lane));
  return items.map((item, index) => results[index] ?? { item, status: 'cancelled' });
}

export interface BulkTally {
  readonly done: number;
  readonly failed: number;
  readonly skipped: number;
  readonly cancelled: number;
}

export function tally(outcomes: readonly BulkOutcome<unknown, unknown>[], skipped: number): BulkTally {
  return {
    done: outcomes.filter((outcome) => outcome.status === 'done').length,
    failed: outcomes.filter((outcome) => outcome.status === 'failed').length,
    cancelled: outcomes.filter((outcome) => outcome.status === 'cancelled').length,
    skipped,
  };
}

function tickets(count: number): string {
  return `${count} ${count === 1 ? TICKET_NOUN.one : TICKET_NOUN.other}`;
}

/**
 * The results toast (SPEC §6.2): "Updated 3 tickets", "Updated 11 of 12 · 1
 * skipped", "Couldn’t update 2 tickets". Never "Done" when something was not.
 */
export function bulkSummary(result: BulkTally): { readonly title: string; readonly tone: 'success' | 'warning' | 'danger' } {
  const total = result.done + result.failed + result.skipped + result.cancelled;
  if (total === 0) return { title: 'Nothing to update', tone: 'warning' };
  if (result.done === total) return { title: `Updated ${tickets(total)}`, tone: 'success' };
  if (result.done === 0 && result.failed === total) return { title: `Couldn’t update ${total === 1 ? 'the ticket' : tickets(total)}`, tone: 'danger' };
  if (result.done === 0 && result.skipped === total) {
    return { title: total === 1 ? 'Nothing to change: the ticket already has it' : `Nothing to change in ${tickets(total)}`, tone: 'warning' };
  }
  const parts = [
    `Updated ${result.done} of ${total}`,
    result.failed > 0 ? `${result.failed} failed` : null,
    result.skipped > 0 ? `${result.skipped} skipped` : null,
    result.cancelled > 0 ? `${result.cancelled} not started` : null,
  ].filter((part): part is string => part !== null);
  return { title: parts.join(' · '), tone: result.failed > 0 || result.done === 0 ? 'danger' : 'warning' };
}

/** Why one write failed, in words a person can act on. */
export function failureReason(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.status) {
      case 0:
        return 'No connection';
      case 403:
        return 'You can’t make this change';
      case 404:
        return 'It no longer exists, or it’s outside your teams';
      case 409:
      case 412:
        return 'Someone changed it since it loaded';
      case 428:
        return 'It needs reloading first';
      case 429:
        return 'Too many changes at once';
      default:
        if (error.status === 422) return error.problem?.detail ?? 'The change was refused';
        if (error.status >= 500) return 'The service had a problem';
        return error.problem?.detail ?? error.message;
    }
  }
  return 'Something went wrong';
}

/** "Assign to you", "Resolved", "P2" — how a change reads in the report's heading. */
export function describeChange(change: BulkChange, people: PeopleMap, me: string | null): string {
  switch (change.kind) {
    case 'assign':
      return change.assigneeId === null ? 'Unassign' : `Assign to ${change.assigneeId === me ? 'you' : (change.name ?? personName(change.assigneeId, people, me))}`;
    case 'status':
      return `Move to ${stateLabel(change.to)}`;
    case 'priority':
      return `Set priority ${change.priority}`;
  }
}
