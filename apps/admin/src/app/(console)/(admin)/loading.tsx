import type { ReactNode } from 'react';
import { SkeletonPage } from '@itsm/ui';

/**
 * The Command centre while it loads: the dashboard template (A7 §2.6 T1) —
 * the toolbar, the hero at 168 px, six KPI tiles and two chart cards at
 * their final heights, revealed only after 200 ms.
 *
 * It lives in `(admin)`, not in `(console)`: a loading boundary above the
 * platform layout would stream a 200 before that layout's `notFound()` could
 * answer 404 (Y-1.3.3). Every other tenant page has a `loading.tsx` of its
 * own, shaped like its template.
 */
export default function Loading(): ReactNode {
  return <SkeletonPage variant="dashboard" label="Loading the Command centre…" />;
}
