/**
 * When a notification may actually reach someone (MOD-11-E1).
 *
 * Two preferences decide this, and they are different questions. **Quiet hours**
 * ask "not now, but later" — the message is held and sent when the window opens.
 * **Digest mode** asks "not separately" — the message waits to be rolled up with
 * whatever else arrives. Conflating them produces the worst outcome of both: a
 * message that is neither prompt nor batched.
 *
 * Pure functions with an injected clock, so the awkward cases — a window that
 * crosses midnight, a user in a different time zone from the server, a digest
 * boundary that has already passed today — are testable without waiting for
 * them to happen.
 */

export interface QuietHours {
  /** Local `HH:mm` in the recipient's time zone. */
  start: string;
  end: string;
}

export type DigestMode = 'immediate' | 'hourly' | 'daily';

export interface DeliveryDecision {
  deliver: boolean;
  /** When to try again. Absent when delivering now. */
  deferUntil?: Date;
  reason?: 'quiet_hours' | 'digest';
}

function minutesOfDay(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** The recipient's local wall-clock minutes and date, from an instant. */
export function localParts(at: Date, timeZone: string): { minutes: number; y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(at);

  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  // Intl renders midnight as 24 in some locales; normalise so arithmetic holds.
  const hour = get('hour') % 24;
  return { minutes: hour * 60 + get('minute'), y: get('year'), m: get('month'), d: get('day') };
}

/**
 * Turns a local wall-clock time on a given local date into an instant.
 *
 * Done by probing rather than by arithmetic: adding an offset would be wrong
 * across a daylight-saving change, which is exactly when a quiet-hours window
 * silently shifts by an hour and someone is woken up.
 */
export function instantForLocalTime(
  timeZone: string,
  date: { y: number; m: number; d: number },
  minutes: number,
): Date {
  const guess = Date.UTC(date.y, date.m - 1, date.d, Math.floor(minutes / 60), minutes % 60);
  // Two passes converge for every real zone offset, including half-hour ones.
  let instant = new Date(guess);
  for (let pass = 0; pass < 2; pass += 1) {
    const local = localParts(instant, timeZone);
    const localGuess = Date.UTC(local.y, local.m - 1, local.d, Math.floor(local.minutes / 60), local.minutes % 60);
    instant = new Date(instant.getTime() + (guess - localGuess));
  }
  return instant;
}

/** Whether `now` falls inside a quiet-hours window, which may cross midnight. */
export function inQuietHours(now: Date, timeZone: string, quiet: QuietHours): boolean {
  const start = minutesOfDay(quiet.start);
  const end = minutesOfDay(quiet.end);
  if (start === null || end === null || start === end) return false;

  const { minutes } = localParts(now, timeZone);
  // 22:00–07:00 wraps midnight; 09:00–17:00 does not.
  return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}

/** The instant a quiet-hours window next opens, after `now`. */
export function quietHoursEnd(now: Date, timeZone: string, quiet: QuietHours): Date {
  const end = minutesOfDay(quiet.end)!;
  const local = localParts(now, timeZone);
  const today = instantForLocalTime(timeZone, local, end);
  if (today.getTime() > now.getTime()) return today;

  // The window ends tomorrow: step a day forward in local terms, not by adding
  // 86 400 000 milliseconds, which is wrong on a clock-change day.
  const tomorrow = localParts(new Date(now.getTime() + 24 * 60 * 60 * 1000), timeZone);
  return instantForLocalTime(timeZone, tomorrow, end);
}

/** The next boundary at which a digest of this mode is sent. */
export function nextDigestBoundary(now: Date, timeZone: string, mode: DigestMode): Date {
  if (mode === 'hourly') {
    const next = new Date(now);
    next.setUTCMinutes(0, 0, 0);
    return new Date(next.getTime() + 60 * 60 * 1000);
  }
  // Daily digests land at 08:00 in the recipient's own morning.
  const local = localParts(now, timeZone);
  const today = instantForLocalTime(timeZone, local, 8 * 60);
  if (today.getTime() > now.getTime()) return today;
  const tomorrow = localParts(new Date(now.getTime() + 24 * 60 * 60 * 1000), timeZone);
  return instantForLocalTime(timeZone, tomorrow, 8 * 60);
}

/**
 * The decision for one message.
 *
 * Digest mode is checked first: someone who has asked for a daily summary has
 * said something about *every* message, whereas quiet hours only say something
 * about the ones that would arrive at 3am.
 */
export function decideDelivery(
  now: Date,
  recipient: { timeZone: string },
  preference: { quietHours?: QuietHours | null; digestMode?: string | null } | null,
  options: { urgent?: boolean } = {},
): DeliveryDecision {
  if (!preference) return { deliver: true };

  // An urgent message — a P1 breach, a major incident — overrides both. Someone
  // who set quiet hours did not mean "do not tell me the building is on fire".
  if (options.urgent) return { deliver: true };

  const mode = (preference.digestMode ?? 'immediate') as DigestMode;
  if (mode === 'hourly' || mode === 'daily') {
    return { deliver: false, deferUntil: nextDigestBoundary(now, recipient.timeZone, mode), reason: 'digest' };
  }

  const quiet = preference.quietHours ?? null;
  if (quiet && inQuietHours(now, recipient.timeZone, quiet)) {
    return { deliver: false, deferUntil: quietHoursEnd(now, recipient.timeZone, quiet), reason: 'quiet_hours' };
  }

  return { deliver: true };
}
