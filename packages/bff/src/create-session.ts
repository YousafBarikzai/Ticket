import type { BffConfig } from './config.js';
import { readClaims } from './oidc.js';
import { recordSession } from './record-session.js';
import { newSessionId, type Session } from './session.js';
import { sessionStore } from './store.js';

/**
 * Turning a token set into a session, in one place.
 *
 * Both sign-in paths — the provider callback and the development form — end
 * here, so the session record has one shape and one lifetime however it was
 * obtained. That is also why the API is told about the session from here
 * rather than from each handler: a sign-in route added later gets the
 * recording without anybody remembering to add it, and the two existing ones
 * cannot drift apart.
 */

export interface TokensToStore {
  readonly accessToken: string;
  readonly refreshToken?: string | null;
  readonly expiresInSeconds: number;
  /** Known already from the development sign-in; read from the token otherwise. */
  readonly tenantId?: string | null;
  readonly userId?: string | null;
  readonly displayName?: string | null;
}

export class SessionRefused extends Error {}

export async function createSession(config: BffConfig, tokens: TokensToStore): Promise<Session> {
  const claims = readClaims(tokens.accessToken);
  const tenantId = tokens.tenantId ?? claims.tenantId;

  // A token with no tenant is one the API will refuse on every request. Better
  // to fail the sign-in, where the message can say what is wrong, than to hand
  // somebody a session that 401s on the first page.
  if (!tenantId) throw new SessionRefused('that token names no tenant; the provider may be missing a mapper');

  const session: Session = {
    id: newSessionId(),
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken ?? null,
    accessExpiresAt: Date.now() + tokens.expiresInSeconds * 1000,
    tenantId,
    userId: tokens.userId ?? claims.userId,
    displayName: tokens.displayName ?? claims.displayName,
    createdAt: Date.now(),
  };

  const store = await sessionStore(config);
  await store.put(session, config.sessionTtlSeconds);

  // Best effort, and awaited rather than left dangling: a promise nobody waits
  // for is a promise a serverless runtime cancels at the end of the response.
  // `recordSession` swallows its own failures — see the reasoning there.
  await recordSession(config, session.accessToken);

  return session;
}
