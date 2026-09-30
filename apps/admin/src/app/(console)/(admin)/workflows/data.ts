import 'server-only';
import { cache } from 'react';
import type { Admin, Me, WorkflowRow, WorkflowRunRow } from '@itsm/sdk';
import { tabsFor } from '../../../../navigation.js';
import { holds, holdsAny, viewOnlyFor } from '../../../../permissions.js';
import { read, type Read } from '../../../../server/read.js';
import { parseFlow, triggerWords, type FlowGraph } from '../../../../components/workflows/graph.js';
import { runFrom } from '../../../../components/workflows/presentation.js';
import type { RunView, VersionView, WorkflowView } from '../../../../components/workflows/types.js';

/**
 * What the three workflow pages share: the rows made serialisable, each
 * workflow's graph and versions (`GET /workflows/:key`), step names for the
 * runs, and who may do what. Server-only (SPEC §3.6).
 */

/** `GET /workflows/:key` as the API returns it (the SDK types the list row only). */
export interface WorkflowDetailRow {
  readonly key: string;
  readonly name: string;
  readonly status: string;
  readonly versions: readonly { readonly version: number; readonly status: string; readonly changeNote: string | null; readonly publishedAt: string | null; readonly isCurrent: boolean }[];
  /** The newest version's graph: the draft when there is one. */
  readonly graph: unknown;
}

export const loadWorkflow = cache((api: Admin, key: string): Promise<Read<WorkflowDetailRow>> => read(() => api.configure.workflows.get(key) as unknown as Promise<WorkflowDetailRow>));

export interface WorkflowAbilities {
  readonly canPublish: boolean;
  readonly canOperate: boolean;
  readonly canReadTickets: boolean;
  readonly viewOnly?: { readonly label: string; readonly permission: string; readonly key: string };
}

export function workflowAbilities(me: Me, label: string): WorkflowAbilities {
  const viewOnly = viewOnlyFor(me, label, ['workflow.publish', 'workflow.operate']);
  return {
    canPublish: holds(me, 'workflow.publish'),
    canOperate: holds(me, 'workflow.operate'),
    canReadTickets: holds(me, 'ticket.read'),
    ...(viewOnly ? { viewOnly } : {}),
  };
}

export function workflowTabs(me: Me): ReturnType<typeof tabsFor> {
  return tabsFor(me, 'workflows');
}

export function versionViews(detail: WorkflowDetailRow | null): VersionView[] {
  return (detail?.versions ?? []).map((version) => ({
    version: version.version,
    status: version.status,
    changeNote: version.changeNote ?? null,
    publishedAt: version.publishedAt ? new Date(version.publishedAt).toISOString() : null,
    isCurrent: version.isCurrent,
  }));
}

export function workflowView(row: WorkflowRow, detail: WorkflowDetailRow | null): WorkflowView {
  const versions = detail?.versions ?? [];
  const current = versions.find((version) => version.isCurrent);
  const newest = versions[0];
  const graph = detail ? parseFlow(detail.graph) : null;
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    status: row.status,
    updatedAt: row.updatedAt,
    liveVersion: current?.version ?? null,
    // With the versions known: a draft newer than what runs. Without them, a draft row is a draft.
    hasDraft: detail ? newest?.status === 'draft' : row.status !== 'published',
    trigger: graph ? triggerWords(graph.trigger) : null,
  };
}

/** At most this many workflows are read one by one for their versions; beyond it the list says less. */
const DETAIL_LIMIT = 40;

/** Each workflow's detail, read side by side; a failed read leaves that workflow with fewer words. */
export async function loadDetails(api: Admin, rows: readonly WorkflowRow[]): Promise<Map<string, WorkflowDetailRow>> {
  const wanted = rows.slice(0, DETAIL_LIMIT);
  const results = await Promise.all(wanted.map((row) => loadWorkflow(api, row.key)));
  const details = new Map<string, WorkflowDetailRow>();
  results.forEach((result, index) => {
    if (result.ok) details.set(wanted[index]!.key, result.value);
  });
  return details;
}

export function graphsFrom(details: ReadonlyMap<string, WorkflowDetailRow>): Record<string, FlowGraph> {
  const graphs: Record<string, FlowGraph> = {};
  for (const [key, detail] of details) {
    const graph = parseFlow(detail.graph);
    if (graph) graphs[key] = graph;
  }
  return graphs;
}

export function workflowIndex(rows: readonly WorkflowRow[]): Record<string, { readonly key: string; readonly name: string }> {
  return Object.fromEntries(rows.map((row) => [row.id, { key: row.key, name: row.name }]));
}

export function runView(
  row: WorkflowRunRow,
  workflows: Readonly<Record<string, { readonly key: string; readonly name: string }>>,
  graphs: Readonly<Record<string, FlowGraph>>,
): RunView {
  return runFrom(row as unknown as Record<string, unknown>, workflows, graphs);
}

/** Rule names, so "Started by the rule …" names a rule rather than its key. Empty for people who cannot read rules. */
export async function loadRuleNames(api: Admin, me: Me): Promise<Record<string, string>> {
  if (!holdsAny(me, ['rules.rule.read', 'rules.rule.manage', 'rules.rule.publish'])) return {};
  const rules = await read(() => api.configure.rules.list());
  return rules.ok ? Object.fromEntries(rules.value.map((rule) => [rule.key, rule.name])) : {};
}
