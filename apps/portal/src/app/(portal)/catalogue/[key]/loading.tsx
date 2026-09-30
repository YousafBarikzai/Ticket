import type { ReactNode } from 'react';
import { Skeleton, SkeletonCard, SkeletonText } from '@itsm/ui';
import '../catalogue.css';

/**
 * A catalogue item while it is read (SPEC §4.10): "‹ Services", the name and
 * its line, then the form's card — the step, a few questions, the buttons —
 * beside the summary. The page's own shape, so nothing moves when it
 * arrives; revealed after 200 ms.
 */
export default function CatalogueItemLoading(): ReactNode {
  return (
    <div className="app-Page app-ServiceRequest" aria-busy="true">
      <div className="app-ServiceRequest__header" aria-hidden="true">
        <Skeleton width="6rem" height="var(--itsm-control-height-sm)" radius="md" />
        <Skeleton width="16rem" height="var(--itsm-text-title1-line)" radius="md" />
        <Skeleton width="80%" height="var(--itsm-text-body-line)" radius="md" />
      </div>
      <div className="app-ServiceRequest__layout">
        <div className="app-ServiceRequest__card app-ServiceRequest__card--loading" aria-hidden="true">
          <Skeleton width="100%" height="var(--itsm-space-2xs)" radius="pill" />
          <div className="app-ServiceRequest__main">
            <Skeleton width="12rem" height="var(--itsm-text-title3-line)" radius="md" />
            <Skeleton width="100%" height="var(--itsm-control-height-md)" radius="lg" />
            <Skeleton width="100%" height="var(--itsm-control-height-md)" radius="lg" />
            <SkeletonText lines={2} size="footnote" />
            <Skeleton width="8rem" height="var(--itsm-control-height-md)" radius="lg" className="app-ServiceRequest__draft" />
          </div>
        </div>
        <SkeletonCard lines={4} label="Loading the request form…" className="app-ServiceRequest__rail" />
      </div>
    </div>
  );
}
