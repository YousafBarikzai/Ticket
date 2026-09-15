import { localParts, wallToUtc, type LocalParts, type Weekday } from '@itsm/business-time';

/**
 * Who is on call, and who is on shift.
 *
 * Both are pure functions of time and a definition, deliberately. A rota held
 * as a *cursor* — "whose turn is it next?" — drifts the moment a period is
 * missed, replayed, or processed twice, and the symptom is that nobody is on
 * call on the night it matters. Computed from a start instant and a cadence,
 * the answer is the same however many times it is asked, and a restart cannot
 * lose anybody's turn.
 *
 * Every boundary here is a local *wall-clock* time, converted through
 * `@itsm/business-time`. Handovers and shifts are things people arrange in
 * their own day — "Monday at nine", "ten till six" — and those stay true across
 * a daylight-saving change where a fixed number of milliseconds does not.
 */

export class RotaError extends Error {}

export interface RotationDefinition {
  timeZone: string;
  cadence: 'daily' | 'weekly';
  startsAt: Date;
  /** In the order they take it. */
  members: string[];
  /** Local time of day the handover happens, `HH:MM`. */
  handoverAt: string;
}

export interface Override {
  userId: string;
  startsAt: Date;
  endsAt: Date;
}

export interface ShiftPattern {
  timeZone: string;
  /** Weekday key to local periods: `{ mon: [{ from: '07:00', to: '15:00' }] }`. */
  pattern: Partial<Record<Weekday, { from: string; to: string }[]>>;
}

const DAY_MS = 86_400_000;

function parseHm(value: string): { hour: number; minute: number } {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) throw new RotaError(`invalid time of day: ${value}`);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 24 || minute > 59 || (hour === 24 && minute !== 0)) throw new RotaError(`invalid time of day: ${value}`);
  return { hour, minute };
}

/**
 * `HH:MM` on the local date these parts fall on, `dayOffset` days later, as a
 * UTC instant.
 *
 * The offset is applied to the *calendar day* rather than by adding
 * milliseconds, so "the same time tomorrow" is 23 or 25 hours away when the
 * clocks change, which is what everybody means by it.
 */
function atLocalTime(parts: LocalParts, hhmm: string, timeZone: string, dayOffset = 0): Date {
  const { hour, minute } = parseHm(hhmm);
  return wallToUtc(parts.year, parts.month, parts.day + dayOffset, hour, minute, timeZone);
}

/** Whole calendar days from one local date to another; no clock involved. */
function daysBetween(from: LocalParts, to: LocalParts): number {
  const a = Date.UTC(from.year, from.month - 1, from.day);
  const b = Date.UTC(to.year, to.month - 1, to.day);
  return Math.round((b - a) / DAY_MS);
}

function daysPerPeriod(definition: RotationDefinition): number {
  return definition.cadence === 'weekly' ? 7 : 1;
}

/**
 * Which period of the rotation `at` falls in, counting from the start.
 *
 * Period 0 begins at the handover time on the local date of `startsAt`; asking
 * about a time before that gives a negative index, which `onCallAt` wraps
 * rather than answering "nobody". Somebody is better than silence when the
 * question is who to wake up.
 */
export function periodIndex(definition: RotationDefinition, at: Date): number {
  const startParts = localParts(definition.startsAt, definition.timeZone);
  const atParts = localParts(at, definition.timeZone);

  // Before today's handover, today still belongs to the previous period.
  const handoverToday = atLocalTime(atParts, definition.handoverAt, definition.timeZone);
  const elapsed = daysBetween(startParts, atParts) - (at.getTime() < handoverToday.getTime() ? 1 : 0);

  return Math.floor(elapsed / daysPerPeriod(definition));
}

/** Which member takes period `index`, wrapping in both directions. */
function memberFor(definition: RotationDefinition, index: number): string {
  const size = definition.members.length;
  // JavaScript's `%` keeps the sign of the left operand, so a time before the
  // rota started would otherwise index off the front of the list.
  return definition.members[((index % size) + size) % size]!;
}

/**
 * Who is on call at this instant.
 *
 * An override wins outright. It is a fact about one week, where the rotation is
 * a fact about every week — which is why a swap is recorded as an override
 * rather than by editing the member list, an edit that would shift everybody's
 * turn for ever.
 */
export function onCallAt(
  definition: RotationDefinition,
  overrides: Override[],
  at: Date,
): { userId: string | null; via: 'override' | 'rotation' | 'nobody' } {
  const covering = overrides.find(
    (override) => at.getTime() >= override.startsAt.getTime() && at.getTime() < override.endsAt.getTime(),
  );
  if (covering) return { userId: covering.userId, via: 'override' };

  if (definition.members.length === 0) return { userId: null, via: 'nobody' };
  return { userId: memberFor(definition, periodIndex(definition, at)), via: 'rotation' };
}

/** The next few handovers, for showing a rota somebody can check. */
export function upcomingHandovers(
  definition: RotationDefinition,
  from: Date,
  count = 4,
): { at: Date; userId: string }[] {
  if (definition.members.length === 0 || count <= 0) return [];

  const startParts = localParts(definition.startsAt, definition.timeZone);
  const perPeriod = daysPerPeriod(definition);
  const out: { at: Date; userId: string }[] = [];

  let index = periodIndex(definition, from) + 1;
  for (let i = 0; i < count; i += 1, index += 1) {
    out.push({
      at: atLocalTime(startParts, definition.handoverAt, definition.timeZone, index * perPeriod),
      userId: memberFor(definition, index),
    });
  }
  return out;
}

/**
 * Whether this shift is running at this instant.
 *
 * A shift crossing midnight — 22:00 to 06:00, which is most night shifts — is
 * the case a naive implementation gets wrong, because `from` is after `to` and
 * a straight comparison says the shift is never running. Checked here against
 * the previous local day as well, so the night shift exists.
 */
export function isOnShift(shift: ShiftPattern, at: Date): boolean {
  const today = localParts(at, shift.timeZone);
  // Midday of the previous local date, so the date is right whatever the
  // clocks did overnight.
  const yesterday = localParts(atLocalTime(today, '12:00', shift.timeZone, -1), shift.timeZone);
  const t = at.getTime();

  for (const period of shift.pattern[today.weekday] ?? []) {
    const from = atLocalTime(today, period.from, shift.timeZone);
    const to = atLocalTime(today, period.to, shift.timeZone);
    if (to.getTime() === from.getTime()) continue;
    if (to.getTime() > from.getTime()) {
      if (t >= from.getTime() && t < to.getTime()) return true;
    } else if (t >= from.getTime()) {
      // Runs past midnight into tomorrow; from `from` onwards it is running.
      return true;
    }
  }

  // Yesterday's overnight shift, still running into today.
  for (const period of shift.pattern[yesterday.weekday] ?? []) {
    const from = atLocalTime(yesterday, period.from, shift.timeZone);
    const to = atLocalTime(yesterday, period.to, shift.timeZone);
    if (to.getTime() > from.getTime() || to.getTime() === from.getTime()) continue;
    const end = atLocalTime(yesterday, period.to, shift.timeZone, 1);
    if (t >= from.getTime() && t < end.getTime()) return true;
  }

  return false;
}

/** The problems with a shift pattern, as messages an administrator can act on. */
export function validateShiftPattern(shift: ShiftPattern): string[] {
  const problems: string[] = [];
  for (const [day, periods] of Object.entries(shift.pattern)) {
    for (const period of periods ?? []) {
      try {
        const from = parseHm(period.from);
        const to = parseHm(period.to);
        if (from.hour * 60 + from.minute === to.hour * 60 + to.minute) {
          problems.push(`${day}: period ${period.from}-${period.to} is zero length`);
        }
      } catch (error) {
        problems.push(`${day}: ${(error as Error).message}`);
      }
    }
  }
  return problems;
}
