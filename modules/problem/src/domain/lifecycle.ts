import { StateTransitionError } from '@itsm/platform';

/**
 * The problem lifecycle.
 *
 * Built around the workaround rather than around the root cause, which is the
 * one design decision in this module worth arguing about.
 *
 * Most problem-management implementations put `known_error` downstream of root
 * cause analysis: investigate, find the cause, then publish what to do about
 * it. That ordering delays the only output anybody outside the team benefits
 * from. The workaround is usually known within hours — "restart the service",
 * "use the old form" — and the cause within weeks, if ever. Making the useful
 * thing wait for the interesting thing is why problem backlogs fill up with
 * problems nobody ever hears about again.
 *
 * So `investigating → known_error` requires a workaround and nothing else, and
 * a root cause is something a problem may acquire at any point, including
 * never.
 */

export const PROBLEM_STATES = ['investigating', 'known_error', 'resolved', 'closed'] as const;
export type ProblemState = (typeof PROBLEM_STATES)[number];

export interface StateDefinition {
  state: ProblemState;
  allowed: ProblemState[];
  /** Whether a published workaround should be visible to agents in this state. */
  workaroundLive: boolean;
  terminal: boolean;
  description: string;
}

export const STATES: Record<ProblemState, StateDefinition> = {
  investigating: {
    state: 'investigating',
    // Straight to resolved is allowed: sometimes the fix is quicker than the
    // workaround, and a lifecycle that forbade it would make people publish a
    // workaround they had no intention of anybody using.
    allowed: ['known_error', 'resolved', 'closed'],
    workaroundLive: false,
    terminal: false,
    description: 'Known to exist, being looked into. No workaround yet.',
  },
  known_error: {
    state: 'known_error',
    allowed: ['investigating', 'resolved', 'closed'],
    workaroundLive: true,
    terminal: false,
    description: 'There is a workaround, published. The cause may still be unknown.',
  },
  resolved: {
    state: 'resolved',
    // Reopening is to `investigating`, not to `known_error`: if it came back,
    // the previous workaround is not known to work on whatever it is now.
    allowed: ['investigating', 'closed'],
    workaroundLive: false,
    terminal: false,
    description: 'Permanently fixed. Any workaround is now obsolete.',
  },
  closed: {
    state: 'closed',
    allowed: [],
    workaroundLive: false,
    terminal: true,
    description: 'Finished with, whether it was fixed, superseded or abandoned.',
  },
};

export function isProblemState(value: string): value is ProblemState {
  return (PROBLEM_STATES as readonly string[]).includes(value);
}

export function canTransition(from: ProblemState, to: ProblemState): boolean {
  return STATES[from].allowed.includes(to);
}

export function assertTransition(from: ProblemState, to: ProblemState): void {
  if (from === to) return;
  if (!canTransition(from, to)) throw new StateTransitionError(from, to, STATES[from].allowed);
}

/**
 * Whether entering this state makes a published workaround obsolete.
 *
 * The trap this exists for: a problem is fixed, nobody retires the known error,
 * and agents go on applying a workaround for a bug that no longer exists. They
 * lose the time twice — once following it, once working out why it did not
 * help — and the known-error list becomes something experienced agents learn to
 * ignore, which costs far more than the individual instances.
 */
export function retiresWorkaround(to: ProblemState): boolean {
  return to === 'resolved' || to === 'closed';
}

/**
 * How many tickets, over how long, before a recurrence is worth suggesting.
 *
 * Suggested, never created. A platform that raised problems by itself would
 * produce a backlog of noise that buries the three somebody actually cares
 * about, and the cost of a wrong suggestion is a glance where the cost of a
 * wrong problem is a permanent list entry nobody dares delete.
 */
export const RECURRENCE_THRESHOLD = { tickets: 5, withinDays: 30 } as const;
