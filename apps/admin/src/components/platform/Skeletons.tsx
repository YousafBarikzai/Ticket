import type { ReactNode } from 'react';
import { Skeleton, SkeletonCard, SkeletonTable } from '@itsm/ui';

/**
 * The platform pages while they load: the tinted header with its Operator
 * pill, then the tenants table or the plan cards. Server-safe; rendered below
 * the `(platform)` layout's gate, never above it.
 */
export function PlatformSkeleton({ kind }: { readonly kind: 'tenants' | 'plans' }): ReactNode {
  return (
    <div className="app-Page app-Platform">
      <div className="app-PlatformHeader app-PlatformSkeleton__head" aria-hidden="true">
        <Skeleton width="min(9rem, 50%)" height="var(--itsm-text-title1-size)" radius="md" />
        <Skeleton width="5rem" height={20} radius="pill" />
      </div>
      {kind === 'tenants' ? (
        <SkeletonTable rows={8} columns={5} label="Loading tenants…" />
      ) : (
        <div className="app-Plans">
          <SkeletonCard lines={6} label="Loading plans…" />
          <SkeletonCard lines={6} />
          <SkeletonCard lines={6} />
          <SkeletonCard lines={6} />
        </div>
      )}
    </div>
  );
}
