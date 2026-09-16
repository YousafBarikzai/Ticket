import { DependencyUnavailableError, cache, logger, metrics } from '@itsm/platform';

/**
 * The session denylist.
 *
 * `apps/api/src/auth/verify.ts` reads `sess:deny:<sid>` on every authenticated
 * request and refuses a token whose session is listed. Until this file existed
 * **nothing ever wrote that key**: revoking a session set `revoked_at` on a
 * row nobody consults at request time, and the token carried on working until
 * it expired. Both halves of "sign out everywhere" were broken — there was
 * nothing to list, and listing it would not have stopped anything.
 *
 * Three decisions, and each is about which way to fail.
 *
 * **Denied before committed.** The write happens inside the transaction that
 * revokes the row, so a rollback leaves a deny entry for a session that was
 * not revoked after all. That is somebody signed out who did not need to be —
 * annoying, and the safe direction. The opposite order gives a committed
 * revocation that never took effect, which is the failure this whole file
 * exists to prevent.
 *
 * **A Redis outage fails the revocation loudly.** The alternative is to log a
 * warning and return success, which tells an administrator that access has
 * been withdrawn when it has not. The verifier already fails *open* on the
 * same outage — it cannot read the list, so it lets the request through — and
 * the two together are consistent: while Redis is down this platform cannot
 * enforce revocation, and it says so rather than pretending.
 *
 * **The entry expires with the token.** A denied session is only interesting
 * for as long as a token bearing that `sid` could still be presented. Keeping
 * it longer fills Redis with tombstones for sessions that died of old age.
 */

const PREFIX = 'sess:deny:';

/**
 * How long a deny entry is worth keeping.
 *
 * The session's own expiry, plus an hour of slack for clock skew between this
 * platform and whatever issued the token. Floored at a minute, because a
 * session that has already expired is still worth denying for a moment: the
 * expiry on the row and the `exp` in the token are not always the same number.
 */
export function denyTtlSeconds(expiresAt: Date, now = new Date()): number {
  const remaining = Math.ceil((expiresAt.getTime() - now.getTime()) / 1000) + 3600;
  return Math.max(60, remaining);
}

export class RevocationUnavailable extends DependencyUnavailableError {
  constructor() {
    super('the session denylist');
    this.message =
      'this session could not be added to the denylist, so it has not been revoked. ' +
      'Revocation needs Redis; try again once it is reachable.';
  }
}

/** Denies one session. Throws rather than returning quietly if it cannot. */
export async function denySession(sid: string, expiresAt: Date): Promise<void> {
  try {
    await cache().set(`${PREFIX}${sid}`, '1', 'EX', denyTtlSeconds(expiresAt));
    metrics.increment('sessions_denied_total');
  } catch (error) {
    logger.error('a session could not be denied', { sid, error: (error as Error).message });
    throw new RevocationUnavailable();
  }
}

/**
 * Denies several at once — deactivating an account, or signing out everywhere.
 *
 * All or nothing: if any one fails the whole call fails, because "we revoked
 * four of your five sessions" is not an outcome anybody can act on.
 */
export async function denySessions(sessions: readonly { sid: string; expiresAt: Date }[]): Promise<void> {
  if (sessions.length === 0) return;
  try {
    const pipeline = cache().pipeline();
    for (const session of sessions) {
      pipeline.set(`${PREFIX}${session.sid}`, '1', 'EX', denyTtlSeconds(session.expiresAt));
    }
    const results = await pipeline.exec();
    const failed = (results ?? []).filter(([error]) => error !== null);
    if (failed.length > 0) throw failed[0]?.[0] ?? new Error('the pipeline reported a failure');
    metrics.increment('sessions_denied_total', {}, sessions.length);
  } catch (error) {
    logger.error('sessions could not be denied', { count: sessions.length, error: (error as Error).message });
    throw new RevocationUnavailable();
  }
}

/** Test seam, and what an operator needs to undo a denial made in error. */
export async function isDenied(sid: string): Promise<boolean> {
  return (await cache().get(`${PREFIX}${sid}`)) !== null;
}
