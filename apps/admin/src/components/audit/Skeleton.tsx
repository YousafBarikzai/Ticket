import type { ReactNode } from 'react';
import { Skeleton, SkeletonTable } from '@itsm/ui';

/**
 * The audit log while it loads: the header with its export button, the
 * sequence line, the filter chips and a table shaped like the timeline.
 * Server-safe; the design system's skeletons reveal after 200 ms and
 * announce once.
 */
export function AuditSkeleton(): ReactNode {
  return (
    <div className="app-Page app-Audit">
      <div className="app-AuditSkeleton__head" aria-hidden="true">
        <Skeleton width="min(10rem, 50%)" height="var(--itsm-text-title1-size)" radius="md" />
        <Skeleton width="7.5rem" height="var(--itsm-control-height-md)" radius="lg" />
      </div>
      <div className="app-AuditSkeleton__line" aria-hidden="true">
        <Skeleton width="min(22rem, 80%)" height={12} />
      </div>
      <div className="app-AuditSkeleton__chips" aria-hidden="true">
        <Skeleton width="5.5rem" height="var(--itsm-control-height-sm)" radius="pill" />
        <Skeleton width="5.5rem" height="var(--itsm-control-height-sm)" radius="pill" />
        <Skeleton width="5rem" height="var(--itsm-control-height-sm)" radius="pill" />
      </div>
      <SkeletonTable rows={10} columns={4} label="Loading the audit log…" />
    </div>
  );
}
