import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { Card } from '@itsm/ui';
import { PageHeader } from '@itsm/ui/shell';
import { Forbidden } from '../../../../../components/Forbidden.js';
import { ShiftsView } from '../../../../../components/workforce/ShiftsView.js';
import { currentAssignees, patternHours, todayIn } from '../../../../../components/workforce/presentation.js';
import type { ShiftView } from '../../../../../components/workforce/types.js';
import { resolvePeople } from '../../../../../server/people.js';
import { read } from '../../../../../server/read.js';
import { pageAccess } from '../../../../../server/session.js';
import { teamNames, workforceHeader } from '../data.js';
import '../../../../../components/workforce/workforce.css';

export const metadata: Metadata = { title: 'Shifts · Workforce' };
export const dynamic = 'force-dynamic';

/** Workforce › Shifts (SPEC §6.1): the weekly patterns and who is on them. */
export default async function ShiftsPage(): Promise<ReactNode> {
  const access = await pageAccess('/workforce/shifts');
  if (!access.allowed) return <Forbidden route="/workforce/shifts" />;
  const { me, api } = access;
  const header = workforceHeader(me);

  const [shifts, teams] = await Promise.all([read(() => api.observe.queues.shifts()), teamNames(api)]);
  if (!shifts.ok) {
    return (
      <div className="app-Page app-Workforce">
        <PageHeader title="Workforce" tabs={header.tabs} />
        <Card title="Shifts" problem={shifts.problem} />
      </div>
    );
  }

  const people = await resolvePeople(
    api,
    shifts.value.flatMap((shift) => shift.assignments.map((entry) => entry.userId)),
  );
  const nameOf = (id: string): string | null => people.get(id)?.name ?? null;

  const rows: ShiftView[] = shifts.value.map((shift) => {
    const today = todayIn(shift.timeZone);
    const current = new Set(currentAssignees(shift, today));
    return {
      key: shift.key,
      name: shift.name,
      teamName: teams?.get(shift.teamId) ?? null,
      timeZone: shift.timeZone,
      hours: patternHours(shift.pattern),
      people: [...current].map((id) => ({ name: nameOf(id) ?? 'Unknown person' })),
      peopleCount: current.size,
      assignments: [...shift.assignments]
        .sort((a, b) => a.startsOn.localeCompare(b.startsOn))
        .map((entry) => ({ id: entry.id, person: { id: entry.userId, name: nameOf(entry.userId) }, startsOn: entry.startsOn, endsOn: entry.endsOn, current: current.has(entry.userId) })),
    };
  });

  return <ShiftsView header={header} rows={rows} teams={teams !== null} />;
}
