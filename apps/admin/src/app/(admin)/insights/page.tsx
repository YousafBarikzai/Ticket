import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { Badge, EmptyState, Table } from '@itsm/ui';
import { currentActor } from '../../../server/session.js';
import { read } from '../../../server/read.js';
import { holds } from '../../../permissions.js';
import { Panel } from '../../../components/Panel.js';

export const metadata: Metadata = { title: 'Insights' };
export const dynamic = 'force-dynamic';

/**
 * What this desk measures (MOD-12).
 *
 * The metrics, dashboards and scheduled reports the analytics module has held
 * since MOD-12-E1b, none of which had a screen. A metric nobody can list is a
 * metric nobody knows exists, which is how two metrics end up measuring the
 * same thing under different names.
 *
 * It does not render a dashboard. `/analytics/dashboards/:id/render` returns
 * real numbers and a chart drawn badly is worse than no chart — that is a
 * screen of its own, with a date range and a comparison, and it should not be
 * smuggled in under a list.
 *
 * Built-in metrics are marked as such: they ship with the platform, cannot be
 * edited or deleted, and an administrator wondering why the delete button is
 * missing deserves to be told rather than to guess.
 */
export default async function InsightsPage(): Promise<ReactNode> {
  const { me, api } = await currentActor();

  if (!holds(me, 'analytics.read') && !holds(me, 'analytics.manage')) {
    return (
      <EmptyState
        tone="error"
        title="Your account cannot see this desk's numbers"
        description="It needs analytics.read. Ask an administrator."
      />
    );
  }

  const [metrics, dashboards, reports] = await Promise.all([
    read(() => api.observe.insights.metrics()),
    read(() => api.observe.insights.dashboards()),
    read(() => api.observe.insights.reports()),
  ]);

  const metricRows = metrics.ok
    ? ({ ok: true as const, value: metrics.value.data })
    : ({ ok: false as const, message: metrics.message });

  return (
    <div className="itsm-Admin">
      <header className="itsm-Admin__head">
        <h1>Insights</h1>
        <p className="itsm-Admin__lede">
          Everything this desk counts, and where those counts are shown. The numbers come from the analytics projection,
          which is rebuilt from the event log — so a metric added today can be asked about yesterday.
        </p>
      </header>

      <Panel
        title="Metrics"
        description="A metric is one aggregate over one fact. What is here is what a dashboard or a report may ask for."
        result={metricRows}
        empty="No metrics."
      >
        {(rows) => (
          <Table
            caption="Metrics"
            columns={[
              { key: 'name', header: 'Metric', cell: (row) => row.name },
              { key: 'key', header: 'Key', cell: (row) => <code>{row.key}</code> },
              {
                key: 'calc',
                header: 'Counts',
                cell: (row) => `${row.aggregate}${row.field ? ` of ${row.field}` : ''} over ${row.fact}`,
              },
              { key: 'unit', header: 'Unit', cell: (row) => row.unit },
              {
                key: 'origin',
                header: 'Origin',
                cell: (row) =>
                  row.builtin ? (
                    <Badge srPrefix="Origin">Built in</Badge>
                  ) : (
                    <Badge intent="info" srPrefix="Origin">
                      This desk
                    </Badge>
                  ),
              },
            ]}
            rows={rows}
            rowKey={(row) => row.key}
          />
        )}
      </Panel>

      <Panel
        title="Dashboards"
        description="A personal dashboard belongs to one person and is invisible to everybody else, including here."
        result={dashboards}
        empty="No dashboards."
      >
        {(rows) => (
          <Table
            caption="Dashboards"
            columns={[
              { key: 'name', header: 'Dashboard', cell: (row) => row.name },
              { key: 'widgets', header: 'Widgets', cell: (row) => row.widgetCount },
              { key: 'scope', header: 'Who sees it', cell: (row) => (row.personal ? 'One person' : 'The desk') },
              { key: 'seeded', header: 'Origin', cell: (row) => (row.seeded ? 'Shipped' : 'Built here') },
              { key: 'updated', header: 'Updated', cell: (row) => new Date(row.updatedAt).toLocaleDateString() },
            ]}
            rows={rows}
            rowKey={(row) => row.id}
          />
        )}
      </Panel>

      <Panel
        title="Reports"
        description="A report is a set of sections that can be run on demand or on a schedule and sent out as CSV."
        result={reports}
        empty="No reports. Nothing is being sent out on a schedule."
      >
        {(rows) => (
          <Table
            caption="Reports"
            columns={[
              { key: 'name', header: 'Report', cell: (row) => row.name },
              { key: 'key', header: 'Key', cell: (row) => <code>{row.key}</code> },
              {
                key: 'schedules',
                header: 'Scheduled',
                cell: (row) => (row.schedules === 0 ? 'On demand only' : `${row.schedules}`),
              },
              { key: 'runs', header: 'Runs', cell: (row) => row.runs },
            ]}
            rows={rows}
            rowKey={(row) => row.id}
          />
        )}
      </Panel>

      <section className="itsm-Admin__note" aria-label="What this screen cannot do yet">
        <h2>Not built yet</h2>
        <p>
          Rendering a dashboard, running a report and downloading its CSV are all served by the API and have no screen.
          So is the forecast endpoint. They need a date range and a chart to be worth anything, and both are a screen of
          their own rather than a row in a table.
        </p>
      </section>
    </div>
  );
}
