import { describe, expect, it } from 'vitest';
import { resolveQuorum, settleStep } from '../domain/policy.js';

/**
 * How a step settles.
 *
 * These are the rules that decide whether a change goes ahead, so they are
 * specified here rather than left implicit in the service: the interesting cases
 * are the ones where a step can no longer reach its quorum, which is where an
 * approval chain silently hangs if nobody thought about it.
 */

describe('settleStep', () => {
  it('waits while nobody has decided', () => {
    expect(settleStep(1, 2, [])).toEqual({ status: 'waiting' });
  });

  it('approves once the quorum is met', () => {
    expect(settleStep(1, 2, [{ decision: 'approved' }])).toEqual({ status: 'approved' });
    expect(settleStep(2, 3, [{ decision: 'approved' }, { decision: 'approved' }])).toEqual({ status: 'approved' });
  });

  it('waits when the quorum is not met yet', () => {
    expect(settleStep(2, 3, [{ decision: 'approved' }])).toEqual({ status: 'waiting' });
  });

  it('rejects on a single rejection, whatever the quorum', () => {
    // An approval chain is a series of vetoes, not a vote: two approvals do not
    // outvote one rejection.
    const outcome = settleStep(2, 3, [{ decision: 'approved' }, { decision: 'approved' }, { decision: 'rejected' }]);
    expect(outcome.status).toBe('rejected');
  });

  it('rejects once the quorum has become unreachable', () => {
    // Three approvers, quorum three, one rejects: the other two approving can
    // never get there. Without this the step waits forever on people who have
    // already decided.
    const outcome = settleStep(3, 3, [{ decision: 'rejected' }]);
    expect(outcome.status).toBe('rejected');
    expect(outcome.reason).toMatch(/reject/);
  });

  it('caps the quorum at the number of approvers actually found', () => {
    // A policy asking for three approvals that resolved to one person must not
    // become unsatisfiable.
    expect(settleStep(3, 1, [{ decision: 'approved' }])).toEqual({ status: 'approved' });
  });
});

describe('resolveQuorum', () => {
  it('treats "all" as everyone who was actually resolved', () => {
    expect(resolveQuorum('all', 3)).toBe(3);
    expect(resolveQuorum('all', 1)).toBe(1);
  });

  it('never asks for more approvals than there are approvers', () => {
    expect(resolveQuorum(5, 2)).toBe(2);
  });

  it('never resolves to zero, which would approve without anyone deciding', () => {
    expect(resolveQuorum('all', 0)).toBe(1);
    expect(resolveQuorum(3, 0)).toBe(1);
  });
});
