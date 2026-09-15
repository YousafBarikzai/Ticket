import { ValidationError } from '@itsm/platform';

/**
 * Named periods, resolved to instants.
 *
 * A widget says "last 30 days" rather than storing two dates, so it is still
 * last 30 days next month. A report run stores the instants it used, so the
 * same report re-run later can say what period it covered.
 */

export const RANGES = ['7d', '30d', '90d', '12m', 'ytd', 'custom'] as const;
export type RangeKey = (typeof RANGES)[number];

export type Bucket = 'day' | 'week' | 'month';

export interface Period {
  from: Date;
  to: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfUtcDay(instant: Date): Date {
  return new Date(Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth(), instant.getUTCDate()));
}

/**
 * The instants a named range covers, ending at the start of tomorrow so that
 * today is included in full. A custom range needs both ends and must run
 * forwards; a range of more than three years is refused because it is a table
 * scan somebody typed by accident.
 */
export function resolveRange(range: RangeKey, now: Date = new Date(), custom?: { from?: string; to?: string }): Period {
  const tomorrow = new Date(startOfUtcDay(now).getTime() + DAY_MS);

  switch (range) {
    case '7d':
      return { from: new Date(tomorrow.getTime() - 7 * DAY_MS), to: tomorrow };
    case '30d':
      return { from: new Date(tomorrow.getTime() - 30 * DAY_MS), to: tomorrow };
    case '90d':
      return { from: new Date(tomorrow.getTime() - 90 * DAY_MS), to: tomorrow };
    case '12m': {
      const from = new Date(Date.UTC(now.getUTCFullYear() - 1, now.getUTCMonth() + 1, 1));
      return { from, to: tomorrow };
    }
    case 'ytd':
      return { from: new Date(Date.UTC(now.getUTCFullYear(), 0, 1)), to: tomorrow };
    case 'custom': {
      if (!custom?.from || !custom.to) throw new ValidationError('a custom range needs from and to');
      const from = new Date(custom.from);
      const to = new Date(custom.to);
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw new ValidationError('a custom range needs valid dates');
      if (to <= from) throw new ValidationError('a custom range must end after it starts');
      if (to.getTime() - from.getTime() > 3 * 366 * DAY_MS) throw new ValidationError('a range may cover at most three years');
      return { from, to };
    }
  }
}

/**
 * How finely to slice a period on a time axis: enough points to see a shape,
 * few enough to draw. Ninety days by day is ninety bars; a year by day is a
 * smear.
 */
export function bucketFor(period: Period): Bucket {
  const days = (period.to.getTime() - period.from.getTime()) / DAY_MS;
  if (days <= 92) return 'day';
  if (days <= 400) return 'week';
  return 'month';
}

/** The previous period of the same length, for "compared with last time". */
export function previousPeriod(period: Period): Period {
  const length = period.to.getTime() - period.from.getTime();
  return { from: new Date(period.from.getTime() - length), to: period.from };
}

/** The start of the bucket an instant falls in: UTC midnight, the ISO Monday, or the first. */
export function truncateTo(instant: Date, bucket: Bucket): Date {
  const day = startOfUtcDay(instant);
  if (bucket === 'day') return day;
  if (bucket === 'week') {
    const shift = (day.getUTCDay() + 6) % 7;
    return new Date(day.getTime() - shift * DAY_MS);
  }
  return new Date(Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth(), 1));
}

/**
 * Every bucket start inside a period, so a series has a point for a quiet
 * week rather than a gap that a chart draws as a cliff.
 */
export function bucketStarts(period: Period, bucket: Bucket): Date[] {
  const starts: Date[] = [];
  let cursor = truncateTo(period.from, bucket);
  while (cursor < period.to) {
    starts.push(cursor);
    cursor =
      bucket === 'day'
        ? new Date(cursor.getTime() + DAY_MS)
        : bucket === 'week'
          ? new Date(cursor.getTime() + 7 * DAY_MS)
          : new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
    if (starts.length > 1200) break;
  }
  return starts;
}
