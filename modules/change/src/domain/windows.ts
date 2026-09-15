import { localParts, wallToUtc, type LocalParts, type Weekday } from '@itsm/business-time';

/**
 * When a change may happen, and when it may not.
 *
 * A blackout window is **enforced, not warned about**. The whole point of
 * declaring "no changes during year-end close" is that it holds; a warning is a
 * thing people click through, and a control everybody clicks through is a
 * control that exists only in the audit report.
 *
 * Weekly windows are local wall-clock times against a zone, for the reason
 * ADR-0024 gives: "every Saturday at ten" stays true across a daylight-saving
 * change and a fixed number of milliseconds does not. A change window that
 * moved by an hour twice a year would put somebody's deployment outside it.
 */

export interface Window {
  kind: string;
  name: string;
  reason?: string | null;
  timeZone: string;
  startsAt?: Date | null;
  endsAt?: Date | null;
  weekday?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  serviceIds?: string[];
  status?: string;
}

export interface Period {
  start: Date;
  end: Date;
}

function parseHm(value: string): { hour: number; minute: number } | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  return match ? { hour: Number(match[1]), minute: Number(match[2]) } : null;
}

function atLocalTime(parts: LocalParts, hhmm: string, timeZone: string, dayOffset = 0): Date | null {
  const time = parseHm(hhmm);
  if (!time) return null;
  return wallToUtc(parts.year, parts.month, parts.day + dayOffset, time.hour, time.minute, timeZone);
}

/**
 * The occurrence of a weekly window that could contain this instant.
 *
 * Both today's and yesterday's, because a window that crosses midnight —
 * "Saturday 22:00 to 02:00", which is what most change windows look like — is
 * still running on Sunday morning. The same case the night shift is in MOD-20,
 * and got wrong first.
 */
function weeklyOccurrences(window: Window, at: Date): Period[] {
  if (!window.weekday || !window.startTime || !window.endTime) return [];

  const today = localParts(at, window.timeZone);
  const yesterdayAnchor = atLocalTime(today, '12:00', window.timeZone, -1);
  if (!yesterdayAnchor) return [];
  const yesterday = localParts(yesterdayAnchor, window.timeZone);

  const periods: Period[] = [];
  for (const parts of [today, yesterday]) {
    if (parts.weekday !== (window.weekday as Weekday)) continue;
    const start = atLocalTime(parts, window.startTime, window.timeZone);
    const endSameDay = atLocalTime(parts, window.endTime, window.timeZone);
    if (!start || !endSameDay) continue;
    // An end at or before the start means it runs into the next day, which is
    // what most change windows look like: Saturday 22:00 to 02:00.
    const end = endSameDay.getTime() > start.getTime() ? endSameDay : atLocalTime(parts, window.endTime, window.timeZone, 1);
    if (end) periods.push({ start, end });
  }
  return periods;
}

/** Whether this window is open at this instant. */
export function covers(window: Window, at: Date): boolean {
  if (window.status && window.status !== 'active') return false;

  if (window.startsAt && window.endsAt) {
    if (at.getTime() >= window.startsAt.getTime() && at.getTime() < window.endsAt.getTime()) return true;
  }
  return weeklyOccurrences(window, at).some(
    (period) => at.getTime() >= period.start.getTime() && at.getTime() < period.end.getTime(),
  );
}

/**
 * Whether this window overlaps a planned period at all.
 *
 * Overlap rather than containment, deliberately: a change that starts before a
 * blackout and runs into it is in the blackout for the part that matters, and
 * "it only overlaps by twenty minutes" is not an argument anybody wants to be
 * making during a year-end freeze.
 *
 * Sampled at the boundaries and hourly between, which is exact for the absolute
 * case and correct for weekly windows down to the hour. A window shorter than
 * an hour is a window somebody has misconfigured.
 */
export function overlaps(window: Window, period: Period): boolean {
  if (window.status && window.status !== 'active') return false;

  if (window.startsAt && window.endsAt) {
    if (period.start.getTime() < window.endsAt.getTime() && period.end.getTime() > window.startsAt.getTime()) {
      return true;
    }
  }

  if (!window.weekday) return false;

  const HOUR = 3_600_000;
  const last = period.end.getTime();
  for (let t = period.start.getTime(); t < last; t += HOUR) {
    if (covers({ ...window, startsAt: null, endsAt: null }, new Date(t))) return true;
  }
  // The final instant, so a period ending inside a window is caught even when
  // the hourly steps stopped short of it.
  return covers({ ...window, startsAt: null, endsAt: null }, new Date(last - 1));
}

/** Whether a window applies to a change on this service. */
export function appliesTo(window: Window, serviceId: string | null | undefined): boolean {
  const scoped = window.serviceIds ?? [];
  // No scope means every service. A window scoped to one service does not
  // restrain a change to another.
  if (scoped.length === 0) return true;
  return Boolean(serviceId && scoped.includes(serviceId));
}

export interface ScheduleVerdict {
  allowed: boolean;
  /** The blackout that refused it, if one did. */
  blockedBy?: { name: string; reason: string | null };
  /** The change windows the period falls inside, if any are defined. */
  inWindows: string[];
  /** Set when change windows exist for this service and the period is in none. */
  outsideWindows: boolean;
}

/**
 * Whether a change may be scheduled into this period.
 *
 * A blackout refuses. Change windows advise: a tenant that has defined them
 * gets told when a change falls outside one, but is not stopped, because the
 * set of legitimate exceptions is large and a hard refusal here would push
 * people to schedule changes as emergencies — trading a small governance win
 * for a large hole in the record.
 */
export function checkSchedule(
  windows: Window[],
  period: Period,
  serviceId: string | null | undefined,
): ScheduleVerdict {
  const applicable = windows.filter((window) => appliesTo(window, serviceId));

  const blackout = applicable.find((window) => window.kind === 'blackout' && overlaps(window, period));
  if (blackout) {
    return {
      allowed: false,
      blockedBy: { name: blackout.name, reason: blackout.reason ?? null },
      inWindows: [],
      outsideWindows: false,
    };
  }

  const changeWindows = applicable.filter((window) => window.kind === 'change');
  const inWindows = changeWindows.filter((window) => overlaps(window, period)).map((window) => window.name);
  return {
    allowed: true,
    inWindows,
    outsideWindows: changeWindows.length > 0 && inWindows.length === 0,
  };
}
