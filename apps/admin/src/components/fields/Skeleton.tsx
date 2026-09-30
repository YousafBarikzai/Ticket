import type { ReactNode } from 'react';
import { Skeleton, SkeletonTable } from '@itsm/ui';

/**
 * Ticket fields while it loads: the header with its action, the scope
 * switch and search, and the table's rows. Server-safe.
 */
export function FieldsSkeleton(): ReactNode {
  return (
    <div className="app-Page app-Fields">
      <div className="app-FieldsSkeleton__head" aria-hidden="true">
        <Skeleton width="min(12rem, 50%)" height="var(--itsm-text-title1-size)" radius="md" />
        <Skeleton width="7rem" height="var(--itsm-control-height-md)" radius="lg" />
      </div>
      <div className="app-FieldsSkeleton__toolbar" aria-hidden="true">
        <Skeleton width="12rem" height="var(--itsm-control-height-sm)" radius="lg" />
        <Skeleton width="14rem" height="var(--itsm-control-height-sm)" radius="lg" />
      </div>
      <SkeletonTable rows={6} columns={5} label="Loading ticket fields…" />
    </div>
  );
}
