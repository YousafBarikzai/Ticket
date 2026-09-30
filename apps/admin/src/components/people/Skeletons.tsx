import type { ReactNode } from 'react';
import { Skeleton, SkeletonList, SkeletonTable } from '@itsm/ui';

/**
 * The People tabs while they load: the header with its tabs (and the
 * primary action's place), the toolbar, then a table or a list shaped like
 * the tab's. Server-safe; the design system's skeletons reveal after 200 ms
 * and announce once.
 */

function Header({ action = true }: { readonly action?: boolean }): ReactNode {
  return (
    <div className="app-PeopleSkeleton__head" aria-hidden="true">
      <div className="app-PeopleSkeleton__title">
        <Skeleton width="min(8rem, 45%)" height="var(--itsm-text-title1-size)" radius="md" />
        {action ? <Skeleton width="8rem" height="var(--itsm-control-height-md)" radius="lg" /> : null}
      </div>
      <div className="app-PeopleSkeleton__tabs">
        <Skeleton width="3.5rem" height={14} />
        <Skeleton width="3.5rem" height={14} />
        <Skeleton width="6.5rem" height={14} />
      </div>
    </div>
  );
}

function Toolbar({ chips }: { readonly chips: number }): ReactNode {
  return (
    <div className="app-PeopleSkeleton__toolbar" aria-hidden="true">
      <Skeleton width="min(18rem, 100%)" height="var(--itsm-control-height-sm)" radius="lg" />
      {Array.from({ length: chips }, (_, index) => (
        <Skeleton key={index} width="5.5rem" height="var(--itsm-control-height-sm)" radius="pill" />
      ))}
    </div>
  );
}

export function PeopleSkeleton(): ReactNode {
  return (
    <div className="app-Page app-People">
      <Header />
      <Toolbar chips={2} />
      <SkeletonTable rows={10} columns={4} label="Loading people…" />
    </div>
  );
}

export function TeamsSkeleton(): ReactNode {
  return (
    <div className="app-Page app-People">
      <Header />
      <Toolbar chips={1} />
      <SkeletonTable rows={6} columns={4} label="Loading teams…" />
    </div>
  );
}

export function OrganisationsSkeleton(): ReactNode {
  return (
    <div className="app-Page app-People">
      <Header />
      <SkeletonList rows={5} label="Loading organisations…" />
    </div>
  );
}
