import type { Operator } from '../rules.js';

/**
 * What a condition can be about, in words, and what kind of value each takes
 * (B §2.7 `ConditionBuilder`; F28).
 *
 * The rules engine publishes its fact paths (`GET /rules/facts`) and checks
 * their types when a rule is published (`modules/rules/src/service/facts.ts`).
 * The builder used to offer those paths raw — `ticket.hasAssignee` — with a
 * free-text box for every value, so an author typed "Open" for a status that
 * is spelled `in_progress` and saved a rule that never matched. This catalogue
 * gives each fact a human label and a typed value editor: a list for the
 * closed vocabularies, a number field, yes/no, and text for the rest.
 *
 * The vocabularies are the API contract's own (`@itsm/contracts` ticket
 * enums); `facts.test.ts` checks them against the schemas, so a status added
 * there fails here rather than silently missing from the list. A fact the
 * engine reports that this file does not know still works — as text, under
 * its path — so a new fact is usable the day it ships.
 */

export type FactKind = 'enum' | 'number' | 'boolean' | 'text' | 'id';

export interface FactOption {
  readonly value: string;
  readonly label: string;
}

export interface Fact {
  /** The engine's path: `ticket.priority`. */
  readonly path: string;
  readonly label: string;
  readonly kind: FactKind;
  /** The closed vocabulary of an `enum` fact. */
  readonly options?: readonly FactOption[];
  /** A word after a number: "minutes", "times". */
  readonly unit?: string;
  /** Where it applies: ticket facts always; comment facts on comment events; a form's answers in its own conditions. */
  readonly group: 'Ticket' | 'Requester' | 'Comment' | 'Event' | 'Answers';
  /**
   * The comparisons to offer, when the kind's own set is wrong for this fact:
   * a form's multi-select question is a list, so "includes" rather than "is".
   */
  readonly operators?: readonly Operator[];
}

const option = (value: string, label: string): FactOption => ({ value, label });

export const TICKET_STATUSES: readonly FactOption[] = [
  option('new', 'New'),
  option('in_progress', 'In progress'),
  option('pending_requester', 'Waiting on requester'),
  option('pending_third_party', 'Waiting on third party'),
  option('pending_approval', 'Waiting for approval'),
  option('resolved', 'Resolved'),
  option('reopened', 'Reopened'),
  option('closed', 'Closed'),
  option('cancelled', 'Cancelled'),
];

export const STATUS_CATEGORIES: readonly FactOption[] = [
  option('open', 'Open'),
  option('paused', 'Paused'),
  option('resolved', 'Resolved'),
  option('closed', 'Closed'),
];

export const TICKET_TYPES: readonly FactOption[] = [
  option('incident', 'Incident'),
  option('request', 'Request'),
  option('problem', 'Problem'),
  option('change', 'Change'),
  option('task', 'Task'),
  option('question', 'Question'),
];

export const PRIORITIES: readonly FactOption[] = [
  option('P1', 'P1 · Critical'),
  option('P2', 'P2 · High'),
  option('P3', 'P3 · Medium'),
  option('P4', 'P4 · Low'),
];

export const LEVELS: readonly FactOption[] = [option('high', 'High'), option('medium', 'Medium'), option('low', 'Low')];

export const CHANNELS: readonly FactOption[] = [
  option('portal', 'Portal'),
  option('email', 'Email'),
  option('api', 'API'),
  option('slack', 'Slack'),
  option('teams', 'Microsoft Teams'),
  option('whatsapp', 'WhatsApp'),
  option('voice', 'Phone'),
  option('mobile', 'Mobile app'),
  option('import', 'Import'),
  option('system', 'System'),
];

export const VISIBILITIES: readonly FactOption[] = [option('public', 'Public reply'), option('internal', 'Internal note')];

export const FACTS: readonly Fact[] = [
  { path: 'ticket.type', label: 'Type', kind: 'enum', options: TICKET_TYPES, group: 'Ticket' },
  { path: 'ticket.title', label: 'Title', kind: 'text', group: 'Ticket' },
  { path: 'ticket.description', label: 'Description', kind: 'text', group: 'Ticket' },
  { path: 'ticket.status', label: 'Status', kind: 'enum', options: TICKET_STATUSES, group: 'Ticket' },
  { path: 'ticket.statusCategory', label: 'Status category', kind: 'enum', options: STATUS_CATEGORIES, group: 'Ticket' },
  { path: 'ticket.priority', label: 'Priority', kind: 'enum', options: PRIORITIES, group: 'Ticket' },
  { path: 'ticket.impact', label: 'Impact', kind: 'enum', options: LEVELS, group: 'Ticket' },
  { path: 'ticket.urgency', label: 'Urgency', kind: 'enum', options: LEVELS, group: 'Ticket' },
  { path: 'ticket.sourceChannel', label: 'Channel', kind: 'enum', options: CHANNELS, group: 'Ticket' },
  { path: 'ticket.orgId', label: 'Organisation', kind: 'id', group: 'Ticket' },
  { path: 'ticket.serviceId', label: 'Service', kind: 'id', group: 'Ticket' },
  { path: 'ticket.categoryId', label: 'Category', kind: 'id', group: 'Ticket' },
  { path: 'ticket.groupId', label: 'Team', kind: 'id', group: 'Ticket' },
  { path: 'ticket.assigneeId', label: 'Assignee', kind: 'id', group: 'Ticket' },
  { path: 'ticket.requesterId', label: 'Requester', kind: 'id', group: 'Ticket' },
  { path: 'ticket.affectedUserId', label: 'Affected person', kind: 'id', group: 'Ticket' },
  { path: 'ticket.reopenCount', label: 'Times reopened', kind: 'number', unit: 'times', group: 'Ticket' },
  { path: 'ticket.hasAssignee', label: 'Has an assignee', kind: 'boolean', group: 'Ticket' },
  { path: 'ticket.hasGroup', label: 'Has a team', kind: 'boolean', group: 'Ticket' },
  { path: 'ticket.ageMinutes', label: 'Age', kind: 'number', unit: 'minutes', group: 'Ticket' },
  { path: 'requester.orgId', label: 'Requester’s organisation', kind: 'id', group: 'Requester' },
  { path: 'requester.locationId', label: 'Requester’s location', kind: 'id', group: 'Requester' },
  { path: 'requester.vip', label: 'Requester is a VIP', kind: 'boolean', group: 'Requester' },
  { path: 'requester.tier', label: 'Requester’s tier', kind: 'text', group: 'Requester' },
  { path: 'comment.visibility', label: 'Comment visibility', kind: 'enum', options: VISIBILITIES, group: 'Comment' },
  { path: 'comment.authorId', label: 'Comment author', kind: 'id', group: 'Comment' },
  { path: 'comment.isFromRequester', label: 'Comment is from the requester', kind: 'boolean', group: 'Comment' },
  { path: 'event.type', label: 'Event', kind: 'text', group: 'Event' },
];

const BY_PATH = new Map(FACTS.map((fact) => [fact.path, fact]));

/**
 * The catalogue entry for a path, or a text fact named by its path — for a
 * fact the engine offers that this catalogue has not caught up with, and for
 * the tenant-defined `fields.*` and `answers.*`.
 */
export function factFor(path: string): Fact {
  const known = BY_PATH.get(path);
  if (known) return known;
  const custom = /^(fields|answers)\.(.+)$/.exec(path);
  return {
    path,
    label: custom ? `${custom[1] === 'fields' ? 'Field' : 'Answer'}: ${custom[2]}` : path,
    kind: 'text',
    group: 'Ticket',
  };
}

/**
 * The facts to offer, in catalogue order: the engine's list when it gave one
 * (so nothing it would refuse on publish is offered), otherwise the catalogue.
 */
export function factsFrom(enginePaths?: readonly string[]): Fact[] {
  if (!enginePaths || enginePaths.length === 0) return [...FACTS];
  const known = FACTS.filter((fact) => enginePaths.includes(fact.path));
  const extra = enginePaths.filter((path) => !BY_PATH.has(path)).map(factFor);
  return [...known, ...extra];
}

const ALL: readonly Operator[] = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains', 'startsWith', 'endsWith', 'exists', 'empty'];

/**
 * The comparisons that make sense for a kind of value, so the builder never
 * offers "Priority is greater than" (a string comparison nobody means) or
 * "Age contains".
 */
export function operatorsFor(fact: Fact): readonly Operator[] {
  if (fact.operators && fact.operators.length > 0) return fact.operators;
  switch (fact.kind) {
    case 'enum':
      return ['eq', 'ne', 'exists', 'empty'];
    case 'boolean':
      return ['eq'];
    case 'number':
      return ['eq', 'ne', 'gt', 'gte', 'lt', 'lte'];
    case 'id':
      return ['eq', 'ne', 'exists', 'empty'];
    case 'text':
      return ALL.filter((operator) => !['gt', 'gte', 'lt', 'lte'].includes(operator));
  }
}

/** The label a value reads as in a sentence: `P1` → "P1 · Critical", `true` → "yes". */
export function valueLabel(fact: Fact, value: string): string {
  if (fact.kind === 'boolean') return value === 'true' ? 'yes' : value === 'false' ? 'no' : value;
  return fact.options?.find((entry) => entry.value === value)?.label ?? value;
}

/** A sensible first value when a fact is chosen: the first option, `true`, or nothing. */
export function defaultValue(fact: Fact): string {
  if (fact.kind === 'enum') return fact.options?.[0]?.value ?? '';
  if (fact.kind === 'boolean') return 'true';
  return '';
}
