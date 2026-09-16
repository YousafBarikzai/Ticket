import type { Client } from '../client.js';

/**
 * The four configuration builders the administration console drives.
 *
 * Separate from `admin.ts` because these are a different question about the
 * same desk. `tenant.users`, `tenant.settings` and `tenant.fields` answer *who
 * may use it and what it collects*; these answer *how it behaves* — what
 * happens automatically, what is promised and by when, what a requester may
 * ask for, and what runs across several steps.
 *
 * Every one of these endpoints existed before anything called them. The rules
 * module's `/rules/facts` route carries a comment reading "The admin UI builds
 * its condition picker from this, so the list an author sees is the list the
 * validator enforces" — written for a picker that did not exist for four
 * phases. This file is the other half of that sentence.
 *
 * The row types are the database shapes, not inventions. A field named here is
 * a column that exists; nothing is added because a screen would look better
 * with it, because a screen that renders `undefined` looks exactly like one
 * whose data has not arrived.
 */

const unwrap = <T>(body: { data: T }): T => body.data;
const path = (...parts: string[]): string => parts.map(encodeURIComponent).join('/');

/* ------------------------------------------------------------------ rules */

export interface RuleRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  event: string;
  conditions: unknown;
  actions: unknown[];
  order: number;
  mode: string;
  status: string;
  version: number;
  orgId: string | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}

/**
 * What a rule may read and react to.
 *
 * The authoritative list, served by the API from the same constants the
 * validator uses. Offering an author anything else would be offering them a
 * rule that cannot be published.
 */
export interface RuleFacts {
  facts: string[];
  events: string[];
}

/** A dry run against real tickets: what this rule would have done. */
export interface RuleTestResult {
  sampled: number;
  wouldChange: {
    ticketId: string;
    number: string;
    title: string;
    matched: string[];
    effects: unknown[];
  }[];
  errors: { ruleKey: string; message: string }[];
}

export interface Rules {
  list(filter?: { event?: string; status?: string }): Promise<RuleRow[]>;
  facts(): Promise<RuleFacts>;
  get(idOrKey: string): Promise<RuleRow>;
  create(input: Record<string, unknown>): Promise<RuleRow>;
  update(idOrKey: string, input: Record<string, unknown>): Promise<RuleRow>;
  publish(idOrKey: string): Promise<RuleRow>;
  archive(idOrKey: string): Promise<RuleRow>;
  /** Writes nothing. A POST because the sample size belongs in a body. */
  test(idOrKey: string, sampleSize?: number): Promise<RuleTestResult>;
}

function rules(client: Client): Rules {
  return {
    list: (filter = {}) => {
      const query = new URLSearchParams();
      if (filter.event) query.set('event', filter.event);
      if (filter.status) query.set('status', filter.status);
      const suffix = query.size > 0 ? `?${query.toString()}` : '';
      return client.request<{ data: RuleRow[] }>(`/api/v1/rules${suffix}`).then(unwrap);
    },
    facts: () => client.request<{ data: RuleFacts }>('/api/v1/rules/facts').then(unwrap),
    get: (idOrKey) => client.request<RuleRow>(`/api/v1/${path('rules', idOrKey)}`),
    create: (input) => client.request<RuleRow>('/api/v1/rules', { method: 'POST', body: input }),
    update: (idOrKey, input) =>
      client.request<RuleRow>(`/api/v1/${path('rules', idOrKey)}`, { method: 'PATCH', body: input }),
    publish: (idOrKey) =>
      client.request<RuleRow>(`/api/v1/${path('rules', idOrKey)}/publish`, { method: 'POST', body: {} }),
    archive: (idOrKey) =>
      client.request<RuleRow>(`/api/v1/${path('rules', idOrKey)}/archive`, { method: 'POST', body: {} }),
    test: (idOrKey, sampleSize) =>
      client.request<RuleTestResult>(`/api/v1/${path('rules', idOrKey)}/test`, {
        method: 'POST',
        body: sampleSize === undefined ? {} : { sampleSize },
      }),
  };
}

/* -------------------------------------------------------------------- sla */

export interface SlaTargetRow {
  id: string;
  priority: string;
  targetType: string;
  minutes: number;
  warningThresholds: number[];
}

export interface SlaPolicyRow {
  id: string;
  key: string;
  name: string;
  match: unknown;
  specificity: number;
  calendarMode: string;
  calendarId: string | null;
  status: string;
  version: number;
  orgId: string | null;
  targets?: SlaTargetRow[];
}

export interface CalendarRow {
  id: string;
  key: string;
  name: string;
  timeZone: string;
  hours: Record<string, { start: string; end: string }[]>;
  isDefault: boolean;
  version: number;
}

/** One cell of the 3×3 grid. The API requires all nine, every time. */
export interface PriorityMatrixRow {
  impact: 'high' | 'medium' | 'low';
  urgency: 'high' | 'medium' | 'low';
  priority: 'P1' | 'P2' | 'P3' | 'P4';
}

export interface Sla {
  policies(): Promise<SlaPolicyRow[]>;
  createPolicy(input: Record<string, unknown>): Promise<SlaPolicyRow>;
  /** Replaces the whole target set: a partial update would leave a priority uncovered. */
  setTargets(idOrKey: string, targets: Record<string, unknown>[]): Promise<SlaPolicyRow>;
  calendars(): Promise<CalendarRow[]>;
  createCalendar(input: Record<string, unknown>): Promise<CalendarRow>;
  priorityMatrix(): Promise<PriorityMatrixRow[]>;
  /** Replaces all nine cells: the API refuses a partial matrix. */
  setPriorityMatrix(rows: readonly PriorityMatrixRow[]): Promise<PriorityMatrixRow[]>;
}

function sla(client: Client): Sla {
  return {
    policies: () => client.request<{ data: SlaPolicyRow[] }>('/api/v1/sla-policies').then(unwrap),
    createPolicy: (input) => client.request<SlaPolicyRow>('/api/v1/sla-policies', { method: 'POST', body: input }),
    setTargets: (idOrKey, targets) =>
      client.request<SlaPolicyRow>(`/api/v1/${path('sla-policies', idOrKey)}/targets`, {
        method: 'PUT',
        body: { targets },
      }),
    calendars: () => client.request<{ data: CalendarRow[] }>('/api/v1/sla-calendars').then(unwrap),
    createCalendar: (input) => client.request<CalendarRow>('/api/v1/sla-calendars', { method: 'POST', body: input }),
    priorityMatrix: () => client.request<{ data: PriorityMatrixRow[] }>('/api/v1/priority-matrix').then(unwrap),
    setPriorityMatrix: (rows) =>
      client.request<PriorityMatrixRow[]>('/api/v1/priority-matrix', { method: 'PUT', body: { rows } }),
  };
}

/* -------------------------------------------------------------- catalogue */

export interface ServiceRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  status: string;
  ownerId: string | null;
  groupId: string | null;
}

export interface RequestTypeRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  shortSummary: string | null;
  serviceId: string;
  formKey: string | null;
  groupId: string | null;
  priority: string;
  status: string;
  sortOrder: number;
  publishedAt: string | null;
}

export interface FormRow {
  key: string;
  name: string;
  status: string;
  version?: number;
}

export interface Catalogue {
  /** What a requester would see: published request types only, entitlement applied. */
  browse(): Promise<unknown[]>;
  /** What an administrator sees: everything, drafts included. */
  services(): Promise<ServiceRow[]>;
  requestTypes(filter?: { status?: string; serviceId?: string }): Promise<RequestTypeRow[]>;
  createService(input: Record<string, unknown>): Promise<ServiceRow>;
  updateService(key: string, patch: Record<string, unknown>): Promise<ServiceRow>;
  createRequestType(input: Record<string, unknown>): Promise<RequestTypeRow>;
  updateRequestType(key: string, patch: Record<string, unknown>): Promise<RequestTypeRow>;
  publishRequestType(key: string): Promise<RequestTypeRow>;
  forms(status?: 'draft' | 'published'): Promise<FormRow[]>;
  createForm(input: Record<string, unknown>): Promise<FormRow>;
  updateForm(key: string, patch: Record<string, unknown>): Promise<FormRow>;
  publishForm(key: string): Promise<FormRow>;
}

function catalogue(client: Client): Catalogue {
  return {
    browse: () => client.request<{ data: unknown[] }>('/api/v1/catalogue').then(unwrap),
    services: () => client.request<{ data: ServiceRow[] }>('/api/v1/services').then(unwrap),
    requestTypes: (filter = {}) => {
      const query = new URLSearchParams();
      if (filter.status) query.set('status', filter.status);
      if (filter.serviceId) query.set('serviceId', filter.serviceId);
      const suffix = query.size > 0 ? `?${query.toString()}` : '';
      return client.request<{ data: RequestTypeRow[] }>(`/api/v1/request-types${suffix}`).then(unwrap);
    },
    createService: (input) => client.request<ServiceRow>('/api/v1/services', { method: 'POST', body: input }),
    updateService: (key, patch) =>
      client.request<ServiceRow>(`/api/v1/${path('services', key)}`, { method: 'PATCH', body: patch }),
    createRequestType: (input) =>
      client.request<RequestTypeRow>('/api/v1/request-types', { method: 'POST', body: input }),
    updateRequestType: (key, patch) =>
      client.request<RequestTypeRow>(`/api/v1/${path('request-types', key)}`, { method: 'PATCH', body: patch }),
    publishRequestType: (key) =>
      client.request<RequestTypeRow>(`/api/v1/${path('request-types', key)}/publish`, { method: 'POST', body: {} }),
    forms: (status) =>
      client
        .request<{ data: FormRow[] }>(`/api/v1/forms${status ? `?status=${status}` : ''}`)
        .then(unwrap),
    createForm: (input) => client.request<FormRow>('/api/v1/forms', { method: 'POST', body: input }),
    updateForm: (key, patch) =>
      client.request<FormRow>(`/api/v1/${path('forms', key)}`, { method: 'PATCH', body: patch }),
    publishForm: (key) =>
      client.request<FormRow>(`/api/v1/${path('forms', key)}/publish`, { method: 'POST', body: {} }),
  };
}

/* -------------------------------------------------------------- workflows */

export interface WorkflowRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  status: string;
  currentVersionId: string | null;
  ownerId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowRunRow {
  id: string;
  definitionId: string;
  versionId: string;
  ticketId: string | null;
  status: string;
  currentKeys: string[];
  triggeredBy: string | null;
  error: string | null;
  startedAt: string;
  endedAt: string | null;
}

/** What `checkGraph` found, against the newest draft rather than what is live. */
export interface WorkflowValidation {
  version: number;
  problems: { code?: string; message: string; nodeKey?: string }[];
}

export interface Workflows {
  list(status?: string): Promise<WorkflowRow[]>;
  get(key: string): Promise<WorkflowRow & { versions?: unknown[] }>;
  create(input: Record<string, unknown>): Promise<WorkflowRow>;
  saveDraft(key: string, graph: unknown, changeNote?: string): Promise<unknown>;
  validate(key: string): Promise<WorkflowValidation>;
  publish(key: string): Promise<unknown>;
  rollback(key: string, toVersion: number): Promise<unknown>;
  /** A dry run: walks the graph against a sample context and writes nothing. */
  test(key: string, context: Record<string, unknown>): Promise<unknown>;
  /**
   * `status`, `ticketId` and `limit` — what the route actually accepts. Its
   * query schema is not strict, so an invented filter would be dropped in
   * silence and the screen would offer a control that does nothing.
   */
  runs(filter?: { status?: string; ticketId?: string; limit?: number }): Promise<WorkflowRunRow[]>;
  run(id: string): Promise<WorkflowRunRow & { steps?: unknown[] }>;
  retry(id: string): Promise<unknown>;
  skip(id: string, reason: string): Promise<unknown>;
  cancel(id: string, reason: string): Promise<unknown>;
}

function workflows(client: Client): Workflows {
  return {
    list: (status) =>
      client.request<{ data: WorkflowRow[] }>(`/api/v1/workflows${status ? `?status=${status}` : ''}`).then(unwrap),
    get: (key) => client.request<WorkflowRow & { versions?: unknown[] }>(`/api/v1/${path('workflows', key)}`),
    create: (input) => client.request<WorkflowRow>('/api/v1/workflows', { method: 'POST', body: input }),
    saveDraft: (key, graph, changeNote) =>
      client.request(`/api/v1/${path('workflows', key)}`, {
        method: 'PATCH',
        body: changeNote === undefined ? { graph } : { graph, changeNote },
      }),
    validate: (key) =>
      client.request<WorkflowValidation>(`/api/v1/${path('workflows', key)}/validate`, { method: 'POST', body: {} }),
    publish: (key) => client.request(`/api/v1/${path('workflows', key)}/publish`, { method: 'POST', body: {} }),
    rollback: (key, toVersion) =>
      client.request(`/api/v1/${path('workflows', key)}/rollback`, { method: 'POST', body: { toVersion } }),
    test: (key, context) =>
      client.request(`/api/v1/${path('workflows', key)}/test`, { method: 'POST', body: { context } }),
    runs: (filter = {}) => {
      const query = new URLSearchParams();
      if (filter.status) query.set('status', filter.status);
      if (filter.ticketId) query.set('ticketId', filter.ticketId);
      if (filter.limit !== undefined) query.set('limit', String(filter.limit));
      const suffix = query.size > 0 ? `?${query.toString()}` : '';
      return client.request<{ data: WorkflowRunRow[] }>(`/api/v1/workflow-runs${suffix}`).then(unwrap);
    },
    run: (id) => client.request<WorkflowRunRow & { steps?: unknown[] }>(`/api/v1/${path('workflow-runs', id)}`),
    retry: (id) => client.request(`/api/v1/${path('workflow-runs', id)}/retry`, { method: 'POST', body: {} }),
    skip: (id, reason) =>
      client.request(`/api/v1/${path('workflow-runs', id)}/skip`, { method: 'POST', body: { reason } }),
    cancel: (id, reason) =>
      client.request(`/api/v1/${path('workflow-runs', id)}/cancel`, { method: 'POST', body: { reason } }),
  };
}

/* ----------------------------------------------------------------- export */

export interface Builders {
  readonly rules: Rules;
  readonly sla: Sla;
  readonly catalogue: Catalogue;
  readonly workflows: Workflows;
}

export function builders(client: Client): Builders {
  return { rules: rules(client), sla: sla(client), catalogue: catalogue(client), workflows: workflows(client) };
}
