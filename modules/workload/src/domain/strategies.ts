/**
 * Choosing who gets the ticket.
 *
 * Pure, deterministic and explicable, in that order. Pure because routing is
 * the decision most often argued about after the fact and a function of its
 * inputs can be replayed; deterministic because a random tie-break makes
 * "why did Priya get this one?" unanswerable and the behaviour untestable;
 * explicable because a router that silently declines to assign looks identical
 * to one that is broken.
 *
 * Every decision therefore carries the candidates it rejected and why. That
 * list is what an administrator reads when the queue is not moving, and it is
 * the difference between "routing is broken" and "everybody is on holiday".
 */

export type Strategy = 'round_robin' | 'least_loaded' | 'skill';

export type Availability = 'available' | 'busy' | 'away' | 'off_shift' | 'left';

export interface Candidate {
  userId: string;
  /** Open tickets already assigned to them. */
  load: number;
  /** What they will hold at once. Null falls back to the team default. */
  capacity: number | null;
  availability: Availability;
  /** Whether a shift they are assigned to is running now. */
  onShift: boolean;
  /** Skill key to level, 1 learning, 2 competent, 3 expert. */
  skills: Readonly<Record<string, number>>;
  /**
   * When they were last given a ticket. Null means never, which puts them at
   * the front — a new joiner should get the next one, not wait for the list to
   * come round.
   */
  lastAssignedAt: Date | null;
}

export interface SkillRequirement {
  key: string;
  /** 1 learning, 2 competent, 3 expert. Defaults to competent. */
  minimumLevel?: number;
}

export interface RoutingRequest {
  strategy: Strategy;
  /** What the work needs. Empty means anybody will do. */
  requiredSkills?: SkillRequirement[];
  /** Whether somebody whose shift is not running may still be given work. */
  allowOffShift: boolean;
  /** Used for any candidate who has not set their own. */
  defaultCapacity: number;
}

export interface RoutingDecision {
  userId: string | null;
  strategy: Strategy;
  /** Why this one, or why none. A sentence, for an audit entry and a tooltip. */
  reason: string;
  eligible: string[];
  rejected: { userId: string; because: string }[];
}

/** Why this candidate cannot take the work, or null if they can. */
function rejectionFor(candidate: Candidate, request: RoutingRequest): string | null {
  switch (candidate.availability) {
    case 'left':
      // The one that matters most. Queueing work for somebody who has left the
      // organisation is how a ticket ages for a fortnight with nobody noticing.
      return 'has left';
    case 'away':
      return 'away';
    case 'busy':
      return 'marked themselves busy';
    case 'off_shift':
      if (!request.allowOffShift) return 'off shift';
      break;
    case 'available':
      break;
  }

  if (!candidate.onShift && !request.allowOffShift) return 'no shift running';

  const capacity = candidate.capacity ?? request.defaultCapacity;
  if (candidate.load >= capacity) return `at capacity (${candidate.load}/${capacity})`;

  for (const requirement of request.requiredSkills ?? []) {
    const needed = requirement.minimumLevel ?? 2;
    const held = candidate.skills[requirement.key] ?? 0;
    if (held < needed) return `does not have ${requirement.key} at level ${needed}`;
  }

  return null;
}

/** Spare places before this candidate is full. */
function headroom(candidate: Candidate, request: RoutingRequest): number {
  return (candidate.capacity ?? request.defaultCapacity) - candidate.load;
}

/** The highest level a candidate holds among the required skills; 0 if none. */
function skillDepth(candidate: Candidate, request: RoutingRequest): number {
  const required = request.requiredSkills ?? [];
  if (required.length === 0) return 0;
  return required.reduce((total, requirement) => total + (candidate.skills[requirement.key] ?? 0), 0);
}

function waitedLongest(a: Candidate, b: Candidate): number {
  // Null means never assigned, which sorts first.
  const left = a.lastAssignedAt?.getTime() ?? -Infinity;
  const right = b.lastAssignedAt?.getTime() ?? -Infinity;
  return left - right;
}

/**
 * Orders candidates best-first for a strategy.
 *
 * Every comparator ends in `userId`, so the order is total and two runs of the
 * same inputs agree. Without that last step a tie is settled by whatever order
 * the database happened to return, which is the kind of behaviour that passes
 * every test and then differs in production.
 */
const ORDERINGS: Record<Strategy, (request: RoutingRequest) => (a: Candidate, b: Candidate) => number> = {
  // Whoever has waited longest for one. Derived from when each person was last
  // given work rather than from a stored cursor, for the same reason the on-call
  // rota is: a cursor drifts when a decision is replayed or lost, and the drift
  // is invisible until somebody has had three in a row.
  round_robin: () => (a, b) => waitedLongest(a, b) || a.userId.localeCompare(b.userId),

  // Fewest open tickets, then the most room to take another, then the one who
  // has waited longest. Two people on two tickets are not equally free if one
  // of them has said they will hold three.
  least_loaded: (request) => (a, b) =>
    a.load - b.load ||
    headroom(b, request) - headroom(a, request) ||
    waitedLongest(a, b) ||
    a.userId.localeCompare(b.userId),

  // The best-qualified person, then the least loaded of those. Expertise first
  // is the point of the strategy; without the load tie-break the one expert on
  // the team receives every ticket that mentions their speciality.
  skill: (request) => (a, b) =>
    skillDepth(b, request) - skillDepth(a, request) ||
    a.load - b.load ||
    waitedLongest(a, b) ||
    a.userId.localeCompare(b.userId),
};

/** Picks one candidate, or none, and says why. */
export function route(candidates: Candidate[], request: RoutingRequest): RoutingDecision {
  const rejected: { userId: string; because: string }[] = [];
  const eligible: Candidate[] = [];

  for (const candidate of candidates) {
    const because = rejectionFor(candidate, request);
    if (because) rejected.push({ userId: candidate.userId, because });
    else eligible.push(candidate);
  }

  if (eligible.length === 0) {
    return {
      userId: null,
      strategy: request.strategy,
      // Naming the commonest cause turns an empty result into something an
      // administrator can act on without reading the whole list.
      reason: summariseRejections(candidates.length, rejected),
      eligible: [],
      rejected,
    };
  }

  const ordered = [...eligible].sort(ORDERINGS[request.strategy](request));
  const chosen = ordered[0]!;

  return {
    userId: chosen.userId,
    strategy: request.strategy,
    reason: reasonFor(chosen, request),
    eligible: ordered.map((candidate) => candidate.userId),
    rejected,
  };
}

function reasonFor(chosen: Candidate, request: RoutingRequest): string {
  const capacity = chosen.capacity ?? request.defaultCapacity;
  switch (request.strategy) {
    case 'round_robin':
      return chosen.lastAssignedAt
        ? `next in turn; last assigned ${chosen.lastAssignedAt.toISOString()}`
        : 'next in turn; has not been assigned a ticket before';
    case 'least_loaded':
      return `least loaded of those available (${chosen.load}/${capacity})`;
    case 'skill':
      return `best qualified of those available (${chosen.load}/${capacity})`;
  }
}

function summariseRejections(total: number, rejected: { because: string }[]): string {
  if (total === 0) return 'the team has no members to route to';

  const counts = new Map<string, number>();
  for (const { because } of rejected) counts.set(because, (counts.get(because) ?? 0) + 1);

  const commonest = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  return commonest
    ? `nobody on the team can take it; ${commonest[1]} of ${total} ${commonest[0]}`
    : 'nobody on the team can take it';
}
