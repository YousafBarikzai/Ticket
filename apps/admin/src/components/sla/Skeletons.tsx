import type { ReactNode } from 'react';
import { Skeleton, SkeletonCard } from '@itsm/ui';

/**
 * The service-level routes while they load (SPEC §6.1 "Admin loading
 * skeletons"): the header with its three tabs, then the policy or calendar
 * cards, or the matrix card. Server-safe; revealed after 200 ms and
 * announced once, after a second, by the design system's skeletons.
 */

function Header({ action }: { readonly action: boolean }): ReactNode {
  return (
    <div className="app-SlaSkeleton__head" aria-hidden="true">
      <div className="app-SlaSkeleton__title">
        <Skeleton width="min(14rem, 60%)" height="var(--itsm-text-title1-size)" radius="md" />
        {action ? <Skeleton width="7.5rem" height="var(--itsm-control-height-md)" radius="lg" /> : null}
      </div>
      <div className="app-SlaSkeleton__tabs">
        <Skeleton width="4.5rem" height={14} />
        <Skeleton width="5rem" height={14} />
        <Skeleton width="7rem" height={14} />
      </div>
    </div>
  );
}

export function SlaCardsSkeleton({ label, action = true }: { readonly label: string; readonly action?: boolean }): ReactNode {
  return (
    <div className="app-Page app-Sla">
      <Header action={action} />
      <div className="app-SlaSkeleton__cards">
        <SkeletonCard lines={5} label={label} />
        <SkeletonCard lines={5} />
        <SkeletonCard lines={5} />
      </div>
    </div>
  );
}

export function SlaMatrixSkeleton(): ReactNode {
  return (
    <div className="app-Page app-Sla">
      <Header action={false} />
      <SkeletonCard lines={8} label="Loading the priority matrix…" />
    </div>
  );
}
