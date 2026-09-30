/**
 * The shapes the API actually returns, written down once.
 *
 * Hand-written rather than generated, and only for what an application reads.
 * The alternative — deriving them from the Prisma models — would tie every
 * screen to the database's column names and make a rename in a module a
 * compile error in a component, which is exactly the coupling the API exists
 * to prevent.
 */

import type { LinkType } from '@itsm/contracts';

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
  /**
   * Whether `event` entries were included. They are only for people who work
   * the desk: a requester's timeline has comments and tasks and nothing else,
   * so an empty history of changes is not mistaken for no changes at all.
   */
  includesEvents: boolean;
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
  /** Values the AI set by itself in `auto` mode that are still on the ticket, each undoable. */
  applied: TriageAppliedItem[];
}

/** One value the AI set by itself (ADR-0051, `auto` mode). */
export interface TriageAppliedItem {
  question: string;
  field: string;
  value: string | number | boolean;
  /** What the provider picked, for a person to read. */
  display: string;
  confidence: number;
  at: string;
}

export interface TimeSummary {
  ticketId: string;
  loggedMinutes: number;
  cost: number;
  currency: string | null;
  elapsedMinutes: number;
  entries: number;
}

// ---------------------------------------------------------------------------
// Shared by more than one surface
//
// People, teams, notifications and a ticket's surroundings are read by the
// workbench, the portal and the console alike. Written down once here, so the
// three applications cannot drift into three ideas of what a person is.
// ---------------------------------------------------------------------------

export interface UserRow {
  id: string;
  email: string;
  displayName: string;
  status: string;
  primaryOrgId: string | null;
  /** Someone from outside the organisation: a supplier, a customer's contact. */
  isExternal: boolean;
}

/**
 * How to ask the directory for people.
 *
 * `ids` resolves a known set at once — the names beside a page of tickets —
 * instead of one request per person. The API takes at most 200 in one call;
 * the SDK splits a longer list and puts the answers back together.
 */
export interface UserQuery {
  q?: string;
  limit?: number;
  status?: string;
  ids?: readonly string[];
}

/** A team as the directory lists it, to anyone who works the desk. */
export interface TeamListRow {
  id: string;
  key: string;
  name: string;
  orgId: string;
  /** Current members who are active: a deactivated person keeps the row but is not counted. */
  memberCount: number;
}

export interface TeamMemberRow {
  userId: string;
  displayName: string;
  isLead: boolean;
  since: string;
}

export interface NotificationRow {
  id: string;
  subject: string | null;
  body: string;
  ticketId: string | null;
  eventType: string;
  readAt: string | null;
  createdAt: string;
}

/** A page of the bell, with the unread count for the badge whatever the page holds. */
export interface NotificationInbox {
  unread: number;
  data: NotificationRow[];
}

/** One of this person's signed-in sessions, for "sign out everywhere else". */
export interface SessionRow {
  id: string;
  device: string | null;
  ip: string | null;
  lastSeenAt: string;
  expiresAt: string;
}

/** `{ count, capped }`: when `capped`, the true number is at least `count`, so say "999+". */
export interface TicketCount {
  count: number;
  capped: boolean;
}

export interface CategoryRow {
  id: string;
  key: string;
  name: string;
  /** Materialised path, for sorting and indenting a tree without rebuilding it. */
  path: string;
  parentId: string | null;
  orgId: string | null;
  defaultGroupId: string | null;
  isActive: boolean;
}

/** The contracts' vocabulary, so a new link type is one edit rather than two. */
export type TicketLinkType = LinkType;

/** A link from this ticket's side. Tickets the reader may not see are left out, not redacted. */
export interface TicketLinkRow {
  linkType: TicketLinkType;
  createdAt: string;
  ticket: { id: string; number: string; type: string; title: string; status: string; statusCategory: string };
}

/** A requester sees only their own row; the desk sees everybody's. */
export interface WatcherRow {
  userId: string;
  reason: string;
  createdAt: string;
}

/** Everything the API would take to raise a ticket; it fills in the defaults. */
export interface CreateTicketInput {
  type?: 'incident' | 'request' | 'problem' | 'change' | 'task' | 'question';
  title: string;
  description?: string;
  descriptionFormat?: 'text' | 'html';
  priority?: 'P1' | 'P2' | 'P3' | 'P4';
  impact?: 'high' | 'medium' | 'low';
  urgency?: 'high' | 'medium' | 'low';
  requesterId?: string;
  affectedUserId?: string;
  serviceId?: string;
  categoryId?: string;
  groupId?: string;
  assigneeId?: string;
  orgId?: string;
  parentId?: string;
  sourceChannel?: 'portal' | 'email' | 'api' | 'slack' | 'teams' | 'whatsapp' | 'voice' | 'mobile' | 'import' | 'system';
  custom?: Record<string, unknown>;
}

/**
 * The fields a PATCH may change. Status, assignee and group are not among
 * them: those move through a transition or an assignment, which carry their
 * own rules and history.
 */
export interface TicketPatch {
  title?: string;
  description?: string | null;
  priority?: 'P1' | 'P2' | 'P3' | 'P4';
  impact?: 'high' | 'medium' | 'low' | null;
  urgency?: 'high' | 'medium' | 'low' | null;
  serviceId?: string | null;
  categoryId?: string | null;
  affectedUserId?: string | null;
  custom?: Record<string, unknown>;
}

/** What a transition may carry besides the state. `resolutionCode` matters when resolving. */
export interface TransitionOptions {
  reason?: string;
  resolutionCode?: string;
}

/** An article as a list shows it: no body, which only the reading page needs. */
export interface ArticleSummary {
  id: string;
  key: string;
  title: string;
  status: string;
  audience: string;
  categoryId: string | null;
  keywords: string[];
  viewCount: number;
  helpfulCount: number;
  unhelpfulCount: number;
  reviewDueAt: string | null;
  updatedAt: string;
  publishedAt: string | null;
}

/** What `/search` indexes. Knowledge articles are `knowledge`, not `article`. */
export type SearchType = 'ticket' | 'knowledge';

export interface SearchHit {
  entityType: string;
  entityId: string;
  title: string;
  snippet: string;
  rank: number;
  facets: Record<string, unknown>;
}

export interface SearchResults {
  data: SearchHit[];
  /**
   * `engine` is worth surfacing: when the search server is down the answer
   * comes from the PostgreSQL projection, which is correct but has no typo
   * tolerance and counts facets over the page only.
   */
  meta: { facets: Record<string, Record<string, number>>; engine: string };
}

export interface SearchOptions {
  /**
   * What to search. `'article'` is accepted for callers written before the
   * index was named, and sent as `knowledge`: the API matches nothing for
   * `article`, so a knowledge search spelled that way quietly found nothing.
   */
  types?: SearchType | 'article' | readonly SearchType[];
  /**
   * Facet filters: `{ status: ['open', 'in_progress'], priority: 'P1' }`.
   * Values of one field are "any of"; different fields are "all of".
   */
  filter?: Record<string, string | readonly string[]>;
  /** Facets to count, e.g. `['status', 'priority']`. */
  facets?: readonly string[];
  limit?: number;
}

/** A running timer, or null when the person has none. */
export interface RunningTimer {
  ticketId: string;
  activityTypeId: string;
  note: string | null;
  startedAt: string;
}

export interface TimeEntryRow {
  id: string;
  ticketId: string;
  taskId: string | null;
  userId: string;
  kind: string;
  minutes: number;
  note: string | null;
  ratePerHour: number;
  currency: string;
  cost: number;
  billable: boolean;
  loggedAt: string;
  startedAt: string | null;
  endedAt: string | null;
  activityKey?: string | null;
  activityName?: string | null;
}

export interface ActivityTypeRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  billable: boolean;
  ratePerHour: number;
  currency: string;
  isSystem: boolean;
  isActive: boolean;
  teamRates: { teamId: string; ratePerHour: number; currency: string }[];
}

export type AvailabilityStatus = 'available' | 'busy' | 'away' | 'off_shift' | 'left';

export interface AvailabilityInput {
  status: AvailabilityStatus;
  /** Omitted means yourself; somebody else's needs the `any` scope. */
  userId?: string;
  reason?: string;
  /** An ISO instant after which the status lapses back to the default. */
  until?: string;
  capacity?: number | null;
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
  helpfulCount: number;
  unhelpfulCount: number;
  reviewDueAt: string | null;
  publishedAt: string | null;
}
