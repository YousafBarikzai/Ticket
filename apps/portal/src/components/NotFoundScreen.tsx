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
 * The pages for one request, one service and one article **return** this
 * rather than calling `notFound()`. Their segments stream behind a
 * `loading.tsx` skeleton, so by the time the read says 404 the response has
 * begun: `notFound()` there cannot change the status any more, and in a
 * production build it also surfaced as an uncaught React error #419 in the
 * browser ("could not finish this Suspense boundary") on every missing link.
 * Returning the same screen, with `NOT_FOUND_METADATA`, shows exactly what
 * the boundary showed without the error. (The status stays 200 either way;
 * a real 404 would need those routes to drop their skeletons — see the
 * portal integration report.)
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

/** The `<title>` and robots rule of a page that is showing `NotFoundScreen`. */
export const NOT_FOUND_METADATA: Metadata = { title: 'Not found', robots: { index: false } };
