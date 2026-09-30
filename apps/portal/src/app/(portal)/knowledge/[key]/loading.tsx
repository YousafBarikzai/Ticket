import type { ReactNode } from 'react';
import { Skeleton, SkeletonCard, SkeletonText } from '@itsm/ui';
import '../knowledge.css';

/**
 * An article while it is read (SPEC §4.10): the breadcrumb, the title and
 * its line, paragraphs at the reading width, then the card at the end —
 * the page's own shape. Revealed after 200 ms.
 */
export default function ArticleLoading(): ReactNode {
  return (
    <div className="app-Page app-Page--reading app-Article" aria-busy="true">
      <span className="app-Article__crumbs" aria-hidden="true">
        <Skeleton width="9rem" height="var(--itsm-text-footnote-line)" radius="md" />
      </span>
      <div className="app-Article__header" aria-hidden="true">
        <Skeleton width="80%" height="var(--itsm-text-title1-line)" radius="md" />
        <Skeleton width="60%" height="var(--itsm-text-title3-line)" radius="md" />
        <Skeleton width="10rem" height="var(--itsm-text-footnote-line)" radius="md" />
      </div>
      <div className="app-Article__body" aria-hidden="true">
        <SkeletonText lines={4} />
        <SkeletonText lines={5} />
        <SkeletonText lines={3} />
      </div>
      {/* The end-of-article card; it carries the one "Loading the article…" a screen reader hears, after a second. */}
      <SkeletonCard lines={1} label="Loading the article…" />
    </div>
  );
}
