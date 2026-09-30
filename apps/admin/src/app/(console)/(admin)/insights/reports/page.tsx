import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import type { ReportRunRow } from '@itsm/sdk';
import { Card } from '@itsm/ui';
import { PageHeader } from '@itsm/ui/shell';
import { Forbidden } from '../../../../../components/Forbidden.js';
import { ReportsTable, type ReportTableRow } from '../../../../../components/insights/ReportsTable.js';
import { tabsFor } from '../../../../../navigation.js';
import { holdsAny } from '../../../../../permissions.js';
import { read } from '../../../../../server/read.js';
import { pageAccess } from '../../../../../server/session.js';
import '../../../../../components/command-centre/shared.css';
import '../../../../../components/insights/insights.css';

export const metadata: Metadata = { title: 'Reports · Insights' };
export const dynamic = 'force-dynamic';

/** Reports whose last run is looked up for the table; a desk has a handful, and past this the column reads "—". */
const LAST_RUN_LOOKUPS = 50;

/**
 * Insights › Reports (SPEC §6.1): what goes out as a spreadsheet, how often,
 * and how the last run went. The list route has no "last run", so each
 * report's newest run is asked for alongside it (one small call each, in
 * parallel, each allowed to fail and read "—").
 */
export default async function ReportsPage(): Promise<ReactNode> {
  const access = await pageAccess('/insights/reports');
  if (!access.allowed) return <Forbidden route="/insights/reports" />;
  const { me, api } = access;
  const reports = await read(() => api.observe.insights.reports());

  let rows: ReportTableRow[] = [];
  if (reports.ok) {
    const lastRuns = await Promise.all(
      reports.value.map((report, index) =>
        index < LAST_RUN_LOOKUPS && report.runs > 0
          ? api.observe.insights.reportRuns(report.id, 1).then(
              (runs): ReportRunRow | null => runs[0] ?? null,
              () => null,
            )
          : Promise.resolve(null),
      ),
    );
    rows = reports.value.map((report, index) => {
      const last = lastRuns[index] ?? null;
      return {
        id: report.id,
        key: report.key,
        name: report.name,
        description: report.description,
        schedules: report.schedules,
        schedulesLabel: report.schedules === 0 ? 'On demand' : `${report.schedules} ${report.schedules === 1 ? 'schedule' : 'schedules'}`,
        runs: report.runs,
        lastRunAt: last ? (last.finishedAt ?? last.startedAt) : null,
        lastRunStatus: last?.status ?? null,
      };
    });
  }

  return (
    <div className="app-Page app-Insights">
      <PageHeader title="Insights" tabs={tabsFor(me, 'insights')} />
      {reports.ok ? <ReportsTable rows={rows} canRun={holdsAny(me, ['analytics.manage'])} /> : <Card title="Reports" problem={reports.problem} />}
    </div>
  );
}
