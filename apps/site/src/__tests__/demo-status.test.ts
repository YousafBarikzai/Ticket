import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { DEMO_RESET, computeDemoStatus, nextResetAt, periodMs, type DemoStatus } from '@itsm/contracts/demo';
import type { SiteConfig } from '../server/config.js';

vi.mock('server-only', () => ({}));

/**
 * The site's read of the public demo status (SPEC v3 §6.1; A5 §3.7, §13.1).
 *
 * The landing page and the chooser render per request, so this read is on
 * every visitor's path. What is pinned here is that it costs the API at most
 * one request per ten seconds, that no failure of any kind reaches the page
 * as anything but `unknown`, and that the countdown is right either way.
 *
 * Each test imports a fresh copy of the module, because the memo lives in
 * module scope exactly as it does in the server process.
 */

type Module = typeof import('../server/demo-status.js');

async function load(): Promise<Module> {
  vi.resetModules();
  return import('../server/demo-status.js');
}

const T0 = Date.UTC(2026, 9, 3, 12, 0, 0);

const CONFIG: SiteConfig = Object.freeze({ origins: {}, apiBaseUrl: 'https://api.example.com', demo: true, indexable: false });

/** A real status body as the API computes it, with the fields a test cares about replaced. */
function status(overrides: Partial<DemoStatus> = {}): DemoStatus {
  return { ...computeDemoStatus({ live: null, build: null, cooldown: null, paused: false, backoff: null }, T0), ...overrides };
}

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init });
}

/** A fetch that answers each call with the next response (or throws the next error). */
function fetchReturning(...answers: (Response | Error | (() => Promise<Response>))[]) {
  const queue = [...answers];
  return vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
    const next = queue.length > 1 ? queue.shift()! : queue[0]!;
    if (next instanceof Error) throw next;
    if (typeof next === 'function') return next();
    return next.clone();
  });
}

let warn: MockInstance;

beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  warn.mockRestore();
});

describe('DEMO_MODE off', () => {
  it('answers off and reads nothing', async () => {
    const { getDemoStatus } = await load();
    const doFetch = fetchReturning(json(status({ state: 'ready' })));
    expect(await getDemoStatus({ ...CONFIG, demo: false }, T0, doFetch)).toEqual({ mode: 'off' });
    expect(doFetch).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('the read', () => {
  it('asks the API’s public status route once, uncached, for JSON, with a deadline', async () => {
    const { getDemoStatus } = await load();
    const doFetch = fetchReturning(json(status({ state: 'ready' })));
    await getDemoStatus(CONFIG, T0, doFetch);
    expect(doFetch).toHaveBeenCalledTimes(1);
    const [url, init] = doFetch.mock.calls[0]!;
    expect(url).toBe('https://api.example.com/api/demo/v1/status');
    expect(init?.cache).toBe('no-store');
    expect(new Headers(init?.headers).get('accept')).toBe('application/json');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init?.method ?? 'GET').toBe('GET');
    expect(init?.body).toBeUndefined();
  });

  it('makes one read per ten seconds, however many pages render', async () => {
    const { DEMO_STATUS_MEMO_MS, getDemoStatus } = await load();
    expect(DEMO_STATUS_MEMO_MS).toBe(10_000);
    const doFetch = fetchReturning(json(status({ state: 'ready' })), json(status({ state: 'paused' })));
    expect(await getDemoStatus(CONFIG, T0, doFetch)).toMatchObject({ state: 'ready' });
    expect(await getDemoStatus(CONFIG, T0 + 5_000, doFetch)).toMatchObject({ state: 'ready' });
    expect(await getDemoStatus(CONFIG, T0 + 9_999, doFetch)).toMatchObject({ state: 'ready' });
    expect(doFetch).toHaveBeenCalledTimes(1);
    expect(await getDemoStatus(CONFIG, T0 + 10_000, doFetch)).toMatchObject({ state: 'paused' });
    expect(doFetch).toHaveBeenCalledTimes(2);
  });

  it('lets renders that arrive during a read share it (single-flight)', async () => {
    const { getDemoStatus } = await load();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const doFetch = fetchReturning(async () => {
      await gate;
      return json(status({ state: 'building', build: { startedAt: T0 - 60_000, etaSec: 200 } }));
    });
    const renders = Promise.all([getDemoStatus(CONFIG, T0, doFetch), getDemoStatus(CONFIG, T0 + 1, doFetch), getDemoStatus(CONFIG, T0 + 2, doFetch)]);
    release();
    const answers = await renders;
    expect(doFetch).toHaveBeenCalledTimes(1);
    for (const answer of answers) expect(answer).toMatchObject({ mode: 'on', state: 'building', etaSec: 200 });
  });

  it('reads again when the API base URL changes', async () => {
    const { getDemoStatus } = await load();
    const doFetch = fetchReturning(json(status({ state: 'ready' })));
    await getDemoStatus(CONFIG, T0, doFetch);
    await getDemoStatus({ ...CONFIG, apiBaseUrl: 'https://api2.example.com' }, T0 + 1, doFetch);
    expect(doFetch).toHaveBeenCalledTimes(2);
    expect(doFetch.mock.calls[1]![0]).toBe('https://api2.example.com/api/demo/v1/status');
  });
});

describe('the states', () => {
  it.each(['ready', 'building', 'preparing', 'paused'] as const)('passes %s through', async (state) => {
    const { getDemoStatus } = await load();
    const answer = await getDemoStatus(CONFIG, T0, fetchReturning(json(status({ state }))));
    expect(answer).toMatchObject({ mode: 'on', state, etaSec: null });
  });

  it('carries a running build’s estimate for the ETA phrase', async () => {
    const { getDemoStatus } = await load();
    const body = status({ state: 'building', build: { startedAt: T0 - 30_000, etaSec: 200 } });
    expect(await getDemoStatus(CONFIG, T0, fetchReturning(json(body)))).toMatchObject({ state: 'building', etaSec: 200 });
  });
});

describe('every failure is unknown, with the pure clock', () => {
  const pureClock = (now: number) => ({
    serverNow: now,
    nextResetAt: nextResetAt(now),
    periodMs: periodMs(now),
    resetLabel: DEMO_RESET.label,
    timeZone: DEMO_RESET.timeZone,
  });

  it.each([
    ['a 500', () => json({ type: 'about:blank' }, { status: 500 }), 'http 500'],
    ['a 503 from a misconfigured demo', () => json({ reason: 'misconfigured' }, { status: 503 }), 'http 503'],
    ['a 404 (the API has the demo off)', () => json({}, { status: 404 }), 'http 404'],
    ['a network error', () => new TypeError('fetch failed'), 'network'],
    ['a body that is not JSON', () => new Response('<html>gateway</html>', { status: 200 }), 'body'],
    ['a body from another version', () => json({ ...status(), v: 2 }), 'body'],
    ['a body with a field it does not know', () => json({ ...status(), tenantId: 'x' }), 'body'],
    ['a body far larger than any status', () => json({ ...status(), pad: 'x'.repeat(20_000) }), 'body'],
  ])('%s', async (_case, answer, logged) => {
    const { getDemoStatus } = await load();
    const result = await getDemoStatus(CONFIG, T0, fetchReturning(answer()));
    expect(result).toEqual({ mode: 'on', state: 'unknown', etaSec: null, clock: pureClock(T0) });
    expect(warn).toHaveBeenCalledWith(`[site] demo status unavailable: ${logged}`);
  });

  it('a read that takes longer than 1.5 s', async () => {
    const { DEMO_STATUS_TIMEOUT_MS, getDemoStatus } = await load();
    expect(DEMO_STATUS_TIMEOUT_MS).toBe(1_500);
    let aborted: unknown;
    // Answers only when the deadline aborts the request, as a hung API would.
    const doFetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            aborted = init.signal?.reason;
            reject(init.signal?.reason);
          });
        }),
    );
    const started = performance.now();
    const result = await getDemoStatus(CONFIG, T0, doFetch);
    const waited = performance.now() - started;
    expect(result).toEqual({ mode: 'on', state: 'unknown', etaSec: null, clock: pureClock(T0) });
    expect((aborted as Error).name).toBe('TimeoutError');
    expect(waited).toBeGreaterThanOrEqual(1_400);
    expect(waited).toBeLessThan(5_000);
    expect(warn).toHaveBeenCalledWith('[site] demo status unavailable: timeout');
  });

  it('no API base URL at all (production with API_BASE_URL unset), without a read', async () => {
    const { getDemoStatus } = await load();
    const doFetch = fetchReturning(json(status()));
    expect(await getDemoStatus({ ...CONFIG, apiBaseUrl: null }, T0, doFetch)).toMatchObject({ state: 'unknown', clock: pureClock(T0) });
    expect(doFetch).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('[site] demo status unavailable: unconfigured');
  });

  it('remembers a failure for the same ten seconds, so a down API is asked six times a minute', async () => {
    const { getDemoStatus } = await load();
    const doFetch = fetchReturning(json({}, { status: 502 }), json(status({ state: 'ready' })));
    expect(await getDemoStatus(CONFIG, T0, doFetch)).toMatchObject({ state: 'unknown' });
    expect(await getDemoStatus(CONFIG, T0 + 9_000, doFetch)).toMatchObject({ state: 'unknown' });
    expect(doFetch).toHaveBeenCalledTimes(1);
    expect(await getDemoStatus(CONFIG, T0 + 10_000, doFetch)).toMatchObject({ state: 'ready' });
  });

  it('logs each kind of failure once per ten minutes, without the URL', async () => {
    const { getDemoStatus } = await load();
    const doFetch = fetchReturning(json({}, { status: 500 }));
    for (let minute = 0; minute < 12; minute++) await getDemoStatus(CONFIG, T0 + minute * 60_000, doFetch);
    expect(doFetch).toHaveBeenCalledTimes(12);
    expect(warn.mock.calls.map(([line]) => line)).toEqual(['[site] demo status unavailable: http 500', '[site] demo status unavailable: http 500']);
    for (const [line] of warn.mock.calls) expect(String(line)).not.toContain('example.com');
  });
});

describe('the clock', () => {
  it('is computed for each render, so a remembered status never freezes the countdown', async () => {
    const { getDemoStatus } = await load();
    const doFetch = fetchReturning(json(status({ state: 'ready' })));
    const first = await getDemoStatus(CONFIG, T0, doFetch);
    const later = await getDemoStatus(CONFIG, T0 + 8_000, doFetch);
    expect(doFetch).toHaveBeenCalledTimes(1);
    expect(first.mode === 'on' && first.clock.serverNow).toBe(T0);
    expect(later.mode === 'on' && later.clock.serverNow).toBe(T0 + 8_000);
    expect(later.mode === 'on' && later.clock.nextResetAt).toBe(nextResetAt(T0 + 8_000));
  });

  it('agrees with what the API itself would say', async () => {
    const { getDemoStatus } = await load();
    const api = status({ state: 'ready' });
    const answer = await getDemoStatus(CONFIG, T0, fetchReturning(json(api)));
    expect(answer.mode === 'on' && answer.clock).toEqual({
      serverNow: api.serverNow,
      nextResetAt: api.nextResetAt,
      periodMs: api.periodMs,
      resetLabel: api.resetLabel,
      timeZone: api.resetTimeZone,
    });
  });

  it('counts the 25-hour day when the clocks go back', async () => {
    const { getDemoStatus } = await load();
    const saturday = Date.UTC(2026, 9, 24, 12, 0, 0);
    const answer = await getDemoStatus({ ...CONFIG, apiBaseUrl: null }, saturday);
    expect(answer.mode === 'on' && answer.clock.periodMs).toBe(24 * 3_600_000);
    const sunday = Date.UTC(2026, 9, 25, 12, 0, 0);
    const next = await getDemoStatus({ ...CONFIG, apiBaseUrl: null }, sunday);
    expect(next.mode === 'on' && next.clock.periodMs).toBe(25 * 3_600_000);
  });
});

describe('demoStatusNote', () => {
  const clock = { serverNow: T0, nextResetAt: nextResetAt(T0), periodMs: periodMs(T0), resetLabel: DEMO_RESET.label, timeZone: DEMO_RESET.timeZone };

  it('words the preparing note with the shared ETA phrase', async () => {
    const { demoStatusNote } = await load();
    expect(demoStatusNote({ mode: 'on', state: 'preparing', etaSec: null, clock })).toBe(
      "The demo is being prepared with fresh data. It's usually ready in a few minutes.",
    );
    expect(demoStatusNote({ mode: 'on', state: 'preparing', etaSec: 200, clock })).toBe(
      "The demo is being prepared with fresh data. It's usually ready in about 4 minutes.",
    );
  });

  it('words the paused note', async () => {
    const { demoStatusNote } = await load();
    expect(demoStatusNote({ mode: 'on', state: 'paused', etaSec: null, clock })).toBe('The demo is paused for maintenance. Please try again shortly.');
  });

  it('says nothing when the demo is usable, unknown or off', async () => {
    const { demoStatusNote } = await load();
    for (const state of ['ready', 'building', 'unknown'] as const) expect(demoStatusNote({ mode: 'on', state, etaSec: 200, clock }), state).toBeNull();
    expect(demoStatusNote({ mode: 'off' })).toBeNull();
  });
});
