/**
 * Deterministic randomness for the planner (A4 §1.15).
 *
 * `sfc32` is small, fast and passes PractRand to 2^40 or so, which is far
 * more than a four-month story needs. Every draw comes from a named stream,
 * `streamFor(seed, part, key…)`, hashed from the seed and the stream's own
 * name: adding a part, or another ticket to a day, never reshuffles a stream
 * that already existed, so a ticket raised on 28 September tells the same
 * story in every build whose window contains that day.
 *
 * `Math.random` is never used: a plan is a pure function of (seed, T0, scale,
 * generator version), and its hash is recorded in the ledger (W8).
 */

/** cyrb128: four well-mixed 32-bit words from a string. */
function cyrb128(text: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < text.length; i += 1) {
    const k = text.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

/** The sfc32 generator: uniform floats in [0, 1). */
export function sfc32(a: number, b: number, c: number, d: number): () => number {
  let s0 = a >>> 0;
  let s1 = b >>> 0;
  let s2 = c >>> 0;
  let s3 = d >>> 0;
  return () => {
    const t = (((s0 + s1) >>> 0) + s3) >>> 0;
    s3 = (s3 + 1) >>> 0;
    s0 = s1 ^ (s1 >>> 9);
    s1 = (s2 + (s2 << 3)) >>> 0;
    s2 = (s2 << 21) | (s2 >>> 11);
    s2 = (s2 + t) >>> 0;
    return t / 4294967296;
  };
}

export type StreamKey = string | number;

/** A named, seeded source of draws. */
export class Stream {
  private readonly next: () => number;

  constructor(seed: number, keys: readonly StreamKey[]) {
    const [a, b, c, d] = cyrb128(`${seed}|${keys.join('|')}`);
    this.next = sfc32(a, b, c, d);
    // sfc32's first few outputs still carry the seed's structure.
    for (let i = 0; i < 12; i += 1) this.next();
  }

  /** Uniform in [0, 1). */
  float(): number {
    return this.next();
  }

  /** Uniform in [min, max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** A whole number in [min, max], inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError('cannot pick from an empty list');
    return items[Math.floor(this.next() * items.length)] as T;
  }

  /** One key of a weight table; weights need not sum to 1. */
  weighted<K extends string>(weights: Readonly<Partial<Record<K, number>>>): K {
    return weightedPick(weights, this.next());
  }

  /** Gamma(shape, 1) by Marsaglia and Tsang; the daily noise of A4 §1.10.1. */
  gamma(shape: number): number {
    if (shape < 1) return this.gamma(shape + 1) * Math.pow(this.next() || Number.MIN_VALUE, 1 / shape);
    const d = shape - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);
    for (;;) {
      let x: number;
      let v: number;
      do {
        x = this.normal();
        v = 1 + c * x;
      } while (v <= 0);
      v = v * v * v;
      const u = this.next();
      if (u < 1 - 0.0331 * x * x * x * x) return d * v;
      if (Math.log(u || Number.MIN_VALUE) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
  }

  /** Standard normal, Box–Muller. */
  normal(): number {
    const u = this.next() || Number.MIN_VALUE;
    const v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** A shuffled copy (Fisher–Yates). */
  shuffle<T>(items: readonly T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = Math.floor(this.next() * (i + 1));
      [out[i], out[j]] = [out[j] as T, out[i] as T];
    }
    return out;
  }
}

/** The stream for one named part of the plan: `streamFor(seed, 'ticket', ref)`. */
export function streamFor(seed: number, ...keys: StreamKey[]): Stream {
  return new Stream(seed, keys);
}

/** A key of a weight table at quantile `u` in [0, 1): the inverse CDF, in the table's own order. */
export function weightedPick<K extends string>(weights: Readonly<Partial<Record<K, number>>>, u: number): K {
  const entries = Object.entries(weights) as [K, number][];
  const total = entries.reduce((sum, [, weight]) => sum + Math.max(0, weight), 0);
  if (!(total > 0)) throw new RangeError('a weight table needs a positive weight');
  let target = u * total;
  for (const [key, weight] of entries) {
    if (weight <= 0) continue;
    if (target < weight) return key;
    target -= weight;
  }
  // Rounding at u → 1: the last key with any weight.
  return [...entries].reverse().find(([, weight]) => weight > 0)![0];
}

/**
 * Poisson(λ) at quantile `u`: the smallest k with CDF(k) > u. One uniform per
 * day, so a slightly larger λ (a higher `DEMO_SCALE`) adds tickets to a day
 * without renumbering the ones it already had.
 */
export function poissonAt(lambda: number, u: number): number {
  if (!(lambda > 0)) return 0;
  // Beyond ~700 the first term underflows; the demo's days never come close.
  let k = 0;
  let term = Math.exp(-lambda);
  let cdf = term;
  while (cdf <= u && k < 10_000) {
    k += 1;
    term *= lambda / k;
    cdf += term;
  }
  return k;
}

/** Fractional part, always in [0, 1). */
export function frac(value: number): number {
  return value - Math.floor(value);
}

/**
 * Low-discrepancy quantiles for counted decisions (who breaches, who answers a
 * survey, how many stars). A Kronecker sequence over (day, position in the
 * day): every day's draws are evenly spread, and consecutive days are offset
 * by an irrational step, so any run of days hits its expected count within a
 * fraction of one. Independent draws would miss a 30-day band by chance on
 * one night in ten, and the build would refuse to swap (A4 §1.11).
 *
 * `channel` keeps the decisions apart: each has its own irrational steps and
 * its own seeded offset, so a ticket's response verdict says nothing about its
 * resolution verdict.
 */
export function quantile(seed: number, channel: string, dayNumber: number, position: number): number {
  const [a, b] = cyrb128(`${seed}|q|${channel}`);
  const offset = a / 4294967296;
  // Within a day, the golden ratio's conjugate: the most evenly spread step
  // there is. Between days, a step drawn per channel from [0.55, 0.95), so
  // two decisions never walk the same lattice.
  const dayStep = 0.55 + 0.4 * (b / 4294967296);
  const positionStep = 0.6180339887498949;
  return frac(offset + dayNumber * dayStep + position * positionStep);
}
