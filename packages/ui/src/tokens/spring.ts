/**
 * The spring easing, precomputed.
 *
 * CSS has no spring timing function, but it has `linear()`: a piecewise-linear
 * curve through as many points as you like. Sampling the step response of a
 * damped spring and writing the samples out gives a curve that settles with
 * the small overshoot a real spring has — the thing that makes a switch thumb
 * feel as though it arrived rather than stopped.
 *
 * It is computed here, once, at module load, rather than typed in as a list of
 * numbers: the damping ratio is the design decision, and the samples are only
 * its consequence. Change the ratio and the curve follows.
 *
 * Browsers without `linear()` treat the variable as invalid at computed-value
 * time, which falls back to the property's initial value, `ease`. That is an
 * acceptable spring for somebody on an older engine.
 */

export interface SpringOptions {
  /** Damping ratio ζ, 0 < ζ < 1. Lower overshoots more; 1 would not overshoot at all. */
  readonly damping: number;
  /** How many points to sample, including both ends. */
  readonly samples?: number;
  /**
   * How far the oscillation's envelope may still be from rest when the curve
   * ends. The natural frequency is chosen so the spring has settled to within
   * this by the end of the transition, so the last sample can be pinned to 1
   * without a visible jump.
   */
  readonly settle?: number;
}

/** The fraction by which a spring of this damping ratio overshoots its target (0.011 is 1.1 %). */
export function springOvershoot(damping: number): number {
  return Math.exp((-damping * Math.PI) / Math.sqrt(1 - damping * damping));
}

/**
 * The step response of an underdamped spring, sampled on [0, 1] and rendered
 * as a CSS `linear()` easing.
 *
 * x(t) = 1 − e^(−ζωt) · (cos ω_d t + ζ/√(1−ζ²) · sin ω_d t), with ω chosen so the
 * envelope e^(−ζωt) has fallen to `settle` at t = 1.
 */
export function springCurve({ damping, samples = 21, settle = 0.001 }: SpringOptions): string {
  if (!(damping > 0 && damping < 1)) throw new Error(`spring damping must be between 0 and 1, got ${damping}`);
  if (samples < 3) throw new Error('a spring curve needs at least three samples');

  const omega = -Math.log(settle) / damping;
  const root = Math.sqrt(1 - damping * damping);
  const damped = omega * root;

  const points: string[] = [];
  for (let index = 0; index < samples; index++) {
    const t = index / (samples - 1);
    const value =
      index === 0
        ? 0
        : index === samples - 1
          ? 1
          : 1 - Math.exp(-damping * omega * t) * (Math.cos(damped * t) + (damping / root) * Math.sin(damped * t));
    // Three decimals: a thousandth of the distance travelled is below what a
    // 60 Hz frame can show for any transition this system runs.
    points.push(String(Number(value.toFixed(3))));
  }
  return `linear(${points.join(', ')})`;
}

/**
 * The one spring the system uses: ζ 0.82, which overshoots by 1.1 %. Enough to
 * read as physical, not enough to wobble. Only the switch and segmented-control
 * thumbs and the tab underline use it (redesign spec §1.9).
 */
export const spring = { damping: 0.82 } as const;

/** `spring` as a CSS timing function, emitted as `--itsm-easing-spring`. */
export const springEasing: string = springCurve(spring);
