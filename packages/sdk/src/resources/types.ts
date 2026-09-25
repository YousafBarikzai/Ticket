/**
 * The shapes the API actually returns, written down once.
 *
 * Hand-written rather than generated, and only for what an application reads.
 * The alternative — deriving them from the Prisma models — would tie every
 * screen to the database's column names and make a rename in a module a
 * compile error in a component, which is exactly the coupling the API exists
 * to prevent.
 */

export interface Page<T> {
  data: T[];
  nextCursor: string | null;
}

export interface Ticket {
  id: string;
  number: string;
  type: string;
  title: string;
  description: string | null;
  status: string;
  statusCategory: string;
  priority: string;
  impact: string;
  urgency: string;
  requesterId: string | null;
  affectedUserId: string | null;
  assigneeId: string | null;
  groupId: string | null;
  serviceId: string | null;
  categoryId: string | null;
  orgId: string | null;
  sourceChannel: string;
  parentId: string | null;
  dueAt: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  reopenCount: number;
  custom: Record<string, unknown>;
  /** What `If-Match` carries on the next update. */
  version: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * A timeline entry, in the shape the API sends it.
 *
 * Flat, and discriminated on `kind`, because that is what
 * `GET /tickets/:id/timeline` returns — the fields sit directly on the entry
 * rather than under a nested `comment`/`event`/`task` object. Written from the
 * route rather than from doc 08, after a first pass written from the document
 * described a response the API has never produced.
 */
export interface TimelineCommentEntry {
  kind: 'comment';
  at: string;
  id: string;
  /** `internal` is agent-only. The service filters them out for a requester. */
  visibility: 'public' | 'internal';
  authorId: string | null;
  body: string;
  channel: string;
}

export interface TimelineEventEntry {
  kind: 'event';
  at: string;
  id: string;
  type: string;
  actorType: string;
  actorId: string | null;
  payload: Record<string, unknown>;
}

export interface TimelineTaskEntry {
  kind: 'task';
  at: string;
  id: string;
  title: string;
  status: string;
  assigneeId: string | null;
}

export type TimelineEntry = TimelineCommentEntry | TimelineEventEntry | TimelineTaskEntry;

export interface TimelineAttachment {
  id: string;
  filename: string;
  mime: string;
  size: number;
  createdAt: string;
}

export interface Timeline {
  ticket: Ticket;
  /** Whether this is the agent view or the requester view. */
  includesInternal: boolean;
  entries: TimelineEntry[];
  attachments: TimelineAttachment[];
}

/**
 * An SLA timer. Milliseconds, not minutes: the engine works in business
 * milliseconds against a calendar (MOD-07), and rounding on the way out of the
 * API would make two timers that differ by a minute read as identical.
 */
export interface SlaTimer {
  id: string;
  targetType: string;
  state: string;
  startedAt: string;
  dueAt: string | null;
  remainingMs: number;
  elapsedMs: number;
  warningsFired: number;
  metAt: string | null;
  breachedAt: string | null;
}

export interface SlaTimers {
  ticketId: string;
  timers: SlaTimer[];
}

export interface Me {
  actor: { type: string; id: string | null; displayName: string | null };
  tenant: { id: string; name: string; slug: string; region: string } | null;
  permissions: { key: string; scope: string | null }[];
  organisations: { id: string; name: string; code: string | null; path: string }[];
  teamIds: string[];
  locale: string;
  timeZone: string;
}

export type ConfidenceBand = 'low' | 'medium' | 'high';

export interface SuggestionEvidence {
  kind: 'article' | 'ticket' | 'known-error';
  id: string;
  title: string;
  /** What a person opens to check the answer: an article key or a number. */
  ref: string;
  /** The part that was actually put in front of the model. */
  extract: string;
}

export type SuggestionOutcome = 'pending' | 'accepted' | 'edited' | 'rejected';

/**
 * What a job carries back with it.
 *
 * Narrower than `Suggestion`: the job already names the capability and the
 * subject, so `GET /ai/jobs/:id` does not repeat them on the nested
 * suggestion. Two types rather than one optional-everything type, so a caller
 * cannot read `suggestion.capability` off a job and get `undefined` at runtime
 * with no complaint at compile time.
 */
export interface JobSuggestion {
  id: string;
  content: Record<string, unknown>;
  reason: string;
  confidence: ConfidenceBand;
  evidence: SuggestionEvidence[];
  outcome: SuggestionOutcome;
}

export interface Suggestion extends JobSuggestion {
  capability: string;
  subjectId: string;
  createdAt: string;
}

export interface AiJob {
  id: string;
  capability: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'refused';
  subjectType: string;
  subjectId: string;
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  /** Already formatted for a person — "£0.02", "3p", "<0.001p" — never a number to do arithmetic on. */
  cost: string;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
  suggestion: JobSuggestion | null;
}

export interface AiCapability {
  key: string;
  name: string;
  description: string;
  /** False for retrieval-only capabilities, which cost nothing and survive an exhausted budget. */
  callsAModel: boolean;
  available: boolean;
  unavailableBecause: string | null;
}

/**
 * One triage answer waiting on an agent (ADR-0051, `suggest` mode).
 *
 * `kind` says what the agent may do: `apply` can be accepted, which sets the
 * field as the agent's own edit; `info` can only be dismissed (a ticket's
 * type is fixed when it is raised); `warning` is a major-incident call, shown
 * with a way to the declaration screen and never applied from here.
 */
export interface TriageSuggestionItem {
  question: string;
  field: string | null;
  kind: 'apply' | 'info' | 'warning';
  value: string | number | boolean;
  /** What the AI picked, for a person to read. */
  display: string;
  confidence: number;
}

export interface TriageSuggestion {
  decisionId: string;
  provider: string;
  model: string | null;
  createdAt: string;
  suggestions: TriageSuggestionItem[];
}

export interface TimeSummary {
  ticketId: string;
  loggedMinutes: number;
  cost: number;
  currency: string | null;
  elapsedMinutes: number;
  entries: number;
}
