import type { IconName, Tone } from '@itsm/ui';
import { formatDateTime } from '@itsm/ui/format';
import type { AvailabilityRow, OnCallRow, RotationRow, ShiftRow } from '@itsm/sdk';

/**
 * Workforce in words (SPEC §6.1 `/workforce/**`, B §3.3): availability
 * statuses, the summary line, the "Away until…" presets, rotas and shifts as
 * sentences. Pure, so the arithmetic (who counts as available, what capacity
 * adds up to, when "end of today" is) has tests.
 */

export const STATUSES = ['available', 'busy', 'away', 'off_shift', 'left'] as const;
export type AvailabilityStatus = (typeof STATUSES)[number];

export const STATUS_LOOK: Readonly<Record<string, { readonly label: string; readonly tone: Tone; readonly icon: IconName }>> = {
  available: { label: 'Available', tone: 'success', icon: 'circle-check' },
  busy: { label: 'Busy', tone: 'warning', icon: 'clock' },
  away: { label: 'Away', tone: 'info', icon: 'moon' },
  off_shift: { label: 'Off shift', tone: 'neutral', icon: 'dot' },
  left: { label: 'Left', tone: 'neutral', icon: 'log-out' },
};

export function statusLabel(status: string): string {
  return STATUS_LOOK[status]?.label ?? status.replace(/_/g, ' ').replace(/^./, (first) => first.toUpperCase());
}

/** The scope switch's three groups: busy people are at work but not free, so they count as away. */
export type Group = 'available' | 'away' | 'offline';

export function groupOf(status: string): Group {
  if (status === 'available') return 'available';
  if (status === 'busy' || status === 'away') return 'away';
  return 'offline';
}

export interface Summary {
  readonly available: number;
  readonly away: number;
  readonly offline: number;
  /** What the available people with a capacity of their own can hold between them. */
  readonly capacity: number;
  /** Available people with no capacity of their own: routing uses their team's default. */
  readonly onDefault: number;
}

/**
 * Counted on what routing acts on (`effectiveStatus`), not on what people
 * last said. A capacity the API sends as null is "the team's default" — the
 * routing policy's number, which differs by team — so it is counted apart
 * rather than as nothing.
 */
export function summarise(rows: readonly { readonly effectiveStatus: string; readonly capacity: number | null }[]): Summary {
  let available = 0;
  let away = 0;
  let offline = 0;
  let capacity = 0;
  let onDefault = 0;
  for (const row of rows) {
    const group = groupOf(row.effectiveStatus);
    if (group === 'available') {
      available += 1;
      if (typeof row.capacity === 'number') capacity += row.capacity;
      else onDefault += 1;
    } else if (group === 'away') away += 1;
    else offline += 1;
  }
  return { available, away, offline, capacity, onDefault };
}

/** "7 available · 3 away · 2 offline · Capacity 21", with the people on their team's default said apart. */
export function summaryLine(summary: Summary): string {
  const counts = `${summary.available} available · ${summary.away} away · ${summary.offline} offline`;
  if (summary.available === 0) return counts;
  if (summary.onDefault === 0) return `${counts} · Capacity ${summary.capacity}`;
  if (summary.onDefault === summary.available) return `${counts} · Capacity: team defaults`;
  return `${counts} · Capacity ${summary.capacity} + ${summary.onDefault} on team defaults`;
}

/**
 * Said beside a status when what somebody set is no longer what routing
 * sees: "Set ‘Away’ until 14:00 — expired". The router treats an "until"
 * that has passed as available again, and a person reading "Away" would
 * otherwise think the queue is short of someone it is not.
 */
export function statusNote(row: Pick<AvailabilityRow, 'status' | 'effectiveStatus' | 'until'>, locale: string, timeZone: string): string | null {
  if (row.status === row.effectiveStatus) return null;
  const until = row.until ? ` until ${formatDateTime(row.until, { locale, timeZone, style: 'time' })}` : '';
  return `Set ‘${statusLabel(row.status)}’${until} — expired`;
}

/** Whether this person may change another's availability: the permission at the `any` scope (their own needs only the permission). */
export function maySetFor(me: { readonly permissions: readonly { readonly key: string; readonly scope?: string | null }[] }, own: boolean): boolean {
  return me.permissions.some((grant) => grant.key === 'workload.availability.set' && (own || grant.scope === 'any'));
}

/* =========================================================================
 * "Away until…"
 * ====================================================================== */

export interface UntilPreset {
  readonly id: string;
  readonly label: string;
  readonly at: Date;
}

/**
 * The quick picks for when somebody is back: in an hour, at the end of the
 * working day (18:00, or midnight once that has passed), and tomorrow at
 * 09:00 — in the browser's own time, which is the setter's.
 */
export function untilPresets(now: Date): UntilPreset[] {
  const hour = new Date(now.getTime() + 60 * 60 * 1000);
  const endOfDay = new Date(now);
  endOfDay.setHours(18, 0, 0, 0);
  if (endOfDay.getTime() <= now.getTime() + 15 * 60 * 1000) endOfDay.setHours(23, 59, 0, 0);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  return [
    { id: 'hour', label: 'In an hour', at: hour },
    { id: 'today', label: 'End of today', at: endOfDay },
    { id: 'tomorrow', label: 'Tomorrow morning', at: tomorrow },
  ];
}

/** A `datetime-local` value (browser time) as an instant, or null when it is not one or has passed. */
export function readLocalDateTime(value: string, now: Date): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return null;
  const at = new Date(value);
  if (Number.isNaN(at.getTime()) || at.getTime() <= now.getTime()) return null;
  return at;
}

/** A Date as a `datetime-local` value in browser time. */
export function toLocalInput(at: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

/* =========================================================================
 * Rotas and shifts
 * ====================================================================== */

/** "Weekly, hands over Mon 09:00 (Europe/London)" or "Daily at 09:00 (UTC)". */
export function cadenceSentence(rotation: Pick<RotationRow, 'cadence' | 'handoverAt' | 'timeZone'>, nextHandover: string | undefined, locale: string): string {
  const zone = rotation.timeZone;
  if (rotation.cadence === 'daily') return `Daily, hands over at ${rotation.handoverAt} (${zone})`;
  if (nextHandover) return `Weekly, hands over ${formatDateTime(nextHandover, { locale, timeZone: zone, style: 'weekdayTime' })} (${zone})`;
  return `Weekly, hands over at ${rotation.handoverAt} (${zone})`;
}

/** Who is on call now, in the shape the card draws. */
export interface OnCallNow {
  readonly userId: string | null;
  readonly covering: boolean;
  readonly next: { readonly userId: string; readonly at: string } | null;
}

export function onCallNow(row: Pick<OnCallRow, 'userId' | 'via' | 'upcoming'> | null): OnCallNow {
  if (!row) return { userId: null, covering: false, next: null };
  const next = row.upcoming.find((turn) => turn.userId !== row.userId) ?? row.upcoming[0] ?? null;
  return { userId: row.userId, covering: row.via === 'override', next: next ? { userId: next.userId, at: next.at } : null };
}

/** An override's span in the reader's zone: "Tue 18:00 – Wed 09:00". */
export function spanText(startsAt: string, endsAt: string, locale: string, timeZone: string): string {
  const from = formatDateTime(startsAt, { locale, timeZone, style: 'weekdayTime' });
  const to = formatDateTime(endsAt, { locale, timeZone, style: 'weekdayTime' });
  return `${from} – ${to}`;
}

/** A shift's assignment period: "From 1 Oct", "1 Oct – 31 Dec". Dates only: an assignment is a run of days. */
export function assignmentSpan(startsOn: string, endsOn: string | null, locale: string): string {
  const format = (day: string): string => formatDateTime(`${day}T12:00:00Z`, { locale, timeZone: 'UTC', style: 'date' });
  return endsOn ? `${format(startsOn)} – ${format(endsOn)}` : `From ${format(startsOn)}`;
}

/** The people currently on a shift: assigned, started, and not yet ended (by calendar date, `YYYY-MM-DD`). */
export function currentAssignees(shift: Pick<ShiftRow, 'assignments'>, today: string): string[] {
  return shift.assignments.filter((entry) => entry.startsOn <= today && (entry.endsOn === null || entry.endsOn >= today)).map((entry) => entry.userId);
}

const WEEK = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

/**
 * A shift's stored pattern (`{ mon: [{ from, to }] }`) as the week strip's
 * hours (`{ mon: [{ start, end }] }`), ignoring anything malformed. Here
 * rather than borrowed from `WeekHours`, which is a client module a server
 * page cannot call into.
 */
export function patternHours(pattern: unknown): Record<string, { start: string; end: string }[]> {
  const out: Record<string, { start: string; end: string }[]> = {};
  if (typeof pattern !== 'object' || pattern === null) return out;
  for (const day of WEEK) {
    const spans = (pattern as Record<string, unknown>)[day];
    if (!Array.isArray(spans)) continue;
    const periods = spans.flatMap((span) =>
      typeof span === 'object' && span !== null && typeof (span as { from?: unknown }).from === 'string' && typeof (span as { to?: unknown }).to === 'string'
        ? [{ start: (span as { from: string }).from, end: (span as { to: string }).to }]
        : [],
    );
    if (periods.length > 0) out[day] = periods;
  }
  return out;
}

/** Today's date as `YYYY-MM-DD` in a zone. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}
