/**
 * Whether to ask again.
 *
 * Survey fatigue is the single thing that decides whether a feedback
 * programme produces numbers or noise: a person asked after every ticket stops
 * answering after the third, and the ones who keep answering are the ones with
 * something to complain about. So one rule, applied across every trigger: no
 * second ask to the same person inside the window, whichever survey it was.
 */

export interface ThrottleInput {
  /** When this person was last invited, by anything, or null. */
  lastInvitedAt: Date | null;
  throttleDays: number;
  now: Date;
}

export function withinThrottle(input: ThrottleInput): boolean {
  if (!input.lastInvitedAt || input.throttleDays <= 0) return false;
  const windowMs = input.throttleDays * 24 * 60 * 60 * 1000;
  return input.now.getTime() - input.lastInvitedAt.getTime() < windowMs;
}

export function expiryFor(now: Date, expiryDays: number): Date {
  return new Date(now.getTime() + Math.max(1, expiryDays) * 24 * 60 * 60 * 1000);
}
