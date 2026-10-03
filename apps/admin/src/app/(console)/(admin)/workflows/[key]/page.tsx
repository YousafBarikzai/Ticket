import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import type { WorkflowValidation } from '@itsm/sdk';
import { notFound } from 'next/navigation';
import { Card } from '@itsm/ui';
import { PageHeader } from '@itsm/ui/shell';
import { Forbidden } from '../../../../../components/Forbidden.js';
import { WorkflowDetail, type CheckResult } from '../../../../../components/workflows/WorkflowDetail.js';
import { parseFlow } from '../../../../../components/workflows/graph.js';
import { breadcrumbsFor } from '../../../../../navigation.js';
import { read } from '../../../../../server/read.js';
import { holds } from '../../../../../permissions.js';
import { currentAreas, pageAccess } from '../../../../../server/session.js';
import { loadRuleNames, loadTicketNumbers, loadWorkflow, runView, versionViews, workflowAbilities, workflowView } from '../data.js';
import '../../../../../components/workflows/workflows.css';

export const dynamic = 'force-dynamic';

type Params = Promise<{ key: string }>;

export async function generateMetadata({ params }: { readonly params: Params }): Promise<Metadata> {
  const { key } = await params;
  const access = await pageAccess('/workflows/[key]');
  if (!access.allowed) return { title: 'Workflow · Workflows' };
  const workflow = await loadWorkflow(access.api, key);
  return { title: `${workflow.ok ? workflow.value.name : 'Workflow'} · Workflows` };
}

/** The check as the page draws it: each problem's message and the step it is on (`where`), when it names one. */
function checkFrom(value: WorkflowValidation): CheckResult {
  return {
    version: value.version,
    problems: value.problems.map((problem) => ({
      message: problem.message || 'A problem',
      where: typeof problem.where === 'string' && problem.where !== '' ? problem.where : null,
    })),
  };
}

/**
 * One workflow (SPEC §6.1 `/workflows/[key]`). The detail, the automatic
 * check, the list row (for its description and id) and the recent runs are
 * read side by side; the check failing leaves the page usable and says so,
 * and a key that names no workflow is the in-frame 404.
 */
export default async function WorkflowPage({ params, searchParams }: { readonly params: Params; readonly searchParams: Promise<Record<string, string | string[] | undefined>> }): Promise<ReactNode> {
  const access = await pageAccess('/workflows/[key]');
  if (!access.allowed) return <Forbidden route="/workflows/[key]" />;
  const { me, api } = access;
  const { key } = await params;
  const search = await searchParams;
  const crumbs = breadcrumbsFor('/workflows/[key]');

  const [detail, list, check, runs, ruleNames, ticketNumbers] = await Promise.all([
    loadWorkflow(api, key),
    read(() => api.configure.workflows.list()),
    read(() => api.configure.workflows.validate(key)),
    read(() => api.configure.workflows.runs({ limit: 200 })),
    loadRuleNames(api, me),
    loadTicketNumbers(api, holds(me, 'ticket.read')),
  ]);
  if (!detail.ok) {
    if (detail.problem.status === 404) notFound();
    return (
      <div className="app-Page app-Workflow">
        <PageHeader title="Workflow" breadcrumbs={crumbs} />
        <Card title="Workflow" problem={detail.problem} />
      </div>
    );
  }

  const row = list.ok ? list.value.find((entry) => entry.key === key) : undefined;
  const graph = parseFlow(detail.value.graph);
  const view = row
    ? workflowView(row, detail.value)
    : workflowView(
        { id: '', key, name: detail.value.name, description: null, status: detail.value.status, currentVersionId: null, ownerId: null, createdAt: '', updatedAt: new Date().toISOString() },
        detail.value,
      );
  const index = row ? { [row.id]: { key, name: row.name } } : {};
  const graphs = graph ? { [key]: graph } : {};
  const own = runs.ok && row ? runs.value.filter((run) => run.definitionId === row.id).map((run) => runView(run, index, graphs)) : [];
  const can = workflowAbilities(me, detail.value.name);
  // Ticket links open in the Service Desk when it is listed for this person (A2 §3.7).
  const areas = await currentAreas();
  const tab = search.tab === 'history' || search.tab === 'runs' ? search.tab : 'diagram';

  return (
    <WorkflowDetail
      workflow={view}
      graph={graph}
      versions={versionViews(detail.value)}
      check={check.ok ? { ok: true, value: checkFrom(check.value) } : { ok: false, problem: check.problem }}
      runs={own}
      graphs={graphs}
      workflows={index}
      ruleNames={ruleNames}
      canPublish={can.canPublish}
      canOperate={can.canOperate}
      canReadTickets={can.canReadTickets}
      ticketNumbers={ticketNumbers}
      breadcrumbs={crumbs}
      initialTab={tab}
      areas={areas}
      {...(can.viewOnly ? { viewOnly: can.viewOnly } : {})}
    />
  );
}
