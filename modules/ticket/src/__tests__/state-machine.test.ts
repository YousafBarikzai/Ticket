import { describe, expect, it } from 'vitest';
import type { CanonicalState } from '@itsm/contracts';
import { StateTransitionError } from '@itsm/platform';
import {
  CANONICAL_STATES,
  STATES,
  allowedTransitions,
  assertTransition,
  canTransition,
  categoryOf,
  effectsOf,
  isRequesterTransition,
  requiresAdministratorOverride,
} from '../domain/state-machine.js';

describe('canonical states', () => {
  it('covers exactly the nine states in the specification', () => {
    expect(CANONICAL_STATES).toEqual([
      'new',
      'in_progress',
      'pending_requester',
      'pending_third_party',
      'pending_approval',
      'resolved',
      'reopened',
      'closed',
      'cancelled',
    ]);
  });

  it('maps every state onto a category so SLA and reporting behave consistently', () => {
    expect(categoryOf('new')).toBe('open');
    expect(categoryOf('reopened')).toBe('open');
    expect(categoryOf('pending_requester')).toBe('paused');
    expect(categoryOf('pending_third_party')).toBe('paused');
    expect(categoryOf('pending_approval')).toBe('paused');
    expect(categoryOf('resolved')).toBe('resolved');
    expect(categoryOf('closed')).toBe('closed');
    expect(categoryOf('cancelled')).toBe('closed');
  });

  it('only ever names states that exist', () => {
    for (const state of CANONICAL_STATES) {
      for (const target of allowedTransitions(state)) {
        expect(CANONICAL_STATES).toContain(target);
      }
    }
  });

  it('leaves terminal states with no way out', () => {
    expect(allowedTransitions('closed')).toEqual([]);
    expect(allowedTransitions('cancelled')).toEqual([]);
    expect(requiresAdministratorOverride('closed')).toBe(true);
    expect(requiresAdministratorOverride('resolved')).toBe(false);
  });

  it('reaches every non-initial state from new', () => {
    // A state nothing can reach would be dead configuration.
    const reachable = new Set<CanonicalState>(['new']);
    let grew = true;
    while (grew) {
      grew = false;
      for (const state of [...reachable]) {
        for (const next of allowedTransitions(state)) {
          if (!reachable.has(next)) {
            reachable.add(next);
            grew = true;
          }
        }
      }
    }
    expect([...reachable].sort()).toEqual([...CANONICAL_STATES].sort());
  });
});

describe('transitions', () => {
  it('permits the documented moves', () => {
    expect(canTransition('new', 'in_progress')).toBe(true);
    expect(canTransition('in_progress', 'resolved')).toBe(true);
    expect(canTransition('resolved', 'reopened')).toBe(true);
    expect(canTransition('resolved', 'closed')).toBe(true);
    expect(canTransition('pending_requester', 'in_progress')).toBe(true);
  });

  it('refuses the ones that would corrupt the record', () => {
    expect(canTransition('closed', 'in_progress')).toBe(false);
    expect(canTransition('cancelled', 'new')).toBe(false);
    expect(canTransition('new', 'closed')).toBe(false);
    expect(canTransition('pending_third_party', 'cancelled')).toBe(false);
  });

  it('rejects a no-op transition rather than writing a meaningless event', () => {
    expect(() => assertTransition('new', 'new')).toThrow(StateTransitionError);
  });

  it('explains what was allowed when it refuses', () => {
    try {
      assertTransition('closed', 'in_progress');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(StateTransitionError);
      expect((error as Error).message).toContain('cannot move from closed to in_progress');
      expect((error as Error).message).toContain('none');
    }
  });
});

describe('effects', () => {
  const at = new Date('2026-09-14T12:00:00.000Z');

  it('stamps resolution and stops the timers', () => {
    const effects = effectsOf('in_progress', 'resolved', at);
    expect(effects.resolvedAt).toEqual(at);
    expect(effects.closedAt).toBe('unchanged');
    expect(effects.sla.resolutionTimer).toBe('stopped');
  });

  it('clears resolution and counts a reopen', () => {
    const effects = effectsOf('resolved', 'reopened', at);
    expect(effects.resolvedAt).toBeNull();
    expect(effects.closedAt).toBeNull();
    expect(effects.incrementReopenCount).toBe(true);
    expect(effects.sla.resolutionTimer).toBe('running');
  });

  it('pauses the resolution timer with a reason for every paused state', () => {
    for (const state of CANONICAL_STATES.filter((s) => categoryOf(s) === 'paused')) {
      const effects = effectsOf('in_progress', state, at);
      expect(effects.sla.resolutionTimer).toBe('paused');
      expect(effects.sla.pauseReason).toBeDefined();
    }
  });

  it('cancels rather than stops the timer when a ticket is withdrawn', () => {
    // Cancelled tickets are excluded from SLA attainment, which is a different
    // outcome from a target that was met or missed.
    expect(effectsOf('new', 'cancelled', at).sla.resolutionTimer).toBe('cancelled');
    expect(effectsOf('resolved', 'closed', at).sla.resolutionTimer).toBe('stopped');
  });

  it('keeps the first-response timer running until an agent replies', () => {
    expect(STATES.new.sla.responseTimer).toBe('running');
    expect(STATES.in_progress.sla.responseTimer).toBe('unchanged');
  });
});

describe('requester transitions', () => {
  it('lets a requester reopen, resolve or withdraw, and nothing else', () => {
    expect(isRequesterTransition('resolved', 'reopened')).toBe(true);
    expect(isRequesterTransition('in_progress', 'resolved')).toBe(true);
    expect(isRequesterTransition('new', 'cancelled')).toBe(true);
    expect(isRequesterTransition('new', 'in_progress')).toBe(false);
    expect(isRequesterTransition('in_progress', 'cancelled')).toBe(false);
    expect(isRequesterTransition('closed', 'reopened')).toBe(false);
  });
});
