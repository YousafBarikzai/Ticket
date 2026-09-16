import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { ApiError } from '@itsm/sdk';
import { Badge, EmptyState, Table } from '@itsm/ui';
import { currentActor } from '../../../server/session.js';
import { holds } from '../../../permissions.js';
import { SlaEditor } from '../../../components/SlaEditor.js';
import { PriorityMatrix } from '../../../components/PriorityMatrix.js';

export const metadata: Metadata = { title: 'What this desk promises' };
export const dynamic = 'force-dynamic';

const HOURS = (minutes: number): string =>
  minutes % 1440 === 0
    ? `${minutes / 1440} day${minutes === 1440 ? '' : 's'}`
    : minutes % 60 === 0
      ? `${minutes / 60} hour${minutes === 60 ? '' : 's'}`
      : `${minutes} minutes`;

/**
 * Service level agreements.
 *
 * Two things on one screen because they are two halves of one answer. A policy
 * says how long something may take; the priority matrix decides what priority
 * a ticket gets in the first place, and the policy's targets are per priority.
 * An administrator who changes one without seeing the other has changed
 * something they did not mean to.
 *
 * The matrix is nine cells and the API takes all nine or none — it refuses a
 * partial one — so the grid below always sends a complete set.
 */
export default async function SlaPage(): Promise<ReactNode> {
  const { me, api } = await currentActor();
  const canManage = holds(me, 'sla.policy.manage');

  let policies: Awaited<ReturnType<typeof api.configure.sla.policies>>;
  let calendars: Awaited<ReturnType<typeof api.configure.sla.calendars>>;
  let matrix: Awaited<ReturnType<typeof api.configure.sla.priorityMatrix>>;
  try {
    [policies, calendars, matrix] = await Promise.all([
      api.configure.sla.policies(),
      api.configure.sla.calendars(),
      api.configure.sla.priorityMatrix(),
    ]);
  } catch (error) {
    return (
      <EmptyState
        tone="error"
        title="The service levels could not be loaded"
        description={error instanceof ApiError ? error.message : 'The API could not be reached.'}
      />
    );
  }

  return (
    <div className="itsm-Admin">
      <header className="itsm-Admin__head">
        <h1>What this desk promises</h1>
        <p className="itsm-Admin__lede">
          A policy says how long a ticket of a given priority may take before each promise is broken. The most
          specific matching policy wins, and the clock runs on a business calendar rather than the wall.
        </p>
      </header>

      <section aria-labelledby="matrix-heading">
        <h2 id="matrix-heading">How a priority is decided</h2>
        <p className="itsm-Admin__lede">
          Impact is how much of the organisation is affected; urgency is how fast it needs to be dealt with. Every
          combination needs an answer, so this is nine cells and the API takes all nine at once.
        </p>
        <PriorityMatrix rows={matrix} canManage={canManage} />
      </section>

      <section aria-labelledby="policies-heading">
        <h2 id="policies-heading">Policies</h2>
        {policies.length === 0 ? (
          <EmptyState title="No policies" description="Nothing is promised yet, so no clock runs on any ticket." />
        ) : (
          <Table
            caption="Service level policies"
            columns={[
              { key: 'name', header: 'Name', cell: (row) => row.name },
              { key: 'key', header: 'Key', cell: (row) => <code>{row.key}</code> },
              {
                key: 'targets',
                header: 'Targets',
                cell: (row) =>
                  row.targets && row.targets.length > 0
                    ? row.targets.map((target) => `${target.priority} ${target.targetType} in ${HOURS(target.minutes)}`).join('; ')
                    : 'None set',
              },
              { key: 'calendar', header: 'Clock', cell: (row) => row.calendarMode },
              { key: 'specificity', header: 'Specificity', cell: (row) => row.specificity },
              {
                key: 'status',
                header: 'In force',
                cell: (row) => (
                  <Badge intent={row.status === 'published' ? 'success' : 'warning'} srPrefix="In force">
                    {row.status === 'published' ? 'Yes' : row.status}
                  </Badge>
                ),
              },
            ]}
            rows={policies}
            rowKey={(row) => row.id}
          />
        )}
      </section>

      <section aria-labelledby="calendars-heading">
        <h2 id="calendars-heading">Business calendars</h2>
        {calendars.length === 0 ? (
          <EmptyState
            title="No calendars"
            description="Without one a clock runs around the clock, which is rarely what was agreed."
          />
        ) : (
          <Table
            caption="Business calendars"
            columns={[
              { key: 'name', header: 'Name', cell: (row) => row.name },
              { key: 'key', header: 'Key', cell: (row) => <code>{row.key}</code> },
              { key: 'tz', header: 'Time zone', cell: (row) => row.timeZone },
              {
                key: 'days',
                header: 'Open',
                cell: (row) => Object.keys(row.hours ?? {}).join(', ') || 'Never',
              },
              {
                key: 'default',
                header: 'Default',
                cell: (row) => (row.isDefault ? <Badge intent="success" srPrefix="Default">Yes</Badge> : 'No'),
              },
            ]}
            rows={calendars}
            rowKey={(row) => row.id}
          />
        )}
      </section>

      {canManage ? (
        <SlaEditor
          existingKeys={policies.map((policy) => policy.key)}
          calendarKeys={calendars.map((calendar) => calendar.key)}
        />
      ) : (
        <p className="itsm-Admin__note">
          Your account can see these but not change them. Editing needs <code>sla.policy.manage</code>.
        </p>
      )}
    </div>
  );
}
