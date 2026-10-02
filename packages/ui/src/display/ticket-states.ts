import type { CanonicalState, Priority, StatusCategory, TicketType } from '@itsm/contracts';
import type { ChartTone } from '../charts/types.js';
import type { IconName, Tone } from '../types.js';

/**
 * How every state in the product looks: ticket states and status categories,
 * SLA states, approvals, priorities, ticket types, status-page components,
 * problems and major incidents (D5, v3 §2.4).
 *
 * One module, so that "Waiting on requester" is the same fuchsia pause in the
 * inbox, the board, the Help Portal and the admin register, and so that the
 * palette's one hard rule can be tested in one place: **amber means an SLA at
 * risk or due soon, and nothing else.** No ticket state, type, component state
 * or problem state maps to `warning`, and no data state maps to `accent` — the
 * blue is for controls. Waiting is `hold`, a P2 is `high`, an open ticket is
 * `info` (indigo, never the control blue).
 *
 * Every look has a label and an icon (or, for a priority, bars), so a state
 * never rests on its colour alone (SC 1.4.1). A look spreads straight into the
 * pill: `<StatusPill {...ticketStateLook(status, category)} />`.
 *
 * Server-safe and client-safe: plain frozen data and pure functions. The only
 * import from `@itsm/contracts` is `import type`, which the compiler erases,
 * so a client list that colours its rows from here does not download the API
 * contract and its zod schemas with them (Y-B2). Keys that live in modules the
 * design system may not import — status-page components and problems — are
 * spelled here and pinned to their sources by `ticket-states.test.ts`.
 */

/** A state as the eye and the ear meet it: colour, shape and words. */
export interface StateLook {
  readonly tone: Tone;
  readonly icon: IconName;
  readonly label: string;
  /** `solid` only for the one state on a screen that must be seen first: a major incident, a service that is down. */
  readonly emphasis?: 'subtle' | 'solid';
}

function look(tone: Tone, icon: IconName, label: string, emphasis?: 'solid'): StateLook {
  return Object.freeze(emphasis ? { tone, icon, label, emphasis } : { tone, icon, label });
}

/** An own key of `map`: data from the API is a string, and `'toString' in map` is true. */
function own<K extends string, V>(map: Readonly<Record<K, V>>, key: string | null | undefined): V | undefined {
  return typeof key === 'string' && Object.prototype.hasOwnProperty.call(map, key) ? map[key as K] : undefined;
}

/**
 * A configuration key as words: "awaiting_parts" → "Awaiting parts". Only the
 * first letter is raised and nothing is lowered, so a tenant's "VIP_review"
 * keeps its capitals.
 */
function humanise(key: string): string {
  const words = key.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return words === '' ? key : words.charAt(0).toUpperCase() + words.slice(1);
}

/* ------------------------------------------------------------- Ticket states */

/** The canonical ticket states (`@itsm/contracts` `canonicalStateSchema`). */
export type TicketStateKey = CanonicalState;

/**
 * The canonical states. New is a dashed circle, the one state not yet looked
 * at; Reopened is indigo with its arrows, never amber, because a reopened
 * ticket is work, not a breach.
 */
export const TICKET_STATE_LOOK: Readonly<Record<TicketStateKey, StateLook>> = Object.freeze({
  new: look('neutral', 'circle-dashed', 'New'),
  in_progress: look('info', 'clock', 'In progress'),
  pending_requester: look('hold', 'pause', 'Waiting on requester'),
  pending_third_party: look('hold', 'pause', 'Waiting on third party'),
  pending_approval: look('hold', 'hourglass', 'Awaiting approval'),
  reopened: look('info', 'refresh-cw', 'Reopened'),
  resolved: look('success', 'circle-check', 'Resolved'),
  closed: look('neutral', 'archive', 'Closed'),
  cancelled: look('neutral', 'ban', 'Cancelled'),
});

/** The four status categories every tenant-configured status belongs to. */
export type StatusCategoryKey = StatusCategory;

/** A tenant's own status by its category; the label is the status's own key, humanised, at the call. */
export const STATUS_CATEGORY_LOOK: Readonly<Record<StatusCategoryKey, StateLook>> = Object.freeze({
  open: look('info', 'circle-dot', 'Open'),
  paused: look('hold', 'pause', 'Paused'),
  resolved: look('success', 'circle-check', 'Resolved'),
  closed: look('neutral', 'archive', 'Closed'),
});

/** What a status nobody has described looks like: plain, with its own words. */
const UNKNOWN_TONE: Tone = 'neutral';
const UNKNOWN_ICON: IconName = 'dot';

/**
 * The look for a ticket's status. A canonical state has its own look. A
 * tenant's own status ("awaiting_parts") takes its category's tone and icon
 * with its own name humanised ("Awaiting parts"), so a custom status still
 * reads as waiting, open or done. A status with neither is plain neutral, in
 * its own words — never a guess at a colour.
 */
export function ticketStateLook(status: string, category?: string | null): StateLook {
  const known = own(TICKET_STATE_LOOK, status);
  if (known) return known;
  const byCategory = own(STATUS_CATEGORY_LOOK, category);
  if (byCategory) return look(byCategory.tone, byCategory.icon, humanise(status));
  return look(UNKNOWN_TONE, UNKNOWN_ICON, humanise(status));
}

/* ---------------------------------------------------------------- SLA states */

export type SlaStateKey = 'on_track' | 'due_soon' | 'breached' | 'paused' | 'met' | 'none';

/**
 * An SLA clock's state. `due_soon` is the only `warning` look among all the
 * maps: amber is reserved for it. Its label is the fallback; a caller that
 * knows the time says it ("Due in 43 min") and keeps the tone and icon.
 */
export const SLA_STATE_LOOK: Readonly<Record<SlaStateKey, StateLook>> = Object.freeze({
  on_track: look('success', 'circle-check', 'On track'),
  due_soon: look('warning', 'clock', 'Due soon'),
  breached: look('danger', 'circle-alert', 'Breached'),
  paused: look('hold', 'pause', 'SLA paused'),
  met: look('success', 'circle-check', 'Met'),
  none: look('neutral', 'dot', '—'),
});

/* ----------------------------------------------------------------- Approvals */

export type ApprovalStateKey = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'expired';

/** An approval request's state. Pending is `hold`, like every other wait. */
export const APPROVAL_STATE_LOOK: Readonly<Record<ApprovalStateKey, StateLook>> = Object.freeze({
  pending: look('hold', 'hourglass', 'Awaiting decision'),
  approved: look('success', 'circle-check', 'Approved'),
  rejected: look('danger', 'circle-x', 'Rejected'),
  cancelled: look('neutral', 'ban', 'Cancelled'),
  expired: look('neutral', 'clock', 'Expired'),
});

const WITHDRAWN = look('neutral', 'ban', 'Withdrawn');

/**
 * The look for an approval request. A cancelled request whose `outcome` is
 * `withdrawn` — the ticket it waited on was cancelled or closed — says
 * "Withdrawn": nobody turned it down, so it must not read as if somebody did.
 */
export function approvalStateLook(status: string, outcome?: string | null): StateLook {
  if (status === 'cancelled' && outcome === 'withdrawn') return WITHDRAWN;
  return own(APPROVAL_STATE_LOOK, status) ?? look(UNKNOWN_TONE, UNKNOWN_ICON, humanise(status));
}

/* ---------------------------------------------------------------- Priorities */

/** The four priorities (`@itsm/contracts` `prioritySchema`). */
export type PriorityKey = Priority;

/**
 * A priority's look. Priorities are drawn as signal bars, not icons: three for
 * P1 and P2, two for P3, one for P4. P1 and P2 both fill three bars, as on the
 * benchmark board; their tint and their label ("P1", "P2") tell them apart, so
 * colour is never the only cue. P4 is `quiet`: neutral with muted text.
 */
export interface PriorityLook {
  readonly tone: 'danger' | 'high' | 'neutral';
  readonly bars: 1 | 2 | 3;
  readonly quiet: boolean;
  readonly label: PriorityKey;
  readonly words: 'Critical' | 'High' | 'Medium' | 'Low';
  /** The paint for this priority's segment in a chart (`chartToneVar`). */
  readonly chartTone: ChartTone;
}

function priority(label: PriorityKey, tone: PriorityLook['tone'], bars: PriorityLook['bars'], words: PriorityLook['words'], chartTone: ChartTone, quiet = false): PriorityLook {
  return Object.freeze({ tone, bars, quiet, label, words, chartTone });
}

export const PRIORITY_LOOK: Readonly<Record<PriorityKey, PriorityLook>> = Object.freeze({
  P1: priority('P1', 'danger', 3, 'Critical', 'danger'),
  P2: priority('P2', 'high', 3, 'High', 'high'),
  P3: priority('P3', 'neutral', 2, 'Medium', 'neutral'),
  P4: priority('P4', 'neutral', 1, 'Low', 'neutralSoft', true),
});

/** The look for a priority that arrived as data; `undefined` for anything but P1–P4. */
export function priorityLook(value: string | null | undefined): PriorityLook | undefined {
  return own(PRIORITY_LOOK, value);
}

/* -------------------------------------------------------------- Ticket types */

/** The ticket types (`@itsm/contracts` `ticketTypeSchema`). */
export type TicketTypeKey = TicketType;

/**
 * A ticket's type. Always `neutral` — a sunken tile with a secondary glyph
 * (`IconTile tone="neutral"`) — because a type is a kind, not a state: tinting
 * incidents red would put a second "danger" on every row beside the SLA chip
 * that actually means it (X-B3).
 */
export const TYPE_LOOK: Readonly<Record<TicketTypeKey, StateLook>> = Object.freeze({
  incident: look('neutral', 'circle-alert', 'Incident'),
  request: look('neutral', 'package', 'Request'),
  question: look('neutral', 'message-circle', 'Question'),
  problem: look('neutral', 'bug', 'Problem'),
  change: look('neutral', 'git-compare', 'Change'),
  task: look('neutral', 'square-check', 'Task'),
});

/** The look for a ticket type that arrived as data; an unknown type keeps its own words and the ticket glyph. */
export function ticketTypeLook(type: string): StateLook {
  return own(TYPE_LOOK, type) ?? look('neutral', 'ticket', humanise(type));
}

/* ------------------------------------------------------ Status-page components */

/** `COMPONENT_STATUSES` in `modules/statuspage/src/domain/status.ts`. */
export type ComponentStateKey = 'operational' | 'degraded' | 'partial_outage' | 'major_outage' | 'maintenance';

/**
 * A service component's state, the one map the status page, the Help Portal's
 * status strip and the admin register all read (X-B3). Degraded is `high`
 * orange — not amber, which is SLA risk — and a full outage is solid red.
 */
export const COMPONENT_STATE_LOOK: Readonly<Record<ComponentStateKey, StateLook>> = Object.freeze({
  operational: look('success', 'circle-check', 'Running'),
  degraded: look('high', 'triangle-alert', 'Degraded'),
  partial_outage: look('danger', 'circle-alert', 'Partly down'),
  major_outage: look('danger', 'circle-x', 'Down', 'solid'),
  maintenance: look('info', 'wrench', 'Maintenance'),
});

/* ------------------------------------------------------------------ Problems */

/** `PROBLEM_STATES` in `modules/problem/src/domain/lifecycle.ts`. */
export type ProblemStateKey = 'investigating' | 'known_error' | 'resolved' | 'closed';

/**
 * A problem's state. A known error is `info`, not a warning: it is the good
 * news of problem management — a workaround people can use — and its label
 * says so.
 */
export const PROBLEM_STATE_LOOK: Readonly<Record<ProblemStateKey, StateLook>> = Object.freeze({
  investigating: look('info', 'search', 'Investigating'),
  known_error: look('info', 'book-open', 'Known error · workaround'),
  resolved: look('success', 'circle-check', 'Resolved'),
  closed: look('neutral', 'archive', 'Closed'),
});

/* ------------------------------------------------------------ Major incident */

/** A live major incident: the one solid danger pill a page may carry. */
export const MAJOR_INCIDENT_LOOK: StateLook = look('danger', 'circle-alert', 'Major incident', 'solid');
