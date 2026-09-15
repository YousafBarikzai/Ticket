import { StateTransitionError } from '@itsm/platform';

/**
 * The major incident lifecycle.
 *
 * Deliberately not the ticket state machine. A ticket's states answer "is
 * anybody working on this?"; an incident's answer "what should we be telling
 * people?", which is a different question with different boundaries. The two
 * that matter most are the ones people run together:
 *
 *   - **monitoring** — we believe it is fixed and are watching. The moment the
 *     organisation most wants to hear from you, and the moment it is most
 *     tempting to declare victory and stop talking.
 *   - **resolved** — service restored. Not the same as **closed**, which means
 *     the review is published and the organisation has learned something.
 *
 * Collapsing resolved into closed is how a company has the same outage twice.
 */

export const SEVERITIES = ['SEV1', 'SEV2', 'SEV3'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const INCIDENT_STATES = [
  'declared',
  'identified',
  'mitigating',
  'monitoring',
  'resolved',
  'closed',
  'stood_down',
] as const;
export type IncidentState = (typeof INCIDENT_STATES)[number];

export interface StateDefinition {
  state: IncidentState;
  allowed: IncidentState[];
  /** Whether the organisation is still owed updates on a cadence. */
  communicating: boolean;
  /** Whether the incident is over, for reporting. */
  terminal: boolean;
  description: string;
}

export const STATES: Record<IncidentState, StateDefinition> = {
  declared: {
    state: 'declared',
    allowed: ['identified', 'mitigating', 'monitoring', 'resolved', 'stood_down'],
    communicating: true,
    terminal: false,
    description: 'Something is badly wrong and somebody is in charge of it.',
  },
  identified: {
    state: 'identified',
    allowed: ['mitigating', 'monitoring', 'resolved', 'stood_down'],
    communicating: true,
    terminal: false,
    description: 'We know what is wrong, which is not the same as having fixed it.',
  },
  mitigating: {
    state: 'mitigating',
    allowed: ['identified', 'monitoring', 'resolved', 'stood_down'],
    communicating: true,
    terminal: false,
    // Back to `identified` on purpose: a fix that turns out to address the
    // wrong thing sends you back to the diagnosis, and a lifecycle that only
    // moves forwards makes people lie to it.
    description: 'A fix or a workaround is being applied.',
  },
  monitoring: {
    state: 'monitoring',
    allowed: ['mitigating', 'resolved'],
    communicating: true,
    terminal: false,
    description: 'We believe it is fixed and are watching to see whether it holds.',
  },
  resolved: {
    state: 'resolved',
    // Reopening is `mitigating`, not `declared`: the incident did not start
    // again, it never finished, and its declaration time is what the review and
    // every duration figure are measured from.
    allowed: ['mitigating', 'closed'],
    communicating: false,
    terminal: false,
    description: 'Service is restored. The review is still owed.',
  },
  closed: {
    state: 'closed',
    allowed: [],
    communicating: false,
    terminal: true,
    description: 'Resolved, reviewed, and the review published.',
  },
  stood_down: {
    state: 'stood_down',
    allowed: [],
    communicating: false,
    terminal: true,
    description: 'Declared and then found not to be major after all.',
  },
};

export function isIncidentState(value: string): value is IncidentState {
  return (INCIDENT_STATES as readonly string[]).includes(value);
}

export function canTransition(from: IncidentState, to: IncidentState): boolean {
  return STATES[from].allowed.includes(to);
}

export function assertTransition(from: IncidentState, to: IncidentState): void {
  if (from === to) return;
  if (!canTransition(from, to)) throw new StateTransitionError(from, to, STATES[from].allowed);
}

/**
 * What entering a state does to the incident's timestamps.
 *
 * Each is stamped **once**, at the first time the incident reached that state,
 * because every duration anybody reports is a difference between two of them. A
 * `mitigating → monitoring → mitigating` loop that restamped `mitigatedAt`
 * would quietly shorten the outage in every report that mattered.
 */
export interface StateEffects {
  identifiedAt: 'now' | 'unchanged';
  mitigatedAt: 'now' | 'unchanged';
  resolvedAt: 'now' | 'clear' | 'unchanged';
  closedAt: 'now' | 'unchanged';
}

export function effectsOf(to: IncidentState): StateEffects {
  const none: StateEffects = {
    identifiedAt: 'unchanged',
    mitigatedAt: 'unchanged',
    resolvedAt: 'unchanged',
    closedAt: 'unchanged',
  };
  switch (to) {
    case 'identified':
      return { ...none, identifiedAt: 'now' };
    case 'mitigating':
      // Reopening from resolved clears the resolution: an incident that is
      // being worked on again is not resolved, and leaving the stamp would make
      // it count as met in every report.
      return { ...none, mitigatedAt: 'now', resolvedAt: 'clear' };
    case 'monitoring':
      return none;
    case 'resolved':
      return { ...none, resolvedAt: 'now' };
    case 'closed':
      return { ...none, closedAt: 'now' };
    default:
      return none;
  }
}

/**
 * How often this severity owes the organisation an update, in minutes.
 *
 * Defaults, not rules — a tenant sets its own, and an incident can override its
 * own. They exist so that declaring a SEV1 at 3am does not also require
 * somebody to decide how often to write, which is a decision nobody should be
 * making at 3am.
 */
export const DEFAULT_UPDATE_INTERVAL: Record<Severity, number> = {
  SEV1: 30,
  SEV2: 60,
  SEV3: 240,
};

/** Whether a published review is required before this severity may be closed. */
export const REVIEW_REQUIRED: Record<Severity, boolean> = {
  SEV1: true,
  SEV2: true,
  SEV3: false,
};
