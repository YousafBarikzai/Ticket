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

/** Impact and urgency: the two axes the desk's matrix turns into a priority. */
export type Level = 'high' | 'medium' | 'low';
export const LEVELS: readonly Level[] = ['high', 'medium', 'low'];
const LEVEL_WORD: Readonly<Record<Level, string>> = { high: 'High', medium: 'Medium', low: 'Low' };

/** One change to a ticket, as the person asked for it. */
export type TicketChange =
  | { readonly kind: 'status'; readonly to: string; readonly reason?: string }
  | { readonly kind: 'priority'; readonly priority: Priority }
  /** `groupId` absent: the team stays as it is. */
  | { readonly kind: 'assign'; readonly assigneeId: string | null; readonly groupId?: string | null }
  | { readonly kind: 'title'; readonly title: string }
  | { readonly kind: 'category'; readonly categoryId: string | null }
  /** The service may re-derive the priority from the matrix; the answer carries it. */
  | { readonly kind: 'impact'; readonly impact: Level | null }
  | { readonly kind: 'urgency'; readonly urgency: Level | null }
  | { readonly kind: 'affectedUser'; readonly affectedUserId: string | null }
  /** One custom field (`PATCH {custom: {key: value}}`, which the API merges); `null` clears it. */
  | { readonly kind: 'custom'; readonly key: string; readonly label: string; readonly value: unknown; readonly display?: string };

/** The ticket fields a change writes. */
export type ChangedField =
  | 'status'
  | 'priority'
  | 'assigneeId'
  | 'groupId'
  | 'title'
  | 'categoryId'
  | 'impact'
  | 'urgency'
  | 'affectedUserId'
  | 'custom';

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
    case 'impact':
      return ['impact'];
    case 'urgency':
      return ['urgency'];
    case 'affectedUser':
      return ['affectedUserId'];
    case 'custom':
      return ['custom'];
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
    case 'impact':
      return api.updateTicket(ticket.number, { impact: change.impact }, ticket.version);
    case 'urgency':
      return api.updateTicket(ticket.number, { urgency: change.urgency }, ticket.version);
    case 'affectedUser':
      return api.updateTicket(ticket.number, { affectedUserId: change.affectedUserId }, ticket.version);
    case 'custom':
      return api.updateTicket(ticket.number, { custom: { [change.key]: change.value ?? null } }, ticket.version);
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
    case 'impact':
      return { ...ticket, impact: change.impact ?? '' };
    case 'urgency':
      return { ...ticket, urgency: change.urgency ?? '' };
    case 'affectedUser':
      return { ...ticket, affectedUserId: change.affectedUserId };
    case 'custom': {
      const custom = { ...ticket.custom };
      if (change.value === null || change.value === undefined) delete custom[change.key];
      else custom[change.key] = change.value;
      return { ...ticket, custom };
    }
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
    case 'impact':
      return (fresh.impact || null) !== change.impact;
    case 'urgency':
      return (fresh.urgency || null) !== change.urgency;
    case 'affectedUser':
      return fresh.affectedUserId !== change.affectedUserId;
    case 'custom':
      return !sameValue(fresh.custom?.[change.key], change.value);
  }
}

/** Two custom-field values compared by what they hold (a list, a date, a number), absent and `null` alike. */
function sameValue(a: unknown, b: unknown): boolean {
  const norm = (value: unknown): string => (value === undefined || value === null || value === '' ? '' : JSON.stringify(value));
  return norm(a) === norm(b);
}

/** A custom field's value in words: "Yes", "Laptop, Monitor", "Not set". */
export function customValueText(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'Not set';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.length === 0 ? 'Not set' : value.map(String).join(', ');
  return String(value);
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
  impact: 'Impact',
  urgency: 'Urgency',
  affectedUserId: 'Affected user',
  custom: 'Custom field',
};

/** A field's value in words: "In progress", "P2 · High", "Jo Bloggs", "Network", "Not set". `key` names the custom field. */
export function valueText(field: ChangedField, ticket: Ticket, directory: Directory, key?: string): string {
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
    case 'impact':
    case 'urgency': {
      const level = ticket[field] as Level | '' | null;
      return level && level in LEVEL_WORD ? LEVEL_WORD[level] : 'Not set';
    }
    case 'affectedUserId':
      return ticket.affectedUserId ? personName(ticket.affectedUserId, directory.people, directory.me) : 'Not recorded';
    case 'custom':
      return key ? customValueText(ticket.custom?.[key]) : 'Changed';
  }
}

/** A change's own value in words, for "Yours: Resolved". */
function mineText(change: TicketChange, field: ChangedField, before: Ticket, directory: Directory): string {
  if (change.kind === 'custom') return change.display ?? customValueText(change.value);
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
  impact: ['ticket.updated'],
  urgency: ['ticket.updated'],
  affectedUserId: ['ticket.updated'],
  custom: ['ticket.updated'],
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
  const key = change.kind === 'custom' ? change.key : undefined;
  return fieldsOf(change)
    .filter((field) => (field === 'custom' ? !sameValue(before.custom?.[key!], fresh.custom?.[key!]) : before[field] !== fresh[field]))
    .map((field) => {
      const who = whoChanged(field, entries, before.updatedAt, directory);
      return {
        field: change.kind === 'custom' ? change.label : FIELD_LABEL[field],
        theirs: valueText(field, fresh, directory, key),
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
    case 'impact':
      return change.impact ? `Impact set to ${LEVEL_WORD[change.impact]}` : 'Impact cleared';
    case 'urgency':
      return change.urgency ? `Urgency set to ${LEVEL_WORD[change.urgency]}` : 'Urgency cleared';
    case 'affectedUser':
      return change.affectedUserId ? 'Affected user changed' : 'Affected user cleared';
    case 'custom':
      return change.value === null || change.value === undefined || change.value === '' ? `${change.label} cleared` : `${change.label} saved`;
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
