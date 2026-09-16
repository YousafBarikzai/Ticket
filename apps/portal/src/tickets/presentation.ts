import type { IntentName } from '@itsm/ui';

/**
 * What a ticket's state means **to the person who raised it**.
 *
 * This file exists because the workbench has one of these too and the two
 * disagree on purpose. `pending_requester` reads to an agent as "waiting on
 * requester" — a queue they can ignore. To the requester it is the single most
 * important thing on the screen: *you* have to do something, or this stops.
 * Rendering the agent's vocabulary in the portal is how a ticket sits for two
 * weeks while both sides believe the other one has it.
 *
 * Three rules:
 *
 * **Say who is holding it.** Every label names a party. "In progress" tells
 * somebody nothing; "We're working on it" and "We need something from you"
 * are different sentences with different consequences.
 *
 * **Never show the priority.** P1..P4 is an internal scheduling decision made
 * from impact and urgency. Showing it invites an argument about it, and the
 * argument is with somebody who cannot change it. The requester chose the
 * urgency; that is what they get told back.
 *
 * **One thing is actionable.** `needsYou` is what the home page counts and
 * what a row is highlighted for. Everything else is information.
 */

export interface RequesterState {
  readonly label: string;
  readonly detail: string;
  readonly intent: IntentName;
  /** Whether the ticket is waiting on the requester rather than on the desk. */
  readonly needsYou: boolean;
}

const STATES: Record<string, RequesterState> = {
  new: {
    label: 'Received',
    detail: 'We have it. Somebody will pick it up shortly.',
    intent: 'info',
    needsYou: false,
  },
  in_progress: {
    label: 'Being worked on',
    detail: 'Somebody is on it now.',
    intent: 'info',
    needsYou: false,
  },
  pending_requester: {
    label: 'Waiting for you',
    detail: 'We have asked you something. Nothing moves until you reply.',
    intent: 'warning',
    needsYou: true,
  },
  pending_third_party: {
    label: 'Waiting on a supplier',
    detail: 'We are waiting on somebody outside the service desk.',
    intent: 'neutral',
    needsYou: false,
  },
  pending_approval: {
    label: 'Waiting for approval',
    detail: 'Somebody has to approve this before it can start.',
    intent: 'neutral',
    needsYou: false,
  },
  resolved: {
    label: 'Resolved',
    detail: 'We think this is sorted. Tell us if it is not.',
    intent: 'success',
    needsYou: false,
  },
  reopened: {
    label: 'Reopened',
    detail: 'You told us it was not sorted, so it is back with us.',
    intent: 'info',
    needsYou: false,
  },
  closed: {
    label: 'Closed',
    detail: 'Finished. Raise a new request if it happens again.',
    intent: 'neutral',
    needsYou: false,
  },
  cancelled: {
    label: 'Cancelled',
    detail: 'This was withdrawn.',
    intent: 'neutral',
    needsYou: false,
  },
};

const UNKNOWN: RequesterState = {
  label: 'Open',
  detail: 'This is with the service desk.',
  intent: 'neutral',
  needsYou: false,
};

/**
 * A tenant may rename its statuses, and MOD-04 maps each onto a canonical one.
 * A state this table has never seen reads as "open" rather than as its raw
 * value: showing `awaiting_parts_l3` to a requester is worse than saying less.
 */
export function requesterState(status: string): RequesterState {
  return STATES[status] ?? UNKNOWN;
}

export function needsYou(status: string): boolean {
  return requesterState(status).needsYou;
}

const TYPE_LABEL: Record<string, string> = {
  incident: 'Issue',
  request: 'Request',
  question: 'Question',
};

/** "Incident" is a word the service desk uses about itself. */
export function typeLabel(type: string): string {
  return TYPE_LABEL[type] ?? 'Ticket';
}

/**
 * "2 days ago", in words. The absolute instant stays in `datetime` and
 * `title`, so a person who needs the exact moment can still get it.
 */
export function raisedAgo(createdAt: string, now: number = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - new Date(createdAt).getTime()) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 31) return `${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.floor(days / 30);
  return `${months} month${months === 1 ? '' : 's'} ago`;
}

/** The urgency a person picks when reporting, in their words rather than the matrix's. */
export const URGENCY_CHOICES = [
  { value: 'low', label: 'I can work around it', description: 'Annoying, but nothing is stopped.' },
  { value: 'medium', label: 'It is slowing me down', description: 'I can work, but not properly.' },
  { value: 'high', label: 'I cannot work', description: 'I am stopped until this is fixed.' },
] as const;
