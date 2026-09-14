/**
 * @itsm/business-time — calendar arithmetic for SLA targets.
 *
 * Pure functions, no I/O, no dependencies. Every SLA due date, pause, resume
 * and attainment figure in the product comes from here, so this package carries
 * a 100% branch-coverage requirement (docs/architecture/18 §1, MOD-07 DoD).
 *
 * All instants are UTC `Date`s. Calendars are expressed in their own IANA time
 * zone and converted using `Intl`, so daylight-saving transitions, holidays and
 * overnight shifts are handled by construction rather than by offset maths.
 */

export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

/** A local wall-clock opening period, e.g. 09:00–17:00. `end` may be 24:00. */
export interface OpenPeriod {
  start: string;
  end: string;
}

export type WeeklyHours = Partial<Record<Weekday, OpenPeriod[]>>;

export interface CalendarException {
  /** Local date in the calendar's time zone, `YYYY-MM-DD`. */
  date: string;
  /** `holiday` closes the day; `extended` replaces that day's hours. */
  type: 'holiday' | 'extended';
  hours?: OpenPeriod[];
}

export interface BusinessCalendar {
  timeZone: string;
  hours: WeeklyHours;
  exceptions?: CalendarException[];
}

export interface Interval {
  start: Date;
  end: Date;
}

export class BusinessTimeError extends Error {}

const WEEKDAYS: Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAY_MS = 86_400_000;
/** Guards against a calendar that is closed forever silently looping. */
const MAX_DAYS_SCANNED = 3650;

export const TWENTY_FOUR_SEVEN: BusinessCalendar = {
  timeZone: 'UTC',
  hours: {
    mon: [{ start: '00:00', end: '24:00' }],
    tue: [{ start: '00:00', end: '24:00' }],
    wed: [{ start: '00:00', end: '24:00' }],
    thu: [{ start: '00:00', end: '24:00' }],
    fri: [{ start: '00:00', end: '24:00' }],
    sat: [{ start: '00:00', end: '24:00' }],
    sun: [{ start: '00:00', end: '24:00' }],
  },
};

const partsCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = partsCache.get(timeZone);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        weekday: 'short',
      });
    } catch {
      throw new BusinessTimeError(`unknown time zone: ${timeZone}`);
    }
    partsCache.set(timeZone, f);
  }
  return f;
}

export interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: Weekday;
}

/** Wall-clock parts of a UTC instant, as seen in the given time zone. */
export function localParts(instant: Date, timeZone: string): LocalParts {
  const parts = formatter(timeZone).formatToParts(instant);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '0';
  const weekdayName = get('weekday').toLowerCase().slice(0, 3) as Weekday;
  // Intl renders midnight as hour 24 in some locales/zones; normalise to 0.
  const hour = Number(get('hour')) % 24;
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour,
    minute: Number(get('minute')),
    second: Number(get('second')),
    weekday: WEEKDAYS.includes(weekdayName) ? weekdayName : 'mon',
  };
}

function offsetMs(instant: Date, timeZone: string): number {
  const p = localParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * Converts a wall-clock time in a zone to the UTC instant.
 * Two passes settle the offset, which is what makes DST transitions correct.
 * A wall-clock time that does not exist (a spring-forward gap) is shifted
 * forward past the gap; one that happens twice (an autumn overlap) resolves to
 * the later occurrence. Both behaviours are pinned by tests.
 */
export function wallToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let guess = naive - offsetMs(new Date(naive), timeZone);
  const secondOffset = offsetMs(new Date(guess), timeZone);
  const corrected = naive - secondOffset;
  if (corrected !== guess) guess = corrected;
  return new Date(guess);
}

function parseHm(value: string, label: string): { hour: number; minute: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!m) throw new BusinessTimeError(`invalid ${label} time: ${value}`);
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 24 || minute > 59 || (hour === 24 && minute !== 0)) {
    throw new BusinessTimeError(`invalid ${label} time: ${value}`);
  }
  return { hour, minute };
}

function dateKey(p: { year: number; month: number; day: number }): string {
  return `${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** The opening periods that apply to one local date, honouring exceptions. */
function periodsFor(calendar: BusinessCalendar, p: LocalParts): OpenPeriod[] {
  const key = dateKey(p);
  const exception = calendar.exceptions?.find((e) => e.date === key);
  if (exception) {
    if (exception.type === 'holiday') return [];
    return exception.hours ?? [];
  }
  return calendar.hours[p.weekday] ?? [];
}

/** The open intervals of one local date, as UTC instants. */
export function dayIntervals(calendar: BusinessCalendar, localDate: LocalParts): Interval[] {
  const out: Interval[] = [];
  for (const period of periodsFor(calendar, localDate)) {
    const from = parseHm(period.start, 'start');
    const to = parseHm(period.end, 'end');
    const start = wallToUtc(localDate.year, localDate.month, localDate.day, from.hour, from.minute, calendar.timeZone);
    // 24:00 means the end of this local day, which is midnight of the next one.
    const end =
      to.hour === 24
        ? wallToUtc(localDate.year, localDate.month, localDate.day + 1, 0, 0, calendar.timeZone)
        : wallToUtc(localDate.year, localDate.month, localDate.day, to.hour, to.minute, calendar.timeZone);
    if (end.getTime() > start.getTime()) out.push({ start, end });
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime());
}

function* scanDays(calendar: BusinessCalendar, from: Date): Generator<Interval> {
  let cursor = from;
  for (let scanned = 0; scanned < MAX_DAYS_SCANNED; scanned += 1) {
    const parts = localParts(cursor, calendar.timeZone);
    for (const interval of dayIntervals(calendar, parts)) yield interval;
    // Step to midday of the next local day: immune to DST shifts of up to 12 h.
    const midday = wallToUtc(parts.year, parts.month, parts.day, 12, 0, calendar.timeZone);
    cursor = new Date(midday.getTime() + DAY_MS);
  }
  throw new BusinessTimeError('calendar has no open time within the scan horizon');
}

/**
 * Adds business milliseconds to an instant.
 * If `from` falls outside opening hours the clock starts at the next opening.
 */
export function addBusinessMs(from: Date, durationMs: number, calendar: BusinessCalendar): Date {
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    throw new BusinessTimeError(`duration must be a non-negative number of ms, got ${durationMs}`);
  }
  let remaining = durationMs;
  // Start the scan a day early so an interval that began before `from` is seen.
  const scanStart = new Date(from.getTime() - DAY_MS);
  for (const interval of scanDays(calendar, scanStart)) {
    if (interval.end.getTime() <= from.getTime()) continue;
    const start = Math.max(interval.start.getTime(), from.getTime());
    const available = interval.end.getTime() - start;
    if (available <= 0) continue;
    if (remaining === 0) return new Date(start);
    if (available >= remaining) return new Date(start + remaining);
    remaining -= available;
  }
  throw new BusinessTimeError('calendar has no open time within the scan horizon');
}

/** Business milliseconds between two instants; zero when `to` is not after `from`. */
export function elapsedBusinessMs(from: Date, to: Date, calendar: BusinessCalendar): number {
  if (to.getTime() <= from.getTime()) return 0;
  let total = 0;
  const scanStart = new Date(from.getTime() - DAY_MS);
  for (const interval of scanDays(calendar, scanStart)) {
    if (interval.start.getTime() >= to.getTime()) break;
    const start = Math.max(interval.start.getTime(), from.getTime());
    const end = Math.min(interval.end.getTime(), to.getTime());
    if (end > start) total += end - start;
  }
  return total;
}

/** True when the instant falls inside an opening period. */
export function isOpen(instant: Date, calendar: BusinessCalendar): boolean {
  const parts = localParts(instant, calendar.timeZone);
  const t = instant.getTime();
  // The previous local day can carry an interval ending after midnight.
  const previous = new Date(t - DAY_MS);
  const candidates = [...dayIntervals(calendar, localParts(previous, calendar.timeZone)), ...dayIntervals(calendar, parts)];
  return candidates.some((i) => t >= i.start.getTime() && t < i.end.getTime());
}

/** The next instant at which the calendar is open, or the input if already open. */
export function nextOpening(instant: Date, calendar: BusinessCalendar): Date {
  return addBusinessMs(instant, 0, calendar);
}

/** Validates a calendar definition, returning the problems found. */
export function validateCalendar(calendar: BusinessCalendar): string[] {
  const problems: string[] = [];
  try {
    formatter(calendar.timeZone);
  } catch {
    problems.push(`unknown time zone: ${calendar.timeZone}`);
  }
  const checkPeriods = (periods: OpenPeriod[], label: string): void => {
    let previousEnd = -1;
    for (const p of periods) {
      let from;
      let to;
      try {
        from = parseHm(p.start, 'start');
        to = parseHm(p.end, 'end');
      } catch (error) {
        problems.push(`${label}: ${(error as Error).message}`);
        continue;
      }
      const startM = from.hour * 60 + from.minute;
      const endM = to.hour * 60 + to.minute;
      if (endM <= startM) problems.push(`${label}: period ${p.start}-${p.end} ends before it starts`);
      if (startM < previousEnd) problems.push(`${label}: period ${p.start}-${p.end} overlaps the previous one`);
      previousEnd = endM;
    }
  };
  for (const [day, periods] of Object.entries(calendar.hours)) {
    if (periods) checkPeriods(periods, day);
  }
  for (const exception of calendar.exceptions ?? []) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(exception.date)) problems.push(`exception date must be YYYY-MM-DD: ${exception.date}`);
    if (exception.type === 'extended') checkPeriods(exception.hours ?? [], `exception ${exception.date}`);
  }
  const hasOpenTime =
    Object.values(calendar.hours).some((periods) => (periods?.length ?? 0) > 0) ||
    (calendar.exceptions ?? []).some((e) => e.type === 'extended' && (e.hours?.length ?? 0) > 0);
  if (!hasOpenTime) problems.push('calendar has no opening hours');
  return problems;
}
