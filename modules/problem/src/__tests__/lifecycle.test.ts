import { describe, expect, it } from 'vitest';
import { StateTransitionError } from '@itsm/platform';
import {
  PROBLEM_STATES,
  RECURRENCE_THRESHOLD,
  STATES,
  assertTransition,
  canTransition,
  isProblemState,
  retiresWorkaround,
  type ProblemState,
} from '../domain/lifecycle.js';

/**
 * The lifecycle carries this module's one real argument: that `known_error`
 * sits before root-cause analysis rather than after it. These tests are where
 * that argument is written down in a form that fails if somebody reverses it.
 */

describe('the workaround comes first', () => {
  it('lets a problem become a known error straight from investigating', () => {
    // Most implementations put `known_error` downstream of finding the cause.
    // The workaround is usually known within hours and the cause within weeks,
    // if ever, so that ordering makes the useful thing wait for the
    // interesting one — which is why problem backlogs fill with problems
    // nobody ever hears about again.
    expect(canTransition('investigating', 'known_error')).toBe(true);
  });

  it('shows the workaround to agents only while it is a known error', () => {
    const live = PROBLEM_STATES.filter((state) => STATES[state].workaroundLive);
    expect(live).toEqual(['known_error']);
  });

  it('lets a problem be fixed without ever publishing one', () => {
    // Sometimes the fix is quicker than the workaround. A lifecycle that
    // forbade this would make people publish a workaround they had no
    // intention of anybody using.
    expect(canTransition('investigating', 'resolved')).toBe(true);
  });
});

describe('what makes a workaround obsolete', () => {
  it('retires it on resolution and on closure, and at no other time', () => {
    // The trap: a problem is fixed, nobody retires the known error, and agents
    // go on applying a workaround for a bug that no longer exists — losing the
    // time twice, once following it and once working out why it did not help.
    const retiring = PROBLEM_STATES.filter((state) => retiresWorkaround(state));
    expect(retiring).toEqual(['resolved', 'closed']);
  });

  it('sends a recurrence back to investigating rather than to known error', () => {
    // If it came back, the previous workaround is not known to work on
    // whatever it is now. Offering it again would be a guess wearing the
    // clothes of a verified answer.
    expect(canTransition('resolved', 'investigating')).toBe(true);
    expect(canTransition('resolved', 'known_error')).toBe(false);
  });
});

describe('the shape of the lifecycle', () => {
  it('reaches every state from the beginning', () => {
    const reachable = new Set<ProblemState>(['investigating']);
    for (let pass = 0; pass < PROBLEM_STATES.length; pass += 1) {
      for (const state of [...reachable]) for (const next of STATES[state].allowed) reachable.add(next);
    }
    expect(PROBLEM_STATES.filter((state) => !reachable.has(state))).toEqual([]);
  });

  it('names only real states as allowed', () => {
    const declared = new Set<string>(PROBLEM_STATES);
    const unknown = PROBLEM_STATES.flatMap((state) =>
      STATES[state].allowed.filter((next) => !declared.has(next)).map((next) => `${state} → ${next}`),
    );
    expect(unknown).toEqual([]);
  });

  it('ends only at closed', () => {
    expect(PROBLEM_STATES.filter((state) => STATES[state].terminal)).toEqual(['closed']);
    expect(STATES.closed.allowed).toEqual([]);
  });

  it('refuses to reopen a closed problem, and says what was allowed', () => {
    expect(() => assertTransition('closed', 'investigating')).toThrow(StateTransitionError);
    expect(() => assertTransition('resolved', 'known_error')).toThrow(/investigating, closed/);
  });

  it('treats a move to the state it is already in as nothing to do', () => {
    expect(() => assertTransition('known_error', 'known_error')).not.toThrow();
  });
});

describe('the recurrence threshold', () => {
  it('is set high enough that a suggestion means something', () => {
    // A threshold of two would suggest a problem for every coincidence, and a
    // list of coincidences is how people learn to ignore the list.
    expect(RECURRENCE_THRESHOLD.tickets).toBeGreaterThanOrEqual(3);
    expect(RECURRENCE_THRESHOLD.withinDays).toBeGreaterThan(0);
  });
});

describe('isProblemState', () => {
  it('accepts what the lifecycle declares and nothing else', () => {
    for (const state of PROBLEM_STATES) expect(isProblemState(state)).toBe(true);
    expect(isProblemState('mitigating')).toBe(false);
  });
});
