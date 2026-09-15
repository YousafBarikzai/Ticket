import { StateTransitionError } from '@itsm/platform';

/**
 * The change lifecycle, and how each kind of change is approved.
 *
 * Change control has one characteristic failure, and it is not changes going
 * wrong — it is changes going *unrecorded*. Every control that makes recording
 * a change more expensive than not recording one buys a little safety and
 * spends a lot of coverage. A change record with holes in it is worse than no
 * record at all, because it is trusted.
 *
 * The three kinds exist to keep that cost proportionate:
 *
 *   - **standard** — approved in advance as a class, by a published template.
 *     Raising one costs nothing, which is the point: the changes people are
 *     most tempted to do unrecorded are the routine ones.
 *   - **normal** — approved before it happens, through MOD-17.
 *   - **emergency** — recorded first, approved *afterwards*. Refusing to record
 *     one until somebody approves it is how emergency changes stop being
 *     recorded, and the record is then missing exactly the changes most likely
 *     to have caused the next outage.
 */

export const CHANGE_KINDS = ['standard', 'normal', 'emergency'] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];

export const CHANGE_STATES = [
  'draft',
  'submitted',
  'approved',
  'rejected',
  'scheduled',
  'implementing',
  'review',
  'closed',
  'cancelled',
] as const;
export type ChangeState = (typeof CHANGE_STATES)[number];

export const CLOSE_CODES = ['successful', 'successful_with_issues', 'backed_out', 'failed'] as const;
export type CloseCode = (typeof CLOSE_CODES)[number];

export interface StateDefinition {
  state: ChangeState;
  allowed: ChangeState[];
  terminal: boolean;
  description: string;
}

export const STATES: Record<ChangeState, StateDefinition> = {
  draft: {
    state: 'draft',
    allowed: ['submitted', 'cancelled'],
    terminal: false,
    description: 'Being written. Nobody has been asked for anything yet.',
  },
  submitted: {
    state: 'submitted',
    allowed: ['approved', 'rejected', 'cancelled'],
    terminal: false,
    description: 'Waiting on approval.',
  },
  approved: {
    state: 'approved',
    allowed: ['scheduled', 'cancelled'],
    terminal: false,
    description: 'Approved, not yet booked into a window.',
  },
  rejected: {
    state: 'rejected',
    // Back to draft, so a rejected change is revised rather than raised again:
    // the second record would lose the rejection and the reason for it.
    allowed: ['draft', 'cancelled'],
    terminal: false,
    description: 'Refused. The reason is on the approval, not lost.',
  },
  scheduled: {
    state: 'scheduled',
    allowed: ['implementing', 'approved', 'cancelled'],
    terminal: false,
    description: 'Booked into a window that is not in a blackout.',
  },
  implementing: {
    state: 'implementing',
    // No route back. A change that has begun has either finished or been
    // backed out, and both are `review` with a close code that says which.
    allowed: ['review'],
    terminal: false,
    description: 'Happening now.',
  },
  review: {
    state: 'review',
    allowed: ['closed'],
    terminal: false,
    description: 'Done, and being looked at before the record is closed.',
  },
  closed: { state: 'closed', allowed: [], terminal: true, description: 'Finished, with a close code.' },
  cancelled: { state: 'cancelled', allowed: [], terminal: true, description: 'Abandoned before it happened.' },
};

export function isChangeState(value: string): value is ChangeState {
  return (CHANGE_STATES as readonly string[]).includes(value);
}

export function canTransition(from: ChangeState, to: ChangeState): boolean {
  return STATES[from].allowed.includes(to);
}

export function assertTransition(from: ChangeState, to: ChangeState): void {
  if (from === to) return;
  if (!canTransition(from, to)) throw new StateTransitionError(from, to, STATES[from].allowed);
}

/**
 * Where a change of this kind goes when it is submitted.
 *
 * An emergency change skips straight to `scheduled` — it is happening, and the
 * platform's job is to have a record of it, not to pretend it has a say. It
 * owes a retrospective approval, which is a debt the record carries and
 * reporting can count.
 */
export function onSubmission(kind: ChangeKind): { to: ChangeState; needsApproval: boolean; owesRetrospective: boolean } {
  switch (kind) {
    case 'standard':
      // The template carried the approval. Asking again for each instance is
      // the cost that makes people stop raising them.
      return { to: 'approved', needsApproval: false, owesRetrospective: false };
    case 'emergency':
      return { to: 'scheduled', needsApproval: false, owesRetrospective: true };
    case 'normal':
      return { to: 'submitted', needsApproval: true, owesRetrospective: false };
  }
}

/** Whether a close code means the change did what it set out to do. */
export function succeeded(closeCode: CloseCode): boolean {
  return closeCode === 'successful' || closeCode === 'successful_with_issues';
}
