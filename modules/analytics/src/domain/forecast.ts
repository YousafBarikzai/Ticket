/**
 * A straight line through the recent past, extended.
 *
 * Ordinary least squares over a time series, with the fit quality alongside
 * so a widget can say "this is a guess" in a number rather than a footnote. It
 * is deliberately nothing more: no seasonality, no smoothing. A service desk
 * whose Mondays are twice its Fridays gets a line through the middle, and the
 * r² tells it so. Anything cleverer needs a year of rollups to be judged
 * against, and that year does not exist yet.
 */

export interface Point {
  /** An instant on the x axis. */
  at: Date;
  value: number;
}

export interface Trend {
  /** Change per day. */
  slopePerDay: number;
  /** The fitted value at the first observed point. */
  intercept: number;
  /** 0 = the line explains nothing; 1 = every point sits on it. */
  rSquared: number;
  /** Fitted values for the observed points, then the projected ones. */
  fitted: Point[];
  projected: Point[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Fits a line and projects it `horizonDays` past the last point.
 *
 * Fewer than three points is a line through anything, so it returns null
 * rather than a confident-looking projection from two numbers. A projection
 * is never allowed below zero: a count cannot be negative and a line that
 * says otherwise is a line that has run out of information.
 */
export function linearTrend(points: Point[], horizonDays: number, stepDays = 1): Trend | null {
  const observed = [...points].sort((a, b) => a.at.getTime() - b.at.getTime());
  if (observed.length < 3 || horizonDays <= 0) return null;

  const origin = observed[0]!.at.getTime();
  const xs = observed.map((point) => (point.at.getTime() - origin) / DAY_MS);
  const ys = observed.map((point) => point.value);
  const n = xs.length;

  const meanX = xs.reduce((sum, x) => sum + x, 0) / n;
  const meanY = ys.reduce((sum, y) => sum + y, 0) / n;

  let covariance = 0;
  let varianceX = 0;
  for (let i = 0; i < n; i += 1) {
    covariance += (xs[i]! - meanX) * (ys[i]! - meanY);
    varianceX += (xs[i]! - meanX) ** 2;
  }

  // Every point on the same day: no direction to speak of.
  if (varianceX === 0) return null;

  const slope = covariance / varianceX;
  const intercept = meanY - slope * meanX;

  let residual = 0;
  let total = 0;
  for (let i = 0; i < n; i += 1) {
    const predicted = intercept + slope * xs[i]!;
    residual += (ys[i]! - predicted) ** 2;
    total += (ys[i]! - meanY) ** 2;
  }
  const rSquared = total === 0 ? 1 : Math.max(0, 1 - residual / total);

  const fitted = observed.map((point, i) => ({ at: point.at, value: round(intercept + slope * xs[i]!) }));

  const projected: Point[] = [];
  const lastX = xs[n - 1]!;
  for (let x = lastX + stepDays; x <= lastX + horizonDays; x += stepDays) {
    projected.push({ at: new Date(origin + x * DAY_MS), value: Math.max(0, round(intercept + slope * x)) });
  }

  return { slopePerDay: round(slope, 4), intercept: round(intercept), rSquared: round(rSquared, 3), fitted, projected };
}

function round(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
