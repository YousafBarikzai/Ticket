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

export interface TimelineComment {
  id: string;
  body: string;
  isInternal: boolean;
  authorId: string | null;
  createdAt: string;
}

export interface TimelineEntry {
  kind: 'comment' | 'event' | 'task';
  at: string;
  comment?: TimelineComment;
  event?: { id: string; type: string; summary?: string; occurredAt: string };
  task?: { id: string; title: string; status: string };
}

export interface Timeline {
  ticket: Ticket;
  entries: TimelineEntry[];
  includeInternal: boolean;
}

export interface SlaTimer {
  id: string;
  targetType: string;
  state: string;
  dueAt: string | null;
  /** Null while the clock is paused or the target is already met. */
  remainingMinutes: number | null;
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
  extract: string;
}

export interface Suggestion {
  id: string;
  capability: string;
  subjectId: string;
  content: Record<string, unknown>;
  reason: string;
  confidence: ConfidenceBand;
  evidence: SuggestionEvidence[];
  outcome: 'pending' | 'accepted' | 'edited' | 'rejected';
  createdAt: string;
}

export interface AiJob {
  id: string;
  capability: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'refused';
  subjectId: string;
  model: string;
  provider: string;
  cost: string;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
  suggestion: Suggestion | null;
}

export interface TimeSummary {
  ticketId: string;
  loggedMinutes: number;
  cost: number;
  currency: string | null;
  elapsedMinutes: number;
  entries: number;
}
