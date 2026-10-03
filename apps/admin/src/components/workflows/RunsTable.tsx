'use client';

import { useMemo, useRef, type ReactNode } from 'react';
import { Button, EmptyState, StatusPill, notify, useItsm, useNow, type EmptySpec, type Plural } from '@itsm/ui';
import { DataTable, type ColumnSpec, type DataTablePagination, type DataTableScope, type FilterSpec } from '@itsm/ui/data';
import { useRouter } from 'next/navigation';
import { crossAreaTicketHref, type AreaModel } from '@itsm/contracts/areas';
import { api } from '../../client/api.js';
import { useOnline } from '../../client/live.js';
import { useDrawer } from '../../client/useDrawer.js';
import { problemFrom } from '../../problem.js';
import { durationText, isRetryable, runLook, stepOrError } from './presentation.js';
import { RunDrawer } from './RunDrawer.js';
import type { FlowGraph } from './graph.js';
import type { RunView } from './types.js';

/**
 * The runs table (SPEC §6.1 `/workflows/runs`, and the *Runs* tab of a
 * workflow): workflow, ticket, state, the step it is on or the error it
 * stopped with, when it started and how long it has taken. A row opens the
 * run's drawer (`?open=run:<id>`).
 *
 * Selecting is for failed runs only — the Failed scope turns it on — and
 * the one bulk action is **Retry**: one run at a time, with progress and
 * Cancel, then a count of what happened (X-51). A run that says nothing
 * about its failed step cannot be retried and is left out, saying so.
 */
export interface RunsTableProps {
  readonly runs: readonly RunView[];
  readonly caption: string;
  /** `''` for the runs page's one list; another key namespaces a tab's table. */
  readonly urlKey: string;
  readonly graphs: Readonly<Record<string, FlowGraph>>;
  readonly workflows: Readonly<Record<string, { readonly key: string; readonly name: string }>>;
  readonly ruleNames: Readonly<Record<string, string>>;
  readonly canOperate: boolean;
  readonly canReadTickets: boolean;
  /**
   * Ticket numbers by ticket id, for the tickets the page could look up (the
   * desk's newest 200): a run names its ticket "INC-000123" rather than
   * "Open". Runs carry only the id, and the API has no lookup by many ids.
   */
  readonly ticketNumbers?: Readonly<Record<string, string>>;
  /** The person's areas (`currentAreas()`): ticket links open in the Service Desk when it is listed (A2 §3.7). */
  readonly areas?: AreaModel;
  readonly showWorkflow?: boolean;
  readonly scope?: DataTableScope;
  readonly filters?: readonly FilterSpec[];
  /** Failed runs only: turns on selection and *Retry*. */
  readonly selectable?: boolean;
  readonly pagination?: DataTablePagination;
  readonly empty: EmptySpec;
  /** An empty list that is good news ("No failed runs"): said in the success tone. */
  readonly emptyIsGood?: boolean;
  readonly refreshing?: boolean;
  readonly toolbarEnd?: ReactNode;
}

type Row = {
  readonly id: string;
  readonly workflowName: string;
  readonly workflowKey: string;
  readonly ticket: string;
  readonly state: string;
  readonly step: string;
  readonly startedAt: string;
  readonly duration: string;
  readonly run: RunView;
} & Record<string, unknown>;

const NOUN: Plural = { one: 'run', other: 'runs' };

/**
 * The state pill in words without the step: the table's own *Step or error*
 * column already says where a waiting run is waiting ("Waiting · Ask for
 * approval" beside "Ask for approval" said it twice, and on a phone card the
 * long pill squeezed the workflow's name to "Close a…"). The drawer keeps the
 * step in its pill.
 */
function stateLook(run: RunView): ReturnType<typeof runLook> {
  return runLook({ status: run.status, stepTitle: null });
}


export function RunsTable({
  runs,
  caption,
  urlKey,
  graphs,
  workflows,
  ruleNames,
  canOperate,
  canReadTickets,
  ticketNumbers = {},
  areas,
  showWorkflow = true,
  scope,
  filters,
  selectable = false,
  pagination,
  empty,
  emptyIsGood = false,
  refreshing = false,
  toolbarEnd,
}: RunsTableProps): ReactNode {
  const drawer = useDrawer('run');
  const router = useRouter();
  const online = useOnline();
  const now = useNow();
  const { locale } = useItsm();
  const cancelled = useRef(false);

  const rows = useMemo<Row[]>(
    () =>
      runs.map((run) => ({
        id: run.id,
        workflowName: run.workflowName,
        workflowKey: run.workflowKey ?? '',
        ticket: run.ticketId ? (ticketNumbers[run.ticketId] ?? 'Open') : '',
        state: stateLook(run).label,
        step: stepOrError(run),
        startedAt: run.startedAt,
        duration: durationText(run, now, locale),
        run,
      })),
    [runs, now, locale, ticketNumbers],
  );

  const columns: ColumnSpec[] = [
    ...(showWorkflow ? [{ id: 'workflow', header: 'Workflow', field: 'workflowName', kind: 'title', minWidth: 200, truncate: 2 } satisfies ColumnSpec] : []),
    { id: 'ticket', header: 'Ticket', field: 'ticket', width: 110, empty: 'None' },
    { id: 'state', header: 'State', field: 'state', minWidth: 170, cardRole: 'badge' },
    { id: 'step', header: 'Step or error', field: 'step', minWidth: 200, truncate: 2, empty: '—', ...(showWorkflow ? {} : { kind: 'title' as const }) },
    { id: 'started', header: 'Started', field: 'startedAt', kind: 'relative', width: 130, sortable: 'page' },
    { id: 'duration', header: 'Duration', field: 'duration', width: 120, align: 'end', hideBelow: 'md', empty: '—' },
  ];

  const open = drawer.key ? (runs.find((run) => run.id === drawer.key) ?? null) : null;

  const retryAll = async (targets: Row[]): Promise<void> => {
    const retryable = targets.filter((row) => isRetryable(row.run));
    const skipped = targets.length - retryable.length;
    const id = `retry-runs-${Date.now()}`;
    cancelled.current = false;
    let done = 0;
    let failed = 0;
    for (const row of retryable) {
      if (cancelled.current) break;
      notify.progress(id, {
        label: `Retrying ${retryable.length} ${retryable.length === 1 ? 'run' : 'runs'}`,
        done,
        total: retryable.length,
        onCancel: () => {
          cancelled.current = true;
        },
      });
      try {
        await api.configure.workflows.retry(row.id);
      } catch (error) {
        failed += 1;
        if (problemFrom(error).status === 401) break;
      }
      done += 1;
    }
    notify.dismiss(id);
    const retried = done - failed;
    const parts = [`Retried ${retried} ${retried === 1 ? 'run' : 'runs'}`];
    if (failed > 0) parts.push(`${failed} couldn’t be retried`);
    if (skipped > 0) parts.push(`${skipped} didn’t say which step failed`);
    if (cancelled.current && done < retryable.length) parts.push(`${retryable.length - done} left as they were`);
    notify(parts.join(' · '), { tone: failed > 0 || skipped > 0 ? 'warning' : 'success' });
    router.refresh();
  };

  return (
    <>
      <DataTable<Row>
        caption={caption}
        captionHidden
        urlKey={urlKey}
        rows={rows}
        rowKey="id"
        columns={columns}
        {...(scope ? { scope } : {})}
        {...(filters ? { filters } : {})}
        countNoun={NOUN}
        activate={{ kind: 'drawer', openKind: 'run', keyField: 'id' }}
        onActivate={(row) => drawer.open(row.id)}
        currentKeys={drawer.key ? [drawer.key] : []}
        refreshing={refreshing}
        selection={selectable && canOperate ? 'multiple' : 'none'}
        {...(selectable && canOperate
          ? {
              bulkActions: [
                {
                  id: 'retry',
                  label: 'Retry',
                  icon: 'refresh-cw',
                  variant: 'primary',
                  ...(online ? {} : { disabled: true, disabledReason: 'You’re offline — changes can’t be saved.' }),
                  confirm: {
                    title: 'Retry the selected runs?',
                    body: 'Each run tries its failed step again, with the same idempotency key, so an effect that already happened isn’t repeated.',
                    confirmLabel: 'Retry runs',
                  },
                },
              ],
              onAction: (id: string, targets: Row[]) => (id === 'retry' ? retryAll(targets) : undefined),
            }
          : {})}
        cells={{
          ticket: (row) => {
            if (!row.run.ticketId) return <span className="app-Runs__quiet">None</span>;
            const number = ticketNumbers[row.run.ticketId];
            // The Service Desk when it is listed (same tab, through the area model), else this
            // console's Tickets drawer. A run does not say which team has its ticket, so in a demo
            // — where the Service Desk opens only Alex Morgan's teams' tickets (X-B2) — the row opens
            // the drawer, whose *Open in Service Desk* knows the team.
            const desk = areas ? crossAreaTicketHref(areas, { number: number ?? row.run.ticketId, groupId: null }) : null;
            if (number) {
              const href = desk ?? `/tickets?open=ticket:${encodeURIComponent(number)}`;
              return (
                <a className="app-Runs__ticket" href={href} aria-label={`Open ${number}${desk ? ' in the Service Desk' : ''}`}>
                  {number}
                </a>
              );
            }
            return desk ? (
              <Button size="sm" variant="ghost" href={desk} aria-label={`Open the ticket for this ${row.workflowName} run`}>
                Open
              </Button>
            ) : (
              <span className="app-Runs__quiet">A ticket</span>
            );
          },
          state: (row) => {
            const look = stateLook(row.run);
            return <StatusPill size="sm" label={look.label} tone={look.tone} icon={look.icon} srPrefix="State" />;
          },
          step: (row) => <span className={row.run.status === 'failed' ? 'app-Runs__error' : undefined}>{row.step || '—'}</span>,
        }}
        {...(pagination ? { pagination } : {})}
        {...(toolbarEnd ? { toolbarEnd } : {})}
        empty={empty}
        {...(runs.length === 0
          ? {
              // Drawn here so its heading follows the page's own (the table's default is an h3,
              // which skips a level on the runs page); good news is said in the success tone.
              emptyContent: (
                <EmptyState
                  size="sm"
                  headingLevel={2}
                  {...(emptyIsGood ? { tone: 'success' as const } : {})}
                  title={empty.title}
                  {...(empty.description ? { description: empty.description } : {})}
                />
              ),
            }
          : {})}
        noResults={{ title: 'No runs match', description: 'Try another workflow, or clear the filters.' }}
      />
      <RunDrawer
        runId={drawer.key}
        row={open}
        graphs={graphs}
        workflows={workflows}
        ruleNames={ruleNames}
        canOperate={canOperate}
        canReadTickets={canReadTickets}
        {...(areas ? { areas } : {})}
        onClose={drawer.close}
      />
    </>
  );
}
