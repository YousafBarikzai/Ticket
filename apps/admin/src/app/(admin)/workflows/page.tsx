import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { ApiError } from '@itsm/sdk';
import { Badge, EmptyState, Table } from '@itsm/ui';
import { currentActor } from '../../../server/session.js';
import { holds } from '../../../permissions.js';
import { WorkflowConsole } from '../../../components/WorkflowConsole.js';

export const metadata: Metadata = { title: 'What runs across several steps' };
export const dynamic = 'force-dynamic';

const WHEN = (iso: string | null): string => (iso ? new Date(iso).toLocaleString('en-GB') : '—');

/**
 * Workflows, without the graph editor.
 *
 * The editor is a project of its own and stays one. Everything around it is
 * not: an administrator needs to see which workflows exist, check a draft
 * before publishing it, publish, roll back when a published version turns out
 * wrong, and — most of all — look at what is running right now and unstick it.
 *
 * The runs are the half that matters day to day. A workflow that has stalled
 * on a step nobody is going to complete is a joiner who never got a laptop,
 * and until this screen the only way to see one was a database query.
 */
export default async function WorkflowsPage(): Promise<ReactNode> {
  const { me, api } = await currentActor();
  const canManage = holds(me, 'workflow.manage');

  let workflows: Awaited<ReturnType<typeof api.configure.workflows.list>>;
  let runs: Awaited<ReturnType<typeof api.configure.workflows.runs>>;
  try {
    [workflows, runs] = await Promise.all([
      api.configure.workflows.list(),
      api.configure.workflows.runs({ limit: 50 }),
    ]);
  } catch (error) {
    return (
      <EmptyState
        tone="error"
        title="The workflows could not be loaded"
        description={error instanceof ApiError ? error.message : 'The API could not be reached.'}
      />
    );
  }

  const byId = new Map(workflows.map((workflow) => [workflow.id, workflow.name]));
  const stuck = runs.filter((run) => run.status === 'failed' || run.status === 'waiting');

  return (
    <div className="itsm-Admin">
      <header className="itsm-Admin__head">
        <h1>What runs across several steps</h1>
        <p className="itsm-Admin__lede">
          A workflow is a sequence with approvals, tasks and waits in it — a joiner, a change, an offboarding.{' '}
          {stuck.length > 0
            ? `${stuck.length} of the last ${runs.length} runs are waiting or have failed.`
            : `None of the last ${runs.length} runs are stuck.`}
        </p>
      </header>

      <section aria-labelledby="definitions-heading">
        <h2 id="definitions-heading">Workflows</h2>
        {workflows.length === 0 ? (
          <EmptyState
            title="No workflows"
            description="Nothing multi-step is defined. Creating one needs the graph editor, which is not built."
          />
        ) : (
          <Table
            caption="Workflow definitions"
            columns={[
              { key: 'name', header: 'Name', cell: (row) => row.name },
              { key: 'key', header: 'Key', cell: (row) => <code>{row.key}</code> },
              { key: 'description', header: 'Description', cell: (row) => row.description ?? '—' },
              {
                key: 'status',
                header: 'Live',
                cell: (row) => (
                  <Badge intent={row.status === 'published' ? 'success' : 'warning'} srPrefix="Live">
                    {row.status === 'published' ? 'Published' : row.status}
                  </Badge>
                ),
              },
              { key: 'updated', header: 'Changed', cell: (row) => WHEN(row.updatedAt) },
            ]}
            rows={workflows}
            rowKey={(row) => row.id}
          />
        )}
      </section>

      <section aria-labelledby="runs-heading">
        <h2 id="runs-heading">Recent runs</h2>
        {runs.length === 0 ? (
          <EmptyState title="Nothing has run" description="No workflow has been started on this desk yet." />
        ) : (
          <Table
            caption="The fifty most recent workflow runs"
            columns={[
              { key: 'workflow', header: 'Workflow', cell: (row) => byId.get(row.definitionId) ?? '—' },
              {
                key: 'status',
                header: 'State',
                cell: (row) => (
                  <Badge
                    intent={
                      row.status === 'completed'
                        ? 'success'
                        : row.status === 'failed'
                          ? 'danger'
                          : row.status === 'cancelled'
                            ? 'neutral'
                            : 'warning'
                    }
                    srPrefix="State"
                  >
                    {row.status}
                  </Badge>
                ),
              },
              {
                key: 'at',
                header: 'Waiting on',
                cell: (row) => (row.currentKeys.length > 0 ? row.currentKeys.join(', ') : '—'),
              },
              { key: 'error', header: 'Error', cell: (row) => row.error ?? '—' },
              { key: 'started', header: 'Started', cell: (row) => WHEN(row.startedAt) },
              { key: 'ended', header: 'Ended', cell: (row) => WHEN(row.endedAt) },
            ]}
            rows={runs}
            rowKey={(row) => row.id}
          />
        )}
      </section>

      {canManage ? (
        <WorkflowConsole
          workflows={workflows.map((workflow) => ({ key: workflow.key, name: workflow.name, status: workflow.status }))}
          stuckRuns={stuck.map((run) => ({
            id: run.id,
            label: `${byId.get(run.definitionId) ?? 'workflow'} · ${run.status} · ${run.currentKeys.join(', ') || 'no step'}`,
          }))}
        />
      ) : (
        <p className="itsm-Admin__note">
          Your account can see these but not change them. Publishing, rolling back and unsticking a run need{' '}
          <code>workflow.manage</code>.
        </p>
      )}
    </div>
  );
}
