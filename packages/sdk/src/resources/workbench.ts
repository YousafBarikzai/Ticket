import type { Client, RequestOptions } from '../client.js';
import type { AiCapability, AiJob, Me, Page, SlaTimers, Suggestion, Ticket, Timeline, TimeSummary, TriageSuggestion } from './types.js';

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
  /** Comma-separated, as the API's grammar takes them: `open,pending`. */
  status?: string;
  statusCategory?: string;
  type?: string;
  priority?: string;
  /** A user id, or the two words the API resolves itself: `me`, `none`. */
  assignee?: string;
  requester?: string;
  group?: string;
  service?: string;
  q?: string;
  limit?: number;
  cursor?: string;
  sort?: 'createdAt' | '-createdAt' | 'dueAt' | '-dueAt';
}

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
  const bracketed = ['status', 'statusCategory', 'type', 'priority', 'assignee', 'requester', 'group', 'service'] as const;
  const query: Record<string, string | number | undefined> = {
    limit: filter.limit ?? 50,
    ...(filter.cursor ? { cursor: filter.cursor } : {}),
    ...(filter.sort ? { sort: filter.sort } : {}),
    ...(filter.q ? { q: filter.q } : {}),
  };
  for (const key of bracketed) {
    const value = filter[key];
    if (value !== undefined && value !== '') query[`filter[${key}]`] = value;
  }
  return query;
}

export function workbench(client: Client) {
  return {
    me: (): Promise<Me> => client.request<Me>('/api/v1/me'),

    tickets: (filter: TicketFilter = {}): Promise<Page<Ticket>> =>
      client.request<Page<Ticket>>('/api/v1/tickets', { query: ticketQuery(filter) }),

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
    transition: (idOrNumber: string, to: string, version: number, reason?: string) =>
      client.request<Ticket>(`/api/v1/tickets/${encodeURIComponent(idOrNumber)}/transitions`, {
        method: 'POST',
        ifMatch: version,
        body: { to, ...(reason ? { reason } : {}) },
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
