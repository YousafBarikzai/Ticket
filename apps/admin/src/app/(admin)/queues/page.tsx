import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { Badge, EmptyState, Table } from '@itsm/ui';
import { currentActor } from '../../../server/session.js';
import { read } from '../../../server/read.js';
import { holds } from '../../../permissions.js';
import { Panel } from '../../../components/Panel.js';

export const metadata: Metadata = { title: 'Queues' };
export const dynamic = 'force-dynamic';

/**
 * Why the queue is or is not moving (MOD-20).
 *
 * Four lists the API has served since MOD-20 and nothing has ever shown:
 * who is available, the shifts they are on, the on-call rotas, and the skills
 * routing can ask for. Between them they answer the question an administrator
 * actually arrives with — "why did this ticket go to nobody?" — which was
 * previously answerable only by reading the database.
 *
 * Read-only. Setting availability for somebody else, editing a shift pattern
 * and reordering a rota are three quite different writes, and each deserves
 * its own screen rather than a shared grid of inputs.
 *
 * Each list is read separately. A desk with no rotations configured must still
 * see its availability, and a `workload.read` refusal on one route should not
 * blank the other three.
 */
export default async function QueuesPage(): Promise<ReactNode> {
  const { me, api } = await currentActor();

  if (!holds(me, 'workload.read') && !holds(me, 'workload.manage')) {
    return (
      <EmptyState
        tone="error"
        title="Your account cannot see this desk's queues"
        description="It needs workload.read. Ask an administrator."
      />
    );
  }

  const [availability, shifts, rotations, skills] = await Promise.all([
    read(() => api.observe.queues.availability()),
    read(() => api.observe.queues.shifts()),
    read(() => api.observe.queues.rotations()),
    read(() => api.observe.queues.skills()),
  ]);

  return (
    <div className="itsm-Admin">
      <header className="itsm-Admin__head">
        <h1>Queues</h1>
        <p className="itsm-Admin__lede">
          Who is here, when they work, who is on call, and what routing knows how to ask for. This is the state the
          assignment strategies read when they decide where a ticket goes.
        </p>
      </header>

      <Panel
        title="Availability"
        description="What each person has said, and what routing will act on. The two differ once an “until” has passed."
        result={availability}
        empty="Nobody has set their availability. Routing treats an unset person as available."
      >
        {(rows) => (
          <Table
            caption="Availability"
            columns={[
              { key: 'user', header: 'Person', cell: (row) => <code>{row.userId}</code> },
              {
                key: 'effective',
                header: 'Routing sees',
                cell: (row) => (
                  <Badge intent={row.effectiveStatus === 'available' ? 'success' : 'neutral'} srPrefix="Status">
                    {row.effectiveStatus}
                  </Badge>
                ),
              },
              { key: 'set', header: 'They set', cell: (row) => row.status },
              { key: 'until', header: 'Until', cell: (row) => (row.until ? new Date(row.until).toLocaleString() : '—') },
              { key: 'capacity', header: 'Capacity', cell: (row) => row.capacity },
              { key: 'reason', header: 'Reason', cell: (row) => row.reason ?? '—' },
            ]}
            rows={rows}
            rowKey={(row) => row.userId}
          />
        )}
      </Panel>

      <Panel
        title="Shifts"
        description="A weekly pattern and the people assigned to it."
        result={shifts}
        empty="No shifts. The desk is treated as always open unless an SLA calendar says otherwise."
      >
        {(rows) => (
          <Table
            caption="Shifts"
            columns={[
              { key: 'name', header: 'Shift', cell: (row) => row.name },
              { key: 'key', header: 'Key', cell: (row) => <code>{row.key}</code> },
              { key: 'zone', header: 'Time zone', cell: (row) => row.timeZone },
              {
                key: 'people',
                header: 'On it',
                cell: (row) => `${row.assignments.length} ${row.assignments.length === 1 ? 'person' : 'people'}`,
              },
            ]}
            rows={rows}
            rowKey={(row) => row.key}
          />
        )}
      </Panel>

      <Panel
        title="On call"
        description="Who takes the out-of-hours page, and when it changes hands."
        result={rotations}
        empty="No rotations. Nothing escalates to an on-call person."
      >
        {(rows) => (
          <Table
            caption="On-call rotations"
            columns={[
              { key: 'name', header: 'Rotation', cell: (row) => row.name },
              { key: 'cadence', header: 'Changes', cell: (row) => row.cadence },
              { key: 'handover', header: 'Handover at', cell: (row) => `${row.handoverAt} ${row.timeZone}` },
              { key: 'members', header: 'In the rota', cell: (row) => row.members.length },
            ]}
            rows={rows}
            rowKey={(row) => row.key}
          />
        )}
      </Panel>

      <Panel
        title="Skills"
        description="What a routing policy can require of whoever takes a ticket."
        result={skills}
        empty="No skills. Skill-based routing has nothing to match on."
      >
        {(rows) => (
          <Table
            caption="Skills"
            columns={[
              { key: 'name', header: 'Skill', cell: (row) => row.name },
              { key: 'key', header: 'Key', cell: (row) => <code>{row.key}</code> },
              { key: 'description', header: 'What it means', cell: (row) => row.description ?? '—' },
            ]}
            rows={rows}
            rowKey={(row) => row.key}
          />
        )}
      </Panel>

      <section className="itsm-Admin__note" aria-label="What this screen cannot do yet">
        <h2>Not built yet</h2>
        <p>
          Routing policy is set per team and the API has no route that lists teams, so the strategy each queue uses —
          and <code>/workload/routing/:teamId/explain</code>, which rehearses an assignment without making one — has no
          screen here yet. That explain route is the best diagnostic in the platform and it deserves better than a text
          box to paste a team id into.
        </p>
      </section>
    </div>
  );
}
