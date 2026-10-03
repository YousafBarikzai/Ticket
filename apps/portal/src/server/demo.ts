import { demoDisabledSentence, type DemoFeature } from '@itsm/contracts/demo';
import type { Me } from '@itsm/sdk';

/**
 * The one reader of `me.demo` for Help Portal pages (A6 §3.2 rule 7, SPEC
 * §7.0.2). `me.demo` is present only in a shared-demo session, so every
 * demo rule a page applies — Devices hidden on Profile, an upload or a
 * setting locked with the canonical sentence, "Open in Service Desk (as Alex
 * Morgan)" offered only for tickets in Alex's teams (X-B2) — reads it
 * through here, and a real account, which never carries `demo`, gets the
 * full product from the same calls.
 *
 * Pure functions of `me` with nothing secret in them: a server page calls
 * them to decide what to draw, and a client island that already holds `me`
 * may call them too, so this module deliberately does not import
 * `server-only`. The Service Desk keeps the same functions in its own
 * `server/demo.ts`: two small copies cost less than a package that exists
 * only to share them.
 */

/** Only the part of `me` these helpers read, so a test or a narrower caller need not build a whole `Me`. */
export type DemoReader = Pick<Me, 'demo'> | null | undefined;

/** A `me` known to be a demo session's. */
export type DemoMe = Pick<Me, 'demo'> & { readonly demo: NonNullable<Me['demo']> };

/** Whether this is a shared-demo session. */
export function isDemo(me: DemoReader): me is DemoMe {
  return typeof me?.demo === 'object' && me.demo !== null;
}

/** What `demoLock` spreads into a `Button`. */
export interface DemoLockProps {
  readonly disabledReason?: string;
  readonly disabledIcon?: 'lock';
}

/**
 * The sentence a control shows when the shared demo turns its feature off,
 * or `null` when the control works — so it reads as a test too
 * (`if (demoDisabled(me, 'uploads'))`). The control is drawn disabled with
 * this sentence and a lock, never hidden (SPEC §7.0.2): a visitor learns the
 * feature exists. A feature this build does not know is never "disabled":
 * `disabledFeatures` may name one from a newer API, and only the API can
 * refuse it.
 */
export function demoDisabled(me: DemoReader, feature: DemoFeature): string | null {
  if (!isDemo(me) || !Array.isArray(me.demo.disabledFeatures)) return null;
  return me.demo.disabledFeatures.includes(feature) ? demoDisabledSentence(feature) : null;
}

/**
 * The props that lock a `Button` for a feature the demo turns off —
 * `<Button {...demoLock(me, 'uploads')}>` — and nothing for one that works.
 */
export function demoLock(me: DemoReader, feature: DemoFeature): DemoLockProps {
  const reason = demoDisabled(me, feature);
  return reason === null ? {} : { disabledReason: reason, disabledIcon: 'lock' };
}

/** A persona's user id as the API sent it: a non-empty string, or nothing. */
function personaId(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * The Employee persona's user id in this generation (Emma Clarke — the
 * visitor, in the Help Portal), or `null` outside the demo.
 */
export function employeeUserId(me: DemoReader): string | null {
  return isDemo(me) ? personaId(me.demo.personaUserIds?.employee) : null;
}

/**
 * The agent persona's teams (Alex Morgan's). "Open in Service Desk (as Alex
 * Morgan)" is offered on a request only when its `groupId` is one of these,
 * because anywhere else Alex could not open it (X-B2; `crossAreaTicketHref`
 * in `@itsm/contracts/areas` applies the rule to the area model). Outside the
 * demo the list is empty and unused.
 */
export function agentTeamIds(me: DemoReader): readonly string[] {
  if (!isDemo(me)) return [];
  const ids: unknown = me.demo.agentTeamIds;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string' && id.length > 0) : [];
}
