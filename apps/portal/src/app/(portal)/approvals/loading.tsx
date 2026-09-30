import type { ReactNode } from 'react';
import { Skeleton, SkeletonList } from '@itsm/ui';
import '../../../approvals/approvals.css';

/**
 * Approvals while the server reads them (SPEC §4.10): the page's own shape —
 * the heading, the two segments, then rows — inside the frame, revealed
 * after 200 ms so a quick load shows nothing, and "Loading your approvals…"
 * for a screen reader after a second.
 */
export default function ApprovalsLoading(): ReactNode {
  return (
    <div className="app-Page app-Approvals" aria-busy="true">
      <div className="app-Approvals__header" aria-hidden="true">
        <Skeleton width="9rem" height={34} radius="md" />
      </div>
      <div aria-hidden="true">
        <Skeleton width="15rem" height={36} radius="md" className="app-Approvals__scopes" />
      </div>
      <SkeletonList rows={4} label="Loading your approvals…" />
    </div>
  );
}
