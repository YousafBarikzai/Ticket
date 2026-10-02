import type { ReactNode } from 'react';
import { SkeletonPage } from '@itsm/ui';

/**
 * Home while its server render is under way (SPEC §4.10), inside the frame
 * that is already on screen: a heading and a few rows in the reading column.
 * Revealed only after 200 ms, so a quick navigation shows nothing at all;
 * "Loading…" for a screen reader after a second. Home's sections then
 * stream on their own, each with a skeleton of its own shape.
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
    <div className="app-Page">
      <SkeletonPage variant="settings" />
    </div>
  );
}
