import type { ReactNode } from 'react';
import { SkeletonPage } from '@itsm/ui';

/**
 * The generic placeholder while a portal page's server render is under way
 * (SPEC §4.10), inside the frame that is already on screen: a heading and a
 * few rows in the reading column. Revealed only after 200 ms, so a quick
 * navigation shows nothing at all; "Loading…" for a screen reader after a
 * second. Pages whose shape differs stream their own sections, each with its
 * own skeleton.
 */
export default function PortalLoading(): ReactNode {
  return (
    <div className="app-Page">
      <SkeletonPage variant="settings" />
    </div>
  );
}
