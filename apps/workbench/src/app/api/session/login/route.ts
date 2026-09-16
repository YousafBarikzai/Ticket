import { NextResponse, type NextRequest } from 'next/server';
import { config, developmentSignInAvailable } from '../../../../bff/config.js';
import { authorisationUrl, challengeFor, createVerifier, discover } from '../../../../bff/oidc.js';
import { safeRedirectTarget } from '../../../../bff/redirects.js';
import { newState } from '../../../../bff/session.js';
import { sessionStore } from '../../../../bff/store.js';
import { redirectUriFor } from '../../../../bff/urls.js';

/**
 * Start of the sign-in (doc 09 §2).
 *
 * The verifier and the intended landing page are written to the store against
 * a random `state`, and only the `state` travels through the browser. Nothing
 * the person carries across the redirect can be tampered with into something
 * useful, because none of it is trusted on the way back.
 */

const PENDING_TTL_SECONDS = 600;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const settings = config();
  const redirectTo = safeRedirectTarget(request.nextUrl.searchParams.get('redirectTo'));

  if (!settings.oidc) {
    // No provider configured. In development that is the form; anywhere else
    // `readConfig` has already refused to start, so this is unreachable.
    const target = developmentSignInAvailable(settings) ? '/sign-in' : '/signed-out';
    return NextResponse.redirect(new URL(`${target}?redirectTo=${encodeURIComponent(redirectTo)}`, settings.appOrigin));
  }

  const verifier = createVerifier();
  const state = newState();
  const store = await sessionStore();
  await store.putPending(state, { verifier, redirectTo, createdAt: Date.now() }, PENDING_TTL_SECONDS);

  const discovery = await discover(settings.oidc);
  const url = authorisationUrl(discovery.authorization_endpoint, settings.oidc, {
    state,
    challenge: challengeFor(verifier),
    redirectUri: redirectUriFor(settings.appOrigin),
    ...(request.nextUrl.searchParams.get('idp') ? { idpHint: request.nextUrl.searchParams.get('idp') as string } : {}),
  });

  return NextResponse.redirect(url);
}
