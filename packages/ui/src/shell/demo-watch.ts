'use client';

import {
  DEMO_COPY,
  DEMO_LOCAL_KEYS,
  DEMO_RESET_REASONS,
  demoEtaPhrase,
  demoResetNotice,
  type DemoResetReason,
  type DemoState,
} from '@itsm/contracts/demo';
import { createElement, type ReactNode } from 'react';
import { Banner } from '../feedback/Banner.js';
import {
  DEMO_GENERATION_CHANGE_EVENT,
  demoBarState,
  subscribeDemoBarState,
  updateDemoBarState,
  type DemoBarState,
  type DemoGenerationChangeDetail,
  type DemoNoticeSpec,
  type DemoPendingReset,
  type DemoStatusView,
  type ResetBlock,
} from './DemoBarControls.js';

/*
 * The demo bar's network half (A2 §9.4, §9.6; A3 §6.9): the status watch,
 * the reset request and the notice under the bars. Loaded when the browser
 * is idle in a demo session, or with the reset flow — never in a first load —
 * which is also why the shared demo copy (`@itsm/contracts/demo`) is read
 * here and not in the islands.
 *
 * Every request is to the page's own origin: the app's BFF routes
 * `/api/demo/status` and `/api/demo/reset` (A3 §6.4). The fetch is passed
 * in (the page's `fetch` by default) so the tests can answer it.
 */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const pageFetch: FetchLike = (input, init) => globalThis.fetch(input, init);

/** Polling while visible and nothing is happening (A2 §9.6). */
export const DEMO_POLL_MS = 60_000;
/** Polling while a reset runs, until the new generation is live. */
export const DEMO_POLL_BUILDING_MS = 5_000;
/** A tab away for longer than this asks again as soon as it is back. */
export const DEMO_RETURN_AFTER_MS = 60_000;
/** "Your fresh demo is ready — reloading…" stays this long before the reload (A2 §9.3). */
export const DEMO_RELOAD_DELAY_MS = 1_200;
/** The longest the notice waits for the application to clear the visit's local data. */
export const DEMO_CLEAR_TIMEOUT_MS = 3_000;
/** A reset this page started (or was told of) that no poll has seen after this long is forgotten. */
export const DEMO_PENDING_LIMIT_MS = 6 * 60_000;
/** A status read that has not answered by now is no answer: the next poll tries again. */
export const DEMO_STATUS_TIMEOUT_MS = 8_000;
/** The reset request's own limit; past it the confirm says it failed and can be tried again. */
export const DEMO_RESET_TIMEOUT_MS = 15_000;

/** An abort signal that fires after `ms`, where the browser has one (all current ones do). */
function deadline(ms: number): AbortSignal | undefined {
  return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(ms) : undefined;
}

const STATES: readonly DemoState[] = ['ready', 'building', 'preparing', 'paused'];

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const numberOrNull = (value: unknown): number | null | undefined => (value === null ? null : isNumber(value) ? value : undefined);

/**
 * The status body, checked field by field: the browser has no schema library
 * in its bundle (Y-B2), and a body that is not a status is no status — the
 * bar keeps what it had rather than acting on a guess.
 */
export function parseDemoStatus(body: unknown): DemoStatusView | null {
  if (typeof body !== 'object' || body === null) return null;
  const value = body as Record<string, unknown>;
  const state = value.state;
  if (typeof state !== 'string' || !(STATES as readonly string[]).includes(state)) return null;
  if (!isNumber(value.serverNow) || !isNumber(value.nextResetAt) || !isNumber(value.periodMs)) return null;
  const generation = numberOrNull(value.generation);
  const lastResetAt = numberOrNull(value.lastResetAt);
  const manualResetAvailableAt = numberOrNull(value.manualResetAvailableAt);
  if (generation === undefined || lastResetAt === undefined || manualResetAvailableAt === undefined) return null;
  const reason = value.lastResetReason;
  const lastResetReason =
    typeof reason === 'string' && (DEMO_RESET_REASONS as readonly string[]).includes(reason) ? (reason as DemoResetReason) : null;
  const rawBuild = value.build;
  const build =
    typeof rawBuild === 'object' && rawBuild !== null && isNumber((rawBuild as Record<string, unknown>).startedAt)
      ? {
          startedAt: (rawBuild as { startedAt: number }).startedAt,
          etaSec: isNumber((rawBuild as Record<string, unknown>).etaSec) ? (rawBuild as { etaSec: number }).etaSec : 0,
        }
      : null;
  return {
    state: state as DemoState,
    serverNow: value.serverNow,
    nextResetAt: value.nextResetAt,
    periodMs: value.periodMs,
    generation,
    lastResetAt,
    lastResetReason,
    build,
    manualResetAvailableAt,
    resetBlocked: value.resetBlocked === true,
    cooldownSeconds: isNumber(value.cooldownSeconds) ? value.cooldownSeconds : 1800,
  };
}

export interface DemoStatusRead {
  readonly status: DemoStatusView;
  /** The client clock halfway through the request, where the server's `serverNow` most likely fell. */
  readonly measuredAt: number;
  /** The round trip, ms: how far the skew measured from this read can be trusted. */
  readonly rtt: number;
}

/** `GET` the status; `null` for anything but a 200 with a status body. Never throws. */
export async function readDemoStatus(endpoint: string, fetcher: FetchLike = pageFetch): Promise<DemoStatusRead | null> {
  const started = Date.now();
  try {
    const signal = deadline(DEMO_STATUS_TIMEOUT_MS);
    const response = await fetcher(endpoint, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
      credentials: 'same-origin',
      ...(signal ? { signal } : {}),
    });
    const finished = Date.now();
    if (!response.ok) return null;
    const status = parseDemoStatus(await response.json());
    return status ? { status, measuredAt: (started + finished) / 2, rtt: finished - started } : null;
  } catch {
    return null;
  }
}

export type DemoResetOutcome =
  | { readonly kind: 'started'; readonly nextGeneration: number | null; readonly etaSec: number | null }
  | { readonly kind: 'running' }
  | { readonly kind: 'refused'; readonly retryAfterSec: number | null }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'failed' };

async function jsonOf(response: Response): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await response.json();
    return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * `POST /api/demo/reset` with `{ "confirm": "RESET" }` and what its answer
 * means for the bar (A2 §9.4, A3 §6.4): 202 started; 409 a reset is already
 * running; 429 the cooldown or the backoff; 403 and 404 no reset here (not a
 * demo session, or the demo is off); anything else, or no answer, failed.
 */
export async function requestDemoReset(endpoint: string, fetcher: FetchLike = pageFetch): Promise<DemoResetOutcome> {
  let response: Response;
  try {
    const signal = deadline(DEMO_RESET_TIMEOUT_MS);
    response = await fetcher(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ confirm: 'RESET' }),
      credentials: 'same-origin',
      cache: 'no-store',
      ...(signal ? { signal } : {}),
    });
  } catch {
    return { kind: 'failed' };
  }
  switch (response.status) {
    case 202: {
      const body = await jsonOf(response);
      return {
        kind: 'started',
        nextGeneration: isNumber(body.nextGeneration) ? body.nextGeneration : null,
        etaSec: isNumber(body.etaSec) ? body.etaSec : null,
      };
    }
    case 409:
      return { kind: 'running' };
    case 429: {
      const body = await jsonOf(response);
      const header = Number(response.headers.get('retry-after'));
      return { kind: 'refused', retryAfterSec: isNumber(body.retryAfterSec) ? body.retryAfterSec : Number.isFinite(header) && header > 0 ? header : null };
    }
    case 403:
    case 404:
      return { kind: 'unavailable' };
    default:
      return { kind: 'failed' };
  }
}

/** "about 2 minutes", or "a few minutes" without an estimate (`demoEtaPhrase`, X13). */
export function etaText(etaSec: number | null | undefined): string {
  return demoEtaPhrase(etaSec);
}

/**
 * Why a visitor cannot reset right now, if they cannot (A2 §9.3): a reset
 * is already running; the demo is paused or still being prepared; the
 * 30-minute cooldown after any reset (D12, D28); the worker's backoff after
 * a failed build.
 *
 * `now` is the server's clock (client clock + skew). The status is a
 * snapshot, so its own `resetBlocked` goes stale as the cooldown runs out;
 * the times decide whenever there are times.
 */
export function resetBlock(status: DemoStatusView | null, building: boolean, now: number): ResetBlock | null {
  if (building || status?.state === 'building') return { kind: 'running' };
  if (!status) return null;
  if (status.state === 'paused' || status.state === 'preparing') return { kind: 'paused' };
  const until = status.manualResetAvailableAt;
  if (until !== null) {
    if (until <= now) return null;
    const since = status.lastResetAt;
    const cooldownEnds = since === null ? null : since + status.cooldownSeconds * 1000;
    // The cooldown explains the wait only when it ends when the wait does; a later end is the backoff's.
    if (since !== null && cooldownEnds !== null && cooldownEnds > now && until <= cooldownEnds + 1000) {
      return { kind: 'cooldown', since, until };
    }
    return { kind: 'backoff', until };
  }
  return status.resetBlocked ? { kind: 'backoff', until: null } : null;
}

const serverNow = (): number => Date.now() + demoBarState().skewMs;

/** The bar's current `ResetBlock`, from the store. */
export function currentResetBlock(): ResetBlock | null {
  const state = demoBarState();
  return resetBlock(state.status, state.building !== null, serverNow());
}

/** The sentence for the bar's current state, or `null` when Reset is available (the details popover's button). */
export function currentResetReason(): string | null {
  const block = currentResetBlock();
  return block ? resetBlockText(block, serverNow()) : null;
}

let expiry: ReturnType<typeof setTimeout> | undefined;

/**
 * Writes `resetBlocked` to the store for the trigger's `aria-disabled`, and
 * sets a timer for the moment a cooldown or backoff runs out, so the button
 * stops saying it is unavailable without waiting for the next poll.
 */
export function syncResetBlocked(): ResetBlock | null {
  const block = currentResetBlock();
  if (expiry !== undefined) clearTimeout(expiry);
  expiry = undefined;
  const until = block && (block.kind === 'cooldown' || block.kind === 'backoff') ? block.until : null;
  if (until !== null) expiry = setTimeout(syncResetBlocked, Math.max(0, until - serverNow()) + 250);
  const blocked = block !== null && block.kind !== 'running';
  if (demoBarState().resetBlocked !== blocked) updateDemoBarState({ resetBlocked: blocked });
  return block;
}

/** The sentence for a `ResetBlock` (A2 §9.3; `DEMO_COPY`). `now` is the server's clock. */
export function resetBlockText(block: ResetBlock, now: number): string {
  switch (block.kind) {
    case 'running':
      return DEMO_COPY.resetRunning;
    case 'cooldown': {
      const minutesAgo = Math.max(0, Math.floor((now - block.since) / 60_000));
      const minutesLeft = Math.max(1, Math.ceil((block.until - now) / 60_000));
      return DEMO_COPY.resetCooldown(minutesAgo, minutesLeft);
    }
    default:
      return DEMO_COPY.resetBlocked;
  }
}

/* -------------------------------------------------------------------------
 * The browser's record of the generations it has seen
 * ---------------------------------------------------------------------- */

type GenerationStorage = Pick<Storage, 'getItem' | 'setItem'>;

function pageStorage(): GenerationStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    // Reading the property throws where storage is blocked.
    return null;
  }
}

function readNumber(storage: GenerationStorage | null, key: string): number | null {
  try {
    const raw = storage?.getItem(key);
    if (raw === null || raw === undefined) return null;
    const value = Number(raw);
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function writeNumber(storage: GenerationStorage | null, key: string, value: number): void {
  try {
    storage?.setItem(key, String(value));
  } catch {
    // A full or blocked storage: the worst case is the notice once more.
  }
}

/** Remembers that the visitor dismissed the notice about `generation`, so another tab does not show it again. */
export function rememberNoticeSeen(generation: number, storage: GenerationStorage | null = pageStorage()): void {
  writeNumber(storage, DEMO_LOCAL_KEYS.noticeSeen, generation);
}

/* -------------------------------------------------------------------------
 * The watch
 * ---------------------------------------------------------------------- */

export interface DemoWatchOptions {
  /** `/api/demo/status` on the page's own origin. */
  readonly endpoint: string;
  /** The generation the page was rendered with; `null` when the layout did not say. */
  readonly generation: number | null;
  /** Shows (or, with `null`, clears) the notice under the bars. */
  readonly onNotice: (notice: DemoNoticeSpec | null) => void;
  readonly fetch?: FetchLike;
  readonly storage?: GenerationStorage | null;
  readonly reload?: () => void;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Hands the new generation to the application (`DEMO_GENERATION_CHANGE_EVENT`)
 * and waits for the clearing it starts, a few seconds at most, then records
 * the generation. Recording last means a page closed half-way clears again
 * next time rather than never.
 */
export async function announceGenerationChange(generation: number, storage: GenerationStorage | null = pageStorage()): Promise<void> {
  const work: Promise<unknown>[] = [];
  const detail: DemoGenerationChangeDetail = {
    generation,
    waitUntil(promise) {
      work.push(Promise.resolve(promise).catch(() => undefined));
    },
  };
  try {
    window.dispatchEvent(new CustomEvent(DEMO_GENERATION_CHANGE_EVENT, { detail }));
  } catch {
    // A listener that throws must not stop the notice.
  }
  if (work.length > 0) await Promise.race([Promise.all(work), delay(DEMO_CLEAR_TIMEOUT_MS)]);
  writeNumber(storage, DEMO_LOCAL_KEYS.lastGeneration, generation);
}

/** Whether a pending reset is still worth waiting for, given the latest status. */
function pendingAlive(pending: DemoPendingReset | null, status: DemoStatusView, now: number): pending is DemoPendingReset {
  if (!pending) return false;
  if (now - pending.since > DEMO_PENDING_LIMIT_MS) return false;
  return pending.generation === null || status.generation === null || status.generation < pending.generation;
}

/**
 * What the bar knows after a status read: the status, the skew (only when
 * the client clock is measurably wrong — the read's own round trip is the
 * measurement's error), and whether a reset is running, from the status or
 * from a reset this page started that no build has picked up yet.
 */
export function noteDemoStatus(read: DemoStatusRead, now = Date.now()): DemoBarState {
  const { status } = read;
  const estimate = status.serverNow - read.measuredAt;
  const skewMs = Math.abs(estimate) <= read.rtt / 2 + 500 ? 0 : estimate;
  const before = demoBarState();
  const pending = pendingAlive(before.pending, status, now) ? before.pending : null;
  const building =
    status.state === 'building'
      ? { etaText: etaText(status.build?.etaSec) }
      : pending
        ? { etaText: etaText(pending.etaSec) }
        : null;
  updateDemoBarState({ status, skewMs, skewFrom: 'poll', building, pending });
  syncResetBlocked();
  return demoBarState();
}

/**
 * Starts polling `GET /api/demo/status` and handling generation changes
 * (A2 §9.3, A3 §6.9, X-M6); returns `stop`.
 *
 * - **Polls** at once, then every 60 s while the tab is visible and every 5 s
 *   while a reset runs; nothing while hidden; at once on return after more
 *   than a minute away.
 * - **First visit** (no generation stored in this browser): the page's
 *   generation is stored silently — no notice (X-M6).
 * - **`fresh`**: the browser last saw a lower generation than the page
 *   shows. The visit's local data is cleared (the generation-change event),
 *   then "Demo data was reset {when}. You're looking at the fresh data." [×].
 *   Without a status saying when, the clear still happens, silently.
 * - **`stale`**: a poll finds a newer generation than the page's. Cleared,
 *   then "… Reload to see the fresh data." [Reload] [×].
 * - **The visitor who pressed Reset**: "Your fresh demo is ready —
 *   reloading…", then a reload after 1.2 s.
 *
 * A dismissed notice is remembered by generation (`itsm-demo:notice-seen`).
 * Never a session-ended screen: the BFF re-mints on its own (D12).
 */
export function startDemoWatch(options: DemoWatchOptions): () => void {
  const fetcher = options.fetch ?? pageFetch;
  const storage = options.storage === undefined ? pageStorage() : options.storage;
  const reload = options.reload ?? (() => window.location.reload());
  const page = options.generation;

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight = false;
  let first = true;
  let lastPollAt = 0;
  let handled = page ?? 0;
  let scheduledFast = false;

  const seen = (generation: number): boolean => (readNumber(storage, DEMO_LOCAL_KEYS.noticeSeen) ?? 0) >= generation;
  const fast = (): boolean => {
    const state = demoBarState();
    return state.building !== null || state.pending !== null;
  };
  const hidden = (): boolean => typeof document !== 'undefined' && document.visibilityState === 'hidden';

  const schedule = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    if (stopped || hidden()) return;
    scheduledFast = fast();
    timer = setTimeout(() => void poll(), scheduledFast ? DEMO_POLL_BUILDING_MS : DEMO_POLL_MS);
  };

  /**
   * A newer generation than the page's is live. `pending` is the reset this
   * page knew of before the status that ended it was noted.
   */
  const newer = async (status: DemoStatusView, pending: DemoPendingReset | null): Promise<void> => {
    const generation = status.generation;
    if (generation === null || generation <= handled) return;
    handled = generation;
    await announceGenerationChange(generation, storage);
    if (stopped) return;
    if (pending?.mine && (pending.generation === null || generation >= pending.generation)) {
      updateDemoBarState({ pending: null, building: null });
      options.onNotice({ kind: 'ready', text: DEMO_COPY.resetReloading, generation });
      setTimeout(() => {
        if (!stopped) reload();
      }, DEMO_RELOAD_DELAY_MS);
      return;
    }
    if (pending && (pending.generation === null || generation >= pending.generation)) updateDemoBarState({ pending: null });
    if (status.state !== 'building') updateDemoBarState({ building: null });
    if (seen(generation)) return;
    options.onNotice({ kind: 'stale', text: demoResetNotice('stale', status.lastResetReason ?? 'scheduled'), generation });
  };

  /** The check made once, with the first status (or without one): has this browser seen this generation? */
  const firstCheck = async (status: DemoStatusView | null, pending: DemoPendingReset | null): Promise<void> => {
    if (page === null) return;
    if (status && status.generation !== null && status.generation > page) {
      await newer(status, pending);
      return;
    }
    const stored = readNumber(storage, DEMO_LOCAL_KEYS.lastGeneration);
    // X-M6: a first visit has no "before"; record the generation and say nothing.
    if (stored === null) {
      writeNumber(storage, DEMO_LOCAL_KEYS.lastGeneration, page);
      return;
    }
    if (stored >= page) return;
    await announceGenerationChange(page, storage);
    const reason = status && status.generation === page ? status.lastResetReason : null;
    if (stopped || reason === null || seen(page)) return;
    options.onNotice({ kind: 'fresh', text: demoResetNotice('fresh', reason), generation: page });
  };

  const poll = async (): Promise<void> => {
    if (stopped || inFlight) return;
    inFlight = true;
    lastPollAt = Date.now();
    const read = await readDemoStatus(options.endpoint, fetcher);
    inFlight = false;
    if (stopped) return;
    const pending = demoBarState().pending;
    if (read) noteDemoStatus(read);
    try {
      if (first) {
        first = false;
        await firstCheck(read?.status ?? null, pending);
      } else if (read) {
        await newer(read.status, pending);
      }
    } finally {
      schedule();
    }
  };

  const onVisibility = (): void => {
    if (hidden()) {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      return;
    }
    if (Date.now() - lastPollAt > DEMO_RETURN_AFTER_MS) void poll();
    else schedule();
  };

  const unsubscribe = subscribeDemoBarState(() => {
    if (stopped) return;
    // A reset that started or ended here changes whether Reset is available…
    syncResetBlocked();
    // …and one started from this page wants the 5-second pace at once, not after the next minute.
    if (!inFlight && fast() && !scheduledFast) schedule();
  });

  document.addEventListener('visibilitychange', onVisibility);
  void poll();

  return () => {
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
    if (expiry !== undefined) clearTimeout(expiry);
    expiry = undefined;
    unsubscribe();
    document.removeEventListener('visibilitychange', onVisibility);
  };
}

/* -------------------------------------------------------------------------
 * The notice
 * ---------------------------------------------------------------------- */

export interface DemoNoticeViewProps {
  readonly notice: DemoNoticeSpec;
  readonly onClose: () => void;
}

/**
 * The notice under the bars (A2 §9.3): an accent `Banner`, `role="status"`,
 * portalled by the controls into the frame's slot after `main`. `stale`
 * offers Reload; every notice but the resetter's own "reloading…" can be
 * dismissed, and a dismissal is remembered by generation.
 */
export function DemoNoticeView({ notice, onClose }: DemoNoticeViewProps): ReactNode {
  const dismiss =
    notice.kind === 'ready'
      ? undefined
      : (): void => {
          if (notice.generation !== undefined) rememberNoticeSeen(notice.generation);
          onClose();
        };
  return createElement(
    Banner,
    {
      tone: 'accent',
      live: 'polite',
      className: 'itsm-DemoNotice',
      'data-kind': notice.kind,
      ...(notice.kind === 'stale' ? { action: { id: 'reload', label: 'Reload', icon: 'refresh-cw' }, onAction: () => window.location.reload() } : {}),
      ...(dismiss ? { onDismiss: dismiss } : {}),
    } as Parameters<typeof Banner>[0],
    notice.text,
  );
}
