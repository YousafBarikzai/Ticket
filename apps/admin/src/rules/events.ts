import type { IconName } from '@itsm/ui';

/**
 * The events a rule can react to, in words (SPEC §6.1 *When*; F28).
 *
 * The engine names them `ticket.comment.added`; an author thinks "someone
 * comments". Each event has the label the builder's *When* cards show, the
 * sentence the list's group headers read ("When a ticket is created"), and an
 * icon. The API's list (`GET /rules/facts`) is authoritative for which events
 * exist: an event it adds that this file has not caught up with still works,
 * under its own name, so it is usable the day it ships.
 *
 * Two of the six are accepted by the API but nothing evaluates rules for them
 * yet — the rules module only consumes the four ticket events — so a rule on
 * them would be saved and published and never run. They are offered last,
 * saying so (`runs: false`), rather than hidden: a pack may already use them.
 */

export interface RuleEventInfo {
  /** The engine's name: `ticket.created`. */
  readonly value: string;
  /** The *When* card: "A ticket is created". */
  readonly label: string;
  /** The list's group header: "When a ticket is created". */
  readonly heading: string;
  /** One line under the card. */
  readonly description: string;
  readonly icon: IconName;
  /** False when the engine accepts rules for it but does not evaluate them yet. */
  readonly runs: boolean;
}

export const RULE_EVENTS: readonly RuleEventInfo[] = [
  {
    value: 'ticket.created',
    label: 'A ticket is created',
    heading: 'When a ticket is created',
    description: 'From any channel: portal, email, the workbench or the API.',
    icon: 'ticket',
    runs: true,
  },
  {
    value: 'ticket.updated',
    label: 'A ticket is updated',
    heading: 'When a ticket is updated',
    description: 'Any change by a person. Changes made by rules don’t count, so a rule never triggers itself.',
    icon: 'pencil',
    runs: true,
  },
  {
    value: 'ticket.comment.added',
    label: 'Someone comments',
    heading: 'When someone comments',
    description: 'A reply or an internal note, from the requester or the desk.',
    icon: 'message-square',
    runs: true,
  },
  {
    value: 'ticket.status.changed',
    label: 'The status changes',
    heading: 'When the status changes',
    description: 'A ticket moves to another status, by a person.',
    icon: 'flag',
    runs: true,
  },
  {
    value: 'request.submitted',
    label: 'A request is submitted',
    heading: 'When a request is submitted',
    description: 'Rules for this event don’t run yet. Use a workflow for requests.',
    icon: 'catalogue',
    runs: false,
  },
  {
    value: 'schedule.tick',
    label: 'Every few minutes',
    heading: 'Every few minutes',
    description: 'Rules on a schedule don’t run yet.',
    icon: 'clock',
    runs: false,
  },
];

const BY_VALUE = new Map(RULE_EVENTS.map((event) => [event.value, event]));

/** The words for an event, or its own name for one this file does not know yet. */
export function eventInfo(value: string): RuleEventInfo {
  const known = BY_VALUE.get(value);
  if (known) return known;
  return { value, label: value, heading: `When ${value}`, description: 'An event this console has no words for yet.', icon: 'automation', runs: true };
}

/**
 * The events to offer, in this file's order: the engine's list when it gave
 * one (so nothing it would refuse is offered), otherwise all of them. Events
 * that do not run yet go last.
 */
export function eventsFrom(engineEvents?: readonly string[]): RuleEventInfo[] {
  const known = !engineEvents || engineEvents.length === 0 ? [...RULE_EVENTS] : RULE_EVENTS.filter((event) => engineEvents.includes(event.value));
  const extra = (engineEvents ?? []).filter((value) => !BY_VALUE.has(value)).map(eventInfo);
  const all = [...known, ...extra];
  return [...all.filter((event) => event.runs), ...all.filter((event) => !event.runs)];
}

/**
 * Whether a fact is there to read on this event. Comment facts are filled in
 * only for comments; on any other event they are empty, so a condition on
 * them would never match.
 */
export function factAppliesTo(path: string, event: string): boolean {
  if (path.startsWith('comment.')) return event === 'ticket.comment.added';
  return true;
}
