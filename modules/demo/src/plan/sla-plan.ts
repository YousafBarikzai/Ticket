import type { CanonicalState, Priority } from '@itsm/contracts';
import type { BusinessClock } from './calendar.js';
import { MINUTE_MS, type Instant } from './time.js';
import { SLA_TARGET_MINUTES, TARGET_TYPES, type TargetType } from './model.js';
import type { PlannedVerdict } from './types.js';

/**
 * MOD-07's maths, in memory (A4 §1.11, §2.6).
 *
 * The planner realises each ticket's sampled verdicts by building a timeline
 * against this simulation, and then reads the verdicts back from it. The
 * simulation does what `replayTimers` does in the database, step for step:
 *
 * - all three timers start at the ticket's creation, on its policy's calendar;
 * - a public reply by anyone but the requester meets `response`, and a reply
 *   by a person also meets the current `update` cycle and starts the next
 *   (F1); a reply while the ticket waits leaves the new cycle paused;
 * - a waiting state pauses every running timer but `response`; a working
 *   state resumes them; `resolved` and `closed` stop them as met (a breached
 *   timer stays breached); `cancelled` cancels them;
 * - before each step, and at the end, whatever fell due breaches at its due
 *   instant, once per target (U4); an `update` timer keeps its cadence after
 *   a breach (U5).
 *
 * Replies sort before status changes at the same instant, as in the replay.
 * The build's V2 compares the database replay with these verdicts, so a drift
 * between the two implementations is caught on the first build, not by a
 * visitor reading an odd attainment figure.
 */

/** What a state does to the resolution clock (`modules/ticket/src/domain/state-machine.ts`). */
export const RESOLUTION_CLOCK: Readonly<Record<CanonicalState, 'running' | 'paused' | 'stopped' | 'cancelled'>> = Object.freeze({
  new: 'running',
  in_progress: 'running',
  pending_requester: 'paused',
  pending_third_party: 'paused',
  pending_approval: 'paused',
  resolved: 'stopped',
  reopened: 'running',
  closed: 'stopped',
  cancelled: 'cancelled',
});

export function targetMs(priority: Priority, target: TargetType): number {
  return SLA_TARGET_MINUTES[priority][target] * MINUTE_MS;
}

type TimerState = 'running' | 'paused' | 'met' | 'breached' | 'cancelled';

interface SimTimer {
  readonly target: TargetType;
  readonly targetMs: number;
  state: TimerState;
  remaining: number;
  lastResumedAt: Instant;
  breachedAt: Instant | null;
  metAt: Instant | null;
}

export interface SimTimerView {
  readonly verdict: PlannedVerdict;
  readonly state: TimerState;
  /** When a running timer falls due; `null` otherwise. */
  readonly dueAt: Instant | null;
  readonly breachedAt: Instant | null;
  readonly metAt: Instant | null;
}

/**
 * One ticket's three timers, stepped forward in time. Every method takes the
 * instant it happens at, and instants must not go backwards.
 */
export class SlaSim {
  private readonly timers: Record<TargetType, SimTimer>;
  private status: CanonicalState = 'new';
  private now: Instant;
  /**
   * The ticket's working time so far: business time while it was not waiting
   * on anyone. It is the resolution clock without the breach — a resolution
   * timer that breached stops counting, but the work goes on until somebody
   * resolves it, and the planner places that moment on this clock.
   */
  private work = { running: true, used: 0, since: 0 };

  constructor(
    readonly priority: Priority,
    readonly createdAt: Instant,
    private readonly clock: BusinessClock,
  ) {
    this.now = createdAt;
    const make = (target: TargetType): SimTimer => ({
      target,
      targetMs: targetMs(priority, target),
      state: 'running',
      remaining: targetMs(priority, target),
      lastResumedAt: createdAt,
      breachedAt: null,
      metAt: null,
    });
    this.timers = { response: make('response'), update: make('update'), resolution: make('resolution') };
    this.work = { running: true, used: 0, since: createdAt };
  }

  get currentStatus(): CanonicalState {
    return this.status;
  }

  private advance(at: Instant): void {
    if (at < this.now) throw new RangeError(`the SLA simulation cannot go back in time (${new Date(at).toISOString()})`);
    this.now = at;
  }

  private dueOf(timer: SimTimer): Instant | null {
    return timer.state === 'running' ? this.clock.add(timer.lastResumedAt, timer.remaining) : null;
  }

  /** `breachDue(upTo)`: whatever fell due by `at` breaches at its own due instant. */
  breachDue(at: Instant): void {
    this.advance(at);
    for (const timer of Object.values(this.timers)) {
      const due = this.dueOf(timer);
      if (due === null || due > at) continue;
      // A later missed cycle of an update timer that already breached: the
      // row shows the miss, but the target breached once (U4).
      if (timer.breachedAt === null) timer.breachedAt = due;
      timer.state = 'breached';
    }
  }

  /** A public comment by someone other than the requester; `person` is false for an automated one. */
  reply(at: Instant, person: boolean): void {
    this.breachDue(at);
    const response = this.timers.response;
    if (response.state === 'running' || response.state === 'paused') {
      response.state = 'met';
      response.metAt = at;
    }
    if (person) this.restartUpdateCycle(at);
  }

  private restartUpdateCycle(at: Instant): void {
    const update = this.timers.update;
    if (update.metAt !== null) return;
    if (update.state !== 'running' && update.state !== 'paused' && update.state !== 'breached') return;
    const clock = RESOLUTION_CLOCK[this.status];
    if (clock === 'stopped' || clock === 'cancelled') return;
    const wasPaused = update.state === 'paused';
    const resumes = wasPaused ? false : update.state === 'breached' ? clock !== 'paused' : true;
    update.remaining = update.targetMs;
    if (resumes) {
      update.state = 'running';
      update.lastResumedAt = at;
    } else {
      update.state = 'paused';
    }
  }

  /** A status change; the step's own breaches are fired first. */
  changeStatus(at: Instant, to: CanonicalState): void {
    this.breachDue(at);
    this.status = to;
    const workClock = RESOLUTION_CLOCK[to];
    if (workClock === 'running' && !this.work.running) this.work = { running: true, used: this.work.used, since: at };
    else if (workClock !== 'running' && this.work.running) {
      this.work = { running: false, used: this.work.used + this.clock.elapsed(this.work.since, at), since: at };
    }
    switch (RESOLUTION_CLOCK[to]) {
      case 'paused':
        for (const timer of Object.values(this.timers)) {
          if (timer.state !== 'running' || timer.target === 'response') continue;
          timer.remaining = Math.max(0, timer.remaining - this.clock.elapsed(timer.lastResumedAt, at));
          timer.state = 'paused';
        }
        break;
      case 'running':
        for (const timer of Object.values(this.timers)) {
          if (timer.state !== 'paused') continue;
          timer.state = 'running';
          timer.lastResumedAt = at;
        }
        break;
      case 'stopped':
        for (const timer of Object.values(this.timers)) {
          if (timer.state !== 'running' && timer.state !== 'paused') continue;
          timer.state = timer.breachedAt !== null ? 'breached' : 'met';
          timer.metAt = at;
        }
        break;
      case 'cancelled':
        for (const timer of Object.values(this.timers)) {
          if (timer.state !== 'running' && timer.state !== 'paused') continue;
          timer.state = 'cancelled';
        }
        break;
    }
  }

  /** When a running target falls due, from where things stand now. */
  dueAt(target: TargetType): Instant | null {
    return this.dueOf(this.timers[target]);
  }

  /** Business time a target has used so far, at `at` (≥ the last step). */
  used(target: TargetType, at: Instant): number {
    const timer = this.timers[target];
    const left = timer.state === 'running' ? timer.remaining - this.clock.elapsed(timer.lastResumedAt, at) : timer.remaining;
    return timer.targetMs - left;
  }

  /** Working time used so far, at `at` (≥ the last step). */
  workUsed(at: Instant): number {
    return this.work.running ? this.work.used + this.clock.elapsed(this.work.since, at) : this.work.used;
  }

  /**
   * The instant at which the ticket will have had `ms` of working time, or
   * `null` while it waits on someone. Never earlier than the last step.
   */
  instantAtWork(ms: number): Instant | null {
    if (!this.work.running) return null;
    return Math.max(this.now, this.clock.add(this.work.since, Math.max(0, ms - this.work.used)));
  }

  view(target: TargetType): SimTimerView {
    const timer = this.timers[target];
    const verdict: PlannedVerdict =
      timer.state === 'cancelled' ? 'cancelled' : timer.breachedAt !== null ? 'breached' : timer.metAt !== null ? 'met' : 'running';
    return { verdict, state: timer.state, dueAt: this.dueOf(timer), breachedAt: timer.breachedAt, metAt: timer.metAt };
  }
}

/** The steps the replay reads off an imported ticket. */
export interface SlaHistory {
  readonly priority: Priority;
  readonly createdAt: Instant;
  readonly requester: string;
  /** Oldest first. */
  readonly statusChanges: readonly { readonly at: Instant; readonly to: CanonicalState }[];
  /** Public comments, any order. */
  readonly publicComments: readonly { readonly at: Instant; readonly author: string | null }[];
}

/**
 * The verdicts `replayTimers` gives a ticket with this history at `upTo`
 * (steps after `upTo` are left out, as there).
 */
export function evaluateSla(history: SlaHistory, upTo: Instant, clock: BusinessClock): Record<TargetType, SimTimerView> {
  type Step = { kind: 'reply'; at: Instant; person: boolean } | { kind: 'status'; at: Instant; to: CanonicalState };
  const steps: { step: Step; index: number }[] = [];
  for (const comment of history.publicComments) {
    if (comment.author === history.requester) continue;
    steps.push({ step: { kind: 'reply', at: comment.at, person: comment.author !== null }, index: steps.length });
  }
  for (const change of history.statusChanges) {
    steps.push({ step: { kind: 'status', at: change.at, to: change.to }, index: steps.length });
  }
  steps.sort((a, b) => a.step.at - b.step.at || (a.step.kind === 'reply' ? 0 : 1) - (b.step.kind === 'reply' ? 0 : 1) || a.index - b.index);

  const sim = new SlaSim(history.priority, history.createdAt, clock);
  for (const { step } of steps) {
    if (step.at > upTo) continue;
    if (step.kind === 'reply') sim.reply(step.at, step.person);
    else sim.changeStatus(step.at, step.to);
  }
  sim.breachDue(Math.max(upTo, history.createdAt));
  return { response: sim.view('response'), update: sim.view('update'), resolution: sim.view('resolution') };
}

/** Attainment as `sla.attainment` counts it: met over met-or-breached, per cent; `null` with nothing finished. */
export function attainment(verdicts: readonly PlannedVerdict[]): number | null {
  let met = 0;
  let finished = 0;
  for (const verdict of verdicts) {
    if (verdict === 'met') {
      met += 1;
      finished += 1;
    } else if (verdict === 'breached') finished += 1;
  }
  return finished === 0 ? null : (met / finished) * 100;
}

export { TARGET_TYPES };
