import type { ReactNode } from 'react';
import { SkeletonPage } from '@itsm/ui';

/**
 * People › Teams while it loads: the dashboard template (A7 §2.6 T1) —
 * the toolbar, the hero at 168 px, six KPI tiles and two chart cards at
 * their final heights, revealed only after 200 ms.
 */
export default function Loading(): ReactNode {
  return <SkeletonPage variant="dashboard" label="Loading teams…" />;
}
