import type { CanonicalState, StatusCategory } from '@itsm/contracts';
import { StateTransitionError } from '@itsm/platform';

/**
 * The canonical ticket state machine (specification §5.3, Appendix A).
 *
 * Tenants may configure their own state names, but every configured state maps
 * onto one of these canonical states, which is what lets SLA timers, reporting
 * and channel adapters behave identically whatever a tenant calls its statuses.
 */

export interface StateDefinition {
  state: CanonicalState;
  category: StatusCategory;
  /** States a ticket may move to directly. */
  allowed: CanonicalState[];
  /** What the SLA engine does on entering this state. */
  sla: {
    responseTimer: 'running' | 'stopped' | 'unchanged';
    resolutionTimer: 'running' | 'paused' | 'stopped' | 'cancelled';
    pauseReason?: 'pending_requester' | 'pending_third_party' | 'pending_approval';
  };
  /** Whether a ticket in this state counts as finished for reporting. */
  terminal: boolean;
  description: string;
}

export const STATES: Record<CanonicalState, StateDefinition> = {
  new: {
    state: 'new',
    category: 'open',
    allowed: ['in_progress', 'pending_requester', 'pending_third_party', 'pending_approval', 'resolved', 'cancelled'],
    sla: { responseTimer: 'running', resolutionTimer: 'running' },
    terminal: false,
    description: 'Raised and waiting for a first response.',
  },
  in_progress: {
    state: 'in_progress',
    category: 'open',
    allowed: ['pending_requester', 'pending_third_party', 'pending_approval', 'resolved', 'cancelled'],
    sla: { responseTimer: 'unchanged', resolutionTimer: 'running' },
    terminal: false,
    description: 'Being worked on.',
  },
  pending_requester: {
    state: 'pending_requester',
    category: 'paused',
    allowed: ['in_progress', 'resolved', 'cancelled'],
    sla: { responseTimer: 'unchanged', resolutionTimer: 'paused', pauseReason: 'pending_requester' },
    terminal: false,
    description: 'Waiting for information from the requester.',
  },
  pending_third_party: {
    state: 'pending_third_party',
    category: 'paused',
    allowed: ['in_progress', 'resolved'],
    sla: { responseTimer: 'unchanged', resolutionTimer: 'paused', pauseReason: 'pending_third_party' },
    terminal: false,
    description: 'Waiting for a supplier or another team outside the service desk.',
  },
  pending_approval: {
    state: 'pending_approval',
    category: 'paused',
    allowed: ['in_progress', 'resolved', 'cancelled'],
    sla: { responseTimer: 'unchanged', resolutionTimer: 'paused', pauseReason: 'pending_approval' },
    terminal: false,
    description: 'Waiting for an approval decision.',
  },
  resolved: {
    state: 'resolved',
    category: 'resolved',
    allowed: ['closed', 'reopened'],
    sla: { responseTimer: 'stopped', resolutionTimer: 'stopped' },
    terminal: false,
    description: 'A resolution has been offered; the requester may still reopen.',
  },
  reopened: {
    state: 'reopened',
    category: 'open',
    allowed: ['in_progress', 'pending_requester', 'pending_third_party', 'pending_approval', 'resolved', 'cancelled'],
    sla: { responseTimer: 'unchanged', resolutionTimer: 'running' },
    terminal: false,
    description: 'Reopened after resolution.',
  },
  closed: {
    state: 'closed',
    category: 'closed',
    allowed: [],
    sla: { responseTimer: 'stopped', resolutionTimer: 'stopped' },
    terminal: true,
    description: 'Finished. A new linked ticket is raised instead of reopening.',
  },
  cancelled: {
    state: 'cancelled',
    category: 'closed',
    allowed: [],
    sla: { responseTimer: 'stopped', resolutionTimer: 'cancelled' },
    terminal: true,
    description: 'Withdrawn. Excluded from SLA attainment.',
  },
};

export const CANONICAL_STATES = Object.keys(STATES) as CanonicalState[];

export function categoryOf(state: CanonicalState): StatusCategory {
  return STATES[state].category;
}

export function allowedTransitions(from: CanonicalState): CanonicalState[] {
  return STATES[from].allowed;
}

export function canTransition(from: CanonicalState, to: CanonicalState): boolean {
  return STATES[from].allowed.includes(to);
}

/** Throws unless the transition is allowed. Used by the service before writing. */
export function assertTransition(from: CanonicalState, to: CanonicalState): void {
  if (from === to) throw new StateTransitionError(from, to, allowedTransitions(from));
  if (!canTransition(from, to)) throw new StateTransitionError(from, to, allowedTransitions(from));
}

export interface TransitionEffects {
  statusCategory: StatusCategory;
  resolvedAt: Date | null | 'unchanged';
  closedAt: Date | null | 'unchanged';
  incrementReopenCount: boolean;
  sla: StateDefinition['sla'];
}

/**
 * The side effects of a transition on the ticket record itself. Kept here, in
 * pure code, so the rules are the same whoever drives the transition: an agent,
 * a rule, a workflow, a channel adapter or an auto-close job.
 */
export function effectsOf(from: CanonicalState, to: CanonicalState, at: Date = new Date()): TransitionEffects {
  const definition = STATES[to];
  return {
    statusCategory: definition.category,
    resolvedAt: to === 'resolved' ? at : to === 'reopened' ? null : 'unchanged',
    closedAt: to === 'closed' || to === 'cancelled' ? at : to === 'reopened' ? null : 'unchanged',
    incrementReopenCount: to === 'reopened',
    sla: definition.sla,
  };
}

/** True when the requester (rather than an agent) may make this transition. */
export function isRequesterTransition(from: CanonicalState, to: CanonicalState): boolean {
  if (to === 'reopened') return from === 'resolved';
  if (to === 'resolved') return from !== 'closed' && from !== 'cancelled';
  if (to === 'cancelled') return from === 'new' || from === 'pending_requester';
  return false;
}

/** Terminal states cannot be changed except by an administrator with a reason. */
export function requiresAdministratorOverride(from: CanonicalState): boolean {
  return STATES[from].terminal;
}
