import { demoPersona } from '@itsm/contracts/demo';
import type { BffConfig } from '../config.js';
import { isDemoSession, isRealSession, type DemoSession, type Session, type SessionStore } from '../session.js';
import type { DemoSettings } from './settings.js';
import type { DemoRemintResult, DemoTokenStore } from './store.js';

/**
 * A demo visit's token over its life: the single-flight re-mint, the session
 * a layout should hand the demo bar afterwards, and the end of the visit
 * (SPEC §4.5 rows F6–F8, X2, X3, O2; §4.6.4 "Transparent re-mint").
 *
 * **Why re-minting is single-flight.** A page that renders after a swap fires
 * a dozen API calls at once, and each meets `401 demo_reset`. Without a
 * shared flight each would re-mint, the Lua compare-and-swap would let one
 * win and answer the rest `already`, and the visit would burn a dozen of its
 * twelve hourly re-mints on one page. In-process, one flight per
 * (session, old token) does the work; across replicas the script's CAS makes
 * the answers agree.
 *
 * **Why the result is remembered for ten seconds.** A layout reads the
 * session, renders, and the page beneath it re-mints during the same request:
 * the layout still holds the old session object and would hand the demo bar
 * the old generation (X3 in §1.4.4). `latestSession` follows what a re-mint
 * replaced, so the bar shows the generation the page is actually reading.
 * The window only has to outlast one request; ten seconds is generous.
 */

/** Why a token is re-minted: its life is sliding forward (F8), or the demo was rebuilt under it (X2). */
export type RemintCause = 'slide' | 'reset';

/** How long a re-mint's outcome is remembered for `latestSession`. */
export const LATEST_SESSION_MS = 10_000;

/** A re-mint replaced chains at most this long; anything longer is a bug, not a visit. */
const MAX_HOPS = 8;

const inflight = new Map<string, Promise<DemoRemintResult>>();
const replaced = new Map<string, { readonly session: Session; readonly at: number }>();

/** Test seam: forgets every flight and every remembered re-mint. */
export function forgetRemints(): void {
  inflight.clear();
  replaced.clear();
}

/** One line per re-mint, never a token or a bucket (§4.9). Tests silence `console.info`. */
function logRemint(appName: string, cause: RemintCause, status: string): void {
  console.info(`[bff:${appName}] demo remint cause=${cause} result=${status}`);
}

function remember(oldToken: string, session: Session, now: number): void {
  for (const [token, entry] of replaced) {
    if (now - entry.at > LATEST_SESSION_MS) replaced.delete(token);
  }
  replaced.set(oldToken, { session, at: now });
}

export interface RemintRequest {
  readonly appName: string;
  readonly store: DemoTokenStore;
  readonly session: DemoSession;
  readonly settings: DemoSettings;
  readonly cause: RemintCause;
  readonly now?: number;
}

/**
 * Re-mints a demo session's token once per (session, token) in this process,
 * however many callers ask at the same moment. `ok` and `already` both carry
 * the session to use from now on; anything else is the visit's end or a
 * refusal the caller decides about (F8 keeps a session with time left; X2
 * ends the visit).
 *
 * The persona decides the app, not the BFF's name: a session of persona
 * `agent` was minted by the Service Desk wherever it is read.
 */
export function remintOnce(request: RemintRequest): Promise<DemoRemintResult> {
  const { session } = request;
  const key = `${request.appName}\u0000${session.id}\u0000${session.accessToken}`;
  const existing = inflight.get(key);
  if (existing) return existing;

  const flight = (async (): Promise<DemoRemintResult> => {
    const now = request.now ?? Date.now();
    const persona = demoPersona(session.persona);
    if (!persona) return { status: 'gone' };
    const result = await request.store.remint({
      sessionId: session.id,
      app: persona.area,
      sid: session.demoSid,
      currentToken: session.accessToken,
      settings: request.settings,
      now,
    });
    logRemint(request.appName, request.cause, result.status);
    if (result.status === 'ok' || result.status === 'already') remember(session.accessToken, result.session, now);
    return result;
  })().finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, flight);
  return flight;
}

/**
 * The session a re-mint replaced `session` with in the last ten seconds, or
 * `session` itself (`bff.latestSession`, SPEC §4.5). Layouts pass
 * `latestSession(session).demoGeneration` to the demo bar.
 */
export function latestSession<T extends Session>(session: T, now: number = Date.now()): T | Session {
  let current: Session = session;
  for (let hop = 0; hop < MAX_HOPS; hop += 1) {
    const entry = replaced.get(current.accessToken);
    if (!entry || now - entry.at > LATEST_SESSION_MS || entry.session.id !== current.id) break;
    current = entry.session;
  }
  return current === session ? session : current;
}

/* ------------------------------------------------------------------ The end of a visit */

/** A parked session is given back only while the demo that replaced it is younger than this (O2: "< 12 h"). */
export const PARKED_RESTORE_MAX_MS = 12 * 60 * 60 * 1000;

/**
 * The real session a demo session put aside, when it can still be given
 * back: the demo is less than twelve hours old and the parked record is a
 * live provider or development session. `null` otherwise.
 */
export async function parkedSessionFor(
  store: SessionStore,
  session: Session,
  now: number = Date.now(),
): Promise<Session | null> {
  if (!isDemoSession(session) || !session.parkedSessionId) return null;
  if (now - session.createdAt >= PARKED_RESTORE_MAX_MS) return null;
  const parked = await store.get(session.parkedSessionId);
  return isRealSession(parked) ? parked : null;
}

export interface EndVisit {
  readonly config: Pick<BffConfig, 'sessionTtlSeconds'>;
  readonly sessions: SessionStore;
  readonly tokens: DemoTokenStore;
  readonly session: DemoSession;
  readonly now?: number;
}

/**
 * Ends a demo visit that ended by itself — its token is gone (X3), the demo
 * was switched off (F6), the visit outlived its day (F7) — and gives back the
 * real session it put aside, if there is one (Y-m3).
 *
 * The token is revoked first (idempotent), so nothing can use it whatever
 * happens next. Then the record the browser's cookie names is either deleted
 * or, when a parked session is still live, **replaced by that session under
 * the cookie's id**. Re-keying rather than re-pointing the cookie is what
 * makes the restore hold everywhere: a server component reading the session
 * cannot set a cookie, and a restore that only worked on the requests that
 * happen to pass through the proxy would give a person their account back
 * for one page and take it away on the next. The ids are both 256 random
 * bits this server minted for this browser, so nothing about the session's
 * secrecy changes; the parked id is deleted, so one session has one record.
 *
 * Returns the restored session, or `null` when the visit simply ended. A
 * record that another request already moved on — re-minted, restored — is
 * left alone and returned as it now is.
 */
export async function endDemoVisit(visit: EndVisit): Promise<Session | null> {
  const { sessions, tokens, session } = visit;
  const now = visit.now ?? Date.now();
  await tokens.revoke(session.accessToken);

  const current = await sessions.get(session.id);
  if (current && (current.kind !== 'demo' || current.accessToken !== session.accessToken)) return current;

  const parked = await parkedSessionFor(sessions, session, now);
  if (parked) {
    const restored: Session = { ...parked, id: session.id };
    await sessions.put(restored, visit.config.sessionTtlSeconds);
    await sessions.delete(parked.id);
    return restored;
  }
  await sessions.delete(session.id);
  return null;
}
