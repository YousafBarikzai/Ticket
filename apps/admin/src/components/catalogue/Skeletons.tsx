import type { ReactNode } from 'react';
import { Skeleton, SkeletonCard, SkeletonList, SkeletonTable } from '@itsm/ui';

/**
 * Services & requests while it loads (SPEC §6.1 "Admin loading skeletons"),
 * each shaped like the page it stands in for: the services list beside the
 * request types table; the forms table; the form editor's question cards
 * beside its inspector. Server-safe; revealed after 200 ms and announced
 * once, after a second, by the design system's skeletons.
 */

function Header({ tabs = 2, action = true }: { readonly tabs?: number; readonly action?: boolean }): ReactNode {
  return (
    <div className="app-CatalogueSkeleton__head" aria-hidden="true">
      <div className="app-CatalogueSkeleton__title">
        <Skeleton width="min(16rem, 60%)" height="var(--itsm-text-title1-size)" radius="md" />
        {action ? <Skeleton width="10rem" height="var(--itsm-control-height-md)" radius="lg" /> : null}
      </div>
      {tabs > 0 ? (
        <div className="app-CatalogueSkeleton__tabs">
          {Array.from({ length: tabs }, (_, index) => (
            <Skeleton key={index} width={index === 0 ? '6.5rem' : '3.5rem'} height={14} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function RequestTypesSkeleton(): ReactNode {
  return (
    <div className="app-Page app-Catalogue">
      <Header />
      <div className="app-Catalogue__panes">
        <div className="app-Catalogue__nav" aria-hidden="true">
          <SkeletonList rows={5} />
        </div>
        <div className="app-Catalogue__main">
          <SkeletonTable rows={6} columns={5} label="Loading request types…" />
        </div>
      </div>
    </div>
  );
}

export function FormsSkeleton(): ReactNode {
  return (
    <div className="app-Page app-Catalogue">
      <Header />
      <SkeletonTable rows={6} columns={4} label="Loading forms…" />
    </div>
  );
}

export function FormEditorSkeleton(): ReactNode {
  return (
    <div className="app-Page app-FormEditor">
      <Header tabs={0} />
      <div className="app-FormEditor__skeleton">
        <div className="app-FormEditor__skeletonList">
          <SkeletonCard lines={2} label="Loading the form…" />
          <SkeletonCard lines={2} />
          <SkeletonCard lines={2} />
          <SkeletonCard lines={2} />
        </div>
        <SkeletonCard lines={7} />
      </div>
    </div>
  );
}
