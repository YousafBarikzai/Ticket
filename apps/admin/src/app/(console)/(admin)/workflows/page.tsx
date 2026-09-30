import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Card } from '@itsm/ui';
import { PageHeader } from '@itsm/ui/shell';
import { Forbidden } from '../../../../components/Forbidden.js';
import { WorkflowsView } from '../../../../components/workflows/WorkflowsView.js';
import { inWorkflowScope, runMix, workflowScope, type RunMix } from '../../../../components/workflows/presentation.js';
import { read } from '../../../../server/read.js';
import { pageAccess } from '../../../../server/session.js';
import { loadDetails, workflowAbilities, workflowTabs, workflowView } from './data.js';
import '../../../../components/workflows/workflows.css';

export const metadata: Metadata = { title: 'Workflows' };
export const dynamic = 'force-dynamic';

/** Runs read for the "last runs" bars: the most the API gives in one answer. */
const RUNS_READ = 200;
/** Runs counted per workflow. */
const PER_WORKFLOW = 50;

type Search = Record<string, string | string[] | undefined>;

function scopeHref(search: Search, scope: 'all' | 'live' | 'draft'): string {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(search)) {
    if (name === 'status' || value === undefined) continue;
    for (const entry of Array.isArray(value) ? value : [value]) params.append(name, entry);
  }
  if (scope !== 'all') params.set('status', scope);
  const query = params.toString();
  return query ? `/workflows?${query}` : '/workflows';
}

/**
 * Workflows › Workflows (SPEC §6.1): each workflow with its live version,
 * how it starts and how its last runs went. The list, its versions and the
 * recent runs are read separately; a failed runs read leaves the bars out.
 */
export default async function WorkflowsPage({ searchParams }: { readonly searchParams: Promise<Search> }): Promise<ReactNode> {
  const access = await pageAccess('/workflows');
  if (!access.allowed) return <Forbidden route="/workflows" />;
  const { me, api } = access;
  const search = await searchParams;
  // `?open=workflow:<key>` (the palette's link before the detail page existed) goes to that page.
  if (typeof search.open === 'string' && search.open.startsWith('workflow:') && search.open.length > 9) {
    redirect(`/workflows/${encodeURIComponent(search.open.slice(9))}`);
  }
  const can = workflowAbilities(me, 'Workflows');
  const tabs = workflowTabs(me);

  const [list, runs] = await Promise.all([read(() => api.configure.workflows.list()), read(() => api.configure.workflows.runs({ limit: RUNS_READ }))]);
  if (!list.ok) {
    return (
      <div className="app-Page app-Workflows">
        <PageHeader title="Workflows" tabs={tabs} {...(can.viewOnly ? { viewOnly: can.viewOnly } : {})} />
        <Card title="Workflows" problem={list.problem} />
      </div>
    );
  }

  const details = await loadDetails(api, list.value);
  const workflows = list.value.map((row) => workflowView(row, details.get(row.key) ?? null));

  const mixes: Record<string, RunMix> = {};
  if (runs.ok) {
    const byId = new Map(list.value.map((row) => [row.id, row.key]));
    const grouped = new Map<string, { status: string }[]>();
    for (const run of runs.value) {
      const key = byId.get(run.definitionId);
      if (!key) continue;
      const bucket = grouped.get(key) ?? [];
      if (bucket.length < PER_WORKFLOW) bucket.push(run);
      grouped.set(key, bucket);
    }
    for (const [key, bucket] of grouped) mixes[key] = runMix(bucket);
  }

  const live = workflows.filter((workflow) => inWorkflowScope(workflow, 'live')).length;
  const failed = runs.ok ? runs.value.filter((run) => run.status === 'failed').length : 0;
  const meta =
    workflows.length === 0
      ? undefined
      : `${live} live${runs.ok ? ` · ${failed === 0 ? 'no failed runs' : `${failed}${runs.value.length >= RUNS_READ ? '+' : ''} failed ${failed === 1 ? 'run' : 'runs'}`}` : ''}`;

  return (
    <WorkflowsView
      workflows={workflows}
      mixes={mixes}
      runsRead={runs.ok ? runs.value.length : 0}
      scope={workflowScope(typeof search.status === 'string' ? search.status : undefined)}
      scopeHrefs={{ all: scopeHref(search, 'all'), live: scopeHref(search, 'live'), draft: scopeHref(search, 'draft') }}
      tabs={tabs}
      {...(meta ? { meta } : {})}
      {...(can.viewOnly ? { viewOnly: can.viewOnly } : {})}
    />
  );
}
