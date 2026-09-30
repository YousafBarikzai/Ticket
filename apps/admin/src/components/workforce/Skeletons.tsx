import type { ReactNode } from 'react';
import { Skeleton, SkeletonCard, SkeletonTable } from '@itsm/ui';

/**
 * The Workforce routes while they load: the header with its tabs, then the
 * Now summary and table, the rota cards, or a table (shifts, skills).
 * Server-safe; the design system's skeletons reveal after 200 ms and
 * announce once.
 */

function Header({ action }: { readonly action: boolean }): ReactNode {
  return (
    <div className="app-WorkforceSkeleton__head" aria-hidden="true">
      <div className="app-WorkforceSkeleton__title">
        <Skeleton width="min(12rem, 55%)" height="var(--itsm-text-title1-size)" radius="md" />
        {action ? <Skeleton width="10rem" height="var(--itsm-control-height-md)" radius="lg" /> : null}
      </div>
      <div className="app-WorkforceSkeleton__tabs">
        <Skeleton width="3rem" height={14} />
        <Skeleton width="4rem" height={14} />
        <Skeleton width="3.5rem" height={14} />
        <Skeleton width="3rem" height={14} />
      </div>
    </div>
  );
}

export function NowSkeleton(): ReactNode {
  return (
    <div className="app-Page app-Workforce">
      <Header action />
      <div aria-hidden="true">
        <Skeleton className="app-WorkforceSkeleton__summary" height="4rem" radius="xl" />
      </div>
      <SkeletonTable rows={8} columns={5} label="Loading availability…" />
    </div>
  );
}

export function RotasSkeleton(): ReactNode {
  return (
    <div className="app-Page app-Workforce">
      <Header action={false} />
      <div className="app-WorkforceSkeleton__cards">
        <SkeletonCard lines={6} label="Loading on-call rotas…" />
        <SkeletonCard lines={6} />
      </div>
    </div>
  );
}

export function WorkforceTableSkeleton({ label, columns }: { readonly label: string; readonly columns: number }): ReactNode {
  return (
    <div className="app-Page app-Workforce">
      <Header action={false} />
      <SkeletonTable rows={6} columns={columns} label={label} />
    </div>
  );
}
