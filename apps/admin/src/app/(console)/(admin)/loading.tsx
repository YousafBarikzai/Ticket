import type { ReactNode } from 'react';
import { SkeletonPage } from '@itsm/ui';

/**
 * The generic page skeleton for every tenant page that has no shape of its own
 * yet: a header, a toolbar and eight rows, inside the frame (SPEC §6.1 "Admin
 * loading skeletons"). Revealed only after 200 ms, so a fast page never
 * flashes it, and "Loading…" is spoken only after a second.
 *
 * It lives in `(admin)`, not in `(console)`: a loading boundary above the
 * platform layout would stream a 200 before that layout's `notFound()` could
 * answer 404 (Y-1.3.3). Pages add their own `loading.tsx` where the shape
 * differs (the Command centre's cards, a builder's canvas).
 */
export default function Loading(): ReactNode {
  return <SkeletonPage variant="list" label="Loading the page…" />;
}
