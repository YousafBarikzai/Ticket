'use client';

import { lazy, Suspense, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import {
  Badge,
  Button,
  DescriptionList,
  Disclosure,
  EmptyState,
  Icon,
  InlineAlert,
  RelativeTime,
  SegmentedControl,
  Skeleton,
  StatusPill,
  Surface,
  Tabs,
  describeProblem,
  type Crumb,
  type Problem,
} from '@itsm/ui';
import { ConfirmDialog } from '@itsm/ui/overlays';
import { PageHeader } from '@itsm/ui/shell';
import { api } from '../../client/api.js';
import { useOnline } from '../../client/live.js';
import { useMutation } from '../../client/useMutation.js';
import { JsonView } from '../JsonView.js';
import { TechnicalKey } from '../command-centre/TechnicalKey.js';
import { describeNode, edgeWords, nodeTitle, nodeType, triggerWords, type FlowGraph } from './graph.js';
import { runMix, workflowLook } from './presentation.js';
import { RunMixBar } from './WorkflowsView.js';
import { RunsTable } from './RunsTable.js';
import { StepsOutline } from './StepsOutline.js';
import type { RunView, VersionView, WorkflowView } from './types.js';

const FlowDiagram = lazy(() => import('./FlowDiagram.js'));

/**
 * One workflow (SPEC §6.1 `/workflows/[key]`): how it starts, whether it is
 * live and at which version, the automatic check of its newest version, and
 * three tabs — the graph (a diagram or, on a phone by default, the Steps
 * outline), the version history, and its runs.
 *
 * **Publish vN** is offered to people who may publish, only when there is a
 * draft, and it stays unavailable — saying why — until the check is clean:
 * the API refuses a graph with problems, and finding that out from a failed
 * publish was the old way. **Make current** on an earlier version publishes
 * its graph again as the next version (F25: no more typing a version number),
 * and says that runs already going stay on their version.
 */
export interface CheckResult {
  readonly version: number;
  readonly problems: readonly { readonly message: string; readonly where: string | null }[];
}

export interface WorkflowDetailProps {
  readonly workflow: WorkflowView;
  readonly graph: FlowGraph | null;
  readonly versions: readonly VersionView[];
  readonly check: { readonly ok: true; readonly value: CheckResult } | { readonly ok: false; readonly problem: Problem };
  readonly runs: readonly RunView[];
  readonly graphs: Readonly<Record<string, FlowGraph>>;
  readonly workflows: Readonly<Record<string, { readonly key: string; readonly name: string }>>;
  readonly ruleNames: Readonly<Record<string, string>>;
  readonly canPublish: boolean;
  readonly canOperate: boolean;
  readonly canReadTickets: boolean;
  readonly workbenchOrigin?: string;
  readonly breadcrumbs: readonly Crumb[];
  readonly viewOnly?: { readonly label: string; readonly permission: string; readonly key: string };
  readonly initialTab?: 'diagram' | 'history' | 'runs';
}

const PHONE = '(max-width: 47.99rem)';
function usePhone(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia(PHONE);
      query.addEventListener('change', onChange);
      return () => query.removeEventListener('change', onChange);
    },
    () => window.matchMedia(PHONE).matches,
    () => false,
  );
}

export function WorkflowDetail(props: WorkflowDetailProps): ReactNode {
  const { workflow, graph, versions, check, runs, graphs, workflows, ruleNames, canPublish, canOperate, canReadTickets, workbenchOrigin, breadcrumbs, viewOnly } = props;
  const online = useOnline();
  const phone = usePhone();
  const [tab, setTab] = useState<'diagram' | 'history' | 'runs'>(props.initialTab ?? 'diagram');
  const [view, setView] = useState<'diagram' | 'steps' | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ readonly kind: 'publish' } | { readonly kind: 'rollback'; readonly version: number } | null>(null);

  const shownView = view ?? (phone ? 'steps' : 'diagram');
  const look = workflowLook(workflow);
  const draft = versions.find((version) => version.status === 'draft') ?? null;
  const problems = check.ok ? check.value.problems : [];
  const problemNodes = useMemo(() => new Set(problems.map((problem) => problem.where).filter((where): where is string => Boolean(where))), [problems]);
  const mix = runMix(runs.slice(0, 50));

  const publish = useMutation(() => api.configure.workflows.publish(workflow.key), {
    success: `Version ${draft?.version ?? ''} of “${workflow.name}” is live`,
    failure: 'Couldn’t publish the workflow',
  });
  const rollback = useMutation((version: number) => api.configure.workflows.rollback(workflow.key, version), {
    success: (value) => {
      const next = (value as { version?: number } | null)?.version;
      return next ? `Version ${next} is live` : 'Version restored';
    },
    failure: 'Couldn’t make that version current',
  });

  const publishReason = !online
    ? 'You’re offline — changes can’t be saved.'
    : !check.ok
      ? 'The check couldn’t run, so it isn’t safe to publish yet.'
      : check.value.version !== draft?.version
        ? 'The check looked at another version. Reload the page.'
        : problems.length > 0
          ? `Fix the ${problems.length === 1 ? 'problem' : `${problems.length} problems`} the check found first.`
          : undefined;

  const select = (key: string): void => {
    setSelected((current) => (current === key ? null : key));
  };
  const showNode = (key: string): void => {
    setTab('diagram');
    setSelected(key);
  };

  const selectedNode = graph && selected ? graph.nodes.find((node) => node.key === selected) : undefined;

  const diagramTab = graph ? (
    <div className="app-WorkflowGraph">
      <div className="app-WorkflowGraph__toolbar">
        <SegmentedControl
          label="Show the workflow as"
          mode="value"
          size="sm"
          value={shownView}
          onValueChange={(value) => setView(value === 'steps' ? 'steps' : 'diagram')}
          options={[
            { value: 'diagram', label: 'Diagram', icon: 'workflow' },
            { value: 'steps', label: 'Steps', icon: 'rows-3' },
          ]}
        />
      </div>
      <div className="app-WorkflowGraph__body" data-with-panel={selectedNode ? '' : undefined}>
        <div className="app-WorkflowGraph__main">
          {shownView === 'diagram' ? (
            <Suspense fallback={<Skeleton height={320} radius="xl" />}>
              <FlowDiagram graph={graph} label={`Diagram of ${workflow.name}`} selected={selected} onSelect={select} problems={problemNodes} />
            </Suspense>
          ) : (
            <StepsOutline graph={graph} selected={selected} onSelect={select} problems={problemNodes} />
          )}
        </div>
        {selectedNode ? (
          <Surface as="section" tone="raised" elevation="xs" padding="md" className="app-NodePanel" aria-labelledby="node-panel-title">
            <header className="app-NodePanel__head">
              <Icon name={nodeType(selectedNode.type).icon} size="sm" />
              <h3 id="node-panel-title" className="app-NodePanel__title">
                {nodeTitle(selectedNode)}
              </h3>
              <Button size="sm" variant="ghost" onClick={() => setSelected(null)} aria-label="Close the step’s settings">
                Close
              </Button>
            </header>
            <DescriptionList
              dense
              items={[
                { id: 'type', label: 'Kind of step', value: nodeType(selectedNode.type).label },
                { id: 'does', label: 'What it does', value: describeNode(selectedNode) },
                {
                  id: 'next',
                  label: 'Then',
                  value: (() => {
                    const out = graph.edges.filter((edge) => edge.from === selectedNode.key);
                    if (out.length === 0) return 'The workflow ends here.';
                    return out
                      .map((edge) => {
                        const target = graph.nodes.find((node) => node.key === edge.to);
                        const words = edgeWords(edge);
                        return `${target ? nodeTitle(target) : edge.to}${words ? ` (${words})` : ''}`;
                      })
                      .join('; or ');
                  })(),
                },
              ]}
            />
            <TechnicalKey value={selectedNode.key} label="step key" />
            {problems.filter((problem) => problem.where === selectedNode.key).map((problem, index) => (
              <InlineAlert key={index} tone="danger">
                {problem.message}
              </InlineAlert>
            ))}
            <Disclosure summary="Settings as stored">
              <JsonView value={selectedNode} label={`Settings of ${nodeTitle(selectedNode)}`} openDepth={1} />
            </Disclosure>
          </Surface>
        ) : null}
      </div>
    </div>
  ) : (
    <EmptyState size="sm" icon="workflow" title="The graph couldn’t be read" description="This version’s graph isn’t in a shape the console can draw." />
  );

  const historyTab =
    versions.length === 0 ? (
      <EmptyState size="sm" icon="history" title="No versions yet" />
    ) : (
      <ol className="app-WorkflowVersions" aria-label={`Versions of ${workflow.name}, newest first`}>
        {versions.map((version) => (
          <li key={version.version}>
            <Surface as="article" tone="raised" elevation="xs" padding="md" className="app-WfVersion" aria-labelledby={`wf-version-${version.version}`}>
              <header className="app-WfVersion__head">
                <h3 id={`wf-version-${version.version}`} className="app-WfVersion__title">
                  Version {version.version}
                </h3>
                {version.isCurrent ? <StatusPill size="sm" label="Current" tone="success" icon="circle-check" /> : null}
                {version.status === 'draft' ? <StatusPill size="sm" label="Draft" tone="neutral" icon="circle-dashed" /> : null}
                {canPublish && version.status === 'published' && !version.isCurrent ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="app-WfVersion__action"
                    onClick={() => setConfirm({ kind: 'rollback', version: version.version })}
                    aria-label={`Make version ${version.version} current`}
                    {...(online ? {} : { disabledReason: 'You’re offline — changes can’t be saved.' })}
                  >
                    Make current
                  </Button>
                ) : null}
              </header>
              <p className="app-WfVersion__meta">
                {version.publishedAt ? (
                  <>
                    Published <RelativeTime date={version.publishedAt} relativeStyle="long" />
                  </>
                ) : (
                  'Not published'
                )}
              </p>
              {version.changeNote ? <p className="app-WfVersion__note">{version.changeNote}</p> : null}
            </Surface>
          </li>
        ))}
      </ol>
    );

  const runsTab = (
    <RunsTable
      runs={runs}
      caption={`Runs of ${workflow.name}`}
      urlKey="runs"
      graphs={graphs}
      workflows={workflows}
      ruleNames={ruleNames}
      canOperate={canOperate}
      canReadTickets={canReadTickets}
      {...(workbenchOrigin ? { workbenchOrigin } : {})}
      showWorkflow={false}
      empty={{ title: 'No runs yet', description: 'Runs of this workflow appear here once it starts.' }}
    />
  );

  return (
    <div className="app-Page app-Workflow">
      <PageHeader
        title={workflow.name}
        breadcrumbs={[...breadcrumbs, { label: workflow.name }]}
        status={<StatusPill label={look.label} tone={look.tone} icon={look.icon} />}
        {...(viewOnly ? { viewOnly } : {})}
        {...(canPublish && draft
          ? {
              primaryAction: {
                id: 'publish',
                label: `Publish v${draft.version}`,
                icon: 'send',
                variant: 'primary' as const,
                ...(publishReason ? { disabled: true, disabledReason: publishReason } : {}),
              },
            }
          : {})}
        onAction={(id) => {
          if (id === 'publish') setConfirm({ kind: 'publish' });
        }}
      />

      <div className="app-Workflow__overview">
        <Surface tone="raised" elevation="xs" padding="md" className="app-Workflow__facts">
          {workflow.description ? <p className="app-Workflow__description">{workflow.description}</p> : null}
          <DescriptionList
            layout="grid"
            dense
            items={[
              { id: 'starts', label: 'Starts', value: graph ? triggerWords(graph.trigger) : '' },
              { id: 'live', label: 'Runs start on', value: workflow.liveVersion ? `Version ${workflow.liveVersion}` : 'Nothing yet — not published' },
              { id: 'runs', label: 'Last runs', value: <RunMixBar mix={mix} of={runs.length} /> },
            ]}
          />
          <TechnicalKey value={workflow.key} label="workflow key" />
        </Surface>
        <CheckPanel check={check} draftVersion={draft?.version ?? null} graph={graph} onShow={showNode} />
      </div>

      <Tabs
        label={`${workflow.name} sections`}
        value={tab}
        onChange={(id) => setTab(id === 'history' ? 'history' : id === 'runs' ? 'runs' : 'diagram')}
        items={[
          { id: 'diagram', label: 'Diagram', content: diagramTab },
          { id: 'history', label: 'History', badge: String(versions.length), content: historyTab },
          { id: 'runs', label: 'Runs', ...(mix.failed > 0 ? { badge: `${mix.failed} failed` } : {}), content: runsTab },
        ]}
      />

      <ConfirmDialog
        open={confirm?.kind === 'publish'}
        onOpenChange={(open) => !open && setConfirm(null)}
        spec={{
          title: `Publish version ${draft?.version ?? ''}?`,
          body: 'New runs use it from now. Runs already in progress stay on the version they started on.',
          confirmLabel: `Publish v${draft?.version ?? ''}`,
        }}
        onConfirm={async () => {
          const result = await publish.run();
          if (!result.ok) throw new Error(describeProblem(result.problem).title);
        }}
      />
      <ConfirmDialog
        open={confirm?.kind === 'rollback'}
        onOpenChange={(open) => !open && setConfirm(null)}
        spec={{
          title: `Make version ${confirm?.kind === 'rollback' ? confirm.version : ''} current?`,
          body: 'Its graph is published again as a new version, and new runs use it from now. Runs in progress stay on their version.',
          confirmLabel: 'Make current',
        }}
        onConfirm={async () => {
          if (confirm?.kind !== 'rollback') return;
          const result = await rollback.run(confirm.version);
          if (!result.ok) throw new Error(describeProblem(result.problem).title);
        }}
      />
    </div>
  );
}

/**
 * The automatic check (SPEC §6.1): run on the newest version when the page
 * opens, for anyone who may read workflows. "No problems", or each problem
 * with a way to the step it is about.
 */
function CheckPanel({
  check,
  draftVersion,
  graph,
  onShow,
}: {
  readonly check: WorkflowDetailProps['check'];
  readonly draftVersion: number | null;
  readonly graph: FlowGraph | null;
  readonly onShow: (key: string) => void;
}): ReactNode {
  const titleFor = (key: string | null): string | null => {
    if (!key || !graph) return null;
    const node = graph.nodes.find((entry) => entry.key === key);
    return node ? nodeTitle(node) : null;
  };
  return (
    <Surface as="section" tone="raised" elevation="xs" padding="md" className="app-Check" aria-labelledby="check-title">
      <h2 id="check-title" className="app-Check__title">
        Check
      </h2>
      {!check.ok ? (
        <InlineAlert tone="warning">
          The check couldn’t run: {describeProblem(check.problem).title}.
        </InlineAlert>
      ) : check.value.problems.length === 0 ? (
        <p className="app-Check__clean">
          <Icon name="circle-check" size="sm" />
          <span>
            No problems in version {check.value.version}
            {draftVersion === check.value.version ? ', the draft' : ''}.
          </span>
        </p>
      ) : (
        <>
          <p className="app-Check__summary">
            {check.value.problems.length === 1 ? 'One problem' : `${check.value.problems.length} problems`} in version {check.value.version}
            {draftVersion === check.value.version ? ', the draft' : ''}:
          </p>
          <ul className="app-Check__list">
            {check.value.problems.map((problem, index) => {
              const title = titleFor(problem.where);
              return (
                <li key={index} className="app-Check__item">
                  <Badge size="sm" tone="danger" icon="circle-alert">
                    Problem
                  </Badge>
                  <span>{problem.message}</span>
                  {title && problem.where ? (
                    <Button size="sm" variant="ghost" onClick={() => onShow(problem.where!)}>
                      Show “{title}”
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Surface>
  );
}
