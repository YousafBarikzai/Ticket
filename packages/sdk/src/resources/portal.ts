import type { FormDefinition, FormValues } from '@itsm/contracts';
import type { Client } from '../client.js';
import { ticketQuery, type TicketFilter } from './workbench.js';
import type { Me, Page, Ticket, Timeline } from './types.js';

/**
 * What the requester portal asks the API for.
 *
 * Separate from `workbench.ts` because the unit of growth is a *screen*, and
 * the two applications barely overlap: the portal reads the catalogue, raises
 * things, reads its own tickets, decides approvals and searches knowledge,
 * where the workbench works a queue. The three calls they share — `me`, a
 * ticket, its timeline — are re-exposed here rather than imported through the
 * other module, so neither application's surface is the other's to change.
 *
 * Everything here is written against `apps/api/src/routes`, not against doc 08.
 * The first pass at `workbench.ts` was written the other way round and had
 * three defects, each of which the API would have accepted silently.
 */

export interface CatalogueItem {
  key: string;
  name: string;
  description: string | null;
  shortSummary: string | null;
  formKey: string | null;
  /** The service this sits under, for grouping. Null where the service was removed. */
  service: string | null;
  serviceKey: string | null;
}

export interface CatalogueItemDetail {
  key: string;
  name: string;
  description: string | null;
  /** Null where the item takes no answers — a request that is only a button. */
  form: FormDefinition | null;
}

export interface SubmitResult {
  ticketId: string;
  ticketNumber: string;
  submissionId: string;
  /** Set where the request needs a decision before it starts (MOD-17). */
  approvalId: string | null;
}

export interface ApprovalRequest {
  id: string;
  subjectType: string;
  subjectId: string;
  status: string;
  reason: string | null;
  requestedAt: string;
  decidedAt: string | null;
}

export interface SearchHit {
  entityType: string;
  entityId: string;
  title: string;
  snippet: string;
  rank: number;
  facets: Record<string, unknown>;
}

export interface Article {
  key: string;
  title: string;
  status: string;
  audience: string;
  version: number | null;
  summary: string | null;
  /** Structured blocks, never an HTML string: an article is data, not markup. */
  body: unknown[];
  keywords: string[];
}

export interface QueueableRequest {
  /** The path on the API, without the proxy prefix. */
  readonly path: string;
  readonly body: Record<string, unknown>;
}

/**
 * The three writes the portal is allowed to queue when it is offline
 * (doc 14 §5), as shapes rather than as calls.
 *
 * They exist separately from `portal()` so that the online path and the
 * offline path send **the same body**. The alternative — a component building
 * a body by hand for the queue and calling the client when online — is two
 * request shapes for one action, and the one that is wrong is the one nobody
 * exercises until a train goes into a tunnel.
 */
export const queueable = {
  reportIssue(input: { title: string; description?: string; urgency?: 'high' | 'medium' | 'low' }): QueueableRequest {
    return {
      path: '/api/v1/tickets',
      body: {
        type: 'incident',
        title: input.title,
        ...(input.description ? { description: input.description } : {}),
        ...(input.urgency ? { urgency: input.urgency } : {}),
        // Every rule, report and calendar can distinguish a ticket a person
        // typed from one an inbox produced.
        sourceChannel: 'portal',
      },
    };
  },

  comment(idOrNumber: string, body: string): QueueableRequest {
    return {
      path: `/api/v1/tickets/${encodeURIComponent(idOrNumber)}/comments`,
      // A requester's message is always public; there is no internal note here.
      body: { body, visibility: 'public' },
    };
  },

  decide(id: string, decision: 'approved' | 'rejected', comment?: string): QueueableRequest {
    return {
      path: `/api/v1/approvals/${encodeURIComponent(id)}/decide`,
      body: { decision, ...(comment ? { comment } : {}) },
    };
  },
} as const;


/** One channel's settings for the signed-in person. */
export interface NotificationPreference {
  channel: string;
  enabled: boolean;
  quietHours: { start: string; end: string } | null;
  digestMode: string;
}

/** `channel` is the key; everything else the schema defaults. */
export interface NotificationPreferenceInput {
  channel: 'inapp' | 'email' | 'push' | 'sms';
  enabled?: boolean;
  quietHours?: { start: string; end: string } | null;
  digestMode?: 'immediate' | 'hourly' | 'daily';
}

export function portal(client: Client) {
  return {
    me: (): Promise<Me> => client.request<Me>('/api/v1/me'),

    /**
     * What this person has asked to be told about, and how.
     *
     * `/me/...` rather than `/users/:id/...`: the second path is the same
     * service checked as the administrative act it is, and somebody reading
     * their own profile has no business being asked for a permission over
     * other people.
     */
    notificationPreferences: (): Promise<NotificationPreference[]> =>
      client.request<{ data: NotificationPreference[] }>('/api/v1/me/notification-preferences').then((body) => body.data),

    setNotificationPreference: (preference: NotificationPreferenceInput): Promise<NotificationPreference> =>
      client.request<NotificationPreference>('/api/v1/me/notification-preferences', { method: 'PUT', body: preference }),

    // ---- Raising something -------------------------------------------------

    /**
     * Reporting an issue. `sourceChannel: 'portal'` matters: every rule,
     * report and SLA calendar in the platform can distinguish a ticket a
     * person typed from one an inbox produced, and a client that left it at
     * the API's default would make the portal invisible in its own numbers.
     */
    reportIssue: (input: { title: string; description?: string; urgency?: 'high' | 'medium' | 'low' }): Promise<Ticket> => {
      const request = queueable.reportIssue(input);
      return client.request<Ticket>(request.path, { method: 'POST', body: request.body });
    },

    catalogue: (): Promise<{ data: CatalogueItem[] }> => client.request('/api/v1/catalogue'),

    /** 404 where the person is not entitled, which is deliberate: an item they cannot have must not be distinguishable from one that does not exist. */
    catalogueItem: (key: string): Promise<CatalogueItemDetail> =>
      client.request(`/api/v1/catalogue/${encodeURIComponent(key)}`),

    submitRequest: (key: string, answers: FormValues): Promise<SubmitResult> =>
      client.request(`/api/v1/catalogue/${encodeURIComponent(key)}/submit`, {
        method: 'POST',
        body: { answers },
      }),

    // ---- What I have raised ------------------------------------------------

    /**
     * `filter[requester]=me`, resolved server-side. A portal that filtered by
     * the user id it happens to hold would show nothing at all to somebody
     * whose account was re-provisioned, and everything to nobody in particular
     * if the parameter were ever dropped.
     */
    myTickets: (filter: Omit<TicketFilter, 'requester'> = {}): Promise<Page<Ticket>> =>
      client.request<Page<Ticket>>('/api/v1/tickets', { query: ticketQuery({ ...filter, requester: 'me' }) }),

    ticket: (idOrNumber: string): Promise<Ticket> =>
      client.request<Ticket>(`/api/v1/tickets/${encodeURIComponent(idOrNumber)}`),

    timeline: (idOrNumber: string): Promise<Timeline> =>
      client.request<Timeline>(`/api/v1/tickets/${encodeURIComponent(idOrNumber)}/timeline`),

    /** A requester's comment is always public: there is no internal note to write from here. */
    comment: (idOrNumber: string, body: string) => {
      const request = queueable.comment(idOrNumber, body);
      return client.request<{ id: string }>(request.path, { method: 'POST', body: request.body });
    },

    /**
     * Reopening. The state machine allows `resolved → reopened` and nothing
     * from `closed`, which is the product decision MOD-04 encodes: a closed
     * ticket gets a new linked one rather than a second life.
     */
    reopen: (idOrNumber: string, version: number, reason: string) =>
      client.request<Ticket>(`/api/v1/tickets/${encodeURIComponent(idOrNumber)}/transitions`, {
        method: 'POST',
        ifMatch: version,
        body: { to: 'reopened', reason },
      }),

    // ---- Approvals (MOD-17) ------------------------------------------------

    approvals: (includeDecided = false): Promise<{ data: ApprovalRequest[] }> =>
      client.request('/api/v1/approvals', { query: { includeDecided } }),

    approval: (id: string): Promise<unknown> => client.request(`/api/v1/approvals/${encodeURIComponent(id)}`),

    decide: (id: string, decision: 'approved' | 'rejected', comment?: string) => {
      const request = queueable.decide(id, decision, comment);
      return client.request<{ id: string; status: string }>(request.path, { method: 'POST', body: request.body });
    },

    // ---- Knowledge (MOD-09) ------------------------------------------------

    /**
     * `engine` comes back with the results and is worth surfacing: when the
     * search server is down the answer comes from the PostgreSQL projection,
     * which is correct but has no typo tolerance. A screen that cannot tell
     * the difference cannot explain it to somebody who typed "pasword".
     */
    search: (
      q: string,
      options: { types?: string; limit?: number } = {},
    ): Promise<{ data: SearchHit[]; meta: { facets: Record<string, Record<string, number>>; engine: string } }> =>
      client.request('/api/v1/search', {
        query: { q, limit: options.limit ?? 20, ...(options.types ? { types: options.types } : {}) },
      }),

    article: (key: string): Promise<Article> => client.request(`/api/v1/knowledge/${encodeURIComponent(key)}`),

    rateArticle: (key: string, helpful: boolean, comment?: string) =>
      client.request<{ ok: boolean }>(`/api/v1/knowledge/${encodeURIComponent(key)}/feedback`, {
        method: 'POST',
        body: { helpful, ...(comment ? { comment } : {}) },
      }),
  };
}

export type Portal = ReturnType<typeof portal>;
