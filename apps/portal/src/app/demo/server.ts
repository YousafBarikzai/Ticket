import { AREAS, SITE, appOrigins } from '@itsm/contracts/areas';
import { DEMO_RESET, demoPersonaForArea, nextResetAt, periodMs, type DemoPersona } from '@itsm/contracts/demo';
import type { DemoBarProps } from '@itsm/ui/shell';
import { bff } from '../../bff.js';

/**
 * The facts the Help Portal's demo surfaces are worded from (SPEC v3 §4.6):
 * the area, its persona, the public site's home, the mode switch and the
 * reset clock. Server-side, and free of client components on purpose: the
 * `(portal)` layout reads the clock from here, and anything this module
 * imported that was a client component would land in the first load of
 * every page under it.
 */

/** This app's area: every name on these pages is `AREAS.portal.name` ("Help Portal", D1). */
export const AREA = AREAS.portal;

/** The persona this app mints (D11): Emma Clarke, Finance Manager. */
export const PERSONA: DemoPersona = demoPersonaForArea('portal');

/** The area as a sentence names it: "the Help Portal". */
export const AREA_IN_SENTENCE = `the ${AREA.name}`;

/** "IT Service Management home" (D18). */
export const HOME_LABEL = SITE.homeLabel;

/** §4.6.2's `ended` row: what a demo visit that ended says, on `/demo` and in the frame's dialog. */
export const DEMO_ENDED_BODY = 'Pick up where you left off — the demo data may have been reset since.';

/** Whether `DEMO_MODE=on` here: the bar, the demo's links and the explore offers exist only then. */
export function demoModeOn(): boolean {
  return bff.config.demo !== null;
}

/**
 * The public site's home (D18), or `null` where the deployment has not set
 * its origin — a link to nowhere is worse than none. Read through
 * `appOrigins`, never a variable by name (`no-raw-origins.test.ts`).
 */
export function siteHome(env: Readonly<Record<string, string | undefined>> = process.env): string | null {
  const site = appOrigins(env).site;
  return site ? `${site}/` : null;
}

/**
 * The reset clock the bar counts down to, computed from the pure UK clock —
 * never a store read — so the first paint and the countdown agree to the
 * second, through both daylight-saving changes.
 */
export function demoClock(now: number = Date.now()): DemoBarProps['clock'] {
  return { nextResetAt: nextResetAt(now), serverNow: now, periodMs: periodMs(now), resetLabel: DEMO_RESET.label, timeZone: DEMO_RESET.timeZone };
}
