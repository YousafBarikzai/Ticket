import { NextResponse, type NextRequest } from 'next/server';
import { config } from '../../../../bff/config.js';
import { cookieAttributes, SESSION_COOKIE } from '../../../../bff/cookies.js';
import { createSession, SessionRefused } from '../../../../bff/create-session.js';
import { exchangeCode, SignInFailed } from '../../../../bff/oidc.js';
import { safeRedirectTarget } from '../../../../bff/redirects.js';
import { sessionStore } from '../../../../bff/store.js';
import { redirectUriFor } from '../../../../bff/urls.js';

/** The provider's redirect back. Everything here is untrusted until the exchange succeeds. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const settings = config();
  const params = request.nextUrl.searchParams;

  const failure = (reason: string): NextResponse =>
    NextResponse.redirect(new URL(`/signed-out?reason=${encodeURIComponent(reason)}`, settings.appOrigin));

  // The provider reports its own refusals here — a cancelled consent screen, a
  // disabled account. Its `error_description` is not echoed back: it is the
  // provider's prose about our client, not a message for this person.
  if (params.get('error')) return failure('the identity provider did not complete the sign-in');

  const code = params.get('code');
  const state = params.get('state');
  if (!code || !state) return failure('that sign-in link is incomplete');

  if (!settings.oidc) return failure('this deployment has no identity provider configured');

  // Single use: a second visit to the same callback URL — a refresh, a back
  // button, a replayed link — finds nothing and fails here rather than
  // exchanging the code twice.
  const store = await sessionStore();
  const pending = await store.takePending(state);
  if (!pending) return failure('that sign-in has already been used, or it expired');

  try {
    const tokens = await exchangeCode(settings.oidc, {
      code,
      verifier: pending.verifier,
      redirectUri: redirectUriFor(settings.appOrigin),
    });
    const session = await createSession({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresInSeconds: tokens.expiresInSeconds,
    });

    const response = NextResponse.redirect(
      new URL(safeRedirectTarget(pending.redirectTo), settings.appOrigin),
    );
    response.cookies.set(SESSION_COOKIE, session.id, cookieAttributes(settings.sessionTtlSeconds));
    return response;
  } catch (error) {
    if (error instanceof SignInFailed || error instanceof SessionRefused) return failure(error.message);
    throw error;
  }
}
