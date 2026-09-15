import { describe, expect, it } from 'vitest';
import { StateTransitionError } from '@itsm/platform';
import {
  CHANGE_KINDS,
  CHANGE_STATES,
  CLOSE_CODES,
  STATES,
  assertTransition,
  canTransition,
  isChangeState,
  onSubmission,
  succeeded,
  type ChangeState,
} from '../domain/lifecycle.js';

/**
 * Change control's characteristic failure is not changes going wrong — it is
 * changes going unrecorded. These tests pin the three trades this module makes
 * between control and coverage, so that tightening one of them is a deliberate
 * act rather than a tidy-up.
 */

describe('how each kind of change is approved', () => {
  it('lets a standard change through on its template’s approval', () => {
    // Asking again for each instance is the cost that makes people stop raising
    // them, and the changes people are most tempted to do unrecorded are the
    // routine ones.
    expect(onSubmission('standard')).toEqual({ to: 'approved', needsApproval: false, owesRetrospective: false });
  });

  it('sends a normal change to be approved before it happens', () => {
    expect(onSubmission('normal')).toEqual({ to: 'submitted', needsApproval: true, owesRetrospective: false });
  });

  it('records an emergency change first and collects the approval afterwards', () => {
    // Refusing to record one until somebody approves it is how emergency
    // changes stop being recorded — and the record is then missing exactly the
    // changes most likely to have caused the next outage.
    expect(onSubmission('emergency')).toEqual({ to: 'scheduled', needsApproval: false, owesRetrospective: true });
  });

  it('has a route for every kind the schema accepts', () => {
    for (const kind of CHANGE_KINDS) expect(onSubmission(kind).to).toBeTruthy();
  });
});

describe('the transitions worth arguing about', () => {
  it('sends a rejected change back to draft rather than making somebody raise a new one', () => {
    // A second record would lose the rejection and the reason for it, which is
    // the only part of a refused change worth keeping.
    expect(canTransition('rejected', 'draft')).toBe(true);
  });

  it('gives a change that has begun no way back', () => {
    // It has either finished or been backed out, and both are `review` with a
    // close code that says which. A route back to `scheduled` would let a
    // half-done change look as though it never started.
    expect(STATES.implementing.allowed).toEqual(['review']);
  });

  it('will not cancel a change that is already happening', () => {
    expect(() => assertTransition('implementing', 'cancelled')).toThrow(StateTransitionError);
  });

  it('lets a scheduled change be unscheduled without losing its approval', () => {
    expect(canTransition('scheduled', 'approved')).toBe(true);
  });

  it('refuses to reopen anything closed or cancelled', () => {
    expect(STATES.closed.allowed).toEqual([]);
    expect(STATES.cancelled.allowed).toEqual([]);
  });

  it('says what was allowed when it refuses', () => {
    expect(() => assertTransition('draft', 'closed')).toThrow(/submitted, cancelled/);
  });
});

describe('the shape of the lifecycle', () => {
  it('reaches every state from draft', () => {
    const reachable = new Set<ChangeState>(['draft']);
    for (let pass = 0; pass < CHANGE_STATES.length; pass += 1) {
      for (const state of [...reachable]) for (const next of STATES[state].allowed) reachable.add(next);
    }
    expect(CHANGE_STATES.filter((state) => !reachable.has(state))).toEqual([]);
  });

  it('names only real states as allowed', () => {
    const declared = new Set<string>(CHANGE_STATES);
    const unknown = CHANGE_STATES.flatMap((state) =>
      STATES[state].allowed.filter((next) => !declared.has(next)).map((next) => `${state} → ${next}`),
    );
    expect(unknown).toEqual([]);
  });

  it('ends only at closed and cancelled', () => {
    expect(CHANGE_STATES.filter((state) => STATES[state].terminal)).toEqual(['closed', 'cancelled']);
  });
});

describe('close codes', () => {
  it('counts only the two successful ones as success', () => {
    // "Successful with issues" is a success: the change went in and stayed in.
    // Folding it into failure would make the success rate a number nobody
    // believes, and a number nobody believes is not reported honestly.
    expect(CLOSE_CODES.filter((code) => succeeded(code))).toEqual(['successful', 'successful_with_issues']);
  });

  it('counts a back-out as a failure of the change, not of the process', () => {
    // Backing out is the process working. It is still not the change having
    // done what it set out to do, and conflating the two hides how often
    // changes have to be undone.
    expect(succeeded('backed_out')).toBe(false);
  });
});

describe('isChangeState', () => {
  it('accepts what the lifecycle declares and nothing else', () => {
    for (const state of CHANGE_STATES) expect(isChangeState(state)).toBe(true);
    expect(isChangeState('known_error')).toBe(false);
  });
});
