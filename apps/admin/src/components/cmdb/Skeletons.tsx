import type { ReactNode } from 'react';
import { Skeleton, SkeletonList, SkeletonTable } from '@itsm/ui';

/**
 * Configuration items and Assets while they load (SPEC §6.1 "Admin loading
 * skeletons"), each shaped like its page: the header with its one button,
 * then the class list beside the table, or the toolbar over the register.
 * Server-safe; revealed after 200 ms and announced once, after a second, by
 * the design system's skeletons.
 */

function Header(): ReactNode {
  return (
    <div className="app-CmdbSkeleton__head" aria-hidden="true">
      <Skeleton width="min(18rem, 60%)" height="var(--itsm-text-title1-size)" radius="md" />
      <Skeleton width="8rem" height="var(--itsm-control-height-md)" radius="lg" />
    </div>
  );
}

function Toolbar(): ReactNode {
  return (
    <div className="app-CmdbSkeleton__toolbar" aria-hidden="true">
      <Skeleton width="min(18rem, 100%)" height="var(--itsm-control-height-md)" radius="lg" />
      <Skeleton width="min(20rem, 100%)" height="var(--itsm-control-height-md)" radius="lg" />
    </div>
  );
}

export function CisSkeleton(): ReactNode {
  return (
    <div className="app-Page app-Cmdb">
      <Header />
      <div className="app-Cmdb__panes">
        <div className="app-Cmdb__nav" aria-hidden="true">
          <SkeletonList rows={6} />
        </div>
        <div className="app-Cmdb__main">
          <Toolbar />
          <SkeletonTable rows={8} columns={6} label="Loading configuration items…" />
        </div>
      </div>
    </div>
  );
}

export function AssetsSkeleton(): ReactNode {
  return (
    <div className="app-Page app-Assets">
      <Header />
      <Toolbar />
      <SkeletonTable rows={8} columns={6} label="Loading assets…" />
    </div>
  );
}
