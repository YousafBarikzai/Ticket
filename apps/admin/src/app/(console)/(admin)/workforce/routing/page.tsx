import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { Card } from '@itsm/ui';
import { PageHeader } from '@itsm/ui/shell';
import { Forbidden } from '../../../../../components/Forbidden.js';
import { RoutingView } from '../../../../../components/workforce/RoutingView.js';
import { isUuid } from '../../../../../components/tickets/presentation.js';
import { holds } from '../../../../../permissions.js';
import { read } from '../../../../../server/read.js';
import { pageAccess } from '../../../../../server/session.js';
import { workforceHeader } from '../data.js';
import '../../../../../components/workforce/workforce.css';

export const metadata: Metadata = { title: 'Routing · Workforce' };
export const dynamic = 'force-dynamic';

/**
 * Workforce › Routing (SPEC §6.1; A6): a team's routing policy and the
 * rehearsal that explains who would take its next ticket. `?team=<id>`
 * chooses the team; without it, the first by name.
 */
export default async function RoutingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }): Promise<ReactNode> {
  const access = await pageAccess('/workforce/routing');
  if (!access.allowed) return <Forbidden route="/workforce/routing" />;
  const { me, api } = access;
  const header = workforceHeader(me, 'workload.manage');

  const teams = await read(() => api.tenant.teams());
  if (!teams.ok || teams.value.length === 0) {
    return (
      <div className="app-Page app-Workforce">
        <PageHeader title="Workforce" tabs={header.tabs} />
        {teams.ok ? (
          <Card title="Routing" empty={{ title: 'No teams yet', description: 'Routing is set per team. Teams you can see appear here.', icon: 'people' }} />
        ) : (
          <Card title="Routing" problem={teams.problem} />
        )}
      </div>
    );
  }

  const params = await searchParams;
  const wanted = typeof params.team === 'string' && isUuid(params.team) ? params.team : null;
  const options = [...teams.value].sort((a, b) => a.name.localeCompare(b.name)).map((team) => ({ value: team.id, label: team.name }));
  const teamId = options.find((team) => team.value === wanted)?.value ?? options[0]!.value;
  const policy = await read(() => api.observe.queues.routing(teamId));

  return (
    <RoutingView
      header={header}
      teams={options}
      teamId={teamId}
      policy={policy.ok ? policy.value : null}
      {...(policy.ok ? {} : { problem: policy.problem })}
      canManage={holds(me, 'workload.manage')}
    />
  );
}
