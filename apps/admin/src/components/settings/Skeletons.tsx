import type { ReactNode } from 'react';
import { Skeleton, SkeletonCard, SkeletonStat } from '@itsm/ui';

/**
 * Settings while it loads (SPEC §6.1 "Admin loading skeletons": section cards
 * with row ghosts): the header and its tabs, the search, then sections shaped
 * like the tab's own. Server-safe; the design system's skeletons reveal after
 * 200 ms and announce once, after a second.
 */

function Header(): ReactNode {
  return (
    <div className="app-SettingsSkeleton__head" aria-hidden="true">
      <Skeleton width="min(9rem, 50%)" height="var(--itsm-text-title1-size)" radius="md" />
      <div className="app-SettingsSkeleton__tabs">
        <Skeleton width="4rem" height={14} />
        <Skeleton width="4.5rem" height={14} />
        <Skeleton width="2rem" height={14} />
        <Skeleton width="4rem" height={14} />
        <Skeleton width="6rem" height={14} />
      </div>
    </div>
  );
}

function Search(): ReactNode {
  return (
    <div className="app-SettingsSkeleton__search" aria-hidden="true">
      <Skeleton width="min(32rem, 100%)" height="var(--itsm-control-height-md)" radius="lg" />
      <Skeleton width="11rem" height="var(--itsm-control-height-sm)" radius="lg" />
    </div>
  );
}

export function SettingsSkeleton({ label = 'Loading settings…', sections = [4, 3, 2] }: { readonly label?: string; readonly sections?: readonly number[] }): ReactNode {
  return (
    <div className="app-Page app-Settings">
      <Header />
      <Search />
      {sections.map((lines, index) => (
        <SkeletonCard key={index} lines={lines} {...(index === 0 ? { label } : {})} />
      ))}
    </div>
  );
}

export function UsageSkeleton(): ReactNode {
  return (
    <div className="app-Page app-Settings">
      <Header />
      <SkeletonCard lines={2} label="Loading usage…" />
      <div className="app-UsageGrid" aria-hidden="true">
        <SkeletonStat />
        <SkeletonStat />
        <SkeletonStat />
        <SkeletonStat />
      </div>
    </div>
  );
}

export function ModulesSkeleton(): ReactNode {
  return (
    <div className="app-Page app-Settings">
      <Header />
      <SkeletonCard lines={8} label="Loading modules…" />
      <SkeletonCard lines={4} />
    </div>
  );
}
