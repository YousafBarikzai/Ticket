import 'server-only';
import type { Admin, Me } from '@itsm/sdk';
import type { TabNavItem } from '@itsm/ui/shell';
import { isPending, mayOpen, routeFor, tabsFor } from '../../../../navigation.js';
import { holds, permissionLabel } from '../../../../permissions.js';
import { read } from '../../../../server/read.js';
import { asMode, type ModeState, type TriageMode } from '../../../../triage.js';
import { RANGES, type RangeDays } from '../../../../components/ai-triage/decisions.js';

/**
 * What the AI triage tabs share (SPEC §6.1 `/ai-triage/**`, X-31): the
 * tabs, the range control's links, who may change the mode, and the three
 * switches behind it.
 */

export const MODE_SETTING = 'ai.decision.triage.mode';
export const TRIAGE_FLAG = 'ai.decision.triage';
export const AI_FLAG = 'ai.enabled';

/** Changing the mode writes a setting and may turn a switch on: both permissions, not either. */
export const MODE_WRITE = ['admin.flag.manage', 'admin.setting.manage'] as const;

export function triageTabs(me: Me): TabNavItem[] {
  return tabsFor(me, 'ai-triage');
}

export function mayChangeMode(me: Me): boolean {
  return MODE_WRITE.every((permission) => holds(me, permission));
}

/** The *View only* pill for someone who may not change the mode: the first permission they lack, in words. */
export function modeViewOnly(me: Me): { readonly label: string; readonly permission: string; readonly key: string } | undefined {
  const missing = MODE_WRITE.find((permission) => !holds(me, permission));
  return missing ? { label: 'AI triage', permission: permissionLabel(missing), key: missing } : undefined;
}

/** The range control's segments: real links that keep the page and change `?days=`. */
export function rangeOptions(path: string): { value: string; label: string; href: string }[] {
  return RANGES.map((days: RangeDays) => ({ value: String(days), label: `${days} days`, href: days === 30 ? path : `${path}?days=${days}` }));
}

/**
 * The switches behind the mode, where this person may read settings; each
 * part null when it could not be read. `effective` is the API's answer
 * (`score.mode`), which already folds all three together.
 */
export async function modeState(me: Me, api: Admin, effective: string): Promise<ModeState> {
  const mode = asMode(effective);
  if (!holds(me, 'admin.setting.read')) return { aiEnabled: null, flag: null, stored: null, effective: mode };
  const [flags, setting] = await Promise.all([read(() => api.tenant.flags()), read(() => api.tenant.setting(MODE_SETTING))]);
  const flag = (key: string): boolean | null => (flags.ok ? (flags.value.find((row) => row.key === key)?.value ?? null) : null);
  return {
    aiEnabled: flag(AI_FLAG),
    flag: flag(TRIAGE_FLAG),
    stored: setting.ok ? asMode(setting.value.value) : null,
    effective: mode,
  };
}

/** A link to a page this person may open and that exists, or undefined. */
export function reachable(me: Me, href: string): string | undefined {
  const route = routeFor(href);
  return route !== null && !isPending(route) && mayOpen(me, route) ? href : undefined;
}

export function originOf(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

export type { TriageMode };
