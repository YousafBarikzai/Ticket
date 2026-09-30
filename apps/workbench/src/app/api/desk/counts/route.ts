import { ApiError } from '@itsm/sdk';
import { countViews, teamIdsFrom } from '../../../../inbox/counts.js';
import { apiFor, currentSession } from '../../../../server/session.js';

/**
 * `GET /api/desk/counts?teams=<id>,<id>` — the sidebar's view counts (SPEC
 * §5.3, D16).
 *
 * An aggregation handler rather than a proxy passthrough: one request from
 * the browser, several `GET /tickets/count` calls in parallel from here (or
 * three probes on an API without that route), answered as one small JSON
 * object. The team ids are filters only — the API scopes every count to what
 * the person may see — so they are taken from the query rather than costing
 * a `/me` on every refresh.
 *
 * A session that has ended is a 401 in problem JSON, never a redirect: the
 * caller is `fetch`, which would follow a redirect into the identity
 * provider's HTML and fail to parse it.
 */
export const dynamic = 'force-dynamic';

function sessionEnded(): Response {
  return Response.json(
    { type: 'about:blank', title: 'Your session ended', status: 401, detail: 'Sign in again to carry on.' },
    { status: 401, headers: { 'content-type': 'application/problem+json', 'cache-control': 'no-store' } },
  );
}

export async function GET(request: Request): Promise<Response> {
  const session = await currentSession();
  if (!session) return sessionEnded();
  const teams = teamIdsFrom(new URL(request.url).searchParams.get('teams'));
  try {
    const counts = await countViews(apiFor(session), teams);
    return Response.json(counts, { headers: { 'cache-control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return sessionEnded();
    throw error;
  }
}
