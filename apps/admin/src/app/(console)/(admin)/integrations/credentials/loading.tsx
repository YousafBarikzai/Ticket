import type { ReactNode } from 'react';
import { Skeleton, SkeletonStat, SkeletonTable } from '@itsm/ui';

/**
 * Integrations › Credentials while it loads: the register template (A7 §2.6 T2) — the toolbar,
 * 4 KPI tiles, the filter pills and the table's rows, at their final
 * heights and revealed only after 200 ms. The status is the table's, spoken
 * once after a second.
 */
export default function Loading(): ReactNode {
  return (
    <div className="itsm-SkeletonPage" data-variant="register">
      <div className="itsm-SkeletonPage__toolbar" aria-hidden="true">
        <Skeleton width="min(18rem, 100%)" height="var(--itsm-control-height-md)" radius="lg" />
        <Skeleton className="itsm-SkeletonPage__toolbarEnd" width="7.5rem" height="var(--itsm-control-height-md)" radius="lg" />
      </div>
      <div className="itsm-SkeletonPage__stats" aria-hidden="true">
        {Array.from({ length: 4 }, (_, index) => (
          <SkeletonStat key={index} />
        ))}
      </div>
      <div className="itsm-SkeletonPage__toolbar" aria-hidden="true">
        <Skeleton width="6rem" height="var(--itsm-control-height-sm)" radius="pill" />
        <Skeleton width="7rem" height="var(--itsm-control-height-sm)" radius="pill" />
        <Skeleton width="5.5rem" height="var(--itsm-control-height-sm)" radius="pill" />
      </div>
      <div className="itsm-SkeletonPage__panel">
        <SkeletonTable rows={8} columns={5} label="Loading credentials…" />
      </div>
    </div>
  );
}
