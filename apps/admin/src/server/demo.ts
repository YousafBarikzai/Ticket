import { DEMO_FEATURES, demoDisabledSentence, isDemoLockedSetting, type DemoFeature } from '@itsm/contracts/demo';
import type { Me } from '@itsm/sdk';

/**
 * Administration's one reader of `me.demo` (A7 §2.3, §2.8; SPEC §7.0.2).
 *
 * `me.demo` is present only in a shared-demo session, so every demo rule a
 * page applies — a write shown locked with the canonical sentence, a locked
 * setting's pill, the ranges D17 hides — reads it here, and a real account,
 * which never carries `demo`, gets the full product from the same calls.
 *
 * Pure functions of `me`, with nothing secret in them, so this module does
 * not import `server-only`: the page kit's client islands may call them with
 * the `me` they were given. The Service Desk and the Help Portal have their
 * own copies (`apps/{workbench,portal}/src/server/demo.ts`) with the same
 * rules.
 */

/** Only the part of `me` these helpers read. */
export type DemoReader = Pick<Me, 'demo'> | null | undefined;

export interface DemoState {
  /** A shared-demo session. */
  readonly on: boolean;
  /** The features the demo turns off, known to this build. */
  readonly disabled: ReadonlySet<DemoFeature>;
  /** The persona user ids (Emma, Alex, Jordan) in this generation, where the API sent them. */
  readonly personaUserIds: ReadonlySet<string>;
  /** Alex Morgan's teams: a Service Desk link lands only on their tickets (X-B2). */
  readonly agentTeamIds: readonly string[];
}

const OFF: DemoState = Object.freeze({ on: false, disabled: new Set<DemoFeature>(), personaUserIds: new Set<string>(), agentTeamIds: Object.freeze([]) as readonly string[] });

const KNOWN = new Set<string>(DEMO_FEATURES);

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0) : [];
}

/**
 * The demo, as a page needs it. A feature this build does not know is never
 * "disabled" here: `disabledFeatures` may name one from a newer API, and only
 * the API can refuse it.
 */
export function demoOf(me: DemoReader): DemoState {
  const demo = me?.demo;
  if (typeof demo !== 'object' || demo === null) return OFF;
  const disabled = new Set(strings(demo.disabledFeatures).filter((feature): feature is DemoFeature => KNOWN.has(feature)));
  const ids = demo.personaUserIds && typeof demo.personaUserIds === 'object' ? Object.values(demo.personaUserIds as Record<string, unknown>) : [];
  return { on: true, disabled, personaUserIds: new Set(strings(ids)), agentTeamIds: strings(demo.agentTeamIds) };
}

/** Whether the shared demo turns this feature off. */
export function isDisabled(me: DemoReader, feature: DemoFeature): boolean {
  return demoOf(me).disabled.has(feature);
}

/**
 * The sentence a locked control carries — "This is a shared demo, so … is
 * turned off. Everything else works as in the full product." — or `null`
 * when the control works. The control is drawn disabled with it, never
 * hidden (SPEC §7.0.2).
 */
export function disabledReason(me: DemoReader, feature: DemoFeature): string | null {
  return isDisabled(me, feature) ? demoDisabledSentence(feature) : null;
}

/** Whether a setting row shows the demo's lock pill (`DEMO_LOCKED_SETTINGS`, Y-M12): never outside the demo. */
export function isSettingLocked(me: DemoReader, key: string): boolean {
  return demoOf(me).on && isDemoLockedSetting(key);
}

/** Whether a person is one of the demo's three personas, whom nobody may deactivate (A7 §2.8 `personas`). */
export function isPersona(me: DemoReader, userId: string | null | undefined): boolean {
  return typeof userId === 'string' && demoOf(me).personaUserIds.has(userId);
}
