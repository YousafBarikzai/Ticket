/**
 * What the page and the service worker say to each other.
 *
 * A module of its own, with nothing in it but names, because both halves
 * import it and the worker is bundled separately: anything else in here would
 * be bundled into `sw.js` as well, and a worker that pulled in React through a
 * shared helper would be a very large file doing a very small job.
 */

/** Page → worker: take over now. Sent only when the person chose to reload. */
export const SKIP_WAITING = 'SKIP_WAITING';

/** Page → worker: drain the outbox now — after a sign-in, or on `online`. */
export const DRAIN_OUTBOX = 'itsm-drain-outbox';

/** Worker → page: a drain finished, so a list of the queue is out of date. */
export const OUTBOX_DRAINED = 'itsm-outbox-drained';
