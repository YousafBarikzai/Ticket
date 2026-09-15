import { describe, expect, it } from 'vitest';
import { StateTransitionError } from '@itsm/platform';
import {
  DEFAULT_UPDATE_INTERVAL,
  INCIDENT_STATES,
  REVIEW_REQUIRED,
  SEVERITIES,
  STATES,
  assertTransition,
  canTransition,
  effectsOf,
  isIncidentState,
  type IncidentState,
} from '../domain/lifecycle.js';

/**
 * The lifecycle is where this module's opinions live, so these tests are its
 * specification. Each names the way an incident goes wrong when the rule is
 * absent, rather than the line it covers.
 */

describe('the shape of the lifecycle', () => {
  it('lets every state be reached from the declaration', () => {
    // A state nothing can reach is a state the code handles and nobody ever
    // sees — and the handling rots without anybody noticing.
    const reachable = new Set<IncidentState>(['declared']);
    for (let pass = 0; pass < INCIDENT_STATES.length; pass += 1) {
      for (const state of [...reachable]) {
        for (const next of STATES[state].allowed) reachable.add(next);
      }
    }
    // `closed` is reached through the review, which is not a plain transition.
    reachable.add('closed');
    expect([...INCIDENT_STATES].filter((state) => !reachable.has(state))).toEqual([]);
  });

  it('names only real states as allowed', () => {
    const declared = new Set<string>(INCIDENT_STATES);
    const unknown = INCIDENT_STATES.flatMap((state) =>
      STATES[state].allowed.filter((next) => !declared.has(next)).map((next) => `${state} → ${next}`),
    );
    expect(unknown).toEqual([]);
  });

  it('ends only at closed and stood down', () => {
    const terminal = INCIDENT_STATES.filter((state) => STATES[state].terminal);
    expect(terminal).toEqual(['closed', 'stood_down']);
    for (const state of terminal) expect(STATES[state].allowed).toEqual([]);
  });

  it('stops owing updates exactly when the incident stops being live', () => {
    // The promise is the product: an organisation still being told "every
    // thirty minutes" about something resolved an hour ago stops believing the
    // next promise.
    const communicating = INCIDENT_STATES.filter((state) => STATES[state].communicating);
    expect(communicating).toEqual(['declared', 'identified', 'mitigating', 'monitoring']);
  });
});

describe('the transitions people argue about', () => {
  it('lets a wrong diagnosis go back from mitigating to identified', () => {
    // A lifecycle that only moves forwards makes people lie to it, and then the
    // timeline is fiction.
    expect(canTransition('mitigating', 'identified')).toBe(true);
  });

  it('reopens a resolved incident as mitigating, not as declared', () => {
    // It never finished; it did not start again. Declaring it afresh would
    // restart the clock every duration figure is measured from.
    expect(canTransition('resolved', 'mitigating')).toBe(true);
    expect(canTransition('resolved', 'declared')).toBe(false);
  });

  it('will not let monitoring skip straight back to the beginning', () => {
    expect(canTransition('monitoring', 'declared')).toBe(false);
    expect(canTransition('monitoring', 'identified')).toBe(false);
  });

  it('refuses to reopen something closed or stood down', () => {
    // Reopening a closed incident would let its published review be rewritten.
    expect(() => assertTransition('closed', 'mitigating')).toThrow(StateTransitionError);
    expect(() => assertTransition('stood_down', 'declared')).toThrow(StateTransitionError);
  });

  it('treats a move to the state it is already in as nothing to do', () => {
    expect(() => assertTransition('mitigating', 'mitigating')).not.toThrow();
  });

  it('says what was allowed when it refuses', () => {
    // An error that only says "no" sends somebody to read the source.
    expect(() => assertTransition('monitoring', 'declared')).toThrow(/mitigating, resolved/);
  });
});

describe('what entering a state does to the clock', () => {
  it('stamps each milestone once, so a loop cannot shorten the outage', () => {
    // mitigating → monitoring → mitigating is an ordinary morning. If the
    // second pass restamped `mitigatedAt`, every report of how long it took to
    // start fixing would quietly improve.
    expect(effectsOf('mitigating').mitigatedAt).toBe('now');
    expect(effectsOf('monitoring').mitigatedAt).toBe('unchanged');
    // The service only writes a 'now' stamp when the column is still empty;
    // this asserts the intent the service reads.
    expect(effectsOf('identified').identifiedAt).toBe('now');
    expect(effectsOf('mitigating').identifiedAt).toBe('unchanged');
  });

  it('clears the resolution when work starts again', () => {
    // An incident being worked on again is not resolved, and leaving the stamp
    // would let it count as met in every report that matters.
    expect(effectsOf('mitigating').resolvedAt).toBe('clear');
    expect(effectsOf('resolved').resolvedAt).toBe('now');
  });

  it('touches nothing on the way to monitoring or stood down', () => {
    expect(effectsOf('monitoring')).toEqual({
      identifiedAt: 'unchanged',
      mitigatedAt: 'unchanged',
      resolvedAt: 'unchanged',
      closedAt: 'unchanged',
    });
    expect(effectsOf('stood_down').closedAt).toBe('unchanged');
  });
});

describe('the defaults somebody would otherwise be choosing at 3am', () => {
  it('gives every severity a cadence and a review policy', () => {
    for (const severity of SEVERITIES) {
      expect(DEFAULT_UPDATE_INTERVAL[severity]).toBeGreaterThan(0);
      expect(typeof REVIEW_REQUIRED[severity]).toBe('boolean');
    }
  });

  it('asks for updates more often the wider the incident', () => {
    expect(DEFAULT_UPDATE_INTERVAL.SEV1).toBeLessThan(DEFAULT_UPDATE_INTERVAL.SEV2);
    expect(DEFAULT_UPDATE_INTERVAL.SEV2).toBeLessThan(DEFAULT_UPDATE_INTERVAL.SEV3);
  });

  it('requires a review of the severe ones', () => {
    expect(REVIEW_REQUIRED.SEV1).toBe(true);
    expect(REVIEW_REQUIRED.SEV2).toBe(true);
    // SEV3 may be closed without one: demanding a review of every small thing
    // is how reviews become a form nobody reads.
    expect(REVIEW_REQUIRED.SEV3).toBe(false);
  });
});

describe('isIncidentState', () => {
  it('accepts what the lifecycle declares and nothing else', () => {
    for (const state of INCIDENT_STATES) expect(isIncidentState(state)).toBe(true);
    expect(isIncidentState('in_progress')).toBe(false);
    expect(isIncidentState('')).toBe(false);
  });
});
