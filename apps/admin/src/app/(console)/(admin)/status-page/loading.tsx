import type { ReactNode } from 'react';
import { SkeletonPage } from '@itsm/ui';

/** The Status page console is a dashboard (A7 §2.6 T1): toolbar, the public verdict, tiles and cards at their final heights. */
export default function Loading(): ReactNode {
  return <SkeletonPage variant="dashboard" label="Loading the status page…" />;
}
