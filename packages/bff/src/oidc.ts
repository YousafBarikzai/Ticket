import { createHash, randomBytes } from 'node:crypto';
import type { OidcSettings } from './config.js';

/**
 * Authorization Code with PKCE, which is what doc 09 §2 specifies for the web
 * apps and what the BFF exists to perform.
 *
 * PKCE is not optional here even though this client has a secret. The code
 * travels back through the user's browser, and a `code` intercepted between
 * the provider and this app is a session unless the exchange also has to prove
 * possession of a verifier that never left the server.
 *
 * `state` is stored server-side against the verifier rather than signed into a
 * cookie, for one reason: the stored record is deleted when it is read, so a
 * callback replayed from a browser history entry finds nothing and fails,
 * where a signed cookie would still verify.
 */

export interface TokenSet {
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly expiresInSeconds: number;
  readonly idToken: string | null;
}

export class SignInFailed extends Error {}

export function createVerifier(): string {
  // 32 bytes as base64url is 43 characters: the shortest the RFC allows, and
  // long enough that there is nothing to gain from more.
  return randomBytes(32).toString('base64url');
}

export function challengeFor(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export interface Discovery {
  authorization_endpoint: string;
  token_endpoint: string;
  end_session_endpoint?: string;
}

const discoveryCache = new Map<string, Discovery>();

export async function discover(settings: OidcSettings, doFetch: typeof fetch = fetch): Promise<Discovery> {
  const cached = discoveryCache.get(settings.issuer);
  if (cached) return cached;

  const response = await doFetch(`${settings.issuer}/.well-known/openid-configuration`, {
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new SignInFailed('the identity provider is not reachable');
  const document = (await response.json()) as Discovery;
  if (!document.authorization_endpoint || !document.token_endpoint) {
    throw new SignInFailed('the identity provider published an incomplete configuration');
  }
  discoveryCache.set(settings.issuer, document);
  return document;
}

export function authorisationUrl(
  endpoint: string,
  settings: OidcSettings,
  options: { state: string; challenge: string; redirectUri: string; loginHint?: string; idpHint?: string },
): string {
  const url = new URL(endpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', settings.clientId);
  url.searchParams.set('redirect_uri', options.redirectUri);
  url.searchParams.set('scope', 'openid profile email');
  url.searchParams.set('state', options.state);
  url.searchParams.set('code_challenge', options.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  // Identity-first login: the tenant's subdomain decides which provider the
  // person is sent to, so they never choose from a list of other tenants' IdPs.
  if (options.idpHint) url.searchParams.set('kc_idp_hint', options.idpHint);
  if (options.loginHint) url.searchParams.set('login_hint', options.loginHint);
  return url.toString();
}

export async function exchangeCode(
  settings: OidcSettings,
  options: { code: string; verifier: string; redirectUri: string },
  doFetch: typeof fetch = fetch,
): Promise<TokenSet> {
  const { token_endpoint: endpoint } = await discover(settings, doFetch);
  return postToken(
    endpoint,
    {
      grant_type: 'authorization_code',
      code: options.code,
      redirect_uri: options.redirectUri,
      code_verifier: options.verifier,
      client_id: settings.clientId,
      client_secret: settings.clientSecret,
    },
    doFetch,
  );
}

export async function refreshTokens(
  settings: OidcSettings,
  refreshToken: string,
  doFetch: typeof fetch = fetch,
): Promise<TokenSet> {
  const { token_endpoint: endpoint } = await discover(settings, doFetch);
  return postToken(
    endpoint,
    {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: settings.clientId,
      client_secret: settings.clientSecret,
    },
    doFetch,
  );
}

async function postToken(endpoint: string, form: Record<string, string>, doFetch: typeof fetch): Promise<TokenSet> {
  const response = await doFetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams(form).toString(),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    // The provider's error body names the client and sometimes the secret's
    // state; it is logged by the caller, never returned to the browser.
    throw new SignInFailed(`the identity provider refused the exchange (${response.status})`);
  }

  const body = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    id_token?: string;
  };
  if (!body.access_token) throw new SignInFailed('the identity provider returned no access token');

  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? null,
    // A provider that omits `expires_in` is treated as a short token rather
    // than an eternal one: refreshing early costs a request, assuming wrongly
    // costs the person their session mid-edit.
    expiresInSeconds: typeof body.expires_in === 'number' ? body.expires_in : 300,
    idToken: body.id_token ?? null,
  };
}

export interface TokenClaims {
  readonly tenantId: string | null;
  readonly userId: string | null;
  readonly displayName: string | null;
}

/**
 * Reads the claims the session record needs for display.
 *
 * Deliberately does NOT verify the signature, and deliberately is not used for
 * any decision: the API verifies the token on every request, and a BFF that
 * verified it too would be a second implementation of the same rule, drifting.
 * What is read here decides what a name badge says, nothing more.
 */
export function readClaims(token: string): TokenClaims {
  const body = token.split('.')[1];
  if (!body) return { tenantId: null, userId: null, displayName: null };
  try {
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Record<string, unknown>;
    const asString = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null);
    return {
      tenantId: asString(claims.tenant_id),
      userId: asString(claims.itsm_user_id) ?? asString(claims.sub),
      displayName: asString(claims.name) ?? asString(claims.preferred_username) ?? asString(claims.email),
    };
  } catch {
    return { tenantId: null, userId: null, displayName: null };
  }
}

export function endSessionUrl(discovery: Discovery, idToken: string | null, redirectTo: string): string | null {
  if (!discovery.end_session_endpoint) return null;
  const url = new URL(discovery.end_session_endpoint);
  url.searchParams.set('post_logout_redirect_uri', redirectTo);
  if (idToken) url.searchParams.set('id_token_hint', idToken);
  return url.toString();
}
