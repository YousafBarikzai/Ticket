import 'server-only';
import type { ReactNode } from 'react';
import type { NavBadgeValues } from '../navigation.js';
import { holdsAny } from '../permissions.js';
import { read, type Read } from '../server/read.js';
import { loadActor } from '../server/session.js';
import { PublishNavBadges } from './AdminShell.js';

/**
 * The sidebar's counts (SPEC §5.2 "Badge" column), streamed after the frame.
 *
 * Rendered by the `(console)` layout inside `<Suspense>`, beside the frame
 * rather than inside it, so the counts never hold up the first paint: the
 * sidebar draws without them and they appear when they arrive. At most five
 * calls, each only for someone who could open the page the count belongs to,
 * in parallel, and each failing on its own — a count that could not be read
 * is simply not shown, never a guess.
 *
 * The list endpoints have no totals, so a full page is a lower bound: 50 of
 * a 50-row page is shown "50+" by the badge itself ("99+" beyond that).
 * Layouts do not re-render on client navigation, so this costs one set of
 * calls per full load and one per `router.refresh()`.
 */

const PAGE = 50;
const RECENT_DAYS = 7;

function count<T>(result: Read<readonly T[]> | null, keep: (row: T) => boolean = () => true, page?: number): { value: number; capped?: boolean } | undefined {
  if (!result || !result.ok) return undefined;
  const value = result.value.filter(keep).length;
  return page !== undefined && result.value.length >= page ? { value, capped: true } : { value };
}

export async function NavBadges(): Promise<ReactNode> {
  const load = await loadActor();
  if (load.kind !== 'ok') return null;
  const { me, api } = load;
  const since = Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000;

  const [requestTypes, rules, runs, deliveries, alerts] = await Promise.all([
    holdsAny(me, ['catalogue.manage']) ? read(() => api.configure.catalogue.requestTypes({ status: 'draft' })) : null,
    holdsAny(me, ['rules.rule.read', 'rules.rule.manage', 'rules.rule.publish']) ? read(() => api.configure.rules.list({ status: 'draft' })) : null,
    holdsAny(me, ['workflow.read', 'workflow.manage']) ? read(() => api.configure.workflows.runs({ status: 'failed', limit: PAGE })) : null,
    holdsAny(me, ['integration.action.read', 'integration.action.manage']) ? read(() => api.observe.integrations.errorQueue('open')) : null,
    holdsAny(me, ['security.alert.read']) ? read(() => api.observe.securityAlerts()) : null,
  ]);

  const values: NavBadgeValues = {};
  const set = <K extends keyof NavBadgeValues>(key: K, value: NavBadgeValues[K] | undefined): void => {
    if (value && value.value > 0) values[key] = value;
  };
  set('draftRequestTypes', count(requestTypes, (row) => row.status === 'draft'));
  set('draftRules', count(rules, (row) => row.status === 'draft'));
  set('failedRuns', count(runs, () => true, PAGE));
  set('failedDeliveries', count(deliveries));
  set(
    'securityAlerts',
    count(alerts, (alert) => (alert.severity === 'high' || alert.severity === 'critical') && Date.parse(alert.createdAt) >= since),
  );

  return <PublishNavBadges values={values} />;
}
