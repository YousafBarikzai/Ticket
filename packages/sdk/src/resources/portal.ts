import type { FormDefinition, FormValues } from '@itsm/contracts';
import { ApiError, type Client } from '../client.js';
import { markNotificationRead, notificationInbox, search, transitionBody } from './common.js';
import { ticketQuery, type TicketFilter } from './workbench.js';
import type {
  Article,
  ArticleSummary,
  Me,
  NotificationInbox,
  Page,
  SearchOptions,
  SearchResults,
  SessionRow,
  SlaTimers,
  Ticket,
  Timeline,
} from './types.js';

export type { Article, SearchHit } from './types.js';

/**
 * What the requester portal asks the API for.
 *
 * Separate from `workbench.ts` because the unit of growth is a *screen*, and
 * the two applications barely overlap: the portal reads the catalogue, raises
 * things, reads its own tickets, decides approvals and searches knowledge,
 * where the workbench works a queue. The calls they share — `me`, a ticket,
 * its timeline, the bell, search — are re-exposed here rather than taken from
 * the other surface (the shared grammar lives in `common.ts`), so neither
 * application's surface is the other's to change.
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

/**
 * Where a pending request has got to: "Step 2 of 3 · Line manager · due Friday".
 * Null once the request is settled.
 */
export interface ApprovalCurrentStep {
  /** Position among all the request's steps, skipped ones included. */
  sequence: number;
  name: string;
  /** `blocked` when every approver on it has left and nobody can decide it. */
  status: 'open' | 'blocked';
  dueAt: string | null;
  quorum: number;
  decidedCount: number;
}

/**
 * What is being approved, for the people asked to approve it — and only for
 * them. Null for everybody else, the requester included, and `title` is null
 * when the subject cannot be found; the page falls back to the step name.
 */
export interface ApprovalSubject {
  /** The subject type: `request`, `change`, `workflow_run`, … */
  kind: string;
  ticketNumber?: string;
  title: string | null;
  /** The catalogue item a request was raised from, when it had a form. */
  itemName?: string;
  requesterName: string | null;
}

/**
 * An approval request as `GET /approvals` lists it.
 *
 * Written from the route. An earlier version had a `reason` that the API has
 * never sent, so every approval read "A request needs your approval" whatever
 * it was for; what a request is about is in `subject`, for approvers.
 */
export interface ApprovalRequest {
  id: string;
  policyId: string;
  policyVersion: number;
  subjectType: string;
  subjectId: string;
  /** The ticket this decision holds up, where there is one. */
  ticketId: string | null;
  /** `pending`, `approved`, `rejected`, … */
  status: string;
  outcome: string | null;
  requestedBy: string | null;
  requestedAt: string;
  decidedAt: string | null;
  dueAt: string | null;
  version: number;
  /** All steps, skipped ones included, for "Step 2 of 3". */
  stepCount: number;
  currentStep: ApprovalCurrentStep | null;
  subject: ApprovalSubject | null;
  /**
   * Never sent by the API. Kept, always undefined, so a page written against
   * the old type still compiles while it moves to `subject`.
   * @deprecated read `subject?.title`.
   */
  reason?: undefined;
}

export interface ApprovalDecisionRow {
  id: string;
  stepId: string;
  approverId: string;
  /** Who actually decided, when a delegate acted for the named approver. */
  actedById: string | null;
  decision: 'approved' | 'rejected';
  comment: string | null;
  via: string;
  decidedAt: string;
}

export interface ApprovalStepRow {
  id: string;
  requestId: string;
  sequence: number;
  name: string;
  quorum: number;
  approverIds: string[];
  status: string;
  openedAt: string | null;
  decidedAt: string | null;
  dueAt: string | null;
  onTimeout: string;
  decisions: ApprovalDecisionRow[];
}

/** One catalogue answer as the requester gave it, labelled for somebody deciding on it. */
export interface ApprovalAnswer {
  field: string;
  label: string;
  value: unknown;
  /** The answer in words: option labels, a person's name, Yes or No. Empty when unanswered. */
  display: string;
}

export interface ApprovalDetail extends ApprovalRequest {
  steps: ApprovalStepRow[];
  /**
   * The catalogue answers, for an approver of a request raised with a form:
   * `[]` when the item had no form, null for anybody else and for subjects
   * that are not catalogue requests.
   */
  answers: ApprovalAnswer[] | null;
}

/** A tenant's public status page, as `GET /status/<slug>` answers anything that is not a browser. */
export interface PublicStatus {
  page: { slug: string; name: string; description: string | null; supportUrl: string | null; path: string };
  overall: PublicComponentStatus;
  components: { key: string; name: string; description: string | null; group: string | null; status: PublicComponentStatus }[];
  incidents: {
    id: string;
    title: string;
    impact: string;
    status: string;
    startedAt: string;
    resolvedAt: string | null;
    /** Component keys. */
    components: string[];
    updates: { status: string; body: string; postedAt: string }[];
  }[];
  maintenance: {
    id: string;
    title: string;
    body: string | null;
    status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
    startsAt: string;
    endsAt: string;
    components: string[];
  }[];
  generatedAt: string;
}

export type PublicComponentStatus = 'operational' | 'degraded' | 'partial_outage' | 'major_outage' | 'maintenance';

export interface QueueableRequest {
  /** The path on the API, without the proxy prefix. */
  readonly path: string;
  /** Always a POST: the outbox replays creates, and only creates. */
  readonly method: 'POST';
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
      method: 'POST',
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
      method: 'POST',
      // A requester's message is always public; there is no internal note here.
      body: { body, visibility: 'public' },
    };
  },

  decide(id: string, decision: 'approved' | 'rejected', comment?: string): QueueableRequest {
    return {
      path: `/api/v1/approvals/${encodeURIComponent(id)}/decide`,
      method: 'POST',
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

    notifications: (options: { unread?: boolean; limit?: number } = {}): Promise<NotificationInbox> =>
      notificationInbox(client, options),

    markNotificationRead: (id: string | 'all'): Promise<{ marked: number }> => markNotificationRead(client, id),

    /** Where this person is signed in, for "sign out of that device". */
    sessions: (): Promise<SessionRow[]> =>
      client.request<{ data: SessionRow[] }>('/api/v1/me/sessions').then((body) => body.data),

    endSession: (id: string): Promise<void> =>
      client.request<void>(`/api/v1/me/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }),

    /**
     * The tenant's public status page, or null when it has none.
     *
     * **Server-only.** The page lives at the API's root (`/status/<slug>`),
     * outside `/api/v1`, because its URL is printed on things; the browser's
     * client points at the BFF proxy, which forwards `/api/v1` and nothing
     * else, so from a browser this can only fail. JSON is asked for by the
     * `accept` header — the same URL is HTML to a browser.
     */
    publicStatus: async (slug: string): Promise<PublicStatus | null> => {
      try {
        return await client.request<PublicStatus>(`/status/${encodeURIComponent(slug)}`, {
          headers: { accept: 'application/json' },
        });
      } catch (error) {
        // No page, a page that is not public, or a slug nobody owns: all the
        // same to a reader, and none of them worth an error on the home page.
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },

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

    /**
     * `idempotencyKey` is one per intent: the caller mints it on the first
     * press and sends the same key when it retries the same answers, so a
     * reply lost on the way back cannot raise the request twice. Without it
     * a fresh key is generated per call, as for every create.
     */
    submitRequest: (key: string, answers: FormValues, options: { idempotencyKey?: string } = {}): Promise<SubmitResult> =>
      client.request(`/api/v1/catalogue/${encodeURIComponent(key)}/submit`, {
        method: 'POST',
        body: { answers },
        ...(options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
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

    /**
     * The other moves a requester may make: `closed` from `resolved` ("Yes,
     * it's fixed"), and cancelling their own request. A 403 means the ticket
     * is no longer in a state that allows it — somebody moved it first — and
     * a 409 that it changed since it was read.
     */
    transition: (idOrNumber: string, to: string, version: number, reason?: string) =>
      client.request<Ticket>(`/api/v1/tickets/${encodeURIComponent(idOrNumber)}/transitions`, {
        method: 'POST',
        ifMatch: version,
        body: transitionBody(to, reason),
      }),

    slaTimers: (idOrNumber: string): Promise<SlaTimers> =>
      client.request<SlaTimers>(`/api/v1/tickets/${encodeURIComponent(idOrNumber)}/sla`),

    // ---- Approvals (MOD-17) ------------------------------------------------

    /**
     * What is waiting on me; with `includeDecided`, what I have decided as
     * well; with `ticketId`, how far the approvals on one of my own tickets
     * have got. The boolean form is the original signature and still works.
     *
     * `false` is never sent (see `queryString`): the route used to read
     * `includeDecided=false` as true, and this call was the one that showed
     * everybody every decision they had ever made.
     */
    approvals: (
      options: boolean | { includeDecided?: boolean; ticketId?: string } = {},
    ): Promise<{ data: ApprovalRequest[] }> => {
      const filter: { includeDecided?: boolean; ticketId?: string } =
        typeof options === 'boolean' ? { includeDecided: options } : options;
      return client.request('/api/v1/approvals', {
        query: { includeDecided: filter.includeDecided, ticketId: filter.ticketId },
      });
    },

    approval: (id: string): Promise<ApprovalDetail> =>
      client.request<ApprovalDetail>(`/api/v1/approvals/${encodeURIComponent(id)}`),

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
    search: (q: string, options: SearchOptions = {}): Promise<SearchResults> => search(client, q, options),

    /** Published articles this person may read. The audience rule is the API's, applied per row. */
    knowledge: (filter: { status?: string; category?: string; limit?: number } = {}): Promise<ArticleSummary[]> =>
      client.request<{ data: ArticleSummary[] }>('/api/v1/knowledge', { query: { ...filter } }).then((body) => body.data),

    article: (key: string): Promise<Article> => client.request(`/api/v1/knowledge/${encodeURIComponent(key)}`),

    rateArticle: (key: string, helpful: boolean, comment?: string) =>
      client.request<{ ok: boolean }>(`/api/v1/knowledge/${encodeURIComponent(key)}/feedback`, {
        method: 'POST',
        body: { helpful, ...(comment ? { comment } : {}) },
      }),
  };
}

export type Portal = ReturnType<typeof portal>;
