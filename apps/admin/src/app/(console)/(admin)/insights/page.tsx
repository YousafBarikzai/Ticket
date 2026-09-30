import { Suspense, type ReactNode } from 'react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Card, EmptyState } from '@itsm/ui';
import { HierNav, PageHeader } from '@itsm/ui/shell';
import { Forbidden } from '../../../../components/Forbidden.js';
import { DashboardActions, DashboardPicker } from '../../../../components/insights/DashboardControls.js';
import {
  DashboardBody,
  dashboardHref,
  dashboardLink,
  orderDashboards,
  pickDashboard,
  WidgetGridSkeleton,
} from '../../../../components/insights/Dashboards.js';
import { tabsFor } from '../../../../navigation.js';
import { read } from '../../../../server/read.js';
import { pageAccess } from '../../../../server/session.js';
import '../../../../components/command-centre/shared.css';
import '../../../../components/insights/insights.css';

export const metadata: Metadata = { title: 'Insights' };
export const dynamic = 'force-dynamic';

/**
 * Insights › Dashboards (SPEC §6.1, MOD-12): the desk's numbers as charts.
 *
 * The list of dashboards beside the one being read (a select on a phone);
 * the selected one — `?dashboard=<key>` — rendered by the API in one call,
 * widget by widget on a twelve-column grid, each widget failing on its own.
 * The seeded desk opens on "Service desk overview" at `/insights`. Editing a
 * dashboard is a later addition (SPEC [Plus]); nothing here offers it.
 */
export default async function InsightsPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactNode> {
  const access = await pageAccess('/insights');
  if (!access.allowed) return <Forbidden route="/insights" />;
  const { me, api } = access;
  const wanted = single((await searchParams).dashboard);
  const tabs = tabsFor(me, 'insights');

  const list = await read(() => api.observe.insights.dashboards());
  if (!list.ok) {
    return (
      <div className="app-Page app-Insights">
        <PageHeader title="Insights" tabs={tabs} />
        <Card title="Dashboards" problem={list.problem} />
      </div>
    );
  }

  const dashboards = orderDashboards(list.value);
  const selected = pickDashboard(dashboards, wanted);
  if (!selected) {
    return (
      <div className="app-Page app-Insights">
        <PageHeader title="Insights" tabs={tabs} />
        <EmptyState
          size="lg"
          illustration="empty-chart"
          title="No dashboards yet"
          description="Dashboards show this desk’s numbers as charts, and none are set up here. Every number a dashboard can show is under Metrics."
          action={{ id: 'metrics', label: 'Open Metrics', href: '/insights/metrics', variant: 'secondary' }}
        />
      </div>
    );
  }

  // The first dashboard's own address is the tab's page, so the list shows
  // it as current; a link that names it explicitly lands there too.
  const first = dashboards[0]!;
  if (wanted && selected.id === first.id) redirect('/insights');

  const items = dashboards.map((dashboard, index) => ({
    id: dashboard.id,
    label: dashboard.personal ? `${dashboard.name} · only you` : dashboard.name,
    href: dashboardHref(dashboard, index === 0),
  }));

  return (
    <div className="app-Page app-Insights">
      <PageHeader title="Insights" tabs={tabs} />
      <div className="app-Dashboards">
        <div className="app-Dashboards__nav">
          <HierNav label="Dashboards" items={items} />
        </div>
        <div className="app-Dashboards__picker">
          <DashboardPicker options={items.map((item) => ({ value: item.id, label: item.label, href: item.href }))} value={selected.id} />
        </div>
        <section className="app-Dashboard" aria-labelledby="app-dashboard-title">
          <header className="app-Dashboard__head">
            <div className="app-Dashboard__title">
              <h2 id="app-dashboard-title">{selected.name}</h2>
              {selected.description ? <p className="app-Dashboard__description">{selected.description}</p> : null}
            </div>
            <DashboardActions href={dashboardLink(selected)} name={selected.name} />
          </header>
          <Suspense key={selected.id} fallback={<WidgetGridSkeleton count={selected.widgetCount} />}>
            <DashboardBody me={me} api={api} id={selected.id} />
          </Suspense>
        </section>
      </div>
    </div>
  );
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
