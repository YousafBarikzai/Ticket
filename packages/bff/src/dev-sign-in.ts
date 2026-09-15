import type { BffConfig } from './config.js';

/**
 * The development sign-in, from the BFF's side.
 *
 * Shaped like the OIDC exchange on purpose: credentials in, a token set out.
 * That keeps the callback and the development form landing in the same
 * `createSession` code, so the path a developer exercises every day is the
 * path that runs in production, minus the provider.
 */

export interface DevTokenSet {
  readonly accessToken: string;
  readonly expiresInSeconds: number;
  readonly tenantId: string;
  readonly userId: string | null;
  readonly displayName: string | null;
}

export class DevSignInFailed extends Error {}

export async function devSignIn(
  config: BffConfig,
  credentials: { tenantSlug: string; email: string },
  doFetch: typeof fetch = fetch,
): Promise<DevTokenSet> {
  const response = await doFetch(`${config.apiBaseUrl}/api/v1/auth/dev-session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(credentials),
    signal: AbortSignal.timeout(10_000),
  });

  if (response.status === 404) {
    throw new DevSignInFailed('the API has no development sign-in; it is configured with an identity provider');
  }
  if (!response.ok) {
    throw new DevSignInFailed('no such tenant and user, or that account is not active');
  }

  const body = (await response.json()) as Partial<DevTokenSet> & { accessToken?: string };
  if (!body.accessToken || !body.tenantId) throw new DevSignInFailed('the API returned an unusable token');

  return {
    accessToken: body.accessToken,
    expiresInSeconds: typeof body.expiresInSeconds === 'number' ? body.expiresInSeconds : 3600,
    tenantId: body.tenantId,
    userId: body.userId ?? null,
    displayName: body.displayName ?? null,
  };
}
