import 'server-only';
import { DEMO_RESET, demoEtaPhrase, nextResetAt, periodMs, type DemoState } from '@itsm/contracts/demo';
import { demoStatusSchema } from '@itsm/contracts/demo/schemas';
import type { SiteConfig } from './config.js';

/**
 * The public demo's state, as the site's server reads it (SPEC v3 §6.1
 * "Demo status"; A5 §3.7).
 *
 * The landing page and the chooser render per request, and each wants to know
 * whether the demo is ready, being prepared or paused: the strip, the hero
 * pill and a note under the role buttons change with it. The answer comes
 * from the API's public `GET /api/demo/v1/status`, read here on the server —
 * the browser never calls the API, so the site's CSP keeps `connect-src
 * 'self'` and a visitor's page makes no request a script could see.
 *
 * Three rules keep a marketing page from depending on the API being up:
 *
 *   1. **Bounded.** One read per 10 s per process, and a render that arrives
 *      while one is in flight awaits the same promise (single-flight). A
 *      failed read is remembered for the same 10 s, so an API that is down
 *      costs one 1.5 s timeout per 10 s rather than one per visitor. Six reads
 *      a minute per replica, whatever the traffic (A5 R6).
 *   2. **Strict.** The body is parsed with `demoStatusSchema`, server-only
 *      (zod never reaches a browser bundle, Y-B2). A body the site cannot
 *      read — a newer `v`, an unknown field — is a failure like any other.
 *   3. **Never in the way.** Any failure is the state `unknown`, which every
 *      page renders as `ready`: the role buttons stay links, and the app's
 *      own `/demo` page is the authority on whether a session can start.
 *
 * The reset clock is computed here for every call, from the pure functions in
 * `@itsm/contracts/demo` — the same ones the API answers with — rather than
 * copied from a remembered answer, so a countdown rendered from a memoised
 * status is never ten seconds behind, and a page whose status read failed
 * still counts down to the right midnight.
 */

/** What a page can be told: the API's four states, or `unknown` when the read failed. */
export type SiteDemoStateName = DemoState | 'unknown';

/** The reset clock a countdown starts from (A2 `DemoCountdown`). Times are epoch milliseconds. */
export interface SiteDemoClock {
  readonly serverNow: number;
  readonly nextResetAt: number;
  readonly periodMs: number;
  /** "00:00 UK time". */
  readonly resetLabel: string;
  /** "Europe/London". */
  readonly timeZone: string;
}

export type SiteDemoState =
  | { readonly mode: 'off' }
  | {
      readonly mode: 'on';
      readonly state: SiteDemoStateName;
      /** The running build's estimate, for `demoEtaPhrase`; null when none is running or the read failed. */
      readonly etaSec: number | null;
      readonly clock: SiteDemoClock;
    };

/** How long one read of the status serves every render, success or failure. */
export const DEMO_STATUS_MEMO_MS = 10_000;

/** How long a read may take before the page renders without it. */
export const DEMO_STATUS_TIMEOUT_MS = 1_500;

/** A status body is a few hundred bytes; anything this large is not one, and is not parsed. */
const MAX_BODY_CHARS = 16_384;

/** How often each kind of failure may be logged. */
const LOG_EVERY_MS = 10 * 60_000;

type FailureKind = 'unconfigured' | 'timeout' | 'network' | 'http' | 'body';

interface Read {
  readonly state: SiteDemoStateName;
  readonly etaSec: number | null;
}

interface Memo {
  readonly base: string | null;
  readonly at: number;
  readonly read: Promise<Read>;
}

let memo: Memo | null = null;
const lastLogged = new Map<FailureKind, number>();

const UNKNOWN: Read = Object.freeze({ state: 'unknown', etaSec: null });

/**
 * One line per failure kind per ten minutes, naming the kind and nothing
 * else: no URL (the base URL is configuration, and a query string could one
 * day carry something), no response body.
 */
function logFailure(kind: FailureKind, now: number, detail?: string): void {
  const last = lastLogged.get(kind);
  if (last !== undefined && now - last < LOG_EVERY_MS) return;
  lastLogged.set(kind, now);
  console.warn(`[site] demo status unavailable: ${kind}${detail ? ` ${detail}` : ''}`);
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

async function readStatus(base: string | null, now: number, doFetch: typeof fetch): Promise<Read> {
  if (base === null) {
    // Production without API_BASE_URL (config.ts leaves it null rather than guess).
    logFailure('unconfigured', now);
    return UNKNOWN;
  }
  let body: string;
  try {
    const response = await doFetch(`${base}/api/demo/v1/status`, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
      // Covers the body as well as the headers: a stalled stream is aborted too.
      signal: AbortSignal.timeout(DEMO_STATUS_TIMEOUT_MS),
    });
    if (response.status !== 200) {
      logFailure('http', now, String(response.status));
      return UNKNOWN;
    }
    body = await response.text();
  } catch (error) {
    logFailure(isTimeout(error) ? 'timeout' : 'network', now);
    return UNKNOWN;
  }
  if (body.length > MAX_BODY_CHARS) {
    logFailure('body', now);
    return UNKNOWN;
  }
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    logFailure('body', now);
    return UNKNOWN;
  }
  const parsed = demoStatusSchema.safeParse(json);
  if (!parsed.success) {
    logFailure('body', now);
    return UNKNOWN;
  }
  return { state: parsed.data.state, etaSec: parsed.data.build?.etaSec ?? null };
}

/**
 * The demo's state for one render.
 *
 * `DEMO_MODE` off answers `{ mode: 'off' }` without a read: the site then
 * shows no strip, no role buttons and no demo copy, and `/try` is a 404.
 * `now` and `doFetch` are parameters so the memo and the failures can be
 * tested without timers or a server; pages call it with the config alone.
 */
export async function getDemoStatus(config: SiteConfig, now: number = Date.now(), doFetch: typeof fetch = fetch): Promise<SiteDemoState> {
  if (!config.demo) return { mode: 'off' };

  const base = config.apiBaseUrl;
  // A changed base URL (another configuration in one process: tests) is a new read, not a stale hit.
  if (memo === null || memo.base !== base || now - memo.at >= DEMO_STATUS_MEMO_MS || now < memo.at) {
    memo = { base, at: now, read: readStatus(base, now, doFetch).catch(() => UNKNOWN) };
  }
  const read = await memo.read;

  return {
    mode: 'on',
    state: read.state,
    etaSec: read.etaSec,
    clock: {
      serverNow: now,
      nextResetAt: nextResetAt(now),
      periodMs: periodMs(now),
      resetLabel: DEMO_RESET.label,
      timeZone: DEMO_RESET.timeZone,
    },
  };
}

/**
 * The note under the role buttons and the chooser's status banner (SPEC v3
 * §6.1), or null when the demo is usable as it is. One function, so the
 * landing page and the chooser cannot word it differently; the duration is
 * always `demoEtaPhrase`'s, never a figure of the page's own (X13).
 */
export function demoStatusNote(status: SiteDemoState): string | null {
  if (status.mode !== 'on') return null;
  if (status.state === 'preparing') {
    return `The demo is being prepared with fresh data. It's usually ready in ${demoEtaPhrase(status.etaSec)}.`;
  }
  if (status.state === 'paused') return 'The demo is paused for maintenance. Please try again shortly.';
  return null;
}
