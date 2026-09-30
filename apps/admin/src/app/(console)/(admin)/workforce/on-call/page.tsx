import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { Card } from '@itsm/ui';
import { PageHeader } from '@itsm/ui/shell';
import { Forbidden } from '../../../../../components/Forbidden.js';
import { OnCallView } from '../../../../../components/workforce/OnCallView.js';
import { onCallNow } from '../../../../../components/workforce/presentation.js';
import type { PersonName, RotaView } from '../../../../../components/workforce/types.js';
import { holds } from '../../../../../permissions.js';
import { resolvePeople } from '../../../../../server/people.js';
import { read } from '../../../../../server/read.js';
import { pageAccess } from '../../../../../server/session.js';
import { teamNames, workforceHeader } from '../data.js';
import '../../../../../components/workforce/workforce.css';

export const metadata: Metadata = { title: 'On call · Workforce' };
export const dynamic = 'force-dynamic';

/**
 * Workforce › On call (SPEC §6.1): every rota with who has it now, who is
 * next and its cover. "Who is on call" is asked of each rota in parallel;
 * one that fails says so on its own card.
 */
export default async function OnCallPage(): Promise<ReactNode> {
  const access = await pageAccess('/workforce/on-call');
  if (!access.allowed) return <Forbidden route="/workforce/on-call" />;
  const { me, api } = access;
  const header = workforceHeader(me, ['workload.oncall.override', 'workload.manage']);

  const [rotations, teams] = await Promise.all([read(() => api.observe.queues.rotations()), teamNames(api)]);
  if (!rotations.ok) {
    return (
      <div className="app-Page app-Workforce">
        <PageHeader title="Workforce" tabs={header.tabs} />
        <Card title="On call" problem={rotations.problem} />
      </div>
    );
  }

  const states = await Promise.all(rotations.value.map((rota) => read(() => api.observe.queues.onCall(rota.key))));
  const ids = rotations.value.flatMap((rota, index) => {
    const state = states[index];
    return [...rota.members, ...(state?.ok ? [state.value.userId, ...state.value.upcoming.map((turn) => turn.userId), ...state.value.overrides.map((o) => o.userId)] : [])];
  });
  const people = await resolvePeople(api, ids);
  const person = (id: string): PersonName => ({ id, name: people.get(id)?.name ?? null });

  const rotas: RotaView[] = rotations.value.map((rota, index) => {
    const state = states[index];
    const now = state?.ok ? onCallNow(state.value) : null;
    return {
      key: rota.key,
      name: rota.name,
      teamId: rota.teamId,
      teamName: teams?.get(rota.teamId) ?? null,
      timeZone: rota.timeZone,
      cadence: rota.cadence,
      handoverAt: rota.handoverAt,
      members: rota.members.map(person),
      now:
        state?.ok && now
          ? {
              person: now.userId ? person(now.userId) : null,
              covering: now.covering,
              next: now.next ? { person: person(now.next.userId), at: now.next.at } : null,
              overrides: state.value.overrides
                .filter((override) => new Date(override.endsAt).getTime() > Date.now())
                .map((override) => ({ id: override.id, person: person(override.userId), startsAt: override.startsAt, endsAt: override.endsAt, reason: override.reason })),
            }
          : null,
    };
  });

  // New and Edit need the team list (A6): without it a rota's team could only be typed as an id.
  const teamOptions = holds(me, 'workload.manage') && teams ? [...teams.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label)) : undefined;
  return <OnCallView header={header} rotas={rotas} canCover={holds(me, 'workload.oncall.override')} {...(teamOptions ? { teams: teamOptions } : {})} />;
}
