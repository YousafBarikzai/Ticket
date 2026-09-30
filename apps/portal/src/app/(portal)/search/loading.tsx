import type { ReactNode } from 'react';
import { Skeleton, SkeletonList } from '@itsm/ui';
import './search.css';

/**
 * `/search` while the three searches run: the results page's shape — the
 * heading, the field, then a section of rows — so nothing moves when they
 * arrive (SPEC §4.10). Shimmer after 200 ms; "Loading results…" after 1 s.
 */
export default function SearchLoading(): ReactNode {
  return (
    <div className="app-Page app-Results">
      <div className="app-Results__header" aria-hidden="true">
        <Skeleton width="20rem" height="var(--itsm-text-title1-line)" radius="md" />
        <Skeleton height="var(--itsm-control-height-lg)" radius="lg" />
      </div>
      <section className="app-Results__section">
        <Skeleton width="8rem" height="var(--itsm-text-title3-line)" radius="md" />
        <SkeletonList rows={4} label="Loading results" className="app-Results__list" />
      </section>
    </div>
  );
}
