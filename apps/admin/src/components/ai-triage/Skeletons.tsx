import type { ReactNode } from 'react';
import { Skeleton, SkeletonCard, SkeletonStat, SkeletonTable } from '@itsm/ui';

/**
 * The AI triage tabs while they load: the header with its tabs, then the
 * mode card and three stats (Overview), two chart cards (Quality), or the
 * decisions table (Decisions). Server-safe; the design system's skeletons
 * reveal after 200 ms and announce once.
 */

function Header({ range }: { readonly range: boolean }): ReactNode {
  return (
    <div className="app-TriageSkeleton__head" aria-hidden="true">
      <Skeleton width="min(9rem, 50%)" height="var(--itsm-text-title1-size)" radius="md" />
      <div className="app-TriageSkeleton__tabs">
        <Skeleton width="4.5rem" height={14} />
        <Skeleton width="3.5rem" height={14} />
        <Skeleton width="4.5rem" height={14} />
      </div>
      {range ? (
        <div className="app-TriageRange">
          <Skeleton width="14rem" height="var(--itsm-control-height-sm)" radius="lg" />
        </div>
      ) : null}
    </div>
  );
}

export function OverviewSkeleton(): ReactNode {
  return (
    <div className="app-Page app-Triage">
      <Header range={false} />
      <SkeletonCard lines={5} label="Loading AI triage…" />
      <div className="app-TriageSkeleton__stats" aria-hidden="true">
        <SkeletonStat />
        <SkeletonStat />
        <SkeletonStat />
      </div>
    </div>
  );
}

export function QualitySkeleton(): ReactNode {
  return (
    <div className="app-Page app-Triage">
      <Header range />
      <SkeletonCard lines={5} label="Loading quality…" />
      <SkeletonCard lines={6} />
    </div>
  );
}

export function DecisionsSkeleton(): ReactNode {
  return (
    <div className="app-Page app-Triage">
      <Header range />
      <SkeletonTable rows={8} columns={6} label="Loading decisions…" />
    </div>
  );
}
