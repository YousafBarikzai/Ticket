import type { Client } from '../client.js';
import type {
  NotificationInbox,
  SearchOptions,
  SearchResults,
  TeamListRow,
  TeamMemberRow,
  TransitionOptions,
  UserQuery,
  UserRow,
} from './types.js';

/**
 * Calls more than one surface makes, written once.
 *
 * The workbench, the portal and the console each have their own resource file
 * because each grows with its own screens. A handful of reads — people, teams,
 * the bell, search — are the same request from all three, and three copies of
 * one request are three places for its grammar to go wrong. The surfaces
 * re-expose these under their own names; nothing here is exported from the
 * package directly.
 */

const unwrap = <T>(body: { data: T }): T => body.data;

/** The API's ceiling on `ids` in one call (`MAX_LOOKUP_IDS`). */
export const MAX_USER_IDS = 200;

/**
 * People, by search or by id.
 *
 * A lookup by ids is split into calls of 200 and answered in one list: the API
 * refuses a longer list outright rather than answering for the first 200, and
 * a caller that had to know that would get it wrong on the day a page first
 * shows its 201st person. An empty list asks nothing and answers nothing,
 * because `ids=` is a 422, not "everybody".
 */
export async function listUsers(client: Client, query: UserQuery = {}): Promise<UserRow[]> {
  const { ids, ...rest } = query;
  if (ids === undefined) {
    return client.request<{ data: UserRow[] }>('/api/v1/users', { query: { ...rest } }).then(unwrap);
  }

  const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  const chunks: string[][] = [];
  for (let start = 0; start < unique.length; start += MAX_USER_IDS) chunks.push(unique.slice(start, start + MAX_USER_IDS));
  const pages = await Promise.all(
    chunks.map((chunk) =>
      client.request<{ data: UserRow[] }>('/api/v1/users', { query: { ...rest, ids: chunk.join(',') } }).then(unwrap),
    ),
  );
  return pages.flat();
}

export function getUser(client: Client, id: string): Promise<UserRow> {
  return client.request<UserRow>(`/api/v1/users/${encodeURIComponent(id)}`);
}

/**
 * The team directory. Anyone who works the desk may read it; a requester gets
 * a 403, so the portal never calls it.
 */
export function listTeams(client: Client): Promise<TeamListRow[]> {
  return client.request<{ data: TeamListRow[] }>('/api/v1/teams').then(unwrap);
}

/** Names only, leads first. Email and organisation stay behind `identity.user.read`. */
export function listTeamMembers(client: Client, teamId: string): Promise<TeamMemberRow[]> {
  return client.request<{ data: TeamMemberRow[] }>(`/api/v1/teams/${encodeURIComponent(teamId)}/members`).then(unwrap);
}

/**
 * The bell. The whole body comes back rather than the list alone, because the
 * unread count is for the badge and is true whatever page the list holds.
 */
export function notificationInbox(client: Client, options: { unread?: boolean; limit?: number } = {}): Promise<NotificationInbox> {
  return client.request<NotificationInbox>('/api/v1/notifications', {
    query: { unread: options.unread, limit: options.limit },
  });
}

/** One notification, or `'all'` of them. Answers with how many changed. */
export function markNotificationRead(client: Client, id: string): Promise<{ marked: number }> {
  return client.request<{ marked: number }>(`/api/v1/notifications/${encodeURIComponent(id)}/read`, {
    method: 'POST',
    body: {},
  });
}

/**
 * The search grammar, spelled the way `/search` reads it.
 *
 * `types` and `facets` are comma lists and `filter` is `field:value` pairs
 * joined by commas — repeated fields mean "any of", different fields "all of".
 * An unrecognised type matches nothing rather than failing, which is how a
 * knowledge search sent as `article` found nothing for as long as it did.
 */
export function searchQuery(q: string, options: SearchOptions = {}): Record<string, string | number> {
  const types = typeof options.types === 'string' ? [options.types] : (options.types ?? []);
  const named = types.map((type) => (type === 'article' ? 'knowledge' : type));
  const pairs = Object.entries(options.filter ?? {}).flatMap(([field, value]) =>
    (typeof value === 'string' ? [value] : [...value]).map((one) => `${field}:${one}`),
  );
  return {
    q,
    limit: options.limit ?? 20,
    ...(named.length > 0 ? { types: [...new Set(named)].join(',') } : {}),
    ...(pairs.length > 0 ? { filter: pairs.join(',') } : {}),
    ...(options.facets && options.facets.length > 0 ? { facets: options.facets.join(',') } : {}),
  };
}

export function search(client: Client, q: string, options: SearchOptions = {}): Promise<SearchResults> {
  return client.request<SearchResults>('/api/v1/search', { query: searchQuery(q, options) });
}

/**
 * A transition's body. The fourth argument was a bare reason before
 * `resolutionCode` existed on the route, and a string there still means that.
 */
export function transitionBody(to: string, detail?: string | TransitionOptions): Record<string, string> {
  const options = typeof detail === 'string' ? { reason: detail } : (detail ?? {});
  return {
    to,
    ...(options.reason ? { reason: options.reason } : {}),
    ...(options.resolutionCode ? { resolutionCode: options.resolutionCode } : {}),
  };
}
