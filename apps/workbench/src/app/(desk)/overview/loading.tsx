import type { ReactNode } from 'react';
import { SkeletonPage } from '@itsm/ui';

/**
 * The Overview while its first render is on its way (A6 §3.7): the
 * dashboard's own shape — a toolbar, the hero, six tiles and two cards —
 * inside the frame, revealed after 200 ms so a quick load shows none.
 */
export default function OverviewLoading(): ReactNode {
  return <SkeletonPage variant="dashboard" label="Loading the Overview…" />;
}
