'use client';

import { lazy, Suspense, useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  Button,
  DescriptionList,
  EmptyState,
  InlineAlert,
  ProblemState,
  RelativeTime,
  Skeleton,
  SkeletonList,
  StatusPill,
  describeProblem,
  useItsm,
  useNow,
  type Problem,
} from '@itsm/ui';
import { formatDateTime } from '@itsm/ui/format';
import { ConfirmDialog, Sheet } from '@itsm/ui/overlays';
import { api } from '../../client/api.js';
import { useOnline } from '../../client/live.js';
import { useMutation } from '../../client/useMutation.js';
import { problemFrom } from '../../problem.js';
import { nodeTitle, type FlowGraph } from './graph.js';
import { durationText, runActions, runFrom, runLook, stepLook, stepRuns, triggeredByWords, type StepRunView } from './presentation.js';
import type { RunView } from './types.js';

const FlowDiagram = lazy(() => import('./FlowDiagram.js'));

/**
 * One workflow run (`?open=run:<id>`, SPEC §6.1): what it is for, how it
 * started, where it is, every step it took, and — for someone who may operate
 * runs — only the actions its state allows (F25):
 *
 * - **failed**: *Retry step* (the primary: the same step again, with the same
 *   idempotency key, so an effect that half-happened is not repeated),
 *   *Skip step…* and *Abandon run…*, each of the last two asking why;
 * - **waiting**: *Abandon run…* only — a run waiting on an approval or a
 *   timer is not stuck, and retrying or skipping it was never possible;
 * - anything else: nothing.
 *
 * The row is the placeholder while the run's steps load; a pasted link to a
 * run that is not in the list loads it the same way.
 */
export interface RunDrawerProps {
  readonly runId: string | null;
  /** The row, when the list has it. */
  readonly row: RunView | null;
  readonly graphs: Readonly<Record<string, FlowGraph>>;
  /** Workflow id → key and name, for a run the list did not load. */
  readonly workflows: Readonly<Record<string, { readonly key: string; readonly name: string }>>;
  readonly ruleNames: Readonly<Record<string, string>>;
  readonly canOperate: boolean;
  readonly canReadTickets: boolean;
  readonly workbenchOrigin?: string;
  /** Client only. */
  readonly onClose: () => void;
}

type Loaded = { readonly kind: 'loading' } | { readonly kind: 'ready'; readonly run: RunView; readonly steps: readonly StepRunView[] } | { readonly kind: 'failed'; readonly problem: Problem };

type Ask = 'skip' | 'abandon' | null;

export function RunDrawer({ runId, row, graphs, workflows, ruleNames, canOperate, canReadTickets, workbenchOrigin, onClose }: RunDrawerProps): ReactNode {
  const [loaded, setLoaded] = useState<Loaded>({ kind: 'loading' });
  const [ticket, setTicket] = useState<{ readonly number: string; readonly title: string } | null>(null);
  const [ask, setAsk] = useState<Ask>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!runId) return;
    let live = true;
    setLoaded({ kind: 'loading' });
    api.configure.workflows.run(runId).then(
      (value) => {
        if (!live) return;
        const record = value as unknown as Record<string, unknown>;
        setLoaded({ kind: 'ready', run: runFrom(record, workflows, graphs), steps: stepRuns(record.steps) });
      },
      (error: unknown) => {
        if (live) setLoaded({ kind: 'failed', problem: problemFrom(error) });
      },
    );
    return () => {
      live = false;
    };
  }, [runId, attempt, workflows, graphs]);

  const run = loaded.kind === 'ready' ? loaded.run : row;
  const ticketId = run?.ticketId ?? null;
  useEffect(() => {
    setTicket(null);
    if (!ticketId || !canReadTickets) return;
    let live = true;
    api.observe.ticket(ticketId).then(
      (value) => {
        if (live) setTicket({ number: value.number, title: value.title });
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [ticketId, canReadTickets]);

  const reload = useCallback(() => setAttempt((value) => value + 1), []);

  const title = run?.workflowName ?? 'Workflow run';
  const look = run ? runLook(run) : null;
  const allowed = run ? runActions(run, canOperate) : [];

  return (
    <Sheet
      open={runId !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      size="lg"
      title={title}
      description="A workflow run"
      {...(look ? { headerMeta: <StatusPill size="sm" label={look.label} tone={look.tone} icon={look.icon} /> } : {})}
      {...(allowed.length > 0 && run ? { footer: <RunActions run={run} allowed={allowed} onAsk={setAsk} onDone={reload} /> } : {})}
    >
      {runId === null ? null : loaded.kind === 'failed' && loaded.problem.status === 404 ? (
        <EmptyState size="sm" icon="workflow" title="That run no longer exists" description="It may have been removed since the link was shared." />
      ) : loaded.kind === 'failed' && !run ? (
        <ProblemState problem={loaded.problem} context="this run" onRetry={reload} />
      ) : run ? (
        <RunDetail
          run={run}
          steps={loaded.kind === 'ready' ? loaded.steps : null}
          stepsProblem={loaded.kind === 'failed' ? loaded.problem : null}
          graph={run.workflowKey ? graphs[run.workflowKey] : undefined}
          ticket={ticket}
          ruleNames={ruleNames}
          onRetry={reload}
          {...(workbenchOrigin ? { workbenchOrigin } : {})}
        />
      ) : (
        <SkeletonList rows={5} label="Loading the run…" />
      )}

      {run ? <AskDialogs run={run} ask={ask} onClose={() => setAsk(null)} onDone={reload} /> : null}
    </Sheet>
  );
}

function RunDetail({
  run,
  steps,
  stepsProblem,
  graph,
  ticket,
  ruleNames,
  workbenchOrigin,
  onRetry,
}: {
  readonly run: RunView;
  readonly steps: readonly StepRunView[] | null;
  readonly stepsProblem: Problem | null;
  readonly graph: FlowGraph | undefined;
  readonly ticket: { readonly number: string; readonly title: string } | null;
  readonly ruleNames: Readonly<Record<string, string>>;
  readonly workbenchOrigin?: string;
  readonly onRetry: () => void;
}): ReactNode {
  const { locale, timeZone } = useItsm();
  const now = useNow();
  const took = durationText(run, now, locale);
  const titles = graph ? new Map(graph.nodes.map((node) => [node.key, nodeTitle(node)])) : new Map<string, string>();
  const nameOf = (key: string): string => titles.get(key) ?? 'A step no longer in the workflow';
  const ticketHref = run.ticketId && workbenchOrigin ? `${workbenchOrigin}/tickets/${encodeURIComponent(ticket?.number ?? run.ticketId)}` : undefined;

  const done = (steps ?? []).filter((step) => step.status === 'done' || step.status === 'skipped').map((step) => step.key);
  const failed = run.status === 'failed' ? [...run.currentKeys] : [];
  const current = run.status === 'failed' ? [] : [...run.currentKeys];

  return (
    <div className="app-RunDetail">
      {run.status === 'failed' && run.error ? (
        <InlineAlert tone="danger">
          <span className="app-RunDetail__error">{run.error}</span>
        </InlineAlert>
      ) : null}
      {run.status === 'waiting' ? (
        <InlineAlert tone="info">Waiting{run.stepTitle ? ` on “${run.stepTitle}”` : ''}. It carries on by itself when that happens.</InlineAlert>
      ) : null}

      <DescriptionList
        layout="inline"
        dense
        items={[
          {
            id: 'workflow',
            label: 'Workflow',
            value: run.workflowKey ? <a href={`/workflows/${encodeURIComponent(run.workflowKey)}`}>{run.workflowName}</a> : run.workflowName,
          },
          {
            id: 'ticket',
            label: 'Ticket',
            value: run.ticketId ? (
              ticketHref ? (
                <a href={ticketHref}>{ticket ? `${ticket.number} · ${ticket.title}` : 'Open the ticket'}</a>
              ) : ticket ? (
                `${ticket.number} · ${ticket.title}`
              ) : (
                'A ticket'
              )
            ) : (
              'Not about a ticket'
            ),
          },
          { id: 'started', label: 'Started', value: <RelativeTime date={run.startedAt} mode="absolute" absoluteStyle="datetime" /> },
          {
            id: 'duration',
            label: run.endedAt ? 'Took' : run.status === 'running' || run.status === 'queued' ? 'Running for' : 'Open for',
            value: took,
          },
          { id: 'trigger', label: 'Why it started', value: triggeredByWords(run.triggeredBy, ruleNames) },
          ...(run.stepTitle && run.status !== 'failed' ? [{ id: 'step', label: 'Now at', value: run.stepTitle }] : []),
        ]}
      />

      {graph ? (
        <section className="app-RunDetail__section" aria-labelledby={`run-${run.id}-diagram`}>
          <h3 id={`run-${run.id}-diagram`} className="app-RunDetail__heading">
            Where it is
          </h3>
          <Suspense fallback={<Skeleton height={160} radius="lg" />}>
            <FlowDiagram graph={graph} label={`Diagram of ${run.workflowName}, with this run’s progress`} compact highlight={{ current, failed, done }} />
          </Suspense>
        </section>
      ) : null}

      <section className="app-RunDetail__section" aria-labelledby={`run-${run.id}-steps`}>
        <h3 id={`run-${run.id}-steps`} className="app-RunDetail__heading">
          Steps
        </h3>
        {steps === null ? (
          stepsProblem ? (
            <InlineAlert tone="danger">
              Couldn’t load the steps.{' '}
              <Button variant="ghost" size="sm" onClick={onRetry}>
                Try again
              </Button>
            </InlineAlert>
          ) : (
            <SkeletonList rows={3} />
          )
        ) : steps.length === 0 ? (
          <p className="app-RunDetail__quiet">No step has started yet.</p>
        ) : (
          <ol className="app-RunSteps">
            {steps.map((step) => {
              const state = stepLook(step.status);
              return (
                <li key={`${step.key}:${step.attempt}`} className="app-RunSteps__step" data-status={step.status}>
                  <div className="app-RunSteps__head">
                    <span className="app-RunSteps__name">{nameOf(step.key)}</span>
                    {step.attempt > 1 ? <span className="app-RunSteps__attempt">Attempt {step.attempt}</span> : null}
                    <StatusPill size="sm" label={state.label} tone={state.tone} icon={state.icon} />
                  </div>
                  <p className="app-RunSteps__when">
                    {step.startedAt ? formatDateTime(step.startedAt, { locale, timeZone, style: 'datetime' }) : ''}
                    {step.endedAt ? ` – ${formatDateTime(step.endedAt, { locale, timeZone, style: 'time' })}` : ''}
                  </p>
                  {step.error ? <p className="app-RunSteps__error">{step.error}</p> : null}
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </div>
  );
}

function RunActions({ run, allowed, onAsk, onDone }: { readonly run: RunView; readonly allowed: readonly string[]; readonly onAsk: (ask: Ask) => void; readonly onDone: () => void }): ReactNode {
  const online = useOnline();
  const gate = online ? {} : { disabledReason: 'You’re offline — changes can’t be saved.' };
  const retry = useMutation(() => api.configure.workflows.retry(run.id), {
    success: `Retrying “${run.stepTitle ?? 'the failed step'}”`,
    failure: 'Couldn’t retry the step',
    onSuccess: onDone,
  });
  return (
    <div className="app-RunActions">
      {allowed.includes('abandon') ? (
        <Button variant="dangerTinted" onClick={() => onAsk('abandon')} {...gate}>
          Abandon run…
        </Button>
      ) : null}
      {allowed.includes('skip') ? (
        <Button variant="secondary" onClick={() => onAsk('skip')} {...gate}>
          Skip step…
        </Button>
      ) : null}
      {allowed.includes('retry') ? (
        <Button variant="primary" iconStart="refresh-cw" loading={retry.pending} onClick={() => void retry.run()} {...gate}>
          Retry step
        </Button>
      ) : null}
    </div>
  );
}

function AskDialogs({ run, ask, onClose, onDone }: { readonly run: RunView; readonly ask: Ask; readonly onClose: () => void; readonly onDone: () => void }): ReactNode {
  const skip = useMutation((reason: string) => api.configure.workflows.skip(run.id, reason), {
    success: `Skipped “${run.stepTitle ?? 'the failed step'}”`,
    failure: 'Couldn’t skip the step',
    onSuccess: onDone,
  });
  const abandon = useMutation((reason: string) => api.configure.workflows.cancel(run.id, reason), {
    success: 'Run abandoned',
    failure: 'Couldn’t abandon the run',
    onSuccess: onDone,
  });
  return (
    <>
      <ConfirmDialog
        open={ask === 'skip'}
        onOpenChange={(open) => !open && onClose()}
        spec={{
          title: `Skip “${run.stepTitle ?? 'the failed step'}”?`,
          body: 'The run carries on from the next step as if this one had finished. What the step would have done doesn’t happen.',
          confirmLabel: 'Skip step',
          requireReason: { label: 'Why skip it?', hint: 'Kept with the run, for whoever asks later.', minLength: 1 },
        }}
        onConfirm={async (reason) => {
          const result = await skip.run(reason ?? '');
          // Kept open with the reason typed, and the failure said inline, so it can be tried again.
          if (!result.ok) throw new Error(describeProblem(result.problem).title);
        }}
      />
      <ConfirmDialog
        open={ask === 'abandon'}
        onOpenChange={(open) => !open && onClose()}
        spec={{
          title: 'Abandon this run?',
          body: `“${run.workflowName}” stops here for this ticket and won’t carry on. This can’t be undone.`,
          confirmLabel: 'Abandon run',
          tone: 'danger',
          requireReason: { label: 'Why abandon it?', hint: 'Kept with the run, for whoever asks later.', minLength: 1 },
        }}
        onConfirm={async (reason) => {
          const result = await abandon.run(reason ?? '');
          if (!result.ok) throw new Error(describeProblem(result.problem).title);
        }}
      />
    </>
  );
}
