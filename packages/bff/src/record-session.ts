import type { BffConfig } from './config.js';

/**
 * Telling the API that a session has begun.
 *
 * Doc 09 §2 has the web applications call `POST /api/v1/auth/session` after a
 * sign-in. Nothing did, and the consequence was quiet and total: `Session` rows
 * were written only by a test, so `GET /me/sessions` listed nothing, `DELETE
 * /me/sessions/:id` had nothing to revoke, and the denylist the API's token
 * verifier reads on every request never gained an entry. "Sign out everywhere"
 * was a promise the product made in its own documentation and could not keep.
 *
 * **A failure here does not fail the sign-in.** That is a deliberate choice
 * against the grain of the rest of this work, so it is worth being explicit
 * about why. The alternative — refusing the sign-in when the record cannot be
 * written — locks everybody out of a working platform because one table is
 * unreachable, and it does so at the one moment a person has no other route
 * in. The cost of the choice is a session that cannot be listed or revoked,
 * and that cost is bounded: the call is repeated on every token refresh, and
 * `recordSession` is idempotent, so a missed record repairs itself within one
 * refresh interval rather than lasting the session's life.
 *
 * What it must never do is fail *silently*. It logs, and the caller carries on.
 */

/** How long to wait before giving up. A sign-in must not hang on this. */
const TIMEOUT_MS = 3_000;

export interface RecordedSession {
  readonly id: string;
  readonly expiresAt: string;
  readonly lastSeenAt: string;
}

export interface RecordDeps {
  readonly fetchImpl?: typeof fetch;
  readonly onFailure?: (reason: string) => void;
}

export async function recordSession(
  config: BffConfig,
  accessToken: string,
  deps: RecordDeps = {},
): Promise<RecordedSession | null> {
  const doFetch = deps.fetchImpl ?? fetch;
  const report = deps.onFailure ?? ((reason: string) => {
    // `console` rather than the platform logger: this package is imported by a
    // Next application, and pulling the API's logging stack into a client
    // build's dependency graph to write one line is not a trade worth making.
    console.warn(`[bff:${config.appName}] a session could not be recorded: ${reason}`);
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await doFetch(`${config.apiBaseUrl}/api/v1/auth/session`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      // The token is the whole of the evidence. Anything in a body here would
      // be the client's claim about itself, which is exactly what the API must
      // not believe.
      body: '{}',
      signal: controller.signal,
    });

    if (!response.ok) {
      report(`the API answered ${response.status}`);
      return null;
    }
    return (await response.json()) as RecordedSession;
  } catch (error) {
    report(error instanceof Error ? error.message : 'the API could not be reached');
    return null;
  } finally {
    clearTimeout(timer);
  }
}
