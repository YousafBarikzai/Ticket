import { NextResponse, type NextRequest } from 'next/server';
import { config, developmentSignInAvailable } from '../../../../bff/config.js';
import { cookieAttributes, SESSION_COOKIE } from '../../../../bff/cookies.js';
import { createSession, SessionRefused } from '../../../../bff/create-session.js';
import { devSignIn, DevSignInFailed } from '../../../../bff/dev-sign-in.js';
import { assertSameOrigin, ProxyRefused } from '../../../../bff/proxy.js';
import { safeRedirectTarget } from '../../../../bff/redirects.js';

/**
 * The development sign-in form's target.
 *
 * Answers 404 unless there is genuinely no identity provider and the
 * environment is not production — the same condition the API applies to the
 * endpoint this calls, checked on both sides because each is a deployment unit
 * of its own and either could be configured wrongly.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const settings = config();
  if (!developmentSignInAvailable(settings)) {
    return NextResponse.json({ title: 'Not Found', status: 404 }, { status: 404 });
  }

  try {
    assertSameOrigin('POST', request.headers, settings.appOrigin);
  } catch (error) {
    if (error instanceof ProxyRefused) return NextResponse.json({ title: 'Forbidden', status: 403 }, { status: 403 });
    throw error;
  }

  const form = await request.formData();
  const tenantSlug = String(form.get('tenantSlug') ?? '').trim();
  const email = String(form.get('email') ?? '').trim();
  const redirectTo = safeRedirectTarget(String(form.get('redirectTo') ?? ''));

  const back = (reason: string): NextResponse =>
    NextResponse.redirect(
      new URL(`/sign-in?reason=${encodeURIComponent(reason)}&redirectTo=${encodeURIComponent(redirectTo)}`, settings.appOrigin),
      // 303, so the browser follows with GET rather than replaying the POST.
      { status: 303 },
    );

  if (!tenantSlug || !email) return back('A tenant and an email address are both needed.');

  try {
    const tokens = await devSignIn(settings, { tenantSlug, email });
    const session = await createSession(tokens);
    const response = NextResponse.redirect(new URL(redirectTo, settings.appOrigin), { status: 303 });
    response.cookies.set(SESSION_COOKIE, session.id, cookieAttributes(settings.sessionTtlSeconds));
    return response;
  } catch (error) {
    if (error instanceof DevSignInFailed || error instanceof SessionRefused) return back(error.message);
    throw error;
  }
}
