import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { Card } from '@itsm/ui';
import { PageHeader } from '@itsm/ui/shell';
import { Forbidden } from '../../../../components/Forbidden.js';
import { NowView } from '../../../../components/workforce/NowView.js';
import { maySetFor } from '../../../../components/workforce/presentation.js';
import type { AvailabilityView } from '../../../../components/workforce/types.js';
import { holds } from '../../../../permissions.js';
import { resolvePeople } from '../../../../server/people.js';
import { read } from '../../../../server/read.js';
import { pageAccess } from '../../../../server/session.js';
import { workforceHeader } from './data.js';
import '../../../../components/workforce/workforce.css';

export const metadata: Metadata = { title: 'Workforce' };
export const dynamic = 'force-dynamic';

/**
 * Workforce › Now (SPEC §6.1): who can take work right now, as routing sees
 * it, and a way to say where you are. The on-call faces beside the summary
 * come from each rota, read in parallel and each allowed to fail.
 */
export default async function WorkforcePage(): Promise<ReactNode> {
  const access = await pageAccess('/workforce');
  if (!access.allowed) return <Forbidden route="/workforce" />;
  const { me, api } = access;
  const header = workforceHeader(me, 'workload.availability.set');

  const [availability, rotations] = await Promise.all([read(() => api.observe.queues.availability()), read(() => api.observe.queues.rotations())]);

  if (!availability.ok) {
    return (
      <div className="app-Page app-Workforce">
        <PageHeader title="Workforce" tabs={header.tabs} />
        <Card title="Availability" problem={availability.problem} />
      </div>
    );
  }

  const onCall = rotations.ok
    ? await Promise.all(rotations.value.slice(0, 8).map((rota) => read(() => api.observe.queues.onCall(rota.key))))
    : [];
  const onCallIds = onCall.flatMap((entry) => (entry.ok && entry.value.userId ? [entry.value.userId] : []));
  const people = await resolvePeople(api, [...availability.value.map((row) => row.userId), ...onCallIds, me.actor.id]);
  const nameOf = (id: string): string => people.get(id)?.name ?? 'Unknown person';

  const rows: AvailabilityView[] = availability.value
    .map((row) => ({
      userId: row.userId,
      person: { id: row.userId, name: nameOf(row.userId) },
      status: row.status,
      effectiveStatus: row.effectiveStatus,
      reason: row.reason,
      until: row.until,
      capacity: typeof row.capacity === 'number' ? row.capacity : null,
      source: row.source,
      updatedAt: row.updatedAt,
      editable: maySetFor(me, row.userId === me.actor.id),
    }))
    .sort((a, b) => a.person.name.localeCompare(b.person.name));

  return (
    <NowView
      header={header}
      rows={rows}
      onCall={[...new Set(onCallIds)].map((id) => ({ name: nameOf(id) }))}
      me={{ id: me.actor.id, name: me.actor.displayName ?? (me.actor.id ? nameOf(me.actor.id) : 'You') }}
      canSetOwn={holds(me, 'workload.availability.set') && me.actor.id !== null}
    />
  );
}
