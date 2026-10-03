import { createHash } from 'node:crypto';
import {
  DEMO_KEYS,
  DEMO_TOKEN_PATTERN,
  DEMO_TOKEN_PREFIX,
  demoPersona,
  type DemoArea,
  type DemoPersonaKey,
} from '@itsm/contracts/demo';
import { demoLiveSchema, demoTokenSchema, parseDemoRecord } from '@itsm/contracts/demo/schemas';
import {
  DemoResetError,
  DemoSessionEndedError,
  DemoUnavailableError,
  UnauthorisedError,
  cache,
  checkDemoInterlock,
  logger,
  metrics,
} from '@itsm/platform';
import type { VerifiedToken } from './verify.js';

/**
 * Shared-demo token verification (SPEC v3 §4.4; annex A3 §4.3).
 *
 * A demo token is opaque: `itsmdemo_` and 43 random base64url characters,
 * carrying no claims and no signature, so there is no secret to leak or
 * forget to set. What makes one valid is a record in Redis that only the
 * BFFs' mint script writes, keyed by the token's SHA-256 — never by the token
 * itself — and agreement between that record and the live generation.
 *
 * Every step fails closed and in a fixed order. In particular a Redis error is
 * `demo_unavailable` (503), never a pass: the session denylist next door
 * errs towards availability, and for a credential that Redis alone vouches
 * for that would mean "Redis is down, so everyone is in". What this cannot
 * check — that the tenant the records name is really the demo — is the
 * database interlock's job in the context plugin, so a fully forged Redis
 * still reaches nothing but the demo tenant (D25).
 */

/** The facts a verified demo token carries into the request (`VerifiedToken.demo`). */
export interface DemoTokenFacts {
  /** The visit: `demo-` and a UUID, stable across re-mints. */
  readonly sid: string;
  readonly persona: DemoPersonaKey;
  /** The area the token was minted in; always the persona's own (`mayMint`). */
  readonly app: DemoArea;
  readonly generation: number;
  /** When this token was minted, epoch ms. */
  readonly issuedAt: number;
  /** The salted IP bucket at mint time, for the per-bucket budgets; never an address. */
  readonly ipBucket: string;
  /** The three personas' user ids in this generation, from the live record. */
  readonly personaUserIds: Readonly<Record<DemoPersonaKey, string>>;
  /** The agent persona's teams (X-B2). */
  readonly agentTeamIds: readonly string[];
}

/**
 * Reads raw values for keys in one round trip, in order (`MGET`). Replaceable
 * so a test can stand in a broken or recording Redis without stopping the
 * shared one.
 */
export type DemoRecordReader = (keys: readonly string[]) => Promise<readonly (string | null)[]>;

/**
 * How long one verification waits for Redis. The shared cache client queues
 * commands while it reconnects, which would turn an outage into requests that
 * hang; two seconds is far beyond a healthy `MGET` and short enough that a
 * visitor sees "being prepared" rather than a spinner.
 */
export const DEMO_STORE_TIMEOUT_MS = 2_000;

const readFromCache: DemoRecordReader = (keys) => cache().mget(...keys);

let readRecords: DemoRecordReader = readFromCache;

/** Test seam: replaces how the records are read; `null` restores the shared cache client. */
export function setDemoRecordReader(reader: DemoRecordReader | null): void {
  readRecords = reader ?? readFromCache;
}

/** The SHA-256 of a token, hex: the only form in which a token names a key. */
export function demoTokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** At most eight hex characters of a hash, for logs. */
function hash8(hash: string): string {
  return hash.slice(0, 8);
}

/** Whether a bearer is a demo token at all; the branch `verifyAccessToken` takes. */
export function isDemoBearer(token: string): boolean {
  return token.startsWith(DEMO_TOKEN_PREFIX);
}

/** Reads the demo records within `DEMO_STORE_TIMEOUT_MS`, or fails with `store`. */
export async function readDemoRecords(keys: readonly string[]): Promise<readonly (string | null)[]> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer from Redis within ${DEMO_STORE_TIMEOUT_MS} ms`)), DEMO_STORE_TIMEOUT_MS);
  });
  try {
    const values = await Promise.race([readRecords(keys), timeout]);
    if (!Array.isArray(values) || values.length !== keys.length) throw new Error('Redis answered with the wrong number of values');
    return values;
  } catch (error) {
    logger.warn('the demo records could not be read', { error: (error as Error).message });
    throw new DemoUnavailableError('store');
  } finally {
    clearTimeout(timer);
  }
}

function refuse(result: string, error: Error): never {
  metrics.increment('demo_verify_total', { result });
  throw error;
}

/**
 * Verifies a demo bearer, steps 1–10 of §4.4, and returns the identity the
 * context plugin builds the request on.
 *
 * The subject is `demo:<visit>`, never the persona's user id: the per-token
 * rate limit then counts each visitor separately, and just-in-time
 * provisioning (which runs only when the subject is the user id and an email
 * is present) cannot run for a token that carries neither.
 */
export async function verifyDemoToken(token: string, now: number = Date.now()): Promise<VerifiedToken> {
  // 1. The demo is on and its slug passed the boot interlock. A deployment
  //    that turned the demo off ends every visit rather than half-honouring it.
  if (!checkDemoInterlock().ready) return refuse('ended', new DemoSessionEndedError());

  // 2. The exact shape, before anything is read: a malformed bearer is never
  //    hashed into a lookup, let alone used as a key.
  if (!DEMO_TOKEN_PATTERN.test(token)) return refuse('malformed', new UnauthorisedError('this is not a valid demo token'));

  // 3. One round trip for the three records. No fallback, no fail-open.
  const hash = demoTokenHash(token);
  let values: readonly (string | null)[];
  try {
    values = await readDemoRecords([DEMO_KEYS.token(hash), DEMO_KEYS.live, DEMO_KEYS.paused]);
  } catch (error) {
    return refuse('unavailable', error as Error);
  }
  const [rawToken, rawLive, rawPaused] = values;

  // 4. An operator pause stops every visit at once, whatever the records say.
  if (rawPaused !== null && rawPaused !== undefined) return refuse('paused', new DemoUnavailableError('paused'));

  // 5–6. The token's record: present, strictly valid, unexpired. Its key's
  //      time-to-live usually removes an expired record first; the check
  //      covers the moment between the two.
  const record = parseDemoRecord(demoTokenSchema, rawToken);
  if (!record) return refuse('ended', new DemoSessionEndedError());
  if (record.exp <= now) return refuse('ended', new DemoSessionEndedError());

  // 7. No live generation: the demo is being prepared.
  const live = parseDemoRecord(demoLiveSchema, rawLive);
  if (!live) return refuse('unavailable', new DemoUnavailableError('preparing'));

  // 8. The demo was rebuilt since this token was minted. The BFF re-mints
  //    once and resends once, so a visitor never sees it.
  if (record.gen !== live.generation || record.tenantId !== live.tenantId) return refuse('reset', new DemoResetError());

  // 9. The token's user must be the live record's persona. Nothing the mint
  //    script writes can disagree, so a mismatch is a forged or corrupted
  //    record: end the visit, and say so loudly.
  if (live.personas[record.persona].userId !== record.userId) {
    logger.error('demo token persona mismatch', { hash8: hash8(hash), persona: record.persona });
    return refuse('ended', new DemoSessionEndedError());
  }

  metrics.increment('demo_verify_total', { result: 'ok' });
  const persona = demoPersona(record.persona);
  return {
    kind: 'user',
    tenantId: record.tenantId,
    userId: record.userId,
    subject: `demo:${record.sid}`,
    sessionId: record.sid,
    expiresAt: Math.floor(record.exp / 1000),
    ...(persona ? { name: persona.name } : {}),
    // No `email`: the context plugin's just-in-time provisioning needs one.
    demo: {
      sid: record.sid,
      persona: record.persona,
      app: record.app,
      generation: record.gen,
      issuedAt: record.iat,
      ipBucket: record.ipb,
      personaUserIds: {
        employee: live.personas.employee.userId,
        agent: live.personas.agent.userId,
        admin: live.personas.admin.userId,
      },
      agentTeamIds: [...live.agentTeamIds],
    },
  };
}
