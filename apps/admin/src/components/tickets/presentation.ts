import type { IconName, Tone } from '@itsm/ui';
import type { SlaTimer, Ticket, TicketFilter } from '@itsm/sdk';
import { TICKET_STATUSES, TICKET_TYPES } from '../../rules/facts.js';

/**
 * The Tickets finder in words and URLs (SPEC §6.1 `/tickets`, B §3.2): the
 * query string it answers to — including the legacy `?status=…&assignee=none`
 * links other pages and people have — and how a ticket reads in a row and a
 * drawer. Pure, so the parts that can quietly go wrong (a filter the API
 * would ignore, a scope that shows the wrong tickets) have tests.
 */

/* =========================================================================
 * The URL
 * ====================================================================== */

/** The scope switch: the API's four status categories and "All". The default is Open. */
export const SCOPES = [
  { value: 'open', label: 'Open' },
  { value: 'paused', label: 'Paused' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed' },
  { value: 'all', label: 'All' },
] as const;
export type Scope = (typeof SCOPES)[number]['value'];

export const PRIORITY_VALUES = ['P1', 'P2', 'P3', 'P4'] as const;
export const TYPE_VALUES = TICKET_TYPES.map((type) => type.value);
export const SORTS = ['-createdAt', 'createdAt', 'dueAt', '-dueAt'] as const;
export type TicketSort = (typeof SORTS)[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string | null | undefined): value is string {
  return typeof value === 'string' && UUID.test(value);
}

/** What the page was asked for, read defensively: anything the API would ignore or refuse is dropped here. */
export interface TicketQuery {
  readonly scope: Scope;
  readonly q: string;
  readonly priority: readonly string[];
  readonly type: readonly string[];
  /** `none`, `me`, or a person's id. */
  readonly assignee: string | null;
  readonly team: string | null;
  readonly service: string | null;
  readonly sort: TicketSort;
}

type Params = URLSearchParams | Readonly<Record<string, string | string[] | undefined>>;

function get(params: Params, name: string): string | null {
  if (params instanceof URLSearchParams) return params.get(name);
  const value = params[name];
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

function list(raw: string | null, allowed: readonly string[]): string[] {
  if (!raw) return [];
  const wanted = raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  // Case-insensitive for priorities typed by hand (`p1`), stored as the API spells them.
  return allowed.filter((value) => wanted.some((item) => item.toLowerCase() === value.toLowerCase()));
}

/**
 * The query string as a query. `status` is the scope and takes the legacy
 * values (`open`, `paused`, `resolved`, `closed`) unchanged; an unknown or
 * missing one is Open — the new default. `assignee` is `none`, `me` or a
 * person's id; `team` and `service` must be ids (the API validates them as
 * UUIDs and would refuse the whole list otherwise).
 */
export function readTicketQuery(params: Params): TicketQuery {
  const status = get(params, 'status');
  const scope = (SCOPES.find((entry) => entry.value === status)?.value ?? 'open') as Scope;
  const assignee = get(params, 'assignee');
  const team = get(params, 'team');
  const service = get(params, 'service');
  const sort = get(params, 'sort');
  return {
    scope,
    q: (get(params, 'q') ?? '').trim().slice(0, 200),
    priority: list(get(params, 'priority'), PRIORITY_VALUES),
    type: list(get(params, 'type'), TYPE_VALUES),
    assignee: assignee === 'none' || assignee === 'me' || isUuid(assignee) ? assignee : null,
    team: isUuid(team) ? team : null,
    service: isUuid(service) ? service : null,
    sort: (SORTS as readonly string[]).includes(sort ?? '') ? (sort as TicketSort) : '-createdAt',
  };
}

/** The API's filter for a query: the grammar `observe.tickets` spells as `filter[…]`. */
export function ticketFilter(query: TicketQuery, limit = 50): TicketFilter {
  return {
    ...(query.scope === 'all' ? {} : { statusCategory: query.scope }),
    ...(query.q ? { q: query.q } : {}),
    ...(query.priority.length > 0 ? { priority: query.priority.join(',') } : {}),
    ...(query.type.length > 0 ? { type: query.type.join(',') } : {}),
    ...(query.assignee ? { assignee: query.assignee } : {}),
    ...(query.team ? { group: query.team } : {}),
    ...(query.service ? { service: query.service } : {}),
    sort: query.sort,
    limit,
  };
}

/** The same page with a different scope, keeping every other parameter (and dropping an open drawer and the cursor). */
export function scopeHref(search: URLSearchParams | string, scope: Scope): string {
  const params = new URLSearchParams(search);
  params.delete('open');
  if (scope === 'open') params.delete('status');
  else params.set('status', scope);
  const query = params.toString();
  return query ? `/tickets?${query}` : '/tickets';
}

/** Whether anything narrows the list beyond its scope: the empty state then offers to clear it. */
export function isFiltered(query: TicketQuery): boolean {
  return query.q !== '' || query.priority.length > 0 || query.type.length > 0 || query.assignee !== null || query.team !== null || query.service !== null;
}

/* =========================================================================
 * A ticket in words
 * ====================================================================== */

type Category = 'open' | 'paused' | 'resolved' | 'closed';

const CATEGORY_LOOK: Readonly<Record<Category, { readonly tone: Tone; readonly icon: IconName }>> = {
  open: { tone: 'info', icon: 'dot' },
  paused: { tone: 'neutral', icon: 'pause' },
  resolved: { tone: 'success', icon: 'circle-check' },
  closed: { tone: 'neutral', icon: 'archive' },
};

function categoryOf(value: string | null | undefined): Category {
  return value === 'paused' || value === 'resolved' || value === 'closed' ? value : 'open';
}

/** `awaiting_parts` → "Awaiting parts": a tenant's own status still reads as words. */
export function humanise(value: string): string {
  const words = value.replace(/[_-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}

export function statusLabel(status: string): string {
  return TICKET_STATUSES.find((entry) => entry.value === status)?.label ?? humanise(status);
}

export function statusLook(status: string, category: string | null | undefined): { readonly label: string; readonly tone: Tone; readonly icon: IconName } {
  return { label: statusLabel(status), ...CATEGORY_LOOK[categoryOf(category)] };
}

export function typeLabel(type: string): string {
  return TICKET_TYPES.find((entry) => entry.value === type)?.label ?? humanise(type);
}

export const TYPE_ICONS: Readonly<Record<string, IconName>> = {
  incident: 'triangle-alert',
  request: 'inbox',
  problem: 'circle-alert',
  change: 'refresh-cw',
  task: 'check',
  question: 'help',
};

export function typeIcon(type: string): IconName {
  return TYPE_ICONS[type] ?? 'ticket';
}

/** P1 danger, P2 warning, P3 info, P4 neutral; the text is always shown, never colour alone. */
export const PRIORITY_LOOK: Readonly<Record<string, { readonly label: string; readonly tone: Tone }>> = {
  P1: { label: 'P1', tone: 'danger' },
  P2: { label: 'P2', tone: 'warning' },
  P3: { label: 'P3', tone: 'info' },
  P4: { label: 'P4', tone: 'neutral' },
};

export const PRIORITY_WORDS: Readonly<Record<string, string>> = { P1: 'Critical', P2: 'High', P3: 'Medium', P4: 'Low' };

/** "P2 · High (high impact, medium urgency)". */
export function priorityText(ticket: Pick<Ticket, 'priority' | 'impact' | 'urgency'>): string {
  const words = PRIORITY_WORDS[ticket.priority];
  const base = words ? `${ticket.priority} · ${words}` : ticket.priority;
  if (!ticket.impact || !ticket.urgency) return base;
  return `${base} (${ticket.impact} impact, ${ticket.urgency} urgency)`;
}

/** Whether a due date has passed while the ticket is still being worked. */
export function isOverdue(ticket: Pick<Ticket, 'dueAt' | 'statusCategory'>, now: number): boolean {
  if (!ticket.dueAt) return false;
  if (ticket.statusCategory === 'resolved' || ticket.statusCategory === 'closed') return false;
  return new Date(ticket.dueAt).getTime() < now;
}

/* =========================================================================
 * Rows
 * ====================================================================== */

/** A ticket as the table shows it: serialisable, names instead of ids. */
export interface TicketRowView {
  readonly [field: string]: unknown;
  readonly id: string;
  readonly number: string;
  readonly title: string;
  readonly type: string;
  readonly typeLabel: string;
  readonly priority: string;
  readonly status: string;
  readonly statusCategory: string;
  /** `{ name }` for the person cell, or null for "Unassigned". */
  readonly assignee: { readonly id: string; readonly name: string } | null;
  readonly teamName: string | null;
  readonly channel: string;
  readonly createdAt: string;
  readonly dueAt: string | null;
}

export type NameOf = (id: string | null | undefined) => string | null;

export function ticketRow(ticket: Ticket, personName: NameOf, teamName: NameOf): TicketRowView {
  return {
    id: ticket.id,
    number: ticket.number,
    title: ticket.title,
    type: ticket.type,
    typeLabel: typeLabel(ticket.type),
    priority: ticket.priority,
    status: ticket.status,
    statusCategory: ticket.statusCategory,
    assignee: ticket.assigneeId ? { id: ticket.assigneeId, name: personName(ticket.assigneeId) ?? 'Unknown person' } : null,
    teamName: ticket.groupId ? (teamName(ticket.groupId) ?? 'Unknown team') : null,
    channel: ticket.sourceChannel,
    createdAt: ticket.createdAt,
    dueAt: ticket.dueAt,
  };
}

/**
 * A description as plain text for the summary drawer: an HTML description
 * (email, the workbench's rich replies) loses its tags rather than showing
 * them, and nothing from it is ever rendered as markup here.
 */
export function plainText(description: string): string {
  return description
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6])\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Where a ticket is worked: the workbench, same tab (SPEC §4.10 cross-app links). */
export function workbenchHref(origin: string | undefined, number: string): string | undefined {
  return origin ? `${origin.replace(/\/+$/, '')}/tickets/${encodeURIComponent(number)}` : undefined;
}

/* =========================================================================
 * The drawer
 * ====================================================================== */

/** What the drawer shows of a ticket: serialisable, so a hard load can pass it from the server. */
export interface TicketDetail {
  readonly ticket: Pick<
    Ticket,
    | 'id'
    | 'number'
    | 'title'
    | 'description'
    | 'type'
    | 'status'
    | 'statusCategory'
    | 'priority'
    | 'impact'
    | 'urgency'
    | 'assigneeId'
    | 'requesterId'
    | 'groupId'
    | 'serviceId'
    | 'sourceChannel'
    | 'createdAt'
    | 'dueAt'
  >;
  /** Names by person id; null when the directory did not answer. */
  readonly people: Readonly<Record<string, string | null>>;
  /** The ticket's SLA timers, or null when they could not be read. */
  readonly timers: readonly SlaTimer[] | null;
}

/** A ticket, its people's names and its clocks, as the drawer takes them. */
export function detailOf(ticket: Ticket, people: Readonly<Record<string, string | null>>, timers: readonly SlaTimer[] | null): TicketDetail {
  return {
    ticket: {
      id: ticket.id,
      number: ticket.number,
      title: ticket.title,
      description: ticket.description,
      type: ticket.type,
      status: ticket.status,
      statusCategory: ticket.statusCategory,
      priority: ticket.priority,
      impact: ticket.impact,
      urgency: ticket.urgency,
      assigneeId: ticket.assigneeId,
      requesterId: ticket.requesterId,
      groupId: ticket.groupId,
      serviceId: ticket.serviceId,
      sourceChannel: ticket.sourceChannel,
      createdAt: ticket.createdAt,
      dueAt: ticket.dueAt,
    },
    people,
    timers,
  };
}


/** The ticket number an `?open=ticket:<number>` names, or null. */
export function drawerTicket(open: string | string[] | undefined | null): string | null {
  const value = Array.isArray(open) ? open[0] : open;
  if (!value || !value.startsWith('ticket:')) return null;
  const number = value.slice('ticket:'.length).trim();
  return number === '' ? null : number;
}
