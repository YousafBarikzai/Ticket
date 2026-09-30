'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { ReportRunRow } from '@itsm/sdk';
import { Button, EmptyState, Icon, ProblemState, RelativeTime, SkeletonList, StatusPill, useItsm, VisuallyHidden, type Problem, type Tone } from '@itsm/ui';
import { DataTable, type ColumnSpec } from '@itsm/ui/data';
import { formatDateTime, formatNumber } from '@itsm/ui/format';
import { Sheet } from '@itsm/ui/overlays';
import { api } from '../../client/api.js';
import { useDrawer } from '../../client/useDrawer.js';
import { useMutation } from '../../client/useMutation.js';
import { problemFrom } from '../../problem.js';

/** One report as the table shows it: serialisable, written by the server page. */
export interface ReportTableRow {
  readonly [field: string]: unknown;
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly description: string | null;
  readonly schedules: number;
  readonly schedulesLabel: string;
  readonly runs: number;
  readonly lastRunAt: string | null;
  readonly lastRunStatus: string | null;
}

const RUN_STATUS: Readonly<Record<string, { readonly label: string; readonly tone: Tone }>> = {
  done: { label: 'Finished', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  running: { label: 'Running', tone: 'info' },
  queued: { label: 'Queued', tone: 'neutral' },
};

const COLUMNS: readonly ColumnSpec[] = [
  { id: 'name', header: 'Report', field: 'name', kind: 'title', secondaryField: 'description', truncate: 2, width: '2fr', minWidth: 220 },
  { id: 'schedules', header: 'Schedules', field: 'schedulesLabel', kind: 'text', hideBelow: 'md', width: '1fr' },
  { id: 'runs', header: 'Runs', field: 'runs', kind: 'number', align: 'end', hideBelow: 'md', width: 96 },
  { id: 'lastRunAt', header: 'Last run', field: 'lastRunAt', kind: 'relative', empty: 'Never', width: '1fr' },
  { id: 'lastRunStatus', header: 'Result', field: 'lastRunStatus', kind: 'status', map: RUN_STATUS, empty: '—', hideBelow: 'sm', width: '1fr' },
];

/** Where a finished run's CSV is: the API's route, through this app's proxy (same origin, CSP-safe). */
export function csvHref(runId: string): string {
  return `/api/proxy/api/v1/analytics/report-runs/${encodeURIComponent(runId)}/csv`;
}

/** The file name a download is saved as — the proxy does not forward the API's own header. */
export function csvFileName(reportKey: string, run: Pick<ReportRunRow, 'periodTo'>): string {
  // A period ends at the start of its next day; the file is named for the last day it covers.
  const last = new Date(Date.parse(run.periodTo) - 1);
  const stamp = Number.isNaN(last.getTime()) ? 'run' : last.toISOString().slice(0, 10);
  return `report-${reportKey}-${stamp}.csv`;
}

/**
 * Insights › Reports (SPEC §6.1): each report, how often it goes out and how
 * its last run went. A row opens its runs (`?open=report:<id>`), each
 * finished one with Download CSV; people who manage insights can run it now.
 */
export function ReportsTable({ rows, canRun }: { readonly rows: readonly ReportTableRow[]; readonly canRun: boolean }): ReactNode {
  const drawer = useDrawer('report');
  const open = drawer.key ? rows.find((row) => row.id === drawer.key) : undefined;

  return (
    <>
      <DataTable
        caption="Reports"
        captionHidden
        columns={COLUMNS}
        rows={rows}
        rowKey="id"
        urlKey=""
        search={{ placeholder: 'Search reports', mode: 'client', shortcut: '/' }}
        activate={{ kind: 'drawer', openKind: 'report', keyField: 'id' }}
        onActivate={(row) => drawer.open(row.id)}
        {...(drawer.key ? { currentKeys: [drawer.key] } : {})}
        countNoun={{ one: 'report', other: 'reports' }}
        empty={{
          title: 'No reports yet',
          description: 'A report is a set of numbers sent out as a spreadsheet, on demand or on a schedule. None are set up for this desk.',
          icon: 'insights',
        }}
        noResults={{ title: 'No reports match', description: 'Try another word.' }}
      />
      <Sheet
        open={drawer.key !== null}
        onOpenChange={(next) => {
          if (!next) drawer.close();
        }}
        size="md"
        title={open?.name ?? 'Report'}
        {...(open?.description ? { description: open.description } : {})}
      >
        {open ? (
          <ReportRuns key={open.id} report={open} canRun={canRun} />
        ) : drawer.key ? (
          <p className="app-Explorer__missing">That report no longer exists. It may have been deleted since the link was shared.</p>
        ) : null}
      </Sheet>
    </>
  );
}

/** A report's runs, newest first, with Download CSV on each finished one, and Run now. */
export function ReportRuns({ report, canRun }: { readonly report: ReportTableRow; readonly canRun: boolean }): ReactNode {
  const { locale } = useItsm();
  const [runs, setRuns] = useState<readonly ReportRunRow[] | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const asked = useRef(0);

  const load = useCallback(async () => {
    const ticket = ++asked.current;
    try {
      const rows = await api.observe.insights.reportRuns(report.id, 20);
      if (ticket === asked.current) {
        setRuns(rows);
        setProblem(null);
      }
    } catch (error) {
      if (ticket === asked.current) setProblem(problemFrom(error));
    }
  }, [report.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = useMutation(() => api.observe.insights.runReport(report.id), {
    success: (result) =>
      result.status === 'done'
        ? `${report.name} ran · ${formatNumber(result.rowCount, { locale })} ${result.rowCount === 1 ? 'row' : 'rows'}`
        : `${report.name} is running`,
    failure: `Couldn’t run ${report.name}`,
    onSuccess: () => void load(),
  });

  const period = (row: ReportRunRow): string =>
    `${formatDateTime(row.periodFrom, { locale, timeZone: 'UTC', style: 'date' })} – ${formatDateTime(new Date(Date.parse(row.periodTo) - 1).toISOString(), { locale, timeZone: 'UTC', style: 'date' })}`;

  return (
    <div className="app-Runs">
      <div className="app-Runs__head">
        <p className="app-Runs__summary">
          {report.schedules === 0 ? 'On demand only' : report.schedulesLabel} · {formatNumber(report.runs, { locale })} {report.runs === 1 ? 'run' : 'runs'} so far
        </p>
        {canRun ? (
          <Button variant="secondary" size="sm" iconStart="play" loading={run.pending} loadingLabel="Running…" onClick={() => void run.run()}>
            Run now
          </Button>
        ) : null}
      </div>
      {problem ? (
        <ProblemState size="sm" problem={problem} context="Runs" onRetry={() => void load()} />
      ) : runs === null ? (
        <SkeletonList rows={3} label="Loading runs…" />
      ) : runs.length === 0 ? (
        <EmptyState
          size="sm"
          headingLevel={3}
          icon="history"
          title="Not run yet"
          description={canRun ? 'Run it now to get the last 30 days as a spreadsheet.' : 'Runs appear here when it is run on demand or on its schedule.'}
        />
      ) : (
        <ol className="app-Runs__list">
          {runs.map((row) => {
            const status = RUN_STATUS[row.status] ?? { label: row.status, tone: 'neutral' as const };
            return (
              <li key={row.id} className="app-Runs__run">
                <div className="app-Runs__text">
                  <p className="app-Runs__period">{period(row)}</p>
                  <p className="app-Runs__meta">
                    <StatusPill size="sm" tone={status.tone} label={status.label} />
                    <span>
                      {row.status === 'done' ? `${formatNumber(row.rowCount, { locale })} ${row.rowCount === 1 ? 'row' : 'rows'} · ` : ''}
                      <RelativeTime date={row.finishedAt ?? row.startedAt} />
                    </span>
                  </p>
                  {row.error ? <p className="app-Runs__error">{row.error}</p> : row.summary ? <p className="app-Runs__detail">{row.summary}</p> : null}
                </div>
                {row.status === 'done' ? (
                  // A plain anchor with `download` (a design-system button cannot carry it): styled as a small secondary button.
                  <a className="itsm-Button itsm-Button--secondary itsm-Button--sm app-Runs__download" href={csvHref(row.id)} download={csvFileName(report.key, row)}>
                    <Icon name="download" size="sm" className="itsm-Button__icon" />
                    <span className="itsm-Button__label">
                      Download CSV<VisuallyHidden> for {period(row)}</VisuallyHidden>
                    </span>
                  </a>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
