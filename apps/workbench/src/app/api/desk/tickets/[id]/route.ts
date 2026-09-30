import { ApiError } from '@itsm/sdk';
import { loadTicketBundle } from '../../../../(desk)/tickets/[id]/bundle.js';
import { apiFor, currentSession } from '../../../../../server/session.js';

/**
 * `GET /api/desk/tickets/[id]` — one ticket for the workspace (SPEC §5.3,
 * D16): the ticket, its conversation, its timers, the names of the people
 * in it and what the reader may do, in one request from the browser.
 *
 * Failures are problem JSON with the API's own status — a 401 when the
 * session has ended (never a redirect: the caller is `fetch`, which would
 * follow it into the identity provider's HTML), 403/404 for a ticket that is
 * not the reader's to see, the API's own status otherwise — so the
 * workspace reads them as it reads the SDK's.
 */
export const dynamic = 'force-dynamic';

const PROBLEM_HEADERS = { 'content-type': 'application/problem+json', 'cache-control': 'no-store' } as const;

function problem(status: number, title: string, detail?: string, type?: string): Response {
  return Response.json({ type: type ?? 'about:blank', title, status, ...(detail ? { detail } : {}) }, { status, headers: PROBLEM_HEADERS });
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const session = await currentSession();
  if (!session) return problem(401, 'Your session ended', 'Sign in again to carry on.');
  const { id } = await params;
  if (!id || id.length > 100) return problem(404, 'Not found');

  try {
    const bundle = await loadTicketBundle(apiFor(session), id);
    return Response.json(bundle, { headers: { 'cache-control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 401) return problem(401, 'Your session ended', 'Sign in again to carry on.');
      const status = error.status >= 400 && error.status < 600 ? error.status : 502;
      return problem(status, error.problem?.title ?? error.message, error.problem?.detail, error.problem?.type);
    }
    throw error;
  }
}
