'use client';

import { useCallback, useEffect, useRef, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { AreaModel } from '@itsm/contracts/areas';
import { IconButton, announce, notify, useItsm, useNow } from '@itsm/ui';
import { formatDateTime, formatRelative } from '@itsm/ui/format';
import { PageHeader, useRoutePending } from '@itsm/ui/shell';
import { api } from '../../client/api.js';
import { problemFrom } from '../../problem.js';
import type { FlowGraph } from './graph.js';
import { RUN_SCOPES, runFrom } from './presentation.js';
import { RunsTable } from './RunsTable.js';
import type { RunScope, RunView } from './types.js';

/**
 * Workflows › Runs (SPEC §6.1 `/workflows/runs`): every run, scoped by state
 * — **Failed** first among the scopes, because that is what someone opens
 * this page for — and filtered by workflow or by ticket number. The page is
 * live: it says how fresh it is, refreshes when the tab comes back after a
 * minute and every five minutes while in view, and on demand.
 *
 * The API returns at most 200 runs and no cursor, so *Load more* asks for a
 * bigger page (50 more, up to 200) and the caption says when there may be
 * more than that.
 */
export interface RunsViewProps {
  readonly runs: readonly RunView[];
  readonly limit: number;
  readonly scope: RunScope;
  readonly scopeHrefs: Readonly<Record<RunScope, string>>;
  /** The API filter the rows were read with, for *Load more*. */
  readonly query: { readonly status?: string; readonly ticketId?: string };
  /** The ticket filter named a ticket this desk does not have. */
  readonly unknownTicket?: string;
  readonly workflows: Readonly<Record<string, { readonly key: string; readonly name: string }>>;
  readonly graphs: Readonly<Record<string, FlowGraph>>;
  readonly ruleNames: Readonly<Record<string, string>>;
  readonly canOperate: boolean;
  readonly canReadTickets: boolean;
  /** Ticket numbers by id, for the runs' ticket column (see `RunsTable`). */
  readonly ticketNumbers?: Readonly<Record<string, string>>;
  /** The person's areas (`currentAreas()`): ticket links open in the Service Desk when it is listed (A2 §3.7). */
  readonly areas?: AreaModel;
  readonly tabs: readonly { id: string; label: string; href: string; match?: 'exact' }[];
  readonly viewOnly?: { readonly label: string; readonly permission: string; readonly key: string };
  /** When the server read these rows (ISO). */
  readonly renderedAt: string;
}

const MAX = 200;
const STEP = 50;
const STALE_AFTER_MS = 60_000;
const REFRESH_EVERY_MS = 5 * 60_000;

const EMPTY: Readonly<Record<RunScope, { title: string; description: string }>> = {
  all: { title: 'No runs yet', description: 'When a workflow starts — from a rule, an event or by hand — its runs appear here.' },
  failed: { title: 'No failed runs', description: 'Nothing has gone wrong that needs you.' },
  waiting: { title: 'Nothing is waiting', description: 'No run is waiting on an approval, a person or a timer.' },
  running: { title: 'Nothing is running', description: 'No run is part-way through a step right now.' },
  completed: { title: 'No finished runs yet', description: 'Runs that reach their end appear here.' },
  cancelled: { title: 'Nothing abandoned', description: 'Runs someone abandoned appear here, with why.' },
};

export function RunsView(props: RunsViewProps): ReactNode {
  const { scope, scopeHrefs, query, workflows, graphs, ruleNames, canOperate, canReadTickets, areas, tabs, viewOnly, unknownTicket } = props;
  const [rows, setRows] = useState<readonly RunView[]>(props.runs);
  const [limit, setLimit] = useState(props.limit);
  const [loading, setLoading] = useState(false);

  // A new first page from the server (a scope, a filter, a refresh) replaces what was loaded.
  useEffect(() => {
    setRows(props.runs);
    setLimit(props.limit);
  }, [props.runs, props.limit]);

  const loadMore = async (): Promise<void> => {
    const next = Math.min(MAX, limit + STEP);
    setLoading(true);
    try {
      const more = await api.configure.workflows.runs({ ...query, limit: next });
      setRows(more.map((row) => runFrom(row as unknown as Record<string, unknown>, workflows, graphs)));
      setLimit(next);
    } catch (error) {
      const problem = problemFrom(error);
      notify('Couldn’t load more runs', { tone: 'danger', ...(problem.detail ? { description: problem.detail } : {}), action: { label: 'Retry', onClick: () => void loadMore() } });
    } finally {
      setLoading(false);
    }
  };

  const hasMore = rows.length >= limit && limit < MAX;
  const names = Object.values(workflows)
    .map((workflow) => ({ value: workflow.key, label: workflow.name }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return (
    <div className="app-Page app-Runs">
      <PageHeader title="Workflows" tabs={tabs} {...(viewOnly ? { viewOnly } : {})} />
      <RunsTable
        runs={rows}
        caption="Workflow runs"
        urlKey=""
        graphs={graphs}
        workflows={workflows}
        ruleNames={ruleNames}
        canOperate={canOperate}
        canReadTickets={canReadTickets}
        {...(props.ticketNumbers ? { ticketNumbers: props.ticketNumbers } : {})}
        {...(areas ? { areas } : {})}
        scope={{
          label: 'State',
          value: scope,
          options: RUN_SCOPES.map((entry) => ({ value: entry.value, label: entry.label, href: scopeHrefs[entry.value] })),
        }}
        filters={[
          { id: 'workflow', label: 'Workflow', type: 'select', pinned: true, field: 'workflowKey', options: names },
          { id: 'ticket', label: 'Ticket', type: 'text', pinned: true, mode: 'server' },
        ]}
        selectable={scope === 'failed'}
        pagination={{ mode: 'loadMore', hasMore, loading, pageSize: STEP, onLoadMore: loadMore }}
        toolbarEnd={<Freshness at={props.renderedAt} />}
        empty={unknownTicket ? { title: `No ticket ${unknownTicket}`, description: 'Check the number, or clear the ticket filter.' } : EMPTY[scope]}
        emptyIsGood={!unknownTicket && scope === 'failed'}
      />
    </div>
  );
}

/**
 * "Updated 1 min ago ↻" (X-85): runs change while the page is open, so it
 * says how fresh it is and refreshes in a transition — what is on screen
 * stays until the new rows arrive.
 */
function Freshness({ at }: { readonly at: string }): ReactNode {
  const router = useRouter();
  const { locale, timeZone } = useItsm();
  const now = useNow();
  const [pending, startTransition] = useTransition();
  const asked = useRef(false);
  useRoutePending(pending);

  const refresh = useCallback(
    (byHand: boolean) => {
      asked.current = byHand;
      startTransition(() => router.refresh());
    },
    [router],
  );

  useEffect(() => {
    if (!asked.current || pending) return;
    asked.current = false;
    announce('Runs updated');
  }, [at, pending]);

  useEffect(() => {
    const renderedAt = Date.parse(at);
    const onVisible = (): void => {
      if (document.visibilityState === 'visible' && Date.now() - renderedAt >= STALE_AFTER_MS) refresh(false);
    };
    document.addEventListener('visibilitychange', onVisible);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') refresh(false);
    }, REFRESH_EVERY_MS);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(timer);
    };
  }, [at, refresh]);

  const moment = Date.parse(at);
  const text =
    now === null
      ? `Updated ${formatDateTime(at, { locale, timeZone, style: 'time' })}`
      : now - moment < 60_000
        ? 'Updated just now'
        : `Updated ${formatRelative(at, now, locale, { timeZone, style: 'short' })}`;

  return (
    <span className="app-Freshness" aria-busy={pending ? true : undefined}>
      <span className="app-Freshness__text">{text}</span>
      <IconButton icon="refresh-cw" label="Refresh runs" size="sm" variant="ghost" disabled={pending} onClick={() => refresh(true)} />
    </span>
  );
}
