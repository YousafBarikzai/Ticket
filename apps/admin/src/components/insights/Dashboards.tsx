import type { ReactNode } from 'react';
import type { Admin, DashboardRow, Me } from '@itsm/sdk';
import { Banner, Card, Skeleton, SkeletonStat } from '@itsm/ui';
import { read } from '../../server/read.js';
import { hasData } from './presentation.js';
import { Widget } from './Widget.js';

/** A dashboard's address. The first in the list is the tab's own page. */
export function dashboardHref(dashboard: Pick<DashboardRow, 'key'>, first: boolean): string {
  return first ? '/insights' : `/insights?dashboard=${encodeURIComponent(dashboard.key)}`;
}

/** Its stable address, by key, for Copy link: it survives the list being reordered. */
export function dashboardLink(dashboard: Pick<DashboardRow, 'key'>): string {
  return `/insights?dashboard=${encodeURIComponent(dashboard.key)}`;
}

/** The dashboards every desk starts with, in the order a service review reads them. */
const SEEDED_ORDER = ['service-desk', 'teams', 'sla'];

/**
 * The desk's dashboards first — the seeded ones in their own order, so a
 * desk opens on "Service desk overview", then the rest by name — and then
 * this person's own, by name.
 */
export function orderDashboards(rows: readonly DashboardRow[]): DashboardRow[] {
  const rank = (row: DashboardRow): number => {
    const seeded = row.seeded ? SEEDED_ORDER.indexOf(row.key) : -1;
    return seeded >= 0 ? seeded : SEEDED_ORDER.length;
  };
  const byName = (a: DashboardRow, b: DashboardRow): number => rank(a) - rank(b) || a.name.localeCompare(b.name, 'en-GB');
  return [...rows.filter((row) => !row.personal).sort(byName), ...rows.filter((row) => row.personal).sort(byName)];
}

/** The dashboard a `?dashboard=` names — by key, or by id for an old link — else the first. */
export function pickDashboard(rows: readonly DashboardRow[], wanted: string | undefined): DashboardRow | undefined {
  if (wanted) {
    const found = rows.find((row) => row.key === wanted) ?? rows.find((row) => row.id === wanted);
    if (found) return found;
  }
  return rows[0];
}

/** The widths a skeleton draws before the dashboard's own are known: the seeded overview's. */
const GHOST_WIDTHS = [3, 3, 3, 3, 8, 4, 6, 6];

export function WidgetGridSkeleton({ count = GHOST_WIDTHS.length }: { readonly count?: number }): ReactNode {
  const widths = Array.from({ length: Math.max(1, Math.min(count, 12)) }, (_, index) => GHOST_WIDTHS[index % GHOST_WIDTHS.length]!);
  return (
    <div className="app-Widgets" aria-hidden="true">
      {widths.map((width, index) => (
        <div key={index} className="app-Widget" data-width={width}>
          {width <= 3 ? (
            <div className="app-Widget__ghost">
              <SkeletonStat />
            </div>
          ) : (
            <Card>
              <Skeleton width="40%" height={16} />
              <Skeleton height={width >= 8 ? 200 : 140} radius="md" className="app-Widget__ghostChart" />
            </Card>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Every widget of one dashboard, evaluated by the API in one call and drawn
 * on a twelve-column grid that honours each widget's width (full width on a
 * phone). If nothing on it has data — the analytics projection has not caught
 * up, or the desk is new — one line says so above the widgets rather than
 * every widget saying it separately.
 */
export async function DashboardBody({ me, api, id }: { readonly me: Me; readonly api: Admin; readonly id: string }): Promise<ReactNode> {
  const rendered = await read(() => api.observe.insights.render(id));
  if (!rendered.ok) return <Card title="This dashboard" problem={rendered.problem} />;
  const widgets = rendered.value.widgets;
  if (widgets.length === 0) {
    return (
      <Card>
        <p className="app-Widget__empty">This dashboard has no widgets yet.</p>
      </Card>
    );
  }
  const quiet = widgets.every((widget) => !widget.error && !hasData(widget.result));
  return (
    <>
      {quiet ? (
        <Banner tone="info" variant="subtle" live={false} title="No data for this range yet">
          Numbers appear as tickets are raised.
        </Banner>
      ) : null}
      <div className="app-Widgets">
        {widgets.map((widget) => (
          <div key={widget.id} className="app-Widget" data-width={Math.min(12, Math.max(1, Math.round(widget.width)))} data-type={widget.type}>
            <Widget widget={widget} locale={me.locale} timeZone={me.timeZone} />
          </div>
        ))}
      </div>
    </>
  );
}
