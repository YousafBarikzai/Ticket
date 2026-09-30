import type { ReactNode } from 'react';
import { SkeletonPage } from '@itsm/ui';

/**
 * The inbox while its first page loads: the list pane's rows beside the
 * ticket's shape, inside the frame (SPEC §4.10). Revealed after 200 ms, so a
 * quick load shows no skeleton at all.
 */
export default function InboxLoading(): ReactNode {
  return <SkeletonPage variant="inbox" label="Loading tickets…" />;
}
