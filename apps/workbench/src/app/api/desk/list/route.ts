import { ApiError } from '@itsm/sdk';
import { peopleIdsOf, toListRow, viewRefFromKey, type ListPage } from '../../../../inbox/queries.js';
import { inboxViewFrom, type SearchParams } from '../../../../inbox/views.js';
import { resolvePeople } from '../../../../server/people.js';
import { apiFor, currentSession } from '../../../../server/session.js';

/**
 * `GET /api/desk/list?view=mine&status=…&cursor=…` — one page of an inbox
 * view (SPEC §5.3, D16).
 *
 * The browser's half of the list: filters change, pages load and live
 * notices refresh through here, without a server render of the page. It
 * reads the query exactly as the page reads its URL (`inboxViewFrom`, every
 * sanitising rule included), asks the API for the page, slims each ticket
 * to what a row shows, and adds the names of the people on it — one small
 * JSON answer instead of a list request and a directory request from the
 * browser. `view` is a view id or `team:<uuid>`.
 *
 * A session that has ended is a 401 in problem JSON, never a redirect: the
 * caller is `fetch`, which would follow one into the identity provider's
 * HTML. Any other refusal keeps its status and problem, so the list can tell
 * "you may not read tickets" from "the service is down".
 */
export const dynamic = 'force-dynamic';

const NO_STORE = { 'cache-control': 'private, no-store' };

function problem(status: number, title: string, detail?: string): Response {
  return Response.json(
    { type: 'about:blank', title, status, ...(detail ? { detail } : {}) },
    { status, headers: { 'content-type': 'application/problem+json', ...NO_STORE } },
  );
}

/** The query string as the page's `searchParams` would hold it: the first value of each name wins. */
function paramsOf(url: URL): SearchParams {
  const params: Record<string, string> = {};
  for (const [key, value] of url.searchParams) if (!(key in params)) params[key] = value;
  return params;
}

export async function GET(request: Request): Promise<Response> {
  const session = await currentSession();
  if (!session) return problem(401, 'Your session ended', 'Sign in again to carry on.');

  const url = new URL(request.url);
  const ref = viewRefFromKey(url.searchParams.get('view'));
  if (!ref) return problem(400, 'Unknown view');
  const view = inboxViewFrom(ref, paramsOf(url));

  try {
    const page = await apiFor(session).tickets(view.filter);
    const rows = page.data.map(toListRow);
    const body: ListPage = { rows, nextCursor: page.nextCursor, people: await resolvePeople(peopleIdsOf(rows)) };
    return Response.json(body, { headers: NO_STORE });
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    if (error.status === 401) return problem(401, 'Your session ended', 'Sign in again to carry on.');
    if (error.status === 0) return problem(502, 'The service could not be reached');
    return Response.json(error.problem ?? { type: 'about:blank', title: error.message, status: error.status }, {
      status: error.status,
      headers: { 'content-type': 'application/problem+json', ...NO_STORE },
    });
  }
}
