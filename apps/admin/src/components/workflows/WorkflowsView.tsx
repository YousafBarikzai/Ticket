'use client';

import { useMemo, type CSSProperties, type ReactNode } from 'react';
import { StatusPill, VisuallyHidden, type Crumb } from '@itsm/ui';
import { DataTable, type ColumnSpec } from '@itsm/ui/data';
import { PageHeader } from '@itsm/ui/shell';
import { inWorkflowScope, mixWords, workflowLook, type RunMix } from './presentation.js';
import type { WorkflowView } from './types.js';

/**
 * Workflows (SPEC §6.1 `/workflows`): what runs across several steps, with
 * whether each is live and at which version, how it starts, and how its last
 * runs went. There is no *New workflow*: workflows come from packs or the
 * API this release (no graph editor, SPEC §7.5), and the empty state says so
 * rather than offering a button that leads nowhere.
 */
export interface WorkflowsViewProps {
  readonly workflows: readonly WorkflowView[];
  readonly mixes: Readonly<Record<string, RunMix>>;
  /** How many recent runs the mixes were counted from. */
  readonly runsRead: number;
  readonly scope: 'all' | 'live' | 'draft';
  readonly scopeHrefs: Readonly<Record<'all' | 'live' | 'draft', string>>;
  readonly tabs: readonly { id: string; label: string; href: string; match?: 'exact' }[];
  readonly meta?: string;
  readonly viewOnly?: { readonly label: string; readonly permission: string; readonly key: string };
  readonly breadcrumbs?: readonly Crumb[];
}

type Row = {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly trigger: string;
  readonly state: string;
  readonly runs: string;
  readonly updatedAt: string;
  readonly workflow: WorkflowView;
} & Record<string, unknown>;

export function WorkflowsView({ workflows, mixes, runsRead, scope, scopeHrefs, tabs, meta, viewOnly }: WorkflowsViewProps): ReactNode {
  const rows = useMemo<Row[]>(
    () =>
      workflows
        .filter((workflow) => inWorkflowScope(workflow, scope))
        .map((workflow) => ({
          key: workflow.key,
          name: workflow.name,
          description: workflow.description ?? '',
          trigger: workflow.trigger ?? '',
          state: workflowLook(workflow).label,
          runs: mixWords(mixes[workflow.key] ?? EMPTY_MIX),
          updatedAt: workflow.updatedAt,
          workflow,
        })),
    [workflows, mixes, scope],
  );

  const counts = {
    all: workflows.length,
    live: workflows.filter((workflow) => inWorkflowScope(workflow, 'live')).length,
    draft: workflows.filter((workflow) => inWorkflowScope(workflow, 'draft')).length,
  };

  const columns: ColumnSpec[] = [
    { id: 'name', header: 'Workflow', field: 'name', kind: 'title', secondaryField: 'description', href: '/workflows/{key}', truncate: 2, minWidth: 240 },
    { id: 'trigger', header: 'Starts', field: 'trigger', hideBelow: 'lg', minWidth: 180, empty: '—' },
    { id: 'state', header: 'Status', field: 'state', width: 190, cardRole: 'badge' },
    { id: 'runs', header: `Last runs`, field: 'runs', width: 200 },
    { id: 'updated', header: 'Updated', field: 'updatedAt', kind: 'relative', hideBelow: 'md', width: 130 },
    { id: 'key', header: 'Key', field: 'key', kind: 'mono', technical: true },
  ];

  return (
    <div className="app-Page app-Workflows">
      <PageHeader
        title="Workflows"
        tabs={tabs}
        {...(workflows.length === 0 ? { subtitle: 'Work that runs across several steps and can wait, like approvals and fulfilment.' } : {})}
        {...(meta ? { meta } : {})}
        {...(viewOnly ? { viewOnly } : {})}
      />
      <DataTable<Row>
        caption="Workflows"
        captionHidden
        urlKey=""
        rows={rows}
        rowKey="key"
        columns={columns}
        search={{ placeholder: 'Search workflows', mode: 'client', shortcut: '/' }}
        scope={{
          label: 'Show',
          value: scope,
          options: [
            { value: 'all', label: 'All', href: scopeHrefs.all, count: counts.all },
            { value: 'live', label: 'Live', href: scopeHrefs.live, count: counts.live },
            { value: 'draft', label: 'Drafts', href: scopeHrefs.draft, count: counts.draft },
          ],
        }}
        countNoun={{ one: 'workflow', other: 'workflows' }}
        cells={{
          state: (row) => {
            const look = workflowLook(row.workflow);
            return <StatusPill size="sm" label={look.label} tone={look.tone} icon={look.icon} srPrefix="Status" />;
          },
          runs: (row) => <RunMixBar mix={mixes[row.key] ?? EMPTY_MIX} of={runsRead} />,
        }}
        empty={{
          title: 'No workflows yet',
          description: 'Workflows come from packs or the API today; there’s no editor for them here yet. Once one exists, its runs show up here.',
          icon: 'workflow',
        }}
        noResults={{ title: 'No workflows match', description: 'Try another word.' }}
      />
    </div>
  );
}

const EMPTY_MIX: RunMix = { completed: 0, active: 0, failed: 0, cancelled: 0, total: 0 };

/** The last runs by outcome as a thin stacked bar, with the one thing worth reading beside it. */
export function RunMixBar({ mix, of }: { readonly mix: RunMix; readonly of: number }): ReactNode {
  const words = mixWords(mix);
  if (mix.total === 0) return <span className="app-RunMix__words app-RunMix__words--quiet">{words}</span>;
  const title = `Last ${mix.total} runs: ${mix.completed} completed, ${mix.active} in progress, ${mix.failed} failed, ${mix.cancelled} abandoned${of >= 200 ? ' (from the 200 most recent runs)' : ''}`;
  return (
    <span className="app-RunMix" title={title}>
      <span className="app-RunMix__bar" aria-hidden="true">
        {(['completed', 'active', 'failed', 'cancelled'] as const).map((part) =>
          mix[part] > 0 ? <span key={part} className="app-RunMix__part" data-part={part} style={{ flexGrow: mix[part] } as CSSProperties} /> : null,
        )}
      </span>
      <span className={mix.failed > 0 ? 'app-RunMix__words app-RunMix__words--failed' : 'app-RunMix__words'}>{words}</span>
      <VisuallyHidden>{`. ${title}.`}</VisuallyHidden>
    </span>
  );
}
