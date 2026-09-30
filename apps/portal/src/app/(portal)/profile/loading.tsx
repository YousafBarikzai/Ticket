import type { ReactNode } from 'react';
import { Skeleton, SkeletonAvatar, SkeletonCard, SkeletonText } from '@itsm/ui';
import '../../../profile/profile.css';

/**
 * Profile while the server reads it (SPEC §4.10): the page's own shape — the
 * heading, the section list beside the sections on a wide screen, the
 * account card with its avatar, then grouped settings — revealed after
 * 200 ms so a quick load shows nothing.
 */
export default function ProfileLoading(): ReactNode {
  return (
    <div className="app-Page app-Profile" aria-busy="true">
      <div className="app-Profile__header" aria-hidden="true">
        <Skeleton width="7rem" height={34} radius="md" />
      </div>
      <div className="app-Profile__layout">
        <div className="app-Profile__nav" aria-hidden="true">
          <SkeletonText lines={5} />
        </div>
        <div className="app-Profile__sections">
          <div className="app-Profile__section" aria-hidden="true">
            <Skeleton width="6rem" height={20} radius="sm" />
            <div className="app-Profile__group">
              <div className="app-Profile__row app-Profile__identity">
                <SkeletonAvatar size="xl" />
                <SkeletonText lines={2} lastLineWidth="40%" />
              </div>
              <div className="app-Profile__row">
                <SkeletonText lines={3} />
              </div>
            </div>
          </div>
          <div className="app-Profile__section">
            <Skeleton width="8rem" height={20} radius="sm" />
            <SkeletonCard lines={4} label="Loading your profile…" />
          </div>
        </div>
      </div>
    </div>
  );
}
