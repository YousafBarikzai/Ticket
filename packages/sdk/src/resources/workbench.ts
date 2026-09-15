import type { Client, RequestOptions } from '../client.js';
import type { AiJob, Me, Page, SlaTimer, Suggestion, Ticket, Timeline, TimeSummary } from './types.js';

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
  status?: string;
  assignee?: string;
  group?: string;
  q?: string;
  limit?: number;
  cursor?: string;
  sort?: string;
}

export function workbench(client: Client) {
  return {
    me: (): Promise<Me> => client.request<Me>('/api/v1/me'),

    tickets: (filter: TicketFilter = {}): Promise<Page<Ticket>> =>
      client.request<Page<Ticket>>('/api/v1/tickets', { query: { ...filter, limit: filter.limit ?? 50 } }),

    ticket: (idOrNumber: string): Promise<Ticket> =>
      client.request<Ticket>(`/api/v1/tickets/${encodeURIComponent(idOrNumber)}`),

    timeline: (idOrNumber: string): Promise<Timeline> =>
      client.request<Timeline>(`/api/v1/tickets/${encodeURIComponent(idOrNumber)}/timeline`),

    slaTimers: (idOrNumber: string): Promise<{ data: SlaTimer[] }> =>
      client.request<{ data: SlaTimer[] }>(`/api/v1/tickets/${encodeURIComponent(idOrNumber)}/sla`),

    timeOnTicket: (ticketId: string): Promise<{ data: unknown[]; summary: TimeSummary }> =>
      client.request<{ data: unknown[]; summary: TimeSummary }>(`/api/v1/tickets/${encodeURIComponent(ticketId)}/time`),

    comment: (idOrNumber: string, body: string, isInternal = false, options: RequestOptions = {}) =>
      client.request<{ id: string }>(`/api/v1/tickets/${encodeURIComponent(idOrNumber)}/comments`, {
        ...options,
        method: 'POST',
        body: { body, isInternal },
      }),

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

    assign: (idOrNumber: string, assigneeId: string | null, version: number) =>
      client.request<Ticket>(`/api/v1/tickets/${encodeURIComponent(idOrNumber)}/assign`, {
        method: 'POST',
        ifMatch: version,
        body: { assigneeId },
      }),

    logTime: (ticketId: string, activityKey: string, minutes: number, note?: string) =>
      client.request<{ id: string }>('/api/v1/time-entries', {
        method: 'POST',
        body: { ticketId, activityKey, minutes, ...(note ? { note } : {}) },
      }),

    // ---- MOD-09 AI ---------------------------------------------------------

    capabilities: (): Promise<{ provider: string | null; capabilities: { key: string; name: string; available: boolean; unavailableBecause: string | null }[] }> =>
      client.request('/api/v1/ai/capabilities'),

    suggest: (capability: string, ticketId: string): Promise<{ jobId: string; status: string; suggestionId: string | null }> =>
      client.request('/api/v1/ai/suggest', { method: 'POST', body: { capability, ticketId } }),

    aiJob: (jobId: string): Promise<AiJob> => client.request<AiJob>(`/api/v1/ai/jobs/${encodeURIComponent(jobId)}`),

    suggestions: (subjectId: string): Promise<{ data: Suggestion[] }> =>
      client.request('/api/v1/ai/suggestions', { query: { subjectId } }),

    /**
     * What the person did with it. Recorded once, and the whole reason the
     * suggestion surface is worth building: without it nobody ever learns
     * whether any of this helps.
     */
    decideSuggestion: (id: string, outcome: 'accepted' | 'edited' | 'rejected', note?: string) =>
      client.request<{ id: string; outcome: string }>(`/api/v1/ai/suggestions/${encodeURIComponent(id)}/outcome`, {
        method: 'POST',
        body: { outcome, ...(note ? { note } : {}) },
      }),
  };
}

export type Workbench = ReturnType<typeof workbench>;
