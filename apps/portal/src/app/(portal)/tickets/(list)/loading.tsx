import type { ReactNode } from 'react';
import { Skeleton, SkeletonList } from '@itsm/ui';
import '../../../../requests/requests.css';

/**
 * My requests while the server reads them (SPEC §4.10): the page's own
 * shape — the heading and New request, the scope and the search, then rows
 * — inside the frame, revealed after 200 ms so a quick load shows nothing,
 * and "Loading your requests…" for a screen reader after a second.
 *
 * In the `(list)` group so that it wraps the list and nothing else: as a
 * sibling of `[id]` it would also be the Suspense boundary above a request's
 * page, and a request that does not exist could no longer answer 404
 * (SPEC §5.5, A4 §5.4).
 */
export default function MyRequestsLoading(): ReactNode {
  return (
    <div className="app-Page app-Requests" aria-busy="true">
      <div className="app-Requests__header" aria-hidden="true">
        <Skeleton width="11rem" height={34} radius="md" />
        <Skeleton width="9rem" height={36} radius="pill" />
      </div>
      <div className="app-Requests__controls" aria-hidden="true">
        <Skeleton width="100%" height={36} radius="md" className="app-Requests__scopes" />
        <Skeleton width="100%" height={36} radius="md" className="app-Requests__search" />
      </div>
      <SkeletonList rows={6} label="Loading your requests…" />
    </div>
  );
}
