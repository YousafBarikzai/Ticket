import type { TicketFilter } from '@itsm/sdk';

/**
 * A queue is a URL.
 *
 * Every filter lives in the query string rather than in component state, for
 * three reasons that all come from watching people actually use a service
 * desk: a view can be linked to a colleague, the back button does what it
 * looks like it does, and a reload during an incident does not lose the
 * filter somebody spent a minute building.
 *
 * The parsing is here, separately from the page, because the interesting part
 * is what happens to input nobody chose — a `sort` that is not a sort, a
 * `limit` of 10000, a status list a hundred items long. A server component
 * that reads `searchParams` directly is reading attacker-controllable input
 * with no schema between.
 */

export const SORTS = ['-createdAt', 'createdAt', 'dueAt', '-dueAt'] as const;
export type QueueSort = (typeof SORTS)[number];

export interface QueueView {
  readonly title: string;
  readonly description: string;
  readonly filter: TicketFilter;
  /** What the filter chips should show as selected. */
  readonly assignee: string;
  readonly status: string;
  readonly q: string;
  readonly sort: QueueSort;
}

export type SearchParams = Record<string, string | string[] | undefined>;

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

const TITLES: Record<string, string> = {
  me: 'Assigned to me',
  none: 'Unassigned',
};

export function queueViewFrom(params: SearchParams): QueueView {
  const assignee = one(params, 'assignee');
  const status = words(one(params, 'status'));
  const q = one(params, 'q').slice(0, 200);
  const sortValue = one(params, 'sort');
  const sort: QueueSort = (SORTS as readonly string[]).includes(sortValue) ? (sortValue as QueueSort) : '-createdAt';
  const cursor = one(params, 'cursor').slice(0, 500);

  // `me` and `none` are resolved by the API, not here: a link to "assigned to
  // me" then means "assigned to whoever is reading it", which is what makes a
  // saved view shareable between two people on the same rota.
  const useAssignee = assignee === 'me' || assignee === 'none' || /^[0-9a-f-]{36}$/i.test(assignee) ? assignee : '';

  return {
    title: TITLES[useAssignee] ?? 'Open tickets',
    description:
      useAssignee === 'me'
        ? 'Everything waiting on you.'
        : useAssignee === 'none'
          ? 'Raised, and nobody has picked it up.'
          : 'Everything open across the queues you can see.',
    assignee: useAssignee,
    status,
    q,
    sort,
    filter: {
      limit: 50,
      sort,
      // Closed tickets are not work; a queue that shows them buries what is.
      ...(status ? { status } : { statusCategory: 'new,open,pending' }),
      ...(useAssignee ? { assignee: useAssignee } : {}),
      ...(q ? { q } : {}),
      ...(cursor ? { cursor } : {}),
    },
  };
}

/** The link for the same view with one thing changed, so a chip does not have to rebuild the URL. */
export function queueHref(
  view: QueueView,
  change: Partial<Record<'assignee' | 'status' | 'q' | 'sort' | 'cursor', string>>,
): string {
  const params = new URLSearchParams();
  // The cursor is never carried forward: changing a filter and keeping the
  // previous page's cursor asks the API to continue a list that no longer
  // exists, and the answer is a page of nothing.
  const next = { assignee: view.assignee, status: view.status, q: view.q, sort: view.sort, cursor: '', ...change };
  for (const [key, value] of Object.entries(next)) {
    if (value && !(key === 'sort' && value === '-createdAt')) params.set(key, value);
  }
  const query = params.toString();
  return query ? `/queue?${query}` : '/queue';
}
