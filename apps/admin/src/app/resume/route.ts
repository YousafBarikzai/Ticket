import { LAST_PATH_COOKIE, SESSION_COOKIE, readCookie, resumeTarget } from '@itsm/bff/cookies';
import { bff } from '../../bff.js';

/**
 * `/resume`: where a link from another area lands (SPEC v3 §3.3).
 *
 * The area switcher and the other areas' cross-area links send a real session
 * to `${origin}/resume`; this sends the person on to the last page they had
 * open here (`__Host-itsm-last`, written by `src/proxy.ts`), or to the
 * Command centre. The cookie counts only when it was written under this same
 * session — a hash of the session cookie is part of its value — so a page
 * remembered for somebody else on a shared machine is never where the next
 * person lands, and a stored path is a same-origin path or nothing
 * (`resumeTarget`).
 *
 * A 303, so the follow-up is always a GET, and never stored: the answer is
 * this browser's alone. Inside the proxy's matcher, so a person with no
 * session signs in first and comes back here.
 */
export const dynamic = 'force-dynamic';

async function resume(request: Request): Promise<Response> {
  const cookie = request.headers.get('cookie');
  const landing = bff.config.defaultLanding;
  const target = await resumeTarget(readCookie(cookie, LAST_PATH_COOKIE), readCookie(cookie, SESSION_COOKIE), landing);
  return new Response(null, {
    status: 303,
    headers: { location: new URL(target, bff.config.appOrigin).toString(), 'cache-control': 'no-store' },
  });
}

export const GET = resume;
export const HEAD = resume;
