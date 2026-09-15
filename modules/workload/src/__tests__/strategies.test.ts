import { describe, expect, it } from 'vitest';
import { route, type Candidate, type RoutingRequest } from '../domain/strategies.js';

/**
 * Routing is the decision people argue with. Each test below pins either a
 * choice somebody would otherwise dispute, or a refusal that has to stay a
 * refusal — assigning work to somebody who has left is the failure this module
 * exists to prevent.
 */

const agent = (over: Partial<Candidate> & { userId: string }): Candidate => ({
  load: 0,
  capacity: null,
  availability: 'available',
  onShift: true,
  skills: {},
  lastAssignedAt: null,
  ...over,
});

const request = (over: Partial<RoutingRequest> = {}): RoutingRequest => ({
  strategy: 'least_loaded',
  allowOffShift: false,
  defaultCapacity: 5,
  ...over,
});

describe('who is refused, and why', () => {
  it('never routes to somebody who has left', () => {
    const decision = route([agent({ userId: 'gone', availability: 'left' })], request());
    expect(decision.userId).toBeNull();
    expect(decision.rejected).toEqual([{ userId: 'gone', because: 'has left' }]);
  });

  it('refuses the away, the busy and the full, naming each', () => {
    const decision = route(
      [
        agent({ userId: 'away', availability: 'away' }),
        agent({ userId: 'busy', availability: 'busy' }),
        agent({ userId: 'full', load: 5 }),
        agent({ userId: 'own-limit', load: 2, capacity: 2 }),
      ],
      request(),
    );
    expect(decision.userId).toBeNull();
    expect(decision.rejected).toEqual([
      { userId: 'away', because: 'away' },
      { userId: 'busy', because: 'marked themselves busy' },
      { userId: 'full', because: 'at capacity (5/5)' },
      { userId: 'own-limit', because: 'at capacity (2/2)' },
    ]);
  });

  it('keeps work off people whose shift is not running, unless the policy allows it', () => {
    const team = [agent({ userId: 'night', onShift: false })];
    expect(route(team, request()).userId).toBeNull();
    expect(route(team, request()).rejected[0]!.because).toBe('no shift running');
    expect(route(team, request({ allowOffShift: true })).userId).toBe('night');
  });

  it('holds a required skill against every strategy, not only the skill one', () => {
    const team = [agent({ userId: 'generalist' }), agent({ userId: 'expert', skills: { network: 3 } })];
    const needed = { requiredSkills: [{ key: 'network' }] };
    expect(route(team, request({ ...needed, strategy: 'round_robin' })).userId).toBe('expert');
    expect(route(team, request({ ...needed, strategy: 'least_loaded' })).userId).toBe('expert');
    expect(route(team, request({ ...needed, strategy: 'skill' })).userId).toBe('expert');
  });

  it('treats competent as the default bar and lets the caller raise it', () => {
    const team = [agent({ userId: 'learner', skills: { network: 1 } })];
    expect(route(team, request({ requiredSkills: [{ key: 'network' }] })).rejected[0]!.because).toBe(
      'does not have network at level 2',
    );
    const competent = [agent({ userId: 'ok', skills: { network: 2 } })];
    expect(route(competent, request({ requiredSkills: [{ key: 'network' }] })).userId).toBe('ok');
    expect(route(competent, request({ requiredSkills: [{ key: 'network', minimumLevel: 3 }] })).userId).toBeNull();
  });
});

describe('what it says when it cannot route', () => {
  it('names the commonest cause, so the queue not moving is explicable', () => {
    const decision = route(
      [
        agent({ userId: 'a', availability: 'away' }),
        agent({ userId: 'b', availability: 'away' }),
        agent({ userId: 'c', load: 9 }),
      ],
      request(),
    );
    expect(decision.reason).toBe('nobody on the team can take it; 2 of 3 away');
  });

  it('says so plainly when there is nobody on the team at all', () => {
    const decision = route([], request());
    expect(decision).toEqual({
      userId: null,
      strategy: 'least_loaded',
      reason: 'the team has no members to route to',
      eligible: [],
      rejected: [],
    });
  });
});

describe('round robin', () => {
  it('gives the next one to somebody who has never had one', () => {
    const decision = route(
      [
        agent({ userId: 'veteran', lastAssignedAt: new Date('2026-09-15T09:00:00Z') }),
        agent({ userId: 'new-joiner', lastAssignedAt: null }),
      ],
      request({ strategy: 'round_robin' }),
    );
    expect(decision.userId).toBe('new-joiner');
    expect(decision.reason).toBe('next in turn; has not been assigned a ticket before');
  });

  it('otherwise gives it to whoever has waited longest', () => {
    const decision = route(
      [
        agent({ userId: 'recent', lastAssignedAt: new Date('2026-09-15T11:00:00Z') }),
        agent({ userId: 'waiting', lastAssignedAt: new Date('2026-09-15T08:00:00Z') }),
        agent({ userId: 'middle', lastAssignedAt: new Date('2026-09-15T10:00:00Z') }),
      ],
      request({ strategy: 'round_robin' }),
    );
    expect(decision.userId).toBe('waiting');
    expect(decision.eligible).toEqual(['waiting', 'middle', 'recent']);
  });

  it('does not lose a turn when somebody is skipped, because there is no cursor to lose', () => {
    // The oldest is away, so the next oldest takes it — and once they have, the
    // one who was away is still the oldest waiting and gets the following one.
    const team = [
      agent({ userId: 'away', availability: 'away', lastAssignedAt: new Date('2026-09-15T07:00:00Z') }),
      agent({ userId: 'b', lastAssignedAt: new Date('2026-09-15T08:00:00Z') }),
      agent({ userId: 'c', lastAssignedAt: new Date('2026-09-15T09:00:00Z') }),
    ];
    expect(route(team, request({ strategy: 'round_robin' })).userId).toBe('b');

    const back = team.map((c) =>
      c.userId === 'away'
        ? { ...c, availability: 'available' as const }
        : c.userId === 'b'
          ? { ...c, lastAssignedAt: new Date('2026-09-15T12:00:00Z') }
          : c,
    );
    expect(route(back, request({ strategy: 'round_robin' })).userId).toBe('away');
  });
});

describe('least loaded', () => {
  it('picks the fewest open tickets', () => {
    const decision = route(
      [agent({ userId: 'busy-ish', load: 3 }), agent({ userId: 'quiet', load: 1 })],
      request(),
    );
    expect(decision.userId).toBe('quiet');
    expect(decision.reason).toBe('least loaded of those available (1/5)');
  });

  it('breaks a tie on who has the most room left, not on who appears first', () => {
    // Two people on two tickets are not equally free when one has said they
    // will hold eight and the other three.
    const decision = route(
      [agent({ userId: 'small', load: 2, capacity: 3 }), agent({ userId: 'large', load: 2, capacity: 8 })],
      request(),
    );
    expect(decision.userId).toBe('large');
  });

  it('settles a complete tie the same way every time, whatever order the rows arrive in', () => {
    const team = [agent({ userId: 'zoe' }), agent({ userId: 'adam' }), agent({ userId: 'mira' })];
    const first = route(team, request()).userId;
    const reversed = route([...team].reverse(), request()).userId;
    expect(first).toBe('adam');
    expect(reversed).toBe('adam');
  });
});

describe('skill', () => {
  it('prefers the better qualified', () => {
    const decision = route(
      [
        agent({ userId: 'competent', skills: { network: 2 } }),
        agent({ userId: 'expert', skills: { network: 3 } }),
      ],
      request({ strategy: 'skill', requiredSkills: [{ key: 'network' }] }),
    );
    expect(decision.userId).toBe('expert');
  });

  it('adds up the levels when the work needs more than one skill', () => {
    const decision = route(
      [
        agent({ userId: 'deep', skills: { network: 3, firewall: 2 } }),
        agent({ userId: 'broad', skills: { network: 2, firewall: 3 } }),
        agent({ userId: 'both', skills: { network: 3, firewall: 3 } }),
      ],
      request({ strategy: 'skill', requiredSkills: [{ key: 'network' }, { key: 'firewall' }] }),
    );
    expect(decision.userId).toBe('both');
  });

  it('spreads the work between equals rather than burying the first of them', () => {
    // Without the load tie-break the one expert receives every ticket that
    // mentions their speciality until they stop answering.
    const decision = route(
      [
        agent({ userId: 'expert-a', skills: { network: 3 }, load: 4 }),
        agent({ userId: 'expert-b', skills: { network: 3 }, load: 1 }),
      ],
      request({ strategy: 'skill', requiredSkills: [{ key: 'network' }] }),
    );
    expect(decision.userId).toBe('expert-b');
  });

  it('falls back to the least loaded when the work needs no particular skill', () => {
    const decision = route(
      [agent({ userId: 'a', load: 3 }), agent({ userId: 'b', load: 1 })],
      request({ strategy: 'skill' }),
    );
    expect(decision.userId).toBe('b');
  });
});
