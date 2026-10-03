import type { MetricResult } from './resources/insights.js';
import type { Me } from './resources/types.js';

/**
 * Three small questions every page asks of what the API answered, written
 * once so no page answers them its own way.
 *
 * Pure, and with type-only imports: client components call these, so this
 * file must bring nothing else into a browser bundle with it.
 */

/** How far a permission reaches. `any` is the whole tenant, `team` the holder's teams, `own` their own records. */
export type PermissionScope = 'own' | 'team' | 'any';

const SCOPE_RANK: Readonly<Record<PermissionScope, number>> = { own: 1, team: 2, any: 3 };

function isScope(value: unknown): value is PermissionScope {
  return value === 'own' || value === 'team' || value === 'any';
}

/**
 * The scope a person holds a permission at, from `me.permissions`, or null
 * when they do not hold it. The widest wins: any > team > own.
 *
 * Pages decide *before* they ask. An agent holds no `analytics.read` (D9), so
 * a Service Desk page that asked for a trend and caught the 403 would spend a
 * round trip to learn what `/me` already said, and draw an error where the
 * card should simply not be. A team-scoped answer is still an answer: its
 * figures read "in your teams".
 */
export function permissionScope(me: Pick<Me, 'permissions'> | null | undefined, key: string): PermissionScope | null {
  let widest: PermissionScope | null = null;
  for (const grant of me?.permissions ?? []) {
    // A scope this release does not know grants nothing it can reason about.
    if (grant.key !== key || !isScope(grant.scope)) continue;
    if (widest === null || SCOPE_RANK[grant.scope] > SCOPE_RANK[widest]) widest = grant.scope;
  }
  return widest;
}

/** The SLA attainment target, ready to draw: a gauge's needle wants the fraction, a sentence the per cent. */
export interface AttainmentGoal {
  /** 0–1, for a gauge or a bullet's target line. */
  fraction: number;
  /** 0–100, for "5 points under the 90 % target". */
  percent: number;
  /**
   * `setting`: the tenant chose it (`sla.attainment.target`). `default`: the
   * platform's 90 %, as the API reported it. `fallback`: the answer carried
   * no target at all — an API that predates it, or a metric that is not
   * `sla.attainment` — so 90 % is assumed here.
   */
  source: 'setting' | 'default' | 'fallback';
}

/** The platform's default target, used only when an answer carries none. */
const FALLBACK_TARGET_PERCENT = 90;

/**
 * The SLA attainment target that came with an answer (S1), or 90 % when it
 * came with none. The only place a page gets the number from: a target typed
 * into a page is a target that disagrees with the tenant's setting the day
 * somebody changes it.
 */
export function attainmentTarget(result?: Pick<MetricResult, 'target'> | null): AttainmentGoal {
  const target = result?.target;
  if (target && typeof target.value === 'number' && Number.isFinite(target.value)) {
    return { fraction: target.value / 100, percent: target.value, source: target.source === 'setting' ? 'setting' : 'default' };
  }
  return { fraction: FALLBACK_TARGET_PERCENT / 100, percent: FALLBACK_TARGET_PERCENT, source: 'fallback' };
}

/**
 * Whether the server applied every filter asked for (R2's `applied` echo).
 *
 * A route ignores a query key it does not know and answers for everything,
 * so during a deploy an older API would answer "Breached: 412" for a filter
 * it never applied. A page that sent a newer key checks it here and, when
 * false, uses its fallback (a probe captioned "200+") instead of the figure.
 * With keys to check, a missing `applied` is false: only an API from before
 * the echo leaves it out. With none, it is true, since nothing was asked
 * that could have been dropped.
 */
export function honoured(response: { readonly applied?: readonly string[] } | null | undefined, keys: readonly string[]): boolean {
  if (keys.length === 0) return true;
  const applied = response?.applied;
  if (!Array.isArray(applied)) return false;
  return keys.every((key) => applied.includes(key));
}
