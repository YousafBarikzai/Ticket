/**
 * The backlog over time, derived (A7 §2.3; charts.md §11).
 *
 * The API counts what is open *now* exactly (`/tickets/count`), but it keeps
 * no history of that count. What it does keep are the tickets raised and
 * resolved each day. Walking back from today, the backlog at the end of a
 * bucket is what is open now, less everything raised after it, plus
 * everything resolved after it:
 *
 *     open(t) = open now − Σ raised after t + Σ resolved after t
 *
 * It is an estimate — a ticket reopened or merged moves the real figure
 * without moving either line — so every place that draws it says so
 * (`BACKLOG_ESTIMATE`), and it never goes below zero, which the arithmetic
 * alone could reach on a desk that closed old tickets in bulk.
 *
 * Pure: the tests hold the arithmetic to a worked example.
 */

/** The words every derived backlog carries: in an InfoTip, a caption, a headline. */
export const BACKLOG_ESTIMATE = 'estimated from raised and resolved';

export interface SeriesPoint {
  /** The bucket's start, an ISO instant, as the API's series gives it. */
  readonly at: string;
  readonly value: number | null;
}

export interface BacklogPoint {
  readonly at: string;
  readonly value: number;
}

/**
 * The open count at the end of each bucket of `raised`, ending at `openNow`.
 *
 * `raised` and `resolved` are the same buckets (the same range and bucket
 * size asked twice); a bucket missing from `resolved`, or a `null` value,
 * counts as nothing resolved. With no buckets there is no line.
 */
export function deriveBacklog(openNow: number, raised: readonly SeriesPoint[], resolved: readonly SeriesPoint[]): BacklogPoint[] {
  if (raised.length === 0 || !Number.isFinite(openNow)) return [];
  const resolvedAt = new Map(resolved.map((point) => [point.at, point.value ?? 0]));
  const points = new Array<BacklogPoint>(raised.length);
  let open = Math.max(0, openNow);
  for (let index = raised.length - 1; index >= 0; index -= 1) {
    const bucket = raised[index]!;
    points[index] = { at: bucket.at, value: Math.max(0, Math.round(open)) };
    // Step back across this bucket: what it raised was not open before it, what it resolved was.
    open = open - (bucket.value ?? 0) + (resolvedAt.get(bucket.at) ?? 0);
  }
  return points;
}

/** The backlog at the start of the range: the first point's value, less its own bucket's change. */
export function backlogAtStart(openNow: number, raised: readonly SeriesPoint[], resolved: readonly SeriesPoint[]): number | null {
  if (raised.length === 0) return null;
  const raisedTotal = raised.reduce((sum, point) => sum + (point.value ?? 0), 0);
  const resolvedTotal = resolved.reduce((sum, point) => sum + (point.value ?? 0), 0);
  return Math.max(0, Math.round(openNow - raisedTotal + resolvedTotal));
}
