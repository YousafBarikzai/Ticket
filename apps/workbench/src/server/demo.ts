import { demoDisabledSentence, type DemoFeature } from '@itsm/contracts/demo';
import type { Me } from '@itsm/sdk';

/**
 * The one reader of `me.demo` for Service Desk pages (A6 §3.2 rule 7, SPEC
 * §7.0.2). `me.demo` is present only in a shared-demo session, so every
 * demo rule a page applies — a control locked with the canonical sentence,
 * "View as requester" offered for Emma Clarke's tickets, a cross-area link
 * only into Alex Morgan's teams — reads it through here, and a real account,
 * which never carries `demo`, gets the full product from the same calls.
 *
 * Pure functions of `me` with nothing secret in them: a server page calls
 * them to decide what to draw, and a client island that already holds `me`
 * may call them too, so this module deliberately does not import
 * `server-only`. The Help Portal has its own copy (`apps/portal/src/server/
 * demo.ts`); Administration's reader is `demoOf()` in its own `server/demo.ts`.
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
 * `<Button {...demoLock(me, 'roles')}>` — and nothing for one that works.
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
 * The Employee persona's user id in this generation (Emma Clarke), or `null`
 * outside the demo. "View as requester" opens the Help Portal as Emma, so in
 * the demo it is offered only on her tickets (A6 §5.6, WP-47).
 */
export function employeeUserId(me: DemoReader): string | null {
  return isDemo(me) ? personaId(me.demo.personaUserIds?.employee) : null;
}

/**
 * The agent persona's teams (Alex Morgan's). A link into the Service Desk
 * from another area lands on a ticket only Alex can open when its group is
 * one of these (X-B2); outside the demo the list is empty and unused, because
 * a real account opens what the API lets it.
 */
export function agentTeamIds(me: DemoReader): readonly string[] {
  if (!isDemo(me)) return [];
  const ids: unknown = me.demo.agentTeamIds;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string' && id.length > 0) : [];
}
