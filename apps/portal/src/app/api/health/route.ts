/**
 * Liveness, and only liveness (docs/architecture/16 §4).
 *
 * This route deliberately touches nothing — not Redis, not the API, not the
 * session store. A rolling deploy asks it whether this process is up so it can
 * stop sending traffic to the previous one. If the answer depended on a
 * dependency being healthy then a Redis blip would roll back a deployment that
 * was fine, and an API outage would take all three web applications down with
 * it rather than showing the error pages they already render.
 *
 * Readiness is the API's to answer, at `/health/ready`, because the API is
 * what owns the database and the queue. Two different questions, two routes,
 * and a deploy that confuses them fails in a way nobody can debug at 3am.
 */
export const dynamic = 'force-dynamic';

export function GET(): Response {
  return Response.json({ status: 'ok', app: 'portal' });
}
