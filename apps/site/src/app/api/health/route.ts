/**
 * Liveness, and only liveness (docs/architecture/16 §4), as in the three
 * applications.
 *
 * Railway's health check and the post-deploy smoke test both call this. It
 * touches nothing — not the API, not the demo status — so an API outage
 * leaves the public site up and saying what it can, rather than taking the
 * one page a prospect opens down with it.
 */
export const dynamic = 'force-dynamic';

export function GET(): Response {
  return Response.json({ status: 'ok', app: 'site' });
}
