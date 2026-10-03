import type { ReactNode } from 'react';
import { SkeletonPage } from '@itsm/ui';

/** SLA performance is a dashboard (A7 §2.6 T1): toolbar, hero, six tiles and two chart cards, at their final heights. */
export default function Loading(): ReactNode {
  return <SkeletonPage variant="dashboard" label="Loading SLA performance…" />;
}
