import type { ReactNode } from 'react';
import { Skeleton, SkeletonCard, SkeletonTable } from '@itsm/ui';

/**
 * The Security tabs while they load: the header with its two tabs, then the
 * alerts' summary line and list, or the role matrix and the registry.
 * Server-safe; the design system's skeletons reveal after 200 ms.
 */

function Header(): ReactNode {
  return (
    <div className="app-SecuritySkeleton__head" aria-hidden="true">
      <Skeleton width="min(9rem, 50%)" height="var(--itsm-text-title1-size)" radius="md" />
      <div className="app-SecuritySkeleton__tabs">
        <Skeleton width="3.5rem" height={14} />
        <Skeleton width="3.5rem" height={14} />
      </div>
    </div>
  );
}

export function AlertsSkeleton(): ReactNode {
  return (
    <div className="app-Page app-Security">
      <Header />
      <div aria-hidden="true">
        <Skeleton width="min(20rem, 80%)" height={12} />
      </div>
      <SkeletonTable rows={6} columns={3} label="Loading security alerts…" />
    </div>
  );
}

export function AccessSkeleton(): ReactNode {
  return (
    <div className="app-Page app-Security">
      <Header />
      <SkeletonCard lines={6} />
      <SkeletonTable rows={8} columns={4} label="Loading roles and permissions…" />
    </div>
  );
}
