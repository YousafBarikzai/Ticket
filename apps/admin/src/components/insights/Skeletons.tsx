import type { ReactNode } from 'react';
import { Skeleton, SkeletonCard, SkeletonStat, SkeletonTable } from '@itsm/ui';

/**
 * The Insights routes' loading shapes (SPEC §6.1 "Admin loading
 * skeletons"): the header with its three tabs, then either the dashboards
 * layout — the list beside twelve-column widget ghosts in the seeded
 * overview's widths — or a table. Server-safe; revealed after 200 ms and
 * announced once, after a second, by the design system's skeletons.
 */

function Header(): ReactNode {
  return (
    <div className="app-InsightsSkeleton__head" aria-hidden="true">
      <Skeleton width="min(12rem, 50%)" height="var(--itsm-text-title1-size)" radius="md" />
      <div className="app-InsightsSkeleton__tabs">
        <Skeleton width="6rem" height={14} />
        <Skeleton width="4.5rem" height={14} />
        <Skeleton width="4.5rem" height={14} />
      </div>
    </div>
  );
}

/** Stat, stat, stat, stat; a wide chart and a narrow one; two halves — the overview's widths. */
const WIDTHS = [3, 3, 3, 3, 8, 4, 6, 6] as const;

export function DashboardsSkeleton(): ReactNode {
  return (
    <div className="app-Page app-Insights">
      <Header />
      <div className="app-Dashboards">
        <div className="app-Dashboards__nav" aria-hidden="true">
          <Skeleton width="80%" height={14} />
          <Skeleton width="60%" height={14} className="app-Widget__ghostChart" />
          <Skeleton width="50%" height={14} className="app-Widget__ghostChart" />
        </div>
        <div className="app-Dashboards__picker" aria-hidden="true">
          <Skeleton height="var(--itsm-control-height-md)" radius="lg" />
        </div>
        <div className="app-Dashboard">
          <Skeleton width="min(16rem, 60%)" height="var(--itsm-text-title2-size)" radius="md" />
          <div className="app-Widgets">
            {WIDTHS.map((width, index) => (
              <div key={index} className="app-Widget" data-width={width}>
                {width <= 3 ? (
                  <div className="app-Widget__ghost" aria-hidden="true">
                    <SkeletonStat />
                  </div>
                ) : index === 4 ? (
                  <SkeletonCard lines={6} label="Loading dashboards…" />
                ) : (
                  <SkeletonCard lines={4} />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function TableSkeleton({ label, columns }: { readonly label: string; readonly columns: number }): ReactNode {
  return (
    <div className="app-Page app-Insights">
      <Header />
      <div aria-hidden="true">
        <Skeleton width="min(16rem, 100%)" height="var(--itsm-control-height-md)" radius="lg" />
      </div>
      <SkeletonTable rows={8} columns={columns} label={label} />
    </div>
  );
}
