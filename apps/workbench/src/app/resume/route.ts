import type { NextRequest } from 'next/server';
import { LAST_PATH_COOKIE, SESSION_COOKIE, readCookie, resumeTarget } from '@itsm/bff/cookies';
import { bff } from '../../bff.js';

/**
 * `/resume` (v3 §3.3, A2 §4.2): where every area row and every real hop into
 * the Service Desk lands. It answers 303 to the last page this session had
 * open here — the `__Host-itsm-last` cookie the proxy keeps, bound to the
 * session by a hash of its id — or to the area's home, the Overview.
 *
 * Bound to the session so a new one never resumes the old one's page: a real
 * sign-in after a demo, a demo after a real session, another person on a
 * shared machine all start at the home page. The stored path is client input
 * and passes the same-origin rules again (`resumeTarget`).
 *
 * Inside the proxy's matcher, so a person with no session signs in first and
 * comes back here; never cached, because the answer is this session's.
 */
export const dynamic = 'force-dynamic';

async function resume(request: NextRequest): Promise<Response> {
  const cookie = request.headers.get('cookie');
  const target = await resumeTarget(readCookie(cookie, LAST_PATH_COOKIE), readCookie(cookie, SESSION_COOKIE), bff.config.defaultLanding);
  // Absolute, on this app's configured origin: a redirect never takes its host from a request header.
  return new Response(null, {
    status: 303,
    headers: { location: new URL(target, bff.config.appOrigin).toString(), 'cache-control': 'no-store' },
  });
}

export const GET = resume;
export const HEAD = resume;
