import type { ReactNode } from 'react';
import { Skeleton, SkeletonCard, SkeletonTable } from '@itsm/ui';

/**
 * The workflow routes while they load (SPEC §6.1 "Admin loading
 * skeletons"): the header with its two tabs, then the list or the runs
 * table; a workflow's overview and check cards over its diagram. Server-safe.
 */

function Header({ tabs, back = false, action = false }: { readonly tabs: number; readonly back?: boolean; readonly action?: boolean }): ReactNode {
  return (
    <div className="app-WorkflowsSkeleton__head" aria-hidden="true">
      {back ? <Skeleton width="6rem" height={12} /> : null}
      <div className="app-WorkflowsSkeleton__title">
        <Skeleton width="min(16rem, 60%)" height="var(--itsm-text-title1-size)" radius="md" />
        {action ? <Skeleton width="7.5rem" height="var(--itsm-control-height-md)" radius="lg" /> : null}
      </div>
      {tabs > 0 ? (
        <div className="app-WorkflowsSkeleton__tabs">
          {Array.from({ length: tabs }, (_, index) => (
            <Skeleton key={index} width={index === 0 ? '5.5rem' : '3.5rem'} height={14} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function WorkflowsListSkeleton({ label, columns }: { readonly label: string; readonly columns: number }): ReactNode {
  return (
    <div className="app-Page app-Workflows">
      <Header tabs={2} />
      <div className="app-WorkflowsSkeleton__toolbar" aria-hidden="true">
        <Skeleton width="min(18rem, 100%)" height="var(--itsm-control-height-md)" radius="lg" />
        <Skeleton width="20rem" height="var(--itsm-control-height-md)" radius="lg" />
      </div>
      <SkeletonTable rows={8} columns={columns} label={label} />
    </div>
  );
}

export function WorkflowSkeleton(): ReactNode {
  return (
    <div className="app-Page app-Workflow">
      <Header tabs={0} back action />
      <div className="app-Workflow__overview">
        <SkeletonCard lines={3} label="Loading the workflow…" />
        <SkeletonCard lines={2} />
      </div>
      <div className="app-WorkflowsSkeleton__tabs" aria-hidden="true">
        <Skeleton width="4.5rem" height={14} />
        <Skeleton width="4rem" height={14} />
        <Skeleton width="3rem" height={14} />
      </div>
      <Skeleton height={320} radius="xl" />
    </div>
  );
}
