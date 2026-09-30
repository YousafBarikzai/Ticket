import type { ReactNode } from 'react';
import { Skeleton, SkeletonCard } from '@itsm/ui';
import './catalogue.css';

/**
 * Services while the catalogue is read (SPEC §4.10): the page's own shape —
 * the heading and its line, the search, the chips, then a service's cards —
 * so nothing moves when it arrives. Revealed after 200 ms; "Loading
 * services…" for a screen reader after a second.
 */
export default function CatalogueLoading(): ReactNode {
  return (
    <div className="app-Page app-Catalogue" aria-busy="true">
      <div className="app-Services__header" aria-hidden="true">
        <Skeleton width="9rem" height="var(--itsm-text-largeTitle-line)" radius="md" />
        <Skeleton width="20rem" height="var(--itsm-text-title3-line)" radius="md" />
      </div>
      <div className="app-Services" aria-hidden="true">
        <Skeleton height="var(--itsm-control-height-lg)" radius="lg" />
        <div className="app-Services__chipList">
          <Skeleton width="7rem" height="var(--itsm-control-height-sm)" radius="pill" />
          <Skeleton width="9rem" height="var(--itsm-control-height-sm)" radius="pill" />
          <Skeleton width="6rem" height="var(--itsm-control-height-sm)" radius="pill" />
        </div>
        <Skeleton width="12rem" height="var(--itsm-text-title2-line)" radius="md" />
      </div>
      <div className="app-Services__grid">
        <SkeletonCard label="Loading services…" />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    </div>
  );
}
