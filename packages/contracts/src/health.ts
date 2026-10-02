/**
 * `@itsm/contracts/health` — the one vocabulary for a health verdict (R7, X-M3).
 *
 * The Service Desk Overview judges its queue (`queueVerdict()`) and the
 * Administration Command centre judges the service (`serviceHealth()`). Both
 * heroes say On track, At risk or Off track, with the same tone and glyph,
 * because both return this type and read their words from this map: two
 * hand-typed vocabularies had already drifted into "Breaching", "Healthy" and
 * "Degraded" in the designs. "Breached" stays the word for an SLA chip, and
 * "Degraded" belongs to status-page components only.
 *
 * Zod-free and import-free, like `demo.ts`: a hero renders in the browser.
 * The tone and icon names mirror `@itsm/ui` rather than importing it, so the
 * server can compute a verdict without a design system.
 */

/** Best first: the order is the comparison `worstHealthVerdict` uses. */
export const HEALTH_VERDICTS = Object.freeze(['on_track', 'at_risk', 'off_track'] as const);
export type HealthVerdict = (typeof HEALTH_VERDICTS)[number];

/** The `@itsm/ui` tones a verdict may take: never `accent`, never a categorical colour (D5). */
export type HealthTone = 'success' | 'warning' | 'danger';

/** The `@itsm/ui` icon names a verdict may take. */
export type HealthIcon = 'circle-check' | 'triangle-alert' | 'circle-x';

export interface HealthVerdictLook {
  readonly label: string;
  readonly tone: HealthTone;
  readonly icon: HealthIcon;
}

export const HEALTH_VERDICT_LOOK: Readonly<Record<HealthVerdict, HealthVerdictLook>> = Object.freeze({
  on_track: Object.freeze({ label: 'On track', tone: 'success', icon: 'circle-check' }),
  at_risk: Object.freeze({ label: 'At risk', tone: 'warning', icon: 'triangle-alert' }),
  off_track: Object.freeze({ label: 'Off track', tone: 'danger', icon: 'circle-x' }),
} as const);

/** The labels alone, for tests and headlines that import the words rather than retype them. */
export const HEALTH_VERDICT_LABELS: Readonly<Record<HealthVerdict, string>> = Object.freeze({
  on_track: HEALTH_VERDICT_LOOK.on_track.label,
  at_risk: HEALTH_VERDICT_LOOK.at_risk.label,
  off_track: HEALTH_VERDICT_LOOK.off_track.label,
});

export function isHealthVerdict(value: unknown): value is HealthVerdict {
  return typeof value === 'string' && (HEALTH_VERDICTS as readonly string[]).includes(value);
}

export function healthVerdictLabel(verdict: HealthVerdict): string {
  return HEALTH_VERDICT_LOOK[verdict].label;
}

/** Negative when `a` is healthier than `b`; sorts best first. */
export function compareHealthVerdicts(a: HealthVerdict, b: HealthVerdict): number {
  return HEALTH_VERDICTS.indexOf(a) - HEALTH_VERDICTS.indexOf(b);
}

/**
 * The worst of a set of dimension verdicts: a hero is only as healthy as its
 * worst shown dimension. Dimensions the viewer may not see are passed as
 * `null` and ignored; with none left there is no verdict to give.
 */
export function worstHealthVerdict(verdicts: Iterable<HealthVerdict | null | undefined>): HealthVerdict | null {
  let worst: HealthVerdict | null = null;
  for (const verdict of verdicts) {
    if (!verdict || !isHealthVerdict(verdict)) continue;
    if (worst === null || compareHealthVerdicts(verdict, worst) > 0) worst = verdict;
  }
  return worst;
}

/** The verdict a dimension's tone stands for, for dimensions that are banded by tone. */
export function healthVerdictForTone(tone: HealthTone): HealthVerdict {
  switch (tone) {
    case 'success':
      return 'on_track';
    case 'warning':
      return 'at_risk';
    case 'danger':
      return 'off_track';
  }
}
