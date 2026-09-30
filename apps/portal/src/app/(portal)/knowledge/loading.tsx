import type { ReactNode } from 'react';
import { Skeleton, SkeletonList } from '@itsm/ui';
import './knowledge.css';

/**
 * Knowledge while the articles are read (SPEC §4.10): the heading, its line
 * and the search, the category chips, then rows — the page's own shape, so
 * nothing moves when it arrives. Revealed after 200 ms; "Loading
 * articles…" for a screen reader after a second.
 */
export default function KnowledgeLoading(): ReactNode {
  return (
    <div className="app-Page app-Knowledge" aria-busy="true">
      <div className="app-Knowledge__header" aria-hidden="true">
        <Skeleton width="10rem" height="var(--itsm-text-title1-line)" radius="md" />
        <Skeleton width="22rem" height="var(--itsm-text-body-line)" radius="md" />
        <Skeleton height="var(--itsm-control-height-lg)" radius="lg" className="app-Knowledge__search" />
      </div>
      <div className="app-Knowledge__chipList" aria-hidden="true">
        <Skeleton width="3.5rem" height="var(--itsm-control-height-sm)" radius="pill" />
        <Skeleton width="5rem" height="var(--itsm-control-height-sm)" radius="pill" />
        <Skeleton width="8rem" height="var(--itsm-control-height-sm)" radius="pill" />
        <Skeleton width="5rem" height="var(--itsm-control-height-sm)" radius="pill" />
      </div>
      <SkeletonList rows={6} label="Loading articles…" />
    </div>
  );
}
