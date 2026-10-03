import type { DemoPersonaKey } from '@itsm/contracts/demo';
import type { BffConfig } from './config.js';
import { readClaims } from './oidc.js';
import { recordSession } from './record-session.js';
import { newSessionId, type Session, type SessionKind } from './session.js';
import { sessionStore } from './store.js';

/**
 * Turning a token set into a session, in one place.
 *
 * Every sign-in path — the provider callback, the development form and the
 * demo's mint — ends here, so the session record has one shape however it
 * was obtained. That is also why the API is told about the session from here
 * rather than from each handler: a sign-in route added later gets the
 * recording without anybody remembering to add it, and the existing ones
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

/**
 * What kind of session this is, and for a demo session the facts the token
 * itself does not carry (an `itsmdemo_` token is opaque: no claims to read).
 */
export type SessionMeta =
  | { readonly kind: 'oidc' | 'dev' }
  | {
      readonly kind: 'demo';
      readonly persona: DemoPersonaKey;
      readonly demoGeneration: number;
      readonly demoSid: string;
      /** The token's own expiry (epoch ms), which the mint decided. */
      readonly accessExpiresAt: number;
      /** The real session this demo replaces on this device, kept to restore later. */
      readonly parkedSessionId?: string;
      /** The instant of the mint, which is also the token's first use. */
      readonly now: number;
    };

export class SessionRefused extends Error {}

/**
 * Creates and stores a session.
 *
 * `meta` defaults to `oidc` for the callers written before sessions had a
 * kind. A demo session differs in three ways, each for a reason:
 *
 *   - **It is never recorded with the API.** The API answers a demo token's
 *     `POST /auth/session` with 204 and lists no sessions for a persona
 *     shared by every visitor (§4.7.3), so a recording would be a wasted
 *     round trip on the one request that has to be quick.
 *   - **Its record lives exactly as long as its token**, not the twelve hours
 *     of a provider session: a record that outlives its token is a session
 *     that can only ever answer 401.
 *   - **Its identity comes from the mint**, because the token is opaque.
 */
export async function createSession(
  config: BffConfig,
  tokens: TokensToStore,
  meta: SessionMeta = { kind: 'oidc' },
): Promise<Session> {
  const claims = meta.kind === 'demo' ? { tenantId: null, userId: null, displayName: null } : readClaims(tokens.accessToken);
  const tenantId = tokens.tenantId ?? claims.tenantId;

  // A token with no tenant is one the API will refuse on every request. Better
  // to fail the sign-in, where the message can say what is wrong, than to hand
  // somebody a session that 401s on the first page.
  if (!tenantId) throw new SessionRefused('that token names no tenant; the provider may be missing a mapper');

  const now = meta.kind === 'demo' ? meta.now : Date.now();
  const kind: SessionKind = meta.kind;
  const session: Session = {
    id: newSessionId(),
    accessToken: tokens.accessToken,
    refreshToken: meta.kind === 'demo' ? null : (tokens.refreshToken ?? null),
    accessExpiresAt: meta.kind === 'demo' ? meta.accessExpiresAt : now + tokens.expiresInSeconds * 1000,
    tenantId,
    userId: tokens.userId ?? claims.userId,
    displayName: tokens.displayName ?? claims.displayName,
    createdAt: now,
    kind,
    ...(meta.kind === 'demo'
      ? {
          persona: meta.persona,
          demoGeneration: meta.demoGeneration,
          demoSid: meta.demoSid,
          // The mint set the token's last-use score to now; the next touch is
          // due a full interval from here.
          lastTouchAt: now,
          ...(meta.parkedSessionId ? { parkedSessionId: meta.parkedSessionId } : {}),
        }
      : {}),
  };

  const store = await sessionStore(config);
  if (meta.kind === 'demo') {
    // At least a second, so a token minted a moment before its expiry still
    // gets a record the browser can name; the API refuses it once it has expired.
    await store.put(session, Math.max(1, Math.ceil((meta.accessExpiresAt - now) / 1000)));
    return session;
  }

  await store.put(session, config.sessionTtlSeconds);

  // Best effort, and awaited rather than left dangling: a promise nobody waits
  // for is a promise a serverless runtime cancels at the end of the response.
  // `recordSession` swallows its own failures — see the reasoning there.
  await recordSession(config, session.accessToken);

  return session;
}
