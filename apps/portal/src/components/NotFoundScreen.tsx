import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { StatusScreen } from '@itsm/ui';

/**
 * Not found, inside the frame (SPEC §4.10, §6.3): a request that does not
 * exist or is not this person's, an article they may not read, a service
 * they are not entitled to — the API answers all of them the same way,
 * deliberately, and so does this. The top bar stays, so search is one press
 * away as well as the way home.
 *
 * `StatusScreen` rather than `ProblemState`: it is server-safe, so the screen
 * costs no JavaScript at all — the not-found boundary is part of every
 * portal route's first load, whether or not it is ever shown (SPEC §3.7).
 *
 * The pages for one request, one service and one article reach it by calling
 * `notFound()`, and they call it **before streaming** (SPEC §5.5, A4 §5.4):
 * the existence read is the first thing each page waits for, and no
 * `loading.tsx` or `<Suspense>` boundary sits above it — the list and Home
 * skeletons live in the `(list)` and `(home)` route groups, beside the pages
 * they stand in for, and the detail pages' own skeletons are explicit
 * boundaries *below* the read. Nothing has been sent when the read says 404,
 * so the response is a real 404 with this screen in the frame. (Inside an
 * already-streaming boundary the status would stay 200, and in a production
 * build the throw surfaced as React error #419 in the browser; that is why
 * the order matters, and why a new detail route must keep it.)
 */
export function NotFoundScreen(): ReactNode {
  return (
    <div className="app-Page app-Page--state">
      <StatusScreen
        as="div"
        illustration="search"
        title="We couldn’t find that"
        body="It may have moved, the link may be out of date, or it isn’t yours to see. Search from the bar above, or start again from Home."
        actions={[{ id: 'home', label: 'Go to Home', href: '/', variant: 'primary' }]}
      />
    </div>
  );
}

/**
 * The `<title>` and robots rule for a page that turns out not to exist:
 * `generateMetadata` answers with this rather than calling `notFound()`, so
 * it never throws (metadata may stream separately from the page).
 */
export const NOT_FOUND_METADATA: Metadata = { title: 'Not found', robots: { index: false } };
