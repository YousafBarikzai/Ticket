import { ApiError, type Ticket, type TicketPatch, type TimelineEntry } from '@itsm/sdk';
import type { ConflictChange } from '@itsm/ui/overlays';
import { personName, priorityLabel, stateLabel, type PeopleMap } from '../inbox/presentation.js';
import { transitionsFrom } from '../queue/transitions.js';
import { api } from './api.js';
import type { CategorySummary, TeamSummary } from './desk-ticket.js';

/**
 * The writes the ticket workspace makes, and the rules around them (SPEC
 * §6.2, §4.10, F24).
 *
 * Every write carries the version the person was looking at as `If-Match`,
 * so a ticket somebody else changed first is a 409 to explain — "Jo changed
 * Status to In progress · 2 min ago" — never a silent overwrite of Jo's
 * work. The rules that decide what the explanation says, whether "Apply my
 * change on top" still makes sense, and what a change does to the ticket on
 * screen before the service answers are plain functions here, so they are
 * tested with a ticket and an answer rather than a rendered page.
 */

export type Priority = 'P1' | 'P2' | 'P3' | 'P4';
export const PRIORITIES: readonly Priority[] = ['P1', 'P2', 'P3', 'P4'];

/** One change to a ticket, as the person asked for it. */
export type TicketChange =
  | { readonly kind: 'status'; readonly to: string; readonly reason?: string }
  | { readonly kind: 'priority'; readonly priority: Priority }
  /** `groupId` absent: the team stays as it is. */
  | { readonly kind: 'assign'; readonly assigneeId: string | null; readonly groupId?: string | null }
  | { readonly kind: 'title'; readonly title: string }
  | { readonly kind: 'category'; readonly categoryId: string | null };

/** The ticket fields a change writes. */
export type ChangedField = 'status' | 'priority' | 'assigneeId' | 'groupId' | 'title' | 'categoryId';

export function fieldsOf(change: TicketChange): readonly ChangedField[] {
  switch (change.kind) {
    case 'status':
      return ['status'];
    case 'priority':
      return ['priority'];
    case 'assign':
      return change.groupId === undefined ? ['assigneeId'] : ['assigneeId', 'groupId'];
    case 'title':
      return ['title'];
    case 'category':
      return ['categoryId'];
  }
}

/** The API's reason is at most 2,000 characters; the full text is in the comment that goes with it. */
export const MAX_REASON = 2000;

/** Sends one change with the version it was made against. */
export function writeChange(ticket: Pick<Ticket, 'number' | 'version'>, change: TicketChange): Promise<Ticket> {
  switch (change.kind) {
    case 'status': {
      const reason = change.reason?.trim();
      return api.transition(ticket.number, change.to, ticket.version, reason ? { reason: reason.slice(0, MAX_REASON) } : undefined);
    }
    case 'priority':
      return api.updateTicket(ticket.number, { priority: change.priority }, ticket.version);
    case 'assign':
      return api.assign(ticket.number, change.assigneeId, change.groupId, ticket.version);
    case 'title':
      return api.updateTicket(ticket.number, { title: change.title } satisfies TicketPatch, ticket.version);
    case 'category':
      return api.updateTicket(ticket.number, { categoryId: change.categoryId }, ticket.version);
  }
}

/**
 * What the ticket looks like while the change is on its way: the new value
 * at once, so the chip moves under the person's hand. The server's answer
 * replaces it (with the new version); a refusal puts the old ticket back.
 */
export function applyOptimistic(ticket: Ticket, change: TicketChange): Ticket {
  switch (change.kind) {
    case 'status':
      return { ...ticket, status: change.to };
    case 'priority':
      return { ...ticket, priority: change.priority };
    case 'assign':
      return { ...ticket, assigneeId: change.assigneeId, ...(change.groupId === undefined ? {} : { groupId: change.groupId }) };
    case 'title':
      return { ...ticket, title: change.title };
    case 'category':
      return { ...ticket, categoryId: change.categoryId };
  }
}

/** Whether a failure is someone else's change arriving first. */
export function isConflict(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 409 || error.status === 412);
}

/** A write sent without `If-Match` (or with one the API could not read): reload once and try again. */
export function isPreconditionRequired(error: unknown): boolean {
  return error instanceof ApiError && error.status === 428;
}

/**
 * Whether "Apply my change on top" can still work on the ticket as it is
 * now. A move the state machine no longer allows from their status is not
 * one the person can re-apply — and the same value twice is not a change.
 */
export function stillApplies(change: TicketChange, fresh: Ticket): boolean {
  switch (change.kind) {
    case 'status':
      return fresh.status !== change.to && transitionsFrom(fresh.status).includes(change.to);
    case 'priority':
      return fresh.priority !== change.priority;
    case 'assign':
      return fresh.assigneeId !== change.assigneeId || (change.groupId !== undefined && fresh.groupId !== change.groupId);
    case 'title':
      return fresh.title !== change.title;
    case 'category':
      return fresh.categoryId !== change.categoryId;
  }
}

/* ------------------------------------------------------------ Explaining */

export interface Directory {
  readonly people: PeopleMap;
  readonly me: string | null;
  readonly teams?: readonly TeamSummary[] | null;
  readonly categories?: readonly CategorySummary[] | null;
}

const FIELD_LABEL: Readonly<Record<ChangedField, string>> = {
  status: 'Status',
  priority: 'Priority',
  assigneeId: 'Assignee',
  groupId: 'Team',
  title: 'Title',
  categoryId: 'Category',
};

/** A field's value in words: "In progress", "P2 · High", "Jo Bloggs", "Network", "Not set". */
export function valueText(field: ChangedField, ticket: Ticket, directory: Directory): string {
  switch (field) {
    case 'status':
      return stateLabel(ticket.status);
    case 'priority':
      return priorityLabel(ticket.priority);
    case 'assigneeId':
      return ticket.assigneeId ? personName(ticket.assigneeId, directory.people, directory.me) : 'Unassigned';
    case 'groupId': {
      if (!ticket.groupId) return 'No team';
      return directory.teams?.find((team) => team.id === ticket.groupId?.toLowerCase())?.name ?? 'Another team';
    }
    case 'title':
      return ticket.title;
    case 'categoryId': {
      if (!ticket.categoryId) return 'Not set';
      return directory.categories?.find((category) => category.id === ticket.categoryId?.toLowerCase())?.path ?? 'Another category';
    }
  }
}

/** A change's own value in words, for "Yours: Resolved". */
function mineText(change: TicketChange, field: ChangedField, before: Ticket, directory: Directory): string {
  return valueText(field, applyOptimistic(before, change), directory);
}

/** The event types that record a change to each field. */
const EVENT_FOR: Readonly<Record<ChangedField, readonly string[]>> = {
  status: ['ticket.status.changed'],
  priority: ['ticket.updated'],
  assigneeId: ['ticket.assigned'],
  groupId: ['ticket.assigned'],
  title: ['ticket.updated'],
  categoryId: ['ticket.updated'],
};

/**
 * An event's type in the catalogue's spelling. The timeline stores the short
 * form (`status.changed`, `assigned`) while the event catalogue — and
 * `describeEvent` — name them in full (`ticket.status.changed`); both are
 * read as the full one.
 */
export function eventType(type: string): string {
  return type.startsWith('ticket.') ? type : `ticket.${type}`;
}

/** Who changed a field since `since`, and when: the newest event that records it, from the fresh history. */
function whoChanged(field: ChangedField, entries: readonly TimelineEntry[], since: string, directory: Directory): { by?: string; at?: string } {
  const after = Date.parse(since);
  const types = EVENT_FOR[field];
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]!;
    if (entry.kind !== 'event' || !types.includes(eventType(entry.type))) continue;
    if (!Number.isNaN(after) && Date.parse(entry.at) <= after) break;
    if (eventType(entry.type) === 'ticket.updated') {
      const changed = entry.payload?.changed;
      if (!changed || typeof changed !== 'object' || !(field in changed)) continue;
    }
    const by =
      entry.actorType === 'ai'
        ? 'AI triage'
        : entry.actorType === 'rule' || entry.actorType === 'workflow'
          ? 'An automation'
          : entry.actorId
            ? personName(entry.actorId.toLowerCase(), directory.people, directory.me)
            : 'The system';
    return { by, at: entry.at };
  }
  return {};
}

/**
 * What someone else changed that this change also touches, for the
 * conflict dialog: "Jo changed Status to In progress · 2 min ago · Yours:
 * Resolved". When nothing the person was changing moved (someone edited
 * another field), the list is empty and the dialog simply offers to apply
 * the change to the newer ticket.
 */
export function conflictChanges(
  change: TicketChange,
  before: Ticket,
  fresh: Ticket,
  entries: readonly TimelineEntry[],
  directory: Directory,
): ConflictChange[] {
  return fieldsOf(change)
    .filter((field) => before[field] !== fresh[field])
    .map((field) => {
      const who = whoChanged(field, entries, before.updatedAt, directory);
      return {
        field: FIELD_LABEL[field],
        theirs: valueText(field, fresh, directory),
        mine: mineText(change, field, before, directory),
        ...(who.by ? { by: who.by } : {}),
        ...(who.at ? { at: who.at } : {}),
      };
    });
}

/** What happened, for the toast after a change lands: "Moved to Resolved", "Assigned to you". */
export function changeSummary(change: TicketChange, directory: Directory): string {
  switch (change.kind) {
    case 'status':
      return `Moved to ${stateLabel(change.to)}`;
    case 'priority':
      return `Priority set to ${priorityLabel(change.priority)}`;
    case 'assign': {
      if (change.groupId !== undefined && change.groupId !== null) {
        const team = directory.teams?.find((entry) => entry.id === change.groupId?.toLowerCase())?.name ?? 'another team';
        return `Moved to ${team}`;
      }
      if (change.assigneeId === null) return 'Unassigned';
      return `Assigned to ${change.assigneeId === directory.me ? 'you' : personName(change.assigneeId, directory.people, directory.me)}`;
    }
    case 'title':
      return 'Title changed';
    case 'category':
      return change.categoryId ? 'Category changed' : 'Category cleared';
  }
}

/* ---------------------------------------------------- Other ticket writes */

/**
 * A new ticket that carries on from a closed one: the same requester, type
 * and title, linked back as related. One idempotency key per press, so a
 * retry after a lost answer raises one ticket, not two.
 */
export async function raiseFollowUp(ticket: Ticket, idempotencyKey: string): Promise<Ticket> {
  const created = await api.createTicket(
    {
      type: (['incident', 'request', 'problem', 'change', 'task', 'question'] as const).find((type) => type === ticket.type) ?? 'incident',
      title: `Follow-up: ${ticket.title}`.slice(0, 500),
      description: `Carries on from ${ticket.number}.${ticket.description ? `\n\n${ticket.description}` : ''}`,
      ...(ticket.requesterId ? { requesterId: ticket.requesterId } : {}),
      ...(ticket.groupId ? { groupId: ticket.groupId } : {}),
      sourceChannel: 'api',
    },
    { idempotencyKey },
  );
  try {
    await api.link(created.number, ticket.number, 'related_to');
  } catch {
    // The ticket exists; a missing link is worth less than a second ticket from a retry.
  }
  return created;
}

/** Adds the reader as a watcher. */
export function watchTicket(ticket: Pick<Ticket, 'number'>, userId: string): Promise<unknown> {
  return api.watch(ticket.number, userId);
}
