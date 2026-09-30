import type { ReactNode } from 'react';
import { Skeleton, SkeletonTable } from '@itsm/ui';

/**
 * Tickets while it loads: the title, the search field with the status scope
 * and filter chips, then the table's rows. Server-safe.
 */
export function TicketsSkeleton(): ReactNode {
  return (
    <div className="app-Page app-Tickets">
      <div className="app-TicketsSkeleton__head" aria-hidden="true">
        <Skeleton width="min(10rem, 50%)" height="var(--itsm-text-title1-size)" radius="md" />
      </div>
      <div className="app-TicketsSkeleton__toolbar" aria-hidden="true">
        <Skeleton width="min(18rem, 100%)" height="var(--itsm-control-height-md)" radius="lg" />
        <Skeleton width="min(22rem, 100%)" height="var(--itsm-control-height-md)" radius="lg" />
      </div>
      <SkeletonTable rows={10} columns={6} label="Loading tickets…" />
    </div>
  );
}
