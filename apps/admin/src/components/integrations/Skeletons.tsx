import type { ReactNode } from 'react';
import { Skeleton, SkeletonStat, SkeletonTable } from '@itsm/ui';

/**
 * The Integrations tabs while they load: the header with its tabs, the
 * health cards on the first tab, then a table shaped like the tab's.
 * Server-safe; the design system's skeletons reveal after 200 ms and
 * announce once.
 */

function Header({ action }: { readonly action: boolean }): ReactNode {
  return (
    <div className="app-IntegrationsSkeleton__head" aria-hidden="true">
      <div className="app-IntegrationsSkeleton__title">
        <Skeleton width="min(11rem, 55%)" height="var(--itsm-text-title1-size)" radius="md" />
        {action ? <Skeleton width="9rem" height="var(--itsm-control-height-md)" radius="lg" /> : null}
      </div>
      <div className="app-IntegrationsSkeleton__tabs">
        <Skeleton width="7rem" height={14} />
        <Skeleton width="3.5rem" height={14} />
        <Skeleton width="5rem" height={14} />
        <Skeleton width="4.5rem" height={14} />
      </div>
    </div>
  );
}

export function DeliveriesSkeleton(): ReactNode {
  return (
    <div className="app-Page app-Integrations">
      <Header action={false} />
      <div className="app-IntegrationsSkeleton__stats" aria-hidden="true">
        <SkeletonStat />
        <SkeletonStat />
        <SkeletonStat />
      </div>
      <SkeletonTable rows={6} columns={5} label="Loading failed deliveries…" />
    </div>
  );
}

export function IntegrationsTableSkeleton({ label, columns, action = false }: { readonly label: string; readonly columns: number; readonly action?: boolean }): ReactNode {
  return (
    <div className="app-Page app-Integrations">
      <Header action={action} />
      <SkeletonTable rows={6} columns={columns} label={label} />
    </div>
  );
}
