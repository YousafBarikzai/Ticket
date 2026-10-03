import type { IconName, Tone } from '@itsm/ui';
import { formatDuration } from '@itsm/ui/format';
import { lifecycle } from '../../lifecycle.js';
import { nodeTitle, type FlowGraph } from './graph.js';
import type { RunScope, RunView, WorkflowView } from './types.js';

/**
 * The workflow pages' words, kept pure so the list, the runs, the drawer
 * and their tests agree (SPEC §6.1 `/workflows/**`; F25).
 */

export interface Look {
  readonly label: string;
  readonly tone: Tone;
  readonly icon: IconName;
}

/* -------------------------------------------------------------- workflows */

/** Live · v3, Draft, or Unpublished changes (a draft waiting on top of a live version). */
export function workflowLook(workflow: Pick<WorkflowView, 'status' | 'liveVersion' | 'hasDraft'>): Look {
  if (workflow.liveVersion !== null && workflow.status === 'published') {
    // Work in progress, not a risk: `info` (D5, A7 §2.9).
    if (workflow.hasDraft) return { label: 'Unpublished changes', tone: 'info', icon: 'pencil' };
    return { label: `Live · v${workflow.liveVersion}`, tone: 'success', icon: 'circle-check' };
  }
  return { label: 'Draft', tone: 'neutral', icon: 'circle-dashed' };
}

/** `?status=` on the list: the Command centre links to `draft`. */
export function workflowScope(param: string | null | undefined): 'all' | 'live' | 'draft' {
  if (param === 'live' || param === 'published') return 'live';
  if (param === 'draft' || param === 'drafts') return 'draft';
  return 'all';
}

export function inWorkflowScope(workflow: Pick<WorkflowView, 'status' | 'liveVersion' | 'hasDraft'>, scope: 'all' | 'live' | 'draft'): boolean {
  if (scope === 'all') return true;
  const live = workflow.status === 'published' && workflow.liveVersion !== null;
  return scope === 'live' ? live : !live || workflow.hasDraft;
}

/* ------------------------------------------------------------------ runs */

export const RUN_SCOPES: readonly { readonly value: RunScope; readonly label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'failed', label: 'Failed' },
  { value: 'waiting', label: 'Waiting' },
  { value: 'running', label: 'Running' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

export function runScope(param: string | null | undefined): RunScope {
  return RUN_SCOPES.some((scope) => scope.value === param) ? (param as RunScope) : 'all';
}

/** A run's state as a pill. Waiting is information, not trouble: it names what it waits on. */
export function runLook(run: Pick<RunView, 'status' | 'stepTitle'>): Look {
  if (run.status === 'queued') return { label: 'Queued', tone: 'info', icon: 'clock' };
  const look = lifecycle(run.status);
  if (run.status === 'waiting' && run.stepTitle) return { ...look, label: `Waiting · ${run.stepTitle}` };
  return look;
}

/** The first line of an error: a stack or a long body is for the drawer. */
export function firstLine(text: string | null | undefined): string {
  if (!text) return '';
  const line = text.split('\n')[0]!.trim();
  return line.length > 140 ? `${line.slice(0, 139)}…` : line;
}

/** "Step / error": what went wrong, or where it is. */
export function stepOrError(run: Pick<RunView, 'status' | 'stepTitle' | 'error'>): string {
  if (run.status === 'failed') return firstLine(run.error) || (run.stepTitle ? `Failed at ${run.stepTitle}` : 'Failed');
  if (run.status === 'cancelled') return run.error ? `Abandoned: ${firstLine(run.error)}` : 'Abandoned';
  if (run.status === 'completed') return 'Finished';
  return run.stepTitle ?? '';
}


/**
 * How long a run took, or has taken so far. A run still going is timed from
 * the shared clock, which the server does not have: its cell stays empty
 * until the page is live, rather than claiming "0 minutes".
 */
export function durationText(run: Pick<RunView, 'startedAt' | 'endedAt'>, now: number | null, locale: string): string {
  if (!run.endedAt && now === null) return '';
  const start = Date.parse(run.startedAt);
  const end = run.endedAt ? Date.parse(run.endedAt) : (now ?? start);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return '';
  if (end - start < 60_000) return 'Under a minute';
  return formatDuration(Math.round((end - start) / 60_000), { locale });
}

export type RunAction = 'retry' | 'skip' | 'abandon';

/**
 * What an operator may do to a run, by its state (F25). Retrying or skipping
 * is for a **failed** step only — the API refuses both on anything else, and
 * the old console offered them on waiting runs, where they did nothing but
 * fail. A failed run that does not say which step failed cannot be retried or
 * skipped either. A waiting run can only be abandoned; one that is queued,
 * running, finished or already abandoned has nothing to do.
 */
export function runActions(run: Pick<RunView, 'status' | 'currentKeys'>, canOperate: boolean): RunAction[] {
  if (!canOperate) return [];
  if (run.status === 'failed') return run.currentKeys.length > 0 ? ['retry', 'skip', 'abandon'] : ['abandon'];
  if (run.status === 'waiting') return ['abandon'];
  return [];
}

export function isRetryable(run: Pick<RunView, 'status' | 'currentKeys'>): boolean {
  return run.status === 'failed' && run.currentKeys.length > 0;
}

/** "Started by the rule “Flag a VIP”", "Started by an event", "Started by hand". */
export function triggeredByWords(triggeredBy: string | null, ruleNames: Readonly<Record<string, string>> = {}): string {
  if (!triggeredBy || triggeredBy === 'manual') return 'Started by hand';
  if (triggeredBy.startsWith('rule:')) {
    const keys = triggeredBy.slice(5).split(',').filter(Boolean);
    const names = keys.map((key) => `“${ruleNames[key] ?? key}”`);
    return names.length === 1 ? `Started by the rule ${names[0]}` : `Started by the rules ${names.join(', ')}`;
  }
  if (triggeredBy.startsWith('event:') || triggeredBy === 'event') return 'Started by an event on the ticket';
  return `Started by ${triggeredBy}`;
}

export interface RunMix {
  readonly completed: number;
  readonly active: number;
  readonly failed: number;
  readonly cancelled: number;
  readonly total: number;
}

/** The last runs of a workflow, by outcome, for the list's mini bar. */
export function runMix(runs: readonly Pick<RunView, 'status'>[]): RunMix {
  let completed = 0;
  let active = 0;
  let failed = 0;
  let cancelled = 0;
  for (const run of runs) {
    if (run.status === 'completed') completed += 1;
    else if (run.status === 'failed') failed += 1;
    else if (run.status === 'cancelled') cancelled += 1;
    else active += 1;
  }
  return { completed, active, failed, cancelled, total: runs.length };
}

/** The mini bar's words: "2 failed", "All completed", "No runs yet". */
export function mixWords(mix: RunMix): string {
  if (mix.total === 0) return 'No runs yet';
  if (mix.failed > 0) return `${mix.failed} failed`;
  if (mix.active > 0) return `${mix.active} in progress`;
  if (mix.completed === mix.total) return 'All completed';
  return `${mix.completed} completed`;
}

/** The step labels for a run's `currentKeys`. */
export function stepTitleFor(keys: readonly string[], titles: Readonly<Record<string, string>> | undefined): string | null {
  if (keys.length === 0) return null;
  const named = keys.map((key) => titles?.[key]).filter((title): title is string => Boolean(title));
  if (named.length === 0) return null;
  return named.join(' and ');
}

export interface StepRunView {
  readonly key: string;
  readonly attempt: number;
  readonly status: string;
  readonly error: string | null;
  readonly startedAt: string;
  readonly endedAt: string | null;
}

/** `workflow-runs/:id`'s `steps`, read defensively. */
export function stepRuns(value: unknown): StepRunView[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((row): row is Record<string, unknown> => typeof row === 'object' && row !== null && typeof (row as { stepKey?: unknown }).stepKey === 'string')
    .map((row) => ({
      key: String(row.stepKey),
      attempt: typeof row.attempt === 'number' ? row.attempt : 1,
      status: String(row.status ?? ''),
      error: typeof row.error === 'string' ? row.error : null,
      startedAt: String(row.startedAt ?? ''),
      endedAt: typeof row.endedAt === 'string' ? row.endedAt : null,
    }));
}

/** A step run's state: done, failed, skipped, started. */
export function stepLook(status: string): Look {
  switch (status) {
    case 'done':
      return { label: 'Done', tone: 'success', icon: 'circle-check' };
    case 'failed':
      return { label: 'Failed', tone: 'danger', icon: 'circle-x' };
    case 'skipped':
      return { label: 'Skipped', tone: 'neutral', icon: 'arrow-right' };
    case 'started':
      return { label: 'In progress', tone: 'info', icon: 'loader-circle' };
    default:
      return lifecycle(status);
  }
}

/**
 * A run as the API returns it (`GET /workflow-runs`, `/workflow-runs/:id`)
 * as the pages' view: its workflow by name and its current step by the
 * step's name in the workflow's graph. Read defensively, for the drawer's
 * detail as much as for the list's rows.
 */
export function runFrom(
  value: Readonly<Record<string, unknown>>,
  workflows: Readonly<Record<string, { readonly key: string; readonly name: string }>>,
  graphs: Readonly<Record<string, FlowGraph>>,
): RunView {
  const workflow = workflows[String(value.definitionId)];
  const keys = Array.isArray(value.currentKeys) ? value.currentKeys.map(String) : [];
  const graph = workflow ? graphs[workflow.key] : undefined;
  const titles = graph ? Object.fromEntries(graph.nodes.map((node) => [node.key, nodeTitle(node)])) : undefined;
  const iso = (at: unknown): string | null => {
    if (typeof at !== 'string' && !(at instanceof Date)) return null;
    const time = new Date(at).getTime();
    return Number.isNaN(time) ? null : new Date(time).toISOString();
  };
  return {
    id: String(value.id),
    workflowId: String(value.definitionId),
    workflowKey: workflow?.key ?? null,
    workflowName: workflow?.name ?? 'A workflow',
    ticketId: typeof value.ticketId === 'string' ? value.ticketId : null,
    status: String(value.status ?? ''),
    currentKeys: keys,
    stepTitle: stepTitleFor(keys, titles),
    error: typeof value.error === 'string' ? value.error : null,
    triggeredBy: typeof value.triggeredBy === 'string' ? value.triggeredBy : null,
    startedAt: iso(value.startedAt) ?? '',
    endedAt: iso(value.endedAt),
  };
}
