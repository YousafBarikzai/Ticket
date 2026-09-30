import type { ReactNode } from 'react';
import { Skeleton, SkeletonCard, SkeletonText } from '@itsm/ui';
import '../../../help/help.css';

/**
 * `/report` while the server reads the person and the status page: the page's
 * own shape — the heading, a line of lede, the card the flow sits in — so
 * nothing moves when it arrives (SPEC §4.10). The shimmer shows after 200 ms
 * and "Loading the report form…" is said only after a second.
 */
export default function ReportLoading(): ReactNode {
  return (
    <div className="app-Page app-Page--reading app-Report">
      <div className="app-Report__header" aria-hidden="true">
        <Skeleton width="16rem" height="var(--itsm-text-largeTitle-line)" radius="md" />
        <SkeletonText lines={1} lastLineWidth="80%" />
      </div>
      <SkeletonCard lines={3} label="Loading the report form" className="app-Report__card" />
    </div>
  );
}
