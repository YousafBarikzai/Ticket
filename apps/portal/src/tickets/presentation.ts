import type { IconName, IntentName, Tone } from '@itsm/ui';

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
 * urgency; that is what they get told back. Nothing in this file reads a
 * ticket's priority or impact, and nothing that renders a request should.
 *
 * **One thing is actionable.** `needsYou` is the state that stops until the
 * requester answers; `nextAction` adds the resolved ticket that is waiting for
 * "Yes, it's fixed". Those rows are pinned first with their action. Everything
 * else is information.
 */

export interface RequesterState {
  readonly label: string;
  readonly detail: string;
  /** The legacy `Badge` intent, for pages that still draw one. */
  readonly intent: IntentName;
  /**
   * The `StatusPill` tone: the design system's `TICKET_STATE_LOOK[state].tone`
   * (D5, v3 §2.4), so a request reads in the same colour here as in the
   * Service Desk — waiting is `hold`, never the amber that means an SLA at
   * risk. Spelt here rather than imported: this module is in every route's
   * first load (the palette reads it), and `presentation.test.ts` holds each
   * tone equal to the map's.
   */
  readonly tone: Tone;
  /** The pill's glyph, so the state reads without its colour (SC 1.4.1). */
  readonly icon: IconName;
  /** Whether the ticket is waiting on the requester rather than on the desk. */
  readonly needsYou: boolean;
}

const STATES: Record<string, RequesterState> = {
  new: {
    label: 'Received',
    detail: 'We have it. Somebody will pick it up shortly.',
    intent: 'neutral',
    tone: 'neutral',
    icon: 'inbox',
    needsYou: false,
  },
  in_progress: {
    label: 'Being worked on',
    detail: 'Somebody is on it now.',
    intent: 'info',
    tone: 'info',
    icon: 'clock',
    needsYou: false,
  },
  pending_requester: {
    label: 'Waiting for you',
    detail: 'We have asked you something. Nothing moves until you reply.',
    intent: 'hold',
    tone: 'hold',
    icon: 'reply',
    needsYou: true,
  },
  pending_third_party: {
    label: 'Waiting on a supplier',
    detail: 'We are waiting on somebody outside the service desk.',
    intent: 'hold',
    tone: 'hold',
    icon: 'hourglass',
    needsYou: false,
  },
  pending_approval: {
    label: 'Waiting for approval',
    detail: 'Somebody has to approve this before it can start.',
    intent: 'hold',
    tone: 'hold',
    icon: 'approvals',
    needsYou: false,
  },
  resolved: {
    label: 'Resolved',
    detail: 'We think this is sorted. Tell us if it is not.',
    intent: 'success',
    tone: 'success',
    icon: 'circle-check',
    needsYou: false,
  },
  reopened: {
    label: 'Reopened',
    detail: 'You told us it was not sorted, so it is back with us.',
    intent: 'info',
    tone: 'info',
    icon: 'refresh-cw',
    needsYou: false,
  },
  closed: {
    label: 'Closed',
    detail: 'Finished. Raise a new request if it happens again.',
    intent: 'neutral',
    tone: 'neutral',
    icon: 'archive',
    needsYou: false,
  },
  cancelled: {
    label: 'Cancelled',
    detail: 'This was withdrawn.',
    intent: 'neutral',
    tone: 'neutral',
    icon: 'ban',
    needsYou: false,
  },
};

const UNKNOWN: RequesterState = {
  label: 'Open',
  detail: 'This is with the service desk.',
  intent: 'neutral',
  tone: 'neutral',
  icon: 'dot',
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

/* ------------------------------------------------------------ Next action */

export type NextActionKind = 'reply' | 'confirm' | 'none';

export interface NextAction {
  readonly kind: NextActionKind;
  /** The chip's words; null for a finished request, where there is nothing left to say. */
  readonly label: string | null;
  readonly tone: Tone;
  /** The requester is the one who moves it: pinned first, with its inline action. */
  readonly yours: boolean;
}

const REPLY: NextAction = { kind: 'reply', label: 'Reply needed', tone: 'hold', yours: true };
const CONFIRM: NextAction = { kind: 'confirm', label: 'Confirm it’s fixed', tone: 'success', yours: true };
const NOTHING: NextAction = { kind: 'none', label: 'No action needed', tone: 'neutral', yours: false };
const FINISHED: NextAction = { kind: 'none', label: null, tone: 'neutral', yours: false };

/**
 * What the requester has to do next, in two words — the chip on every
 * request row (SPEC §6.3).
 *
 * Two states are theirs: a question from the desk (*Reply needed*) and a fix
 * waiting for their word (*Confirm it's fixed* — "Yes, it's fixed" closes it,
 * "No, still broken" reopens it). Everything open that is not theirs says so
 * plainly — "No action needed", never "Nothing to do. We'll update you" —
 * including a request waiting for somebody else's approval, whose pill already
 * says as much. A closed or withdrawn request carries no chip at all.
 */
export function nextAction(status: string): NextAction {
  switch (status) {
    case 'pending_requester':
      return REPLY;
    case 'resolved':
      return CONFIRM;
    case 'closed':
    case 'cancelled':
      return FINISHED;
    default:
      return NOTHING;
  }
}

/**
 * The rows that are the requester's to move come first, in the order they
 * were given; the rest keep theirs. Stable, so a list sorted by "last
 * updated" stays sorted within each half.
 */
export function yoursFirst<T extends { readonly status: string }>(tickets: readonly T[]): T[] {
  const yours = tickets.filter((ticket) => nextAction(ticket.status).yours);
  const rest = tickets.filter((ticket) => !nextAction(ticket.status).yours);
  return [...yours, ...rest];
}

/* --------------------------------------------------------------- Progress */

/** The four steps a request moves through, as the request page's stepper draws them. */
export const PROGRESS_STEPS = ['Received', 'Being worked on', 'Resolved', 'Closed'] as const;

export interface Progress {
  /** Index into `PROGRESS_STEPS` of the current step. */
  readonly current: number;
  /** The current step's own words when they say more than the step's name: "Waiting for you". */
  readonly currentLabel: string;
}

/**
 * Where a request has got to, for the four-dot stepper in the request's hero
 * card. A pause is still "being worked on" — the step's label says who it is
 * waiting for — and a withdrawn request ends at the last step, named for what
 * happened.
 */
export function progressOf(status: string): Progress {
  switch (status) {
    case 'new':
      return { current: 0, currentLabel: 'Received' };
    case 'pending_requester':
    case 'pending_approval':
    case 'pending_third_party':
      return { current: 1, currentLabel: requesterState(status).label };
    case 'resolved':
      return { current: 2, currentLabel: 'Resolved' };
    case 'closed':
      return { current: 3, currentLabel: 'Closed' };
    case 'cancelled':
      return { current: 3, currentLabel: 'Cancelled' };
    default:
      return { current: 1, currentLabel: 'Being worked on' };
  }
}

/* ------------------------------------------------------------------ Words */

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
