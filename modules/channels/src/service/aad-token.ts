/**
 * A client-credentials token from Microsoft, cached until it nearly expires.
 *
 * Shared because two adapters need it — Graph for mail, Bot Framework for
 * Teams — and they differ only in the scope they ask for and the directory they
 * ask. Written twice, the caching would be written twice, and caching is where
 * this goes wrong: a token that expires between the check and the call fails the
 * call, and the retry is indistinguishable from an outage.
 */

export interface TokenRequest {
  loginBase: string;
  /** The directory to ask. `botframework.com` for a multi-tenant Teams bot. */
  directory: string;
  clientId: string;
  clientSecret: string | undefined;
  scope: string;
  fetchImpl?: typeof fetch;
}

interface CachedToken {
  value: string;
  expiresAt: number;
}

/** A minute of headroom, so a token cannot expire in flight. */
const HEADROOM_MS = 60_000;

/**
 * Builds a token getter with its own cache.
 *
 * One cache per caller rather than a shared map keyed by scope: two adapters
 * holding tokens for different directories should not be able to hand each
 * other the wrong one, and the cost of a second cache is one object.
 */
export function clientCredentialsToken(request: TokenRequest): () => Promise<string> {
  const call = request.fetchImpl ?? fetch;
  const login = request.loginBase.replace(/\/+$/, '');
  let cached: CachedToken | null = null;

  return async function token(): Promise<string> {
    if (cached && cached.expiresAt > Date.now() + HEADROOM_MS) return cached.value;

    if (!request.clientSecret) {
      throw new Error(`no client secret is configured for ${request.scope}`);
    }

    const response = await call(`${login}/${request.directory}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: request.clientId,
        client_secret: request.clientSecret,
        scope: request.scope,
        grant_type: 'client_credentials',
      }).toString(),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      // Truncated on purpose: a token endpoint's error body can echo parts of
      // the request back, and this string goes into a log.
      throw new Error(`Microsoft would not issue a token (${response.status}): ${detail.slice(0, 120)}`);
    }

    const body = (await response.json()) as { access_token: string; expires_in: number };
    cached = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
    return cached.value;
  };
}
