import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient, workbench, type Workbench } from '@itsm/sdk';
import { config } from '../bff/config.js';
import { SESSION_COOKIE } from '../bff/cookies.js';
import { refreshTokens, readClaims } from '../bff/oidc.js';
import { needsRefresh, newCorrelationId, type Session } from '../bff/session.js';
import { sessionStore } from '../bff/store.js';

/**
 * How a server component gets at the API.
 *
 * Server components call the API *directly* rather than through this app's own
 * proxy: the proxy exists so that the browser never holds a token, and a
 * server component already holds the session. Going through the proxy would
 * mean the app making an HTTP request to itself on every render, which is a
 * hop, a timeout and a confusing trace for no gain.
 *
 * `server-only` is imported for its side effect: it is a module that fails to
 * build if it is ever pulled into a client bundle, which is the difference
 * between a rule about where tokens may live and a rule that is enforced.
 */

export async function currentSession(): Promise<Session | null> {
  const jar = await cookies();
  const id = jar.get(SESSION_COOKIE)?.value;
  if (!id) return null;

  const store = await sessionStore();
  const session = await store.get(id);
  if (!session) return null;
  if (!needsRefresh(session)) return session;

  const settings = config().oidc;
  // Without a provider there is nothing to refresh against: the development
  // token simply expires, and the person signs in again. Saying so here is
  // better than a refresh path that silently does nothing.
  if (!settings || !session.refreshToken) {
    await store.delete(session.id);
    return null;
  }

  try {
    const tokens = await refreshTokens(settings, session.refreshToken);
    const claims = readClaims(tokens.accessToken);
    const refreshed: Session = {
      ...session,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken ?? session.refreshToken,
      accessExpiresAt: Date.now() + tokens.expiresInSeconds * 1000,
      displayName: claims.displayName ?? session.displayName,
    };
    await store.put(refreshed, config().sessionTtlSeconds);
    return refreshed;
  } catch {
    // A refused refresh means the provider has ended the session — because the
    // person signed out elsewhere, or an administrator revoked it. Dropping the
    // record here is what makes that take effect in this app too.
    await store.delete(session.id);
    return null;
  }
}

/**
 * Redirects rather than throwing. A page that threw would render a 500, and
 * "your session expired" is not a server error — it is the most ordinary thing
 * that happens to a screen somebody left open overnight.
 */
export async function requireSession(): Promise<Session> {
  const session = await currentSession();
  if (!session) redirect('/api/session/login');
  return session;
}

/** The SDK, bound to this request's session and its correlation id. */
export function apiFor(session: Session, correlationId = newCorrelationId()): Workbench {
  return workbench(
    createClient({
      baseUrl: config().apiBaseUrl,
      token: session.accessToken,
      correlationId,
      // Server components render during a request, and Next's fetch caches by
      // default. A queue that shows yesterday's tickets because the framework
      // was being helpful is worse than a slow queue.
      fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }),
    }),
  );
}
