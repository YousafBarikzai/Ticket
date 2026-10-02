import type { ChartTone } from './types.js';

/**
 * Chart tones as paint (v3 §2.6). Server-safe: strings, nothing else.
 *
 * Each status tone paints with its intent's `border` slot rather than its
 * `solid`: the border is the colour the contrast audit holds at 3:1 against
 * every surface a chart sits on (SC 1.4.11, non-text contrast), in all four
 * themes, and it is the same hue the matching `StatusPill` carries — so the P2
 * segment of a bar and the P2 chip beside it are visibly one thing.
 *
 * `neutralSoft` is the exception. Its fill is deliberately quiet and does not
 * reach 3:1 on its own, so the mark that uses it must also draw the outline
 * in `chartToneOutline`, which does.
 */
export const chartToneVar: Readonly<Record<ChartTone, string>> = Object.freeze({
  danger: 'var(--itsm-colour-danger-border)',
  high: 'var(--itsm-colour-high-border)',
  warning: 'var(--itsm-colour-warning-border)',
  success: 'var(--itsm-colour-success-border)',
  info: 'var(--itsm-colour-info-border)',
  hold: 'var(--itsm-colour-hold-border)',
  neutral: 'var(--itsm-colour-neutral-border)',
  neutralSoft: 'var(--itsm-colour-chart-neutralSoft)',
});

/** The outline a tone's mark must carry to keep its 3:1 boundary; only `neutralSoft` needs one. */
export const chartToneOutline: Readonly<Partial<Record<ChartTone, string>>> = Object.freeze({
  neutralSoft: 'var(--itsm-colour-neutral-border)',
});
