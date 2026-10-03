import type { ReactNode } from 'react';
import { Skeleton, SkeletonCard } from '@itsm/ui';
import { QuickActionsSkeleton } from '../../../home/QuickActions.js';
import '../../../home/home.css';

/**
 * Home while its server render is under way (SPEC §4.10, A6 §6.1.5), inside
 * the frame that is already on screen, in Home's own shape: the hero's
 * lines, its search and four quick-action ghosts, then three card-shaped
 * ghosts where the requests will be. The bones reveal only after 200 ms, so
 * a quick navigation shows nothing at all; "Loading Home…" for a screen
 * reader after a second. Home's sections then stream on their own, each with
 * a skeleton of its own shape.
 *
 * It sits in the `(home)` group, beside the page it stands in for, rather
 * than at the top of `(portal)` (SPEC §5.5, A4 §5.4). A `loading.tsx` is a
 * Suspense boundary around every page below it, and once a boundary has
 * streamed its fallback the status line has gone out as 200: a request,
 * service or article that turns out not to exist could then only *look*
 * missing. Here it is the ancestor of Home and nothing else.
 */
export default function HomeLoading(): ReactNode {
  return (
    <div className="app-Page app-Home app-Home--loading">
      <div className="app-Home__hero" aria-hidden="true">
        <Skeleton width="14rem" height={14} />
        <Skeleton width="min(24rem, 80%)" height={40} radius="md" />
        <Skeleton width="min(30rem, 90%)" height={16} />
        <Skeleton height="3.5rem" radius="lg" className="app-Home__askGhost" />
        <QuickActionsSkeleton />
      </div>
      <div className="app-Home__grid">
        <div className="app-Home__main app-RequestCards">
          <SkeletonCard lines={2} label="Loading Home…" />
          <SkeletonCard lines={2} />
          <SkeletonCard lines={2} />
        </div>
      </div>
    </div>
  );
}
