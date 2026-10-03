import type { TicketFilter } from '@itsm/sdk';
import type { IconName } from '@itsm/ui';
import type { NavBadge, NavItem, NavModel } from '@itsm/ui/shell';

/**
 * The inbox's views, and the URL each one is (SPEC §5.3; successor of
 * `queue/view.ts`).
 *
 * A view is a URL. Every filter lives in the query string rather than in
 * component state, for three reasons that all come from watching people use a
 * service desk: a view can be linked to a colleague, the back button does what
 * it looks like it does, and a reload during an incident does not lose the
 * filter somebody spent a minute building.
 *
 * The parsing is here, apart from the pages, because the interesting part is
 * what happens to input nobody chose — a `sort` that is not a sort, a status
 * list a hundred items long, an assignee that is a SQL fragment. A server
 * component that reads `searchParams` directly is reading attacker-controlled
 * input with no schema in between. Nothing here trusts the URL to be one this
 * app wrote.
 *
 * Pure and framework-free: the proxy, the server pages, the counts handler,
 * the sidebar and the palette all read the same registry.
 */

export const SORTS = ['-createdAt', 'createdAt', 'dueAt', '-dueAt'] as const;
export type InboxSort = (typeof SORTS)[number];

export type SearchParams = Record<string, string | string[] | undefined>;

export const VIEW_IDS = ['mine', 'unassigned', 'due', 'waiting', 'all', 'resolved'] as const;
export type ViewId = (typeof VIEW_IDS)[number];

/** The cookie that makes `/inbox` open where the agent left off (SPEC D2). */
export const LAST_VIEW_COOKIE = 'itsm-wb-last-view';

/**
 * The inbox's landmark ids: the targets of its skip links ("Skip to ticket
 * list", "Skip to conversation", "Skip to reply") and of F6 region cycling.
 */
export const INBOX_REGIONS = {
  list: 'inbox-list',
  conversation: 'ticket-conversation',
  reply: 'ticket-reply',
} as const;

/** Where the workbench opens when there is no remembered view. */
export const DEFAULT_VIEW: ViewId = 'mine';

/** The filters that define a view, without paging, sorting or searching. */
export type ViewFilter = Omit<TicketFilter, 'q' | 'cursor' | 'limit' | 'sort'>;

/** How a view's sidebar count is known: exactly (with `GET /tickets/count`), also by probing without it, or never. */
export type CountMode = 'exact' | 'probe' | false;

export interface ViewEmptyCopy {
  readonly title: string;
  readonly description: string;
  /** `success` when an empty view is good news ("Every ticket has an owner"). */
  readonly tone: 'empty' | 'success';
}

export interface ViewDefinition {
  readonly id: ViewId;
  /** Nav label = H1 = `<title>` (SPEC §5.1). */
  readonly label: string;
  /**
   * The purpose line under the title in the top bar while the view is open
   * (v3 §3.5, A2 §5.4.1): one line, sentence case, no full stop.
   */
  readonly description: string;
  readonly icon: IconName;
  /** The `g` chord that goes here (SPEC §5.6). */
  readonly shortcut: string;
  readonly keywords: readonly string[];
  readonly base: ViewFilter;
  readonly sort: InboxSort;
  /** The view *is* its order ("Due soon"): a `sort` in the URL is ignored. */
  readonly fixedSort: boolean;
  /** The view is about one assignee, so the URL may not name another. */
  readonly lockedAssignee: boolean;
  readonly count: CountMode;
  /** Row extras (SPEC §6.2): the assignee avatar is pointless in My work; the team helps where tickets span teams. */
  readonly showAssignee: boolean;
  readonly showTeam: boolean;
  readonly empty: ViewEmptyCopy;
}

/** Open work: the two categories that are still somebody's job (MOD-04). */
const OPEN_WORK = 'open,paused';
const WAITING_STATES = 'pending_requester,pending_third_party,pending_approval';

export const VIEWS: readonly ViewDefinition[] = [
  {
    id: 'mine',
    label: 'My work',
    description: 'Open tickets assigned to you, soonest due first',
    icon: 'user',
    shortcut: 'g m',
    keywords: ['assigned to me', 'my tickets', 'mine'],
    base: { assignee: 'me', statusCategory: OPEN_WORK },
    sort: 'dueAt',
    fixedSort: false,
    lockedAssignee: true,
    count: 'probe',
    showAssignee: false,
    showTeam: false,
    empty: {
      title: 'Nothing assigned to you',
      description: 'When a ticket is assigned to you, it appears here.',
      tone: 'empty',
    },
  },
  {
    id: 'unassigned',
    label: 'Unassigned',
    description: 'New tickets in your teams that nobody has picked up',
    icon: 'user-plus',
    shortcut: 'g u',
    keywords: ['nobody', 'unclaimed', 'pick up', 'triage'],
    base: { assignee: 'none', statusCategory: 'open' },
    sort: 'createdAt',
    fixedSort: false,
    lockedAssignee: true,
    count: 'probe',
    showAssignee: false,
    showTeam: true,
    empty: {
      title: 'Every ticket has an owner',
      description: 'Nothing is waiting to be picked up.',
      tone: 'success',
    },
  },
  {
    id: 'due',
    label: 'Due soon',
    description: 'Open tickets in your teams by deadline, breaches first',
    icon: 'clock',
    shortcut: 'g d',
    keywords: ['sla', 'deadline', 'overdue', 'breach'],
    base: { statusCategory: 'open' },
    sort: 'dueAt',
    fixedSort: true,
    lockedAssignee: false,
    count: 'probe',
    showAssignee: true,
    showTeam: true,
    empty: {
      title: 'Nothing is due',
      description: 'No open ticket in your teams has a deadline coming up.',
      tone: 'success',
    },
  },
  {
    id: 'waiting',
    label: 'Waiting on others',
    description: 'Your tickets waiting on a requester, a supplier or an approval',
    icon: 'hourglass',
    shortcut: 'g w',
    keywords: ['pending', 'on hold', 'requester', 'supplier', 'approval'],
    base: { assignee: 'me', status: WAITING_STATES },
    sort: '-createdAt',
    fixedSort: false,
    lockedAssignee: true,
    count: false,
    showAssignee: false,
    showTeam: false,
    empty: {
      title: 'Nothing is waiting on others',
      description: 'Tickets you put on hold for a requester, a supplier or an approval appear here.',
      tone: 'empty',
    },
  },
  {
    id: 'all',
    label: 'All open',
    description: 'Every open ticket in your teams',
    icon: 'inbox',
    shortcut: 'g a',
    keywords: ['open tickets', 'queue', 'everything', 'team'],
    base: { statusCategory: OPEN_WORK },
    sort: '-createdAt',
    fixedSort: false,
    lockedAssignee: false,
    count: 'exact',
    showAssignee: true,
    showTeam: true,
    empty: {
      title: 'No open tickets',
      description: 'Everything in your teams is resolved or closed.',
      tone: 'success',
    },
  },
  {
    id: 'resolved',
    label: 'Recently resolved',
    description: "Tickets you resolved that haven't closed yet",
    icon: 'circle-check',
    shortcut: 'g r',
    keywords: ['done', 'fixed', 'closed'],
    base: { assignee: 'me', statusCategory: 'resolved' },
    sort: '-createdAt',
    fixedSort: false,
    lockedAssignee: true,
    count: false,
    showAssignee: false,
    showTeam: false,
    empty: {
      title: 'Nothing resolved recently',
      description: 'Tickets you resolve appear here until they close.',
      tone: 'empty',
    },
  },
];

/** A team's view: open work for one group. */
export const TEAM_VIEW = {
  icon: 'people',
  sort: '-createdAt',
  count: 'exact',
  empty: {
    title: 'No open tickets for this team',
    description: 'Everything assigned to this team is resolved or closed.',
    tone: 'success',
  },
} as const satisfies { icon: IconName; sort: InboxSort; count: CountMode; empty: ViewEmptyCopy };

export type ViewRef =
  | { readonly kind: 'view'; readonly id: ViewId }
  | { readonly kind: 'team'; readonly teamId: string; readonly name?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** `INC-000123`, as the API numbers tickets, or a UUID. */
const TICKET_REF = /^(?:[A-Z]{2,6}-\d{1,12}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

export function isViewId(value: string): value is ViewId {
  return (VIEW_IDS as readonly string[]).includes(value);
}

export function viewById(id: ViewId): ViewDefinition {
  return VIEWS.find((view) => view.id === id)!;
}

/** `mine`, or `team:<uuid>`: the key a view's cache entry and count are filed under. */
export function viewKey(ref: ViewRef): string {
  return ref.kind === 'view' ? ref.id : `team:${ref.teamId.toLowerCase()}`;
}

export function viewPath(ref: ViewRef): string {
  return ref.kind === 'view' ? `/inbox/${ref.id}` : `/inbox/team/${ref.teamId.toLowerCase()}`;
}

/** The filter a view's count and list share (the list adds sort, search and paging). */
export function viewFilter(ref: ViewRef): ViewFilter {
  return ref.kind === 'view' ? { ...viewById(ref.id).base } : { group: ref.teamId.toLowerCase(), statusCategory: OPEN_WORK };
}

/* ------------------------------------------------------------ Reading the URL */

function one(params: SearchParams, key: string): string {
  const value = params[key];
  const found = Array.isArray(value) ? value[0] : value;
  return typeof found === 'string' ? found.trim() : '';
}

/** Comma-separated words, capped: a filter list is a person's choice, not an essay. */
function words(value: string, limit = 10): string {
  return value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => /^[a-z][a-z0-9_-]{0,39}$/i.test(part))
    .slice(0, limit)
    .join(',');
}

/** `me` and `none` are resolved by the API, so a link to "assigned to me" means whoever reads it. */
function assigneeFrom(value: string): string {
  return value === 'me' || value === 'none' || UUID.test(value) ? value.toLowerCase() : '';
}

/** The filters a person added on top of the view, as they appear in the URL. */
export interface InboxFilters {
  readonly status: string;
  readonly priority: string;
  readonly type: string;
  readonly assignee: string;
  readonly requester: string;
  readonly team: string;
  readonly q: string;
}

export interface InboxView {
  readonly ref: ViewRef;
  readonly key: string;
  readonly path: string;
  readonly title: string;
  readonly icon: IconName;
  readonly empty: ViewEmptyCopy;
  readonly showAssignee: boolean;
  readonly showTeam: boolean;
  readonly filters: InboxFilters;
  readonly sort: InboxSort;
  readonly defaultSort: InboxSort;
  readonly fixedSort: boolean;
  readonly cursor: string;
  /** `?t=`: the ticket selected in the detail pane (a selection, not a drawer). */
  readonly selected: string | null;
  /** Whether anything beyond the view itself narrows the list. */
  readonly filtered: boolean;
  /** What the API is asked for. */
  readonly filter: TicketFilter;
}

/** Page size. The list auto-loads more as it scrolls, so this is about the first paint, not a limit. */
export const PAGE_SIZE = 50;

function intersect(list: string, allowed: string): string {
  const permitted = new Set(allowed.split(','));
  return list
    .split(',')
    .filter((word) => permitted.has(word))
    .join(',');
}

export function inboxViewFrom(ref: ViewRef, params: SearchParams): InboxView {
  const definition = ref.kind === 'view' ? viewById(ref.id) : null;
  const base = viewFilter(ref);

  const status = words(one(params, 'status'));
  const priority = words(one(params, 'priority'), 4);
  const type = words(one(params, 'type'), 6);
  const lockedAssignee = definition?.lockedAssignee ?? false;
  const assignee = lockedAssignee ? '' : assigneeFrom(one(params, 'assignee'));
  const requesterValue = one(params, 'requester');
  const requester = UUID.test(requesterValue) ? requesterValue.toLowerCase() : '';
  const teamValue = one(params, 'team');
  const team = ref.kind === 'view' && UUID.test(teamValue) ? teamValue.toLowerCase() : '';
  const q = one(params, 'q').slice(0, 200);
  const cursor = one(params, 'cursor').slice(0, 500);
  const selectedValue = one(params, 't');
  const selected = TICKET_REF.test(selectedValue) ? selectedValue.toUpperCase() : null;

  const defaultSort = definition?.sort ?? TEAM_VIEW.sort;
  const fixedSort = definition?.fixedSort ?? false;
  const sortValue = one(params, 'sort');
  const sort: InboxSort =
    !fixedSort && (SORTS as readonly string[]).includes(sortValue) ? (sortValue as InboxSort) : defaultSort;

  // A status chosen in the URL narrows the view rather than replacing it:
  // "Waiting on others" filtered to `new` would otherwise quietly become a
  // list of new tickets under a heading that says the opposite. Where the
  // view is defined by states, the choice is intersected with them; where it
  // is defined by categories, the API ands the two.
  const narrowedStatus = status && base.status ? intersect(status, base.status) : status;
  const statusFilter = base.status ? narrowedStatus || base.status : narrowedStatus;

  const filter: TicketFilter = {
    ...base,
    limit: PAGE_SIZE,
    sort,
    ...(statusFilter ? { status: statusFilter } : {}),
    ...(priority ? { priority } : {}),
    ...(type ? { type } : {}),
    ...(assignee ? { assignee } : {}),
    ...(requester ? { requester } : {}),
    ...(team ? { group: team } : {}),
    ...(q ? { q } : {}),
    ...(cursor ? { cursor } : {}),
  };

  const filters: InboxFilters = {
    status: base.status ? narrowedStatus : status,
    priority,
    type,
    assignee,
    requester,
    team,
    q,
  };

  return {
    ref,
    key: viewKey(ref),
    path: viewPath(ref),
    title: definition?.label ?? (ref.kind === 'team' && ref.name ? ref.name : 'Team'),
    icon: definition?.icon ?? TEAM_VIEW.icon,
    empty: definition?.empty ?? TEAM_VIEW.empty,
    showAssignee: definition?.showAssignee ?? true,
    showTeam: definition?.showTeam ?? false,
    filters,
    sort,
    defaultSort,
    fixedSort,
    cursor,
    selected,
    filtered: Object.values(filters).some((value) => value !== ''),
    filter,
  };
}

export type InboxParam = keyof InboxFilters | 'sort' | 'cursor' | 't';

/**
 * The link for the same view with some things changed. The cursor is never
 * carried: changing a filter and keeping the previous page's cursor asks the
 * API to continue a list that no longer exists, and the answer is a page of
 * nothing. The selection is kept, so filtering does not close the ticket
 * being read.
 */
export function inboxHref(view: InboxView, change: Partial<Record<InboxParam, string>> = {}): string {
  const next: Record<InboxParam, string> = {
    ...view.filters,
    sort: view.sort,
    cursor: '',
    t: view.selected ?? '',
    ...change,
  };
  const params = new URLSearchParams();
  for (const key of ['q', 'status', 'priority', 'type', 'assignee', 'requester', 'team', 'sort', 'cursor', 't'] as const) {
    const value = next[key];
    if (!value) continue;
    if (key === 'sort' && (value === view.defaultSort || view.fixedSort)) continue;
    params.set(key, value);
  }
  const query = params.toString();
  return query ? `${view.path}?${query}` : view.path;
}

/** The same view with every added filter removed ("Clear filters"). */
export function clearedHref(view: InboxView): string {
  return inboxHref(view, { status: '', priority: '', type: '', assignee: '', requester: '', team: '', q: '', sort: '' });
}

/* -------------------------------------------------- The last view, redirects */

/** A view as the last-view cookie stores it: `mine`, or `team/<uuid>`. */
export function lastViewValue(ref: ViewRef): string {
  return ref.kind === 'view' ? ref.id : `team/${ref.teamId.toLowerCase()}`;
}

/** Reads the cookie back, refusing anything this app did not write. */
export function viewRefFromLastView(value: string | undefined | null): ViewRef | null {
  if (!value) return null;
  if (isViewId(value)) return { kind: 'view', id: value };
  const team = /^team\/(.+)$/.exec(value);
  return team && UUID.test(team[1]!) ? { kind: 'team', teamId: team[1]!.toLowerCase() } : null;
}

/** The view a path shows, for the proxy to remember: `/inbox/mine`, `/inbox/team/<uuid>`. */
export function viewRefFromPath(pathname: string): ViewRef | null {
  const view = /^\/inbox\/([a-z]+)\/?$/.exec(pathname);
  if (view && isViewId(view[1]!)) return { kind: 'view', id: view[1] as ViewId };
  const team = /^\/inbox\/team\/([^/]+)\/?$/.exec(pathname);
  return team && UUID.test(team[1]!) ? { kind: 'team', teamId: team[1]!.toLowerCase() } : null;
}

/** `/inbox` → the remembered view, else My work. */
export function inboxLanding(lastView: string | undefined | null): string {
  return viewPath(viewRefFromLastView(lastView) ?? { kind: 'view', id: DEFAULT_VIEW });
}

/**
 * `/queue?…` → the matching inbox view, other parameters carried (SPEC §5.3).
 *
 * `assignee=me` is My work and `none` is Unassigned; a person's id becomes All
 * open filtered to them; no assignee was the old queue's "Open tickets", which
 * is All open. The cursor is dropped — it belonged to the old list's order.
 */
export function queueRedirectTarget(params: SearchParams): string {
  const assignee = assigneeFrom(one(params, 'assignee'));
  const id: ViewId = assignee === 'me' ? 'mine' : assignee === 'none' ? 'unassigned' : 'all';
  // A named person survives only where the view can hold one (All open);
  // `inboxViewFrom` drops it from the views that are about one assignee.
  const view = inboxViewFrom({ kind: 'view', id }, { ...params, cursor: undefined, t: undefined });
  return inboxHref(view);
}

/* ------------------------------------------------------------- The sidebar */

export interface TeamSummary {
  readonly id: string;
  readonly name: string;
}

export interface ViewCount {
  readonly count: number;
  /** "At least this many": the source stopped counting. */
  readonly capped: boolean;
}

export type ViewCounts = Readonly<Record<string, ViewCount>>;

/** Twenty topics per live stream, and the API adds the person's own `user:` topic: so at most 19 teams. */
export const MAX_TEAM_TOPICS = 19;

/** The live stream's topics for the person's teams (passing `user:<me>` would only spend a slot). */
export function deskTopics(teamIds: readonly string[]): string[] {
  return [...new Set(teamIds.map((id) => id.toLowerCase()))].slice(0, MAX_TEAM_TOPICS).map((id) => `group:${id}`);
}

/** The badge for a count: nothing for zero or unknown, "99+" past 99, spoken as tickets. */
export function countBadge(count: ViewCount | undefined): NavBadge | undefined {
  if (!count || count.count <= 0) return undefined;
  const many = count.count > 99 || count.capped;
  const shown = count.count > 99 ? 'more than 99' : `${count.count}${count.capped ? ' or more' : ''}`;
  return {
    value: count.count,
    capped: count.capped,
    tone: 'neutral',
    label: `${shown} ${count.count === 1 && !many ? 'ticket' : 'tickets'}`,
  };
}

/**
 * The counts the client fetched (`/api/desk/counts`), put on the navigation
 * the server built (`navigation.ts`): views are filed under their id
 * (`mine`), teams under `team:<uuid>` (`viewKey`). An item with no known
 * count, or a count of nothing, has no badge: the server's model carries
 * none, and this is always applied to it, never to an earlier result.
 *
 * Here, beside `countBadge`, rather than in `navigation.ts`, because the
 * frame calls it in the browser on every count refresh, and `navigation.ts`
 * reads the area contracts, whose tables cost a client bundle about 4 kB.
 */
export function navWithCounts(nav: NavModel, counts: ViewCounts): NavModel {
  const counted = (items: readonly NavItem[]): NavItem[] =>
    items.map((item) => {
      const badge = countBadge(counts[item.id]);
      return badge ? { ...item, badge } : item;
    });
  return { ...nav, sections: nav.sections.map((section) => ({ ...section, items: counted(section.items) })) };
}

/** Whether any item carries a danger count: the phone's More tab then shows its dot (A2 §7.1). */
export function hasDangerCount(nav: NavModel): boolean {
  return nav.sections.some((section) => section.items.some((item) => item.badge?.tone === 'danger' && item.badge.value > 0));
}
