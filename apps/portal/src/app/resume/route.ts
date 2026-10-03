import { LAST_PATH_COOKIE, SESSION_COOKIE, readCookie, resumeTarget } from '@itsm/bff/cookies';
import { bff } from '../../bff.js';

/**
 * `/resume` (SPEC v3 §3.3, A2 §4.2): where a switch from another area lands.
 *
 * The Service Desk's and Administration's area menus link here, not to Home,
 * so a person who went to the desk and comes back finds the request they were
 * reading. The proxy records the last page in `__Host-itsm-last`, bound to
 * the session by a hash of its cookie; this answers 303 to that page when the
 * binding still holds, and to Home when it does not — a new sign-in, a demo
 * visit after a real one, or somebody else on a shared machine never resumes
 * another session's page.
 *
 * It stays inside the proxy's matcher, so a person with no session signs in
 * first and comes back here (`redirectTo=/resume`). Never cached: the answer
 * is this browser's, and changes with every page it opens.
 *
 * The `Location` is a path, not a URL: a relative reference is valid in a
 * redirect (RFC 9110 §10.2.2), and it cannot name another host whatever the
 * request's own `Host` said.
 */
export const dynamic = 'force-dynamic';

async function resume(request: Request): Promise<Response> {
  const cookie = request.headers.get('cookie');
  const target = await resumeTarget(readCookie(cookie, LAST_PATH_COOKIE), readCookie(cookie, SESSION_COOKIE), bff.config.defaultLanding);
  return new Response(null, { status: 303, headers: { location: target, 'cache-control': 'no-store' } });
}

export const GET = resume;
export const HEAD = resume;
