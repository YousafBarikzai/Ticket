import type { ReactNode } from 'react';
import { Skeleton, SkeletonCard, SkeletonTable } from '@itsm/ui';

/**
 * The rules routes while they load (SPEC §6.1 "Admin loading skeletons"):
 * the list's header, toolbar and grouped rows; the builder's canvas cards
 * with the *Try it* panel beside them. Server-safe; the design system's
 * skeletons reveal after 200 ms and announce once, after a second.
 */

function Header({ tabs = 0, action = true }: { readonly tabs?: number; readonly action?: boolean }): ReactNode {
  return (
    <div className="app-RulesSkeleton__head" aria-hidden="true">
      <div className="app-RulesSkeleton__title">
        <Skeleton width="min(14rem, 60%)" height="var(--itsm-text-title1-size)" radius="md" />
        {action ? <Skeleton width="7.5rem" height="var(--itsm-control-height-md)" radius="lg" /> : null}
      </div>
      {tabs > 0 ? (
        <div className="app-RulesSkeleton__tabs">
          {Array.from({ length: tabs }, (_, index) => (
            <Skeleton key={index} width={index === 0 ? '5rem' : '4rem'} height={14} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function RulesListSkeleton(): ReactNode {
  return (
    <div className="app-Page app-Rules">
      <Header />
      <div className="app-RulesSkeleton__toolbar" aria-hidden="true">
        <Skeleton width="min(18rem, 100%)" height="var(--itsm-control-height-md)" radius="lg" />
        <Skeleton width="16rem" height="var(--itsm-control-height-md)" radius="lg" />
      </div>
      <SkeletonTable rows={8} columns={5} label="Loading rules…" />
    </div>
  );
}

export function RuleBuilderSkeleton({ label }: { readonly label: string }): ReactNode {
  return (
    <div className="app-Page app-RuleBuilder">
      <div className="app-RulesSkeleton__head" aria-hidden="true">
        <Skeleton width="6rem" height={12} />
        <div className="app-RulesSkeleton__title">
          <Skeleton width="min(20rem, 70%)" height="var(--itsm-text-title1-size)" radius="md" />
          <Skeleton width="8rem" height="var(--itsm-control-height-md)" radius="lg" />
        </div>
      </div>
      <div className="app-RuleBuilder__grid" data-panel="">
        <div className="app-RuleBuilder__canvas">
          <SkeletonCard lines={3} label={label} />
          <SkeletonCard lines={3} />
          <SkeletonCard lines={4} />
          <SkeletonCard lines={2} />
        </div>
        <div className="app-RuleBuilder__panel">
          <SkeletonCard lines={5} />
        </div>
      </div>
    </div>
  );
}
