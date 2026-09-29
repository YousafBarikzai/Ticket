/**
 * Durations in minutes: shown as "4 h 15 min", typed as "4h", "2d 3h", "90m"
 * or "90".
 *
 * Minutes because that is the unit every SLA target and business-time
 * calculation in the API already uses. Hand-rolled rather than
 * `Intl.DurationFormat`, which the browsers the product supports do not all
 * have.
 *
 * Stub (SPEC §4.1): the signatures are the contract; the foundations package
 * replaces the English-only formatting with `Intl.NumberFormat` units and
 * `Intl.ListFormat`, and tests both functions.
 */

export interface FormatDurationOptions {
  readonly style?: 'short' | 'long';
  readonly locale?: string;
}

const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;

export function formatDuration(minutes: number, { style = 'short' }: FormatDurationOptions = {}): string {
  const total = Math.max(0, Math.round(minutes));
  const days = Math.floor(total / MINUTES_PER_DAY);
  const hours = Math.floor((total % MINUTES_PER_DAY) / MINUTES_PER_HOUR);
  const rest = total % MINUTES_PER_HOUR;
  const long = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
  const parts: string[] = [];
  if (days) parts.push(style === 'long' ? long(days, 'day') : `${days} d`);
  if (hours) parts.push(style === 'long' ? long(hours, 'hour') : `${hours} h`);
  if (rest || parts.length === 0) parts.push(style === 'long' ? long(rest, 'minute') : `${rest} min`);
  return parts.join(' ');
}

const unitMinutes: Record<string, number> = { d: MINUTES_PER_DAY, h: MINUTES_PER_HOUR, m: 1 };

/**
 * Minutes from what a person typed, or `null` when it is not a duration.
 * A bare number is minutes. Zero and negative values are not rejected here —
 * that is the field's message to give, in words, not a parse failure.
 */
export function parseDuration(text: string): number | null {
  const input = text.trim().toLowerCase();
  if (input === '') return null;
  if (/^-?\d+(?:\.\d+)?$/.test(input)) return Math.round(Number(input));
  // Longest spelling first: alternation takes the first that fits, so `h` before
  // `hours` would match the "h" and leave "ours" unparsed.
  const part = /(\d+(?:\.\d+)?)\s*(days?|d|hours?|hrs?|h|minutes?|mins?|m)\s*/y;
  let total = 0;
  let index = 0;
  while (index < input.length) {
    part.lastIndex = index;
    const match = part.exec(input);
    if (!match) return null;
    total += Number(match[1]) * unitMinutes[match[2]!.charAt(0)]!;
    index = part.lastIndex;
  }
  return Math.round(total);
}
