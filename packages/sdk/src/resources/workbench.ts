import type { Client, RequestOptions } from '../client.js';
import type { FieldRow } from './admin.js';
import type { ServiceRow } from './builders.js';
import { metricQueries } from './insights.js';
import type { AvailabilityRow, OnCallRow, RotationRow } from './operations.js';
import {
  majorIncidentsApi,
  onCallApi,
  type MajorIncidentAudience,
  type MajorIncidentDetail,
  type MajorIncidentFilter,
  type MajorIncidentRow,
} from './service-management.js';
import {
  getUser,
  listTeamMembers,
  listTeams,
  listUsers,
  markNotificationRead,
  notificationInbox,
  search,
  transitionBody,
} from './common.js';
import type {
  ActivityTypeRow,
  AiCapability,
  AiJob,
  Article,
  ArticleSummary,
  AvailabilityInput,
  CategoryRow,
  CreateTicketInput,
  Me,
  NotificationInbox,
  Page,
  RunningTimer,
  SearchOptions,
  SearchResults,
  RecordCiRow,
  SlaTimers,
  Suggestion,
  TeamListRow,
  TeamMemberRow,
  Ticket,
  TicketCount,
  TicketCountDimension,
  TicketCountsBy,
  TicketLinkRow,
  TicketLinkType,
  TicketPatch,
  TimeEntryRow,
  Timeline,
  TimeSummary,
  TransitionOptions,
  TriageSuggestion,
  UserQuery,
  UserRow,
  WatcherRow,
} from './types.js';

/**
 * What the agent workbench asks the API for.
 *
 * One file rather than one per module, because the unit of growth here is a
 * *screen*, not a module: a workbench that shows a ticket needs MOD-04's
 * timeline, MOD-07's timers, MOD-19's totals and MOD-09's suggestions, and
 * splitting them by owner would make finding "what does the ticket page call"
 * a search rather than a read.
 */
export interface TicketFilter {
  /** Comma-separated, as the API's grammar takes them: `new,in_progress`. */
  status?: string;
  /**
   * The four categories every status falls into: `open`, `paused`,
   * `resolved`, `closed`. Open work is `open,paused`; anything else here
   * matches nothing, silently.
   */
  statusCategory?: string;
  type?: string;
  priority?: string;
  /** A user id, or the two words the API resolves itself: `me`, `none`. */
  assignee?: string;
  requester?: string;
  group?: string;
  service?: string;
  /**
   * Time windows (R2), each half-open: `…After` includes its instant and
   * `…Before` does not, so consecutive windows never count a ticket twice.
   * An ISO instant with `Z` or an offset, or a `Date`. "Due today" is the
   * reader's own local midnight sent as an instant: the server has no viewer
   * zone and never guesses one. Any `due…` bound also means "has a due time".
   */
  createdAfter?: string | Date;
  createdBefore?: string | Date;
  dueAfter?: string | Date;
  dueBefore?: string | Date;
  resolvedAfter?: string | Date;
  resolvedBefore?: string | Date;
  /**
   * Open work past its due time (`breached`), or due within the hour
   * (`due_soon`), judged on the server's clock so a saved link never goes
   * stale. Paused work is neither.
   */
  sla?: 'breached' | 'due_soon';
  q?: string;
  limit?: number;
  cursor?: string;
  sort?: 'createdAt' | '-createdAt' | 'dueAt' | '-dueAt';
}

/** The filter keys that are sent bracketed, `filter[key]=…`: every one but paging, sorting and `q`. */
const BRACKETED = [
  'status',
  'statusCategory',
  'type',
  'priority',
  'assignee',
  'requester',
  'group',
  'service',
  'createdAfter',
  'createdBefore',
  'dueAfter',
  'dueBefore',
  'resolvedAfter',
  'resolvedBefore',
  'sla',
] as const;

/**
 * The list grammar, spelled the way the API reads it.
 *
 * `GET /api/v1/tickets` takes `filter[status]`, not `status` — and a query
 * parameter the API does not recognise is not an error, it is silently
 * ignored. A filtered queue that quietly returns everything is the worst shape
 * this mistake could take: it looks like it worked. Written out here, once,
 * with a test, rather than spelled at each call site.
 */
export function ticketQuery(filter: TicketFilter): Record<string, string | number | undefined> {
  const query: Record<string, string | number | undefined> = {
    limit: filter.limit ?? 50,
    ...(filter.cursor ? { cursor: filter.cursor } : {}),
    ...(filter.sort ? { sort: filter.sort } : {}),
    ...(filter.q ? { q: filter.q } : {}),
  };
  for (const key of BRACKETED) {
    const value = filter[key];
    // A `Date` goes as an ISO instant. `String(date)` would send the local
    // "Fri Oct 02 2026 …" form, which the API refuses — and an invalid date
    // asks nothing rather than throwing from inside a page's loader.
    const text = value instanceof Date ? (Number.isNaN(value.getTime()) ? undefined : value.toISOString()) : value;
    if (text !== undefined && text !== '') query[`filter[${key}]`] = text;
  }
  return query;
}

/**
 * The same grammar without paging or sorting, for `GET /tickets/count`.
 *
 * The route ignores `limit`, `cursor` and `sort` rather than refusing them, so
 * sending a view's list query unchanged would work; leaving them out keeps the
 * request honest about what it asks.
 */
export function ticketCountQuery(filter: TicketFilter): Record<string, string | number | undefined> {
  const { limit: _limit, cursor: _cursor, sort: _sort, ...rest } = filter;
  const { limit: _defaultLimit, ...query } = ticketQuery(rest);
  return query;
}

/**
 * The grouped count's query (R2g): the count grammar plus `groupBy`.
 *
 * A separate route rather than `groupBy` on `/tickets/count`, because an API
 * without grouped counts would drop the unknown key and answer one total,
 * which a reader of groups would misread; a new route answers 404 instead.
 */
export function ticketCountsQuery(groupBy: TicketCountDimension, filter: TicketFilter): Record<string, string | number | undefined> {
  return { ...ticketCountQuery(filter), groupBy };
}

const unwrap = <T>(body: { data: T }): T => body.data;

export function workbench(client: Client) {
  const incidents = majorIncidentsApi(client);
  const onCall = onCallApi(client);
  return {
    me: (): Promise<Me> => client.request<Me>('/api/v1/me'),

    tickets: (filter: TicketFilter = {}): Promise<Page<Ticket>> =>
      client.request<Page<Ticket>>('/api/v1/tickets', { query: ticketQuery(filter) }),

    /**
     * How many tickets a view holds, for its badge. The same filter and the
     * same visibility as the list, so a badge never promises a ticket the list
     * will not show; `capped` means "at least this many".
     */
    ticketCount: (filter: TicketFilter = {}): Promise<TicketCount> =>
      client.request<TicketCount>('/api/v1/tickets/count', { query: ticketCountQuery(filter) }),

    /**
     * The same set broken down by one dimension (R2g): a distribution bar,
     * the age of a backlog, the SLA picture of a queue. The groups sum to
     * `total`, which is what `ticketCount` answers for the same filter.
     */
    ticketCounts: (groupBy: TicketCountDimension, filter: TicketFilter = {}): Promise<TicketCountsBy> =>
      client.request<TicketCountsBy>('/api/v1/tickets/counts', { query: ticketCountsQuery(groupBy, filter) }),

    ticket: (idOrNumber: string): Promise<Ticket> =>
      client.request<Ticket>(`/api/v1/tickets/${encodeURIComponent(idOrNumber)}`),

    timeline: (idOrNumber: string): Promise<Timeline> =>
      client.request<Timeline>(`/api/v1/tickets/${encodeURIComponent(idOrNumber)}/timeline`),

    slaTimers: (idOrNumber: string): Promise<SlaTimers> =>
      client.request<SlaTimers>(`/api/v1/tickets/${encodeURIComponent(idOrNumber)}/sla`),

    timeOnTicket: (ticketId: string): Promise<{ data: unknown[]; summary: TimeSummary }> =>
      client.request<{ data: unknown[]; summary: TimeSummary }>(`/api/v1/tickets/${encodeURIComponent(ticketId)}/time`),

    /**
     * `visibility`, not a boolean. The API's vocabulary is `public` and
     * `internal`, and it defaults to `public` — so a client that sent
     * `isInternal: true` would have its internal note delivered to the
     * requester, because an unrecognised field is ignored rather than refused.
     * The boolean stays on this signature because that is what a switch in a
     * component holds; the translation happens here, once.
     */
    comment: (idOrNumber: string, body: string, isInternal = false, options: RequestOptions = {}) =>
      client.request<{ id: string; visibility: 'public' | 'internal'; createdAt: string }>(
        `/api/v1/tickets/${encodeURIComponent(idOrNumber)}/comments`,
        {
          ...options,
          method: 'POST',
          body: { body, visibility: isInternal ? 'internal' : 'public' },
        },
      ),

    /**
     * Moves a ticket. `version` is what was read, and it rides as `If-Match`:
     * without it the API answers 428 and the edit is refused, which is the
     * point — two agents working the same ticket should not silently overwrite
     * one another.
     */
    transition: (idOrNumber: string, to: string, version: number, detail?: string | TransitionOptions) =>
      client.request<Ticket>(`/api/v1/tickets/${encodeURIComponent(idOrNumber)}/transitions`, {
        method: 'POST',
        ifMatch: version,
        body: transitionBody(to, detail),
      }),

    /**
     * `If-Match` is optional here, and that asymmetry with `transition` is
     * deliberate on both sides. A queue screen assigns from a list it read a
     * minute ago; requiring a version would mean re-reading every row before
     * every claim, and the API says so by not demanding one. But a caller that
     * holds the version should send it: two agents claiming the same ticket in
     * the same second then get a 409 rather than one of them silently losing
     * the ticket they thought they had taken.
     */
    assign: (idOrNumber: string, assigneeId: string | null, groupId?: string | null, version?: number) =>
      client.request<Ticket>(`/api/v1/tickets/${encodeURIComponent(idOrNumber)}/assign`, {
        method: 'POST',
        ...(version !== undefined ? { ifMatch: version } : {}),
        body: { assigneeId, ...(groupId !== undefined ? { groupId } : {}), method: 'manual' },
      }),

    logTime: (ticketId: string, activityKey: string, minutes: number, note?: string) =>
      client.request<{ id: string }>('/api/v1/time-entries', {
        method: 'POST',
        body: { ticketId, activityKey, minutes, ...(note ? { note } : {}) },
      }),

    // ---- Raising and editing -------------------------------------------------

    /**
     * Raises a ticket. The idempotency key is generated unless the caller
     * supplies one, and a caller that may retry — a sheet that stays open
     * after a network error — should: the same key twice is one ticket.
     */
    createTicket: (input: CreateTicketInput, options: { idempotencyKey?: string } = {}): Promise<Ticket> =>
      client.request<Ticket>('/api/v1/tickets', {
        method: 'POST',
        body: input,
        ...(options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
      }),

    /**
     * Edits fields. `If-Match` is required here, unlike an assignment: an edit
     * is made from a form somebody has been looking at, and two people saving
     * the same form must not silently keep only the second.
     */
    updateTicket: (idOrNumber: string, patch: TicketPatch, version: number): Promise<Ticket> =>
      client.request<Ticket>(`/api/v1/tickets/${encodeURIComponent(idOrNumber)}`, {
        method: 'PATCH',
        ifMatch: version,
        body: patch,
      }),

    tags: (idOrNumber: string): Promise<string[]> =>
      client.request<{ data: string[] }>(`/api/v1/tickets/${encodeURIComponent(idOrNumber)}/tags`).then(unwrap),

    createTask: (
      idOrNumber: string,
      input: { title: string; description?: string; assigneeId?: string; groupId?: string; key?: string; order?: number },
    ): Promise<{ id: string; title: string; status: string; order: number }> =>
      client.request(`/api/v1/tickets/${encodeURIComponent(idOrNumber)}/tasks`, { method: 'POST', body: input }),

    completeTask: (taskId: string): Promise<{ id: string; status: string; completedAt: string | null }> =>
      client.request(`/api/v1/tasks/${encodeURIComponent(taskId)}/complete`, { method: 'POST', body: {} }),

    /** `target` is a number or an id; the inverse link is written on the other ticket too. */
    link: (idOrNumber: string, target: string, linkType: TicketLinkType): Promise<{ sourceId: string; targetId: string; linkType: TicketLinkType }> =>
      client.request(`/api/v1/tickets/${encodeURIComponent(idOrNumber)}/links`, {
        method: 'POST',
        body: { target, linkType },
      }),

    /** What this ticket is linked to, from its own side. Links to tickets the reader cannot see are left out. */
    ticketLinks: (idOrNumber: string): Promise<TicketLinkRow[]> =>
      client.request<{ data: TicketLinkRow[] }>(`/api/v1/tickets/${encodeURIComponent(idOrNumber)}/links`).then(unwrap),

    watch: (idOrNumber: string, userId: string): Promise<{ ticketId: string; userId: string; reason: string }> =>
      client.request(`/api/v1/tickets/${encodeURIComponent(idOrNumber)}/watchers`, { method: 'POST', body: { userId } }),

    ticketWatchers: (idOrNumber: string): Promise<WatcherRow[]> =>
      client.request<{ data: WatcherRow[] }>(`/api/v1/tickets/${encodeURIComponent(idOrNumber)}/watchers`).then(unwrap),

    /** The same call as `slaTimers`, under the name the other surfaces use. */
    ticketSla: (idOrNumber: string): Promise<SlaTimers> =>
      client.request<SlaTimers>(`/api/v1/tickets/${encodeURIComponent(idOrNumber)}/sla`),

    /** The desk's custom fields, active ones only: what an agent may fill in today. */
    fieldDefinitions: (): Promise<FieldRow[]> =>
      client.request<{ data: FieldRow[] }>('/api/v1/field-definitions').then(unwrap),

    categories: (options: { includeInactive?: boolean } = {}): Promise<CategoryRow[]> =>
      client.request<{ data: CategoryRow[] }>('/api/v1/categories', { query: { includeInactive: options.includeInactive } }).then(unwrap),

    /** The configuration items this ticket (or another record) touched. Needs `cmdb.read`. */
    recordCis: (entityType: 'ticket' | 'major_incident' | 'problem' | 'change', entityId: string): Promise<RecordCiRow[]> =>
      client
        .request<{ data: RecordCiRow[] }>(`/api/v1/records/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}/cis`)
        .then(unwrap),

    // ---- The desk's numbers, its incidents and who is on call ------------------

    /**
     * The metric questions (MOD-12): `query`, `forecast` and `queryBatch`.
     * Needs `analytics.read`, which the agent role does not hold (D9): decide
     * with `permissionScope(me, 'analytics.read')` before asking.
     */
    insights: metricQueries(client),

    /** `open: true` for the ones still running: the frame's chip and the Overview's banner. */
    majorIncidents: (filter: MajorIncidentFilter = {}): Promise<MajorIncidentRow[]> => incidents.majorIncidents(filter),

    /** One incident by number; `ticketId` is the way to its ticket until the incident pages ship. */
    majorIncident: (number: string, audience?: MajorIncidentAudience): Promise<MajorIncidentDetail> =>
      incidents.majorIncident(number, audience),

    /** A team's rotations, or every one the reader may see (`workload.read`). */
    rotations: (teamId?: string): Promise<RotationRow[]> => onCall.rotations(teamId),

    /** Who is on call for one rotation, now or at `at`, through any cover somebody agreed to. */
    onCall: (rotationKey: string, at?: string): Promise<OnCallRow> => onCall.onCall(rotationKey, at),

    /**
     * The service catalogue's services, for naming a grouped count's keys.
     * Behind `catalogue.manage` today, so most agents get a 403: a page treats
     * the names as optional rather than failing without them.
     */
    services: (): Promise<ServiceRow[]> => client.request<{ data: ServiceRow[] }>('/api/v1/services').then(unwrap),

    // ---- People and teams ----------------------------------------------------

    users: (query: UserQuery = {}): Promise<UserRow[]> => listUsers(client, query),

    user: (id: string): Promise<UserRow> => getUser(client, id),

    teams: (): Promise<TeamListRow[]> => listTeams(client),

    teamMembers: (teamId: string): Promise<TeamMemberRow[]> => listTeamMembers(client, teamId),

    // ---- Me: notifications, availability, the timer ---------------------------

    notifications: (options: { unread?: boolean; limit?: number } = {}): Promise<NotificationInbox> =>
      notificationInbox(client, options),

    markNotificationRead: (id: string | 'all'): Promise<{ marked: number }> => markNotificationRead(client, id),

    /** Everybody's by default, or the people named. `effectiveStatus` is what routing uses. */
    availability: (userIds?: readonly string[]): Promise<AvailabilityRow[]> =>
      client
        .request<{ data: AvailabilityRow[] }>('/api/v1/workload/availability', {
          query: { userIds: userIds && userIds.length > 0 ? userIds.join(',') : undefined },
        })
        .then(unwrap),

    setAvailability: (input: AvailabilityInput): Promise<{ userId: string; status: string; until: string | null }> =>
      client.request('/api/v1/workload/availability', { method: 'PUT', body: input }),

    timer: (): Promise<RunningTimer | null> =>
      client.request<{ running: RunningTimer | null }>('/api/v1/time/timer').then((body) => body.running),

    /** A 409 when one is already running: stop that one first, which is what the conflict body says. */
    startTimer: (input: { ticketId: string; activityKey: string; note?: string }): Promise<{ ticketId: string; startedAt: string }> =>
      client.request('/api/v1/time/timer/start', { method: 'POST', body: input }),

    /** Turns the running timer into a time entry. */
    stopTimer: (): Promise<TimeEntryRow> => client.request<TimeEntryRow>('/api/v1/time/timer/stop', { method: 'POST', body: {} }),

    activityTypes: (): Promise<ActivityTypeRow[]> =>
      client.request<{ data: ActivityTypeRow[] }>('/api/v1/activity-types').then(unwrap),

    // ---- Search and knowledge ------------------------------------------------

    search: (q: string, options: SearchOptions = {}): Promise<SearchResults> => search(client, q, options),

    knowledge: (filter: { status?: string; category?: string; limit?: number } = {}): Promise<ArticleSummary[]> =>
      client.request<{ data: ArticleSummary[] }>('/api/v1/knowledge', { query: { ...filter } }).then(unwrap),

    article: (key: string): Promise<Article> => client.request<Article>(`/api/v1/knowledge/${encodeURIComponent(key)}`),

    /** `resolved` counts the article as having answered the ticket; `referenced` only records that it was used. */
    linkArticle: (key: string, ticketId: string, relation: 'referenced' | 'resolved' = 'referenced') =>
      client.request<{ articleKey: string; ticketId: string; relation: string }>(`/api/v1/knowledge/${encodeURIComponent(key)}/link`, {
        method: 'POST',
        body: { ticketId, relation },
      }),

    // ---- MOD-09 AI ---------------------------------------------------------

    capabilities: (): Promise<{ provider: string | null; capabilities: AiCapability[] }> =>
      client.request('/api/v1/ai/capabilities'),

    suggest: (capability: string, ticketId: string): Promise<{ jobId: string; status: 'queued' | 'completed'; suggestionId: string | null }> =>
      client.request('/api/v1/ai/suggest', { method: 'POST', body: { capability, ticketId } }),

    aiJob: (jobId: string): Promise<AiJob> => client.request<AiJob>(`/api/v1/ai/jobs/${encodeURIComponent(jobId)}`),

    suggestions: (subjectId: string): Promise<{ data: Suggestion[] }> =>
      client.request('/api/v1/ai/suggestions', { query: { subjectId } }),

    /** Triage suggestions still waiting on a ticket; null when there is nothing to show. */
    triageSuggestion: (ticketId: string): Promise<{ data: TriageSuggestion | null }> =>
      client.request(`/api/v1/ai/triage/${encodeURIComponent(ticketId)}`),

    /**
     * Accept one triage suggestion: the agent's own edit, sent with the ticket
     * version they were looking at, so a ticket that changed under them is a
     * 409 rather than an overwrite.
     */
    acceptTriage: (decisionId: string, question: string, version: number) =>
      client.request<{ decisionId: string; question: string; response: string }>(
        `/api/v1/ai/decisions/${encodeURIComponent(decisionId)}/suggestions/${encodeURIComponent(question)}/accept`,
        { method: 'POST', body: { version } },
      ),

    dismissTriage: (decisionId: string, question: string) =>
      client.request<{ decisionId: string; question: string; response: string }>(
        `/api/v1/ai/decisions/${encodeURIComponent(decisionId)}/suggestions/${encodeURIComponent(question)}/dismiss`,
        { method: 'POST', body: {} },
      ),

    /**
     * Puts back what a field held before the AI set it, in `auto` mode. The
     * agent's own edit, with the version they were looking at, and counted
     * as a correction.
     */
    undoTriage: (decisionId: string, question: string, version: number) =>
      client.request<{ decisionId: string; question: string; restored: string | number | boolean | null }>(
        `/api/v1/ai/decisions/${encodeURIComponent(decisionId)}/applied/${encodeURIComponent(question)}/undo`,
        { method: 'POST', body: { version } },
      ),

    /**
     * What the person did with it. Recorded once, and the whole reason the
     * suggestion surface is worth building: without it nobody ever learns
     * whether any of this helps.
     */
    decideSuggestion: (id: string, outcome: 'accepted' | 'edited' | 'rejected', note?: string) =>
      client.request<{ id: string; outcome: string; outcomeAt: string | null }>(`/api/v1/ai/suggestions/${encodeURIComponent(id)}/outcome`, {
        method: 'POST',
        body: { outcome, ...(note ? { note } : {}) },
      }),
  };
}

export type Workbench = ReturnType<typeof workbench>;
