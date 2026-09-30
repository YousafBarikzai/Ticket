import 'server-only';
import type { Admin, CalendarRow, Me, SlaPolicyRow } from '@itsm/sdk';
import { tabsFor } from '../../../../navigation.js';
import { holds, viewOnlyFor } from '../../../../permissions.js';
import type { CalendarOption, CalendarView, PolicyView, SlaHeader } from '../../../../components/sla/types.js';
import { weekFrom } from '../../../../components/sla/presentation.js';

/**
 * What the three service-level pages share: the header this person sees and
 * the rows, made serialisable for the client views.
 */

export function slaHeader(me: Me): SlaHeader {
  const viewOnly = viewOnlyFor(me, 'Service levels', 'sla.policy.manage');
  return { tabs: tabsFor(me, 'service-levels'), ...(viewOnly ? { viewOnly } : {}) };
}

export function canManageSla(me: Me): boolean {
  return holds(me, 'sla.policy.manage');
}

export function policyView(row: SlaPolicyRow): PolicyView {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    status: row.status,
    specificity: row.specificity,
    calendarMode: row.calendarMode,
    calendarId: row.calendarId,
    version: row.version,
    match: row.match ?? { always: true },
    targets: (row.targets ?? []).map((target) => ({
      priority: target.priority,
      targetType: target.targetType,
      minutes: target.minutes,
      warningThresholds: target.warningThresholds ?? [],
    })),
  };
}

export function calendarOption(row: CalendarRow): CalendarOption {
  return { id: row.id, key: row.key, name: row.name, timeZone: row.timeZone, isDefault: row.isDefault };
}

export function calendarView(row: CalendarRow, policies: readonly SlaPolicyRow[]): CalendarView {
  return {
    ...calendarOption(row),
    hours: weekFrom(row.hours),
    usedBy: policies.filter((policy) => policy.calendarId === row.id).map((policy) => policy.name),
  };
}

export async function loadPolicies(api: Admin): Promise<SlaPolicyRow[]> {
  return api.configure.sla.policies();
}
