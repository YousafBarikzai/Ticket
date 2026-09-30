import type { ReactNode } from 'react';
import { Skeleton, SkeletonConversation, SkeletonText } from '@itsm/ui';
import '../../../../requests/requests.css';

/**
 * A request while the server reads it (SPEC §4.10), in the page's shape: the
 * way back, the reference line and title, the one card with its four steps,
 * then the conversation. Revealed after 200 ms; "Loading the request…" for
 * a screen reader after a second.
 */
export default function RequestLoading(): ReactNode {
  return (
    <div className="app-Page app-Page--reading app-Request" aria-busy="true">
      <div className="app-Request__header" aria-hidden="true">
        <Skeleton width="7rem" height={28} radius="pill" />
        <Skeleton width="14rem" height={16} />
        <Skeleton width="80%" height={34} radius="md" />
      </div>
      <div className="app-RequestHero app-RequestHero--loading" aria-hidden="true">
        <div className="app-RequestHero__head">
          <Skeleton width={40} height={40} radius="full" />
          <div className="app-RequestHero__text">
            <Skeleton width="40%" height={22} radius="md" />
            <SkeletonText lines={2} size="callout" />
          </div>
        </div>
        <Skeleton width="10rem" height={36} radius="md" />
        <Skeleton width="100%" height={40} radius="md" />
      </div>
      <SkeletonConversation messages={3} label="Loading the request…" />
    </div>
  );
}
