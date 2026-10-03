// @vitest-environment jsdom
import type { AreaModel } from '@itsm/contracts/areas';
import { computeDemoStatus, DEMO_COPY, DEMO_LOCAL_KEYS, type DemoLiveRecord, type DemoStatus } from '@itsm/contracts/demo';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { announcerText, destroyAnnouncer } from '../../a11y/announcer.js';
import { unknownVariables } from '../../styles/css.js';
import { expectNoViolations } from '../../web/__tests__/support/audit.js';
import { activeElement, cleanupDocument, click, focus, press, render, settle } from '../../web/__tests__/support/render.js';
import {
  DEMO_BAR_LABEL,
  DEMO_BAR_PAUSED,
  DEMO_BAR_PREPARING,
  DEMO_BAR_RESETTING,
  DEMO_BAR_SIGN_OUT_FORM_ID,
  DemoBar,
  type DemoBarProps,
} from '../DemoBar.js';
import { demoBarStyles } from '../DemoBar.styles.js';
import {
  DEMO_BAR_EVENTS,
  DEMO_GENERATION_CHANGE_EVENT,
  DEMO_NOTICE_HOST_ID,
  demoBarState,
  onDemoGenerationChange,
  resetDemoBarStateForTesting,
  updateDemoBarState,
  type DemoNoticeSpec,
} from '../DemoBarControls.js';
import { crossedAnnouncement, formatCountdown, spokenCountdown, type DemoClock } from '../DemoCountdown.js';
import { lastResetLine, resetWhen } from '../DemoDetailsPopover.js';
import { DEMO_RESET_CONFIRM } from '../DemoResetDialog.js';
import {
  DEMO_POLL_BUILDING_MS,
  DEMO_POLL_MS,
  DEMO_RELOAD_DELAY_MS,
  noteDemoStatus,
  parseDemoStatus,
  readDemoStatus,
  requestDemoReset,
  resetBlock,
  resetBlockText,
  startDemoWatch,
  syncResetBlocked,
  type FetchLike,
} from '../demo-watch.js';
import { SIGN_OUT_FORM_ID, SYSTEM_NOTICE_ID } from '../frame.js';
import { systemBarStyles } from '../SystemBar.styles.js';
import { DEMO_DETAILS_REQUEST_EVENT, DEMO_RESET_REQUEST_EVENT } from '../UserMenu.js';
import { demoAreas } from './support.js';

vi.mock('../../web/IconButtonTooltip.js', () => ({ IconButtonTooltip: () => null }));

/*
 * The demo bar (v3 §3.8, A2 §9, A2 §15.1 `demo-bar` rows, X-M6): the server
 * markup, the countdown island, the reset flow against a mocked fetch, the
 * details popover, the status watch and its notices, End demo, the
 * stylesheet's phone rules, the module boundaries that keep the bar's weight
 * out of first loads, and axe on the navy surface.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 13:58:22 UTC on 2 Oct 2026 = 14:58:22 in London; the reset is 00:00 BST on Sat 3 Oct (23:00 UTC). */
const SERVER_NOW = Date.UTC(2026, 9, 2, 13, 58, 22);
const NEXT_RESET = Date.UTC(2026, 9, 2, 23, 0, 0);
const LAST_RESET = Date.UTC(2026, 9, 1, 23, 0, 0);

const clock: DemoClock = {
  nextResetAt: NEXT_RESET,
  serverNow: SERVER_NOW,
  periodMs: 24 * 60 * 60 * 1000,
  resetLabel: '00:00 UK time',
  timeZone: 'Europe/London',
};

const alex = { name: 'Alex Morgan', title: 'Service Desk team lead' };

function live(generation: number, reason: DemoLiveRecord['lastResetReason'] = 'scheduled', lastResetAt = LAST_RESET): DemoLiveRecord {
  return {
    v: 1,
    tenantId: `00000000-0000-4000-8000-00000000000${generation}`,
    slug: 'demo',
    generation,
    builtAt: lastResetAt,
    anchor: lastResetAt,
    lastResetAt,
    lastResetReason: reason,
    personas: { employee: { userId: 'u-e' }, agent: { userId: 'u-a' }, admin: { userId: 'u-j' } },
    agentTeamIds: ['t-sd'],
  };
}

/** A status as the BFF returns it, computed by the contract's own function. */
function statusAt(now: number, records: Partial<Parameters<typeof computeDemoStatus>[0]> = {}): DemoStatus {
  return computeDemoStatus({ live: live(5), build: null, cooldown: null, paused: false, backoff: null, ...records }, now);
}

interface Answer {
  readonly status: number;
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
}

/** Stubs the page's `fetch`; every call is recorded with its method and body. */
function stubFetch(answer: (url: string, init?: RequestInit) => Answer | Promise<Answer>) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
    const { status, body, headers } = await answer(url, init);
    return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
  });
  vi.stubGlobal('fetch', fn);
  return { fn, calls };
}

const q = <T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T | null => root.querySelector<T>(selector);
const text = (element: Element | null | undefined): string => element?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

function serverMarkup(element: ReactElement): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = renderToStaticMarkup(element);
  return host.firstElementChild as HTMLElement;
}

function sessionProps(overrides: Partial<DemoBarProps> = {}): DemoBarProps {
  return { variant: 'session', clock, persona: alex, generation: 5, areas: demoAreas('workbench'), ...overrides };
}

/** The bar as a framed page has it: the bar, `main`, the notice slot and the frame's sign-out form. */
function page(bar: ReactElement): ReactElement {
  return (
    <div>
      {bar}
      <main>
        <h1>Overview</h1>
      </main>
      <div id={DEMO_NOTICE_HOST_ID} />
      <form id={DEMO_BAR_SIGN_OUT_FORM_ID} method="post" action="/api/session/logout" hidden />
    </div>
  );
}

/** axe, inside `act`: the countdown keeps ticking while it reads the page. */
async function audit(): Promise<void> {
  await act(async () => {
    await expectNoViolations(document.body);
  });
}

/** Lets lazy modules arrive and the promises and timers behind them run. */
async function flush(rounds = 4): Promise<void> {
  for (let round = 0; round < rounds; round += 1) {
    await act(async () => {
      await vi.dynamicImportSettled();
    });
    await settle();
  }
}

const bar = (): HTMLElement => q('.itsm-SystemBar')!;
const resetButton = (): HTMLButtonElement | null => q<HTMLButtonElement>('.itsm-DemoBar__reset');
const infoButton = (): HTMLButtonElement => q<HTMLButtonElement>('.itsm-DemoBar__info')!;
const dialogButton = (label: string): HTMLButtonElement | undefined =>
  [...document.querySelectorAll<HTMLButtonElement>('.itsm-ConfirmDialog button')].find((button) => button.textContent?.includes(label));

class MemoryStorage {
  readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

beforeEach(() => {
  // jsdom has no idle callback; the bar's watch waits for one.
  vi.stubGlobal('requestIdleCallback', (run: IdleRequestCallback) => window.setTimeout(() => run({ didTimeout: false, timeRemaining: () => 50 }), 0));
  vi.stubGlobal('cancelIdleCallback', (handle: number) => window.clearTimeout(handle));
  localStorage.clear();
});

afterEach(() => {
  cleanupDocument();
  resetDemoBarStateForTesting();
  destroyAnnouncer();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute('data-itsm-theme');
  localStorage.clear();
});

/* ------------------------------------------------------------------------- */

describe('DemoBar on the server', () => {
  it('is server-safe and composes the system bar: one region named "Demo environment" on the navy surface', () => {
    expect(readFileSync(join(SRC, 'shell/DemoBar.tsx'), 'utf8').trimStart().startsWith("'use client'")).toBe(false);
    const root = serverMarkup(<DemoBar {...sessionProps()} />);
    expect(root.getAttribute('role')).toBe('region');
    expect(root.getAttribute('aria-label')).toBe('Demo environment');
    expect(DEMO_BAR_LABEL).toBe('Demo environment');
    expect(root.classList.contains('itsm-SystemBar')).toBe(true);
    expect(root.classList.contains('itsm-DemoBar')).toBe(true);
    expect(root.dataset.surface).toBe('hero');
    expect(root.dataset.variant).toBe('session');
    expect(root.dataset.state).toBe('default');
    // One surface: no second system bar inside it.
    expect(root.querySelectorAll('.itsm-SystemBar')).toHaveLength(0);
    expect(text(root.querySelector('.itsm-SystemBar__badge'))).toBe('Demo');
    expect(root.querySelector('.itsm-SystemBar__badge')?.hasAttribute('data-live')).toBe(true);
  });

  it('renders the countdown from the server clock: a timer, not live, named in words, HH:MM:SS', () => {
    const root = serverMarkup(<DemoBar {...sessionProps()} />);
    const timer = root.querySelector('[role="timer"]')!;
    expect(timer.getAttribute('aria-live')).toBe('off');
    expect(timer.getAttribute('aria-label')).toBe('Demo data resets in 9 hours 1 minute');
    expect(text(timer)).toBe('Resets in 09:01:38');
    expect(timer.querySelector('time')?.getAttribute('datetime')).toBe(new Date(NEXT_RESET).toISOString());
    expect(timer.closest('.itsm-SystemBar__status')).not.toBeNull();
  });

  it('says what the demo is and who the visitor is, with Demo details, Reset demo data and End demo', () => {
    const root = serverMarkup(<DemoBar {...sessionProps()} />);
    expect(text(root.querySelector('.itsm-SystemBar__message'))).toBe('Demo data resets every day at 00:00 UK time.');
    expect(text(root.querySelector('.itsm-SystemBar__persona'))).toBe("You're Alex Morgan · Service Desk team lead");
    expect(text(root.querySelector('.itsm-SystemBar__persona strong'))).toBe('Alex Morgan');
    expect(text(root.querySelector('.itsm-SystemBar__note'))).toBe(DEMO_COPY.sharedData);

    const actions = [...root.querySelectorAll<HTMLButtonElement>('.itsm-SystemBar__actions button')];
    expect(actions.map((button) => button.getAttribute('aria-label') ?? text(button))).toEqual(['Demo details', 'Reset demo data', 'End demo']);
    expect(actions[0]!.getAttribute('aria-haspopup')).toBe('dialog');
    expect(actions[1]!.getAttribute('aria-haspopup')).toBe('dialog');
    for (const button of actions) expect(button.classList.contains('itsm-SystemBar__action')).toBe(true);

    const end = actions[2]!;
    expect(end.getAttribute('type')).toBe('submit');
    expect(end.getAttribute('form')).toBe('itsm-signout');
    expect(end.classList.contains('itsm-DemoBar__end')).toBe(true);
  });

  it('submits a named sign-out form when the frame uses another id', () => {
    const root = serverMarkup(<DemoBar {...sessionProps({ signOutFormId: 'desk-signout' })} />);
    expect(root.querySelector('.itsm-DemoBar__end')?.getAttribute('form')).toBe('desk-signout');
  });

  it('puts nothing with a status role before main: only the countdown’s own polite region, which has no role', () => {
    const root = serverMarkup(<DemoBar {...sessionProps()} />);
    expect(root.querySelector('[role="status"], [role="alert"]')).toBeNull();
    const live = [...root.querySelectorAll('[aria-live="polite"]')];
    expect(live).toHaveLength(1);
    expect(live[0]!.hasAttribute('role')).toBe(false);
    expect(live[0]!.classList.contains('itsm-visually-hidden')).toBe(true);
  });

  it('has the busy line ready in the markup: "Resetting now…", the start of DEMO_COPY.resettingNow', () => {
    const root = serverMarkup(<DemoBar {...sessionProps()} />);
    expect(text(root.querySelector('.itsm-SystemBar__busy'))).toBe('Resetting now…');
    expect(DEMO_COPY.resettingNow(120).startsWith(DEMO_BAR_RESETTING)).toBe(true);
  });

  it('public variant: badge, countdown, the one sentence and Demo details, centred — no persona, Reset or End demo', () => {
    const root = serverMarkup(<DemoBar variant="public" clock={clock} />);
    expect(root.dataset.variant).toBe('public');
    expect(root.dataset.align).toBe('center');
    expect(root.querySelector('[role="timer"]')).not.toBeNull();
    expect(text(root.querySelector('.itsm-SystemBar__message'))).toBe('Demo data resets every day at 00:00 UK time.');
    expect(root.querySelector('.itsm-SystemBar__persona')).toBeNull();
    expect(root.querySelector('.itsm-SystemBar__note')).toBeNull();
    expect(root.querySelector('.itsm-DemoBar__reset')).toBeNull();
    expect(root.querySelector('.itsm-DemoBar__end, [type="submit"]')).toBeNull();
    expect([...root.querySelectorAll('button')].map((button) => button.getAttribute('aria-label'))).toEqual(['Demo details']);
    expect(text(root)).not.toContain('Alex Morgan');
  });

  it('public variant states: "Preparing the demo…", "Resetting now…" and "Paused" in place of the countdown', () => {
    const preparing = serverMarkup(<DemoBar variant="public" clock={clock} state="preparing" />);
    expect(preparing.dataset.state).toBe('busy');
    expect(text(preparing.querySelector('.itsm-SystemBar__busy'))).toBe('Preparing the demo…');
    expect(DEMO_BAR_PREPARING).toBe('Preparing the demo…');
    expect(preparing.querySelector('[role="timer"]')).toBeNull();

    const building = serverMarkup(<DemoBar variant="public" clock={clock} state="building" />);
    expect(building.dataset.state).toBe('busy');
    expect(text(building.querySelector('.itsm-SystemBar__busy'))).toBe('Resetting now…');

    const paused = serverMarkup(<DemoBar variant="public" clock={clock} state="paused" />);
    expect(paused.dataset.state).toBe('default');
    expect(text(paused.querySelector('.itsm-SystemBar__status'))).toBe('Paused');
    expect(DEMO_BAR_PAUSED).toBe('Paused');
    expect(paused.querySelector('[role="timer"]')).toBeNull();

    const ready = serverMarkup(<DemoBar variant="public" clock={clock} state="ready" />);
    expect(ready.dataset.state).toBe('default');
    expect(ready.querySelector('[role="timer"]')).not.toBeNull();
  });

  it('leaves a session’s state to its polls, whatever was seeded', () => {
    const root = serverMarkup(<DemoBar {...sessionProps({ state: 'paused' })} />);
    expect(root.dataset.state).toBe('default');
    expect(root.querySelector('[role="timer"]')).not.toBeNull();
  });
});

/* ------------------------------------------------------------------------- */

describe('the clock words', () => {
  it('formats HH:MM:SS, rounding seconds down, past 24 hours on the long day, never negative', () => {
    expect(formatCountdown(9 * 3600_000 + 60_000 + 38_999)).toBe('09:01:38');
    expect(formatCountdown(59_999)).toBe('00:00:59');
    expect(formatCountdown(25 * 3600_000)).toBe('25:00:00');
    expect(formatCountdown(0)).toBe('00:00:00');
    expect(formatCountdown(-5_000)).toBe('00:00:00');
  });

  it('says the time left in words for the timer’s name', () => {
    expect(spokenCountdown(9 * 3600_000 + 60_000 + 38_000)).toBe('9 hours 1 minute');
    expect(spokenCountdown(3600_000)).toBe('1 hour');
    expect(spokenCountdown(2 * 3600_000 + 5 * 60_000)).toBe('2 hours 5 minutes');
    expect(spokenCountdown(42 * 60_000 + 10_000)).toBe('42 minutes');
    expect(spokenCountdown(60_000)).toBe('1 minute');
    expect(spokenCountdown(59_000)).toBe('less than a minute');
  });

  it('announces only on crossing 10, 5 and 1 minutes, the latest one crossed, never on the first reading', () => {
    expect(crossedAnnouncement(null, 9 * 60_000)).toBeNull();
    expect(crossedAnnouncement(10 * 60_000 + 1_000, 10 * 60_000)).toBe(10);
    expect(crossedAnnouncement(5 * 60_000 + 500, 4 * 60_000 + 59_000)).toBe(5);
    expect(crossedAnnouncement(61_000, 60_000)).toBe(1);
    expect(crossedAnnouncement(12 * 60_000, 3 * 60_000)).toBe(5);
    expect(crossedAnnouncement(9 * 60_000, 8 * 60_000)).toBeNull();
    expect(crossedAnnouncement(30_000, 0)).toBeNull();
  });
});

/* ------------------------------------------------------------------------- */

describe('DemoCountdown, running', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: SERVER_NOW, toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  });

  const tick = (ms: number): void => {
    act(() => {
      vi.advanceTimersByTime(ms);
    });
  };
  const timer = (): HTMLElement => q('[role="timer"]')!;
  const shown = (): string => text(timer().querySelector('time'));

  it('ticks once a second and renames the timer only when the minute changes', () => {
    render(<DemoBar variant="public" clock={clock} />);
    expect(shown()).toBe('09:01:38');
    // A few milliseconds after each whole second, once the shown second has changed.
    tick(4);
    expect(shown()).toBe('09:01:38');
    tick(1);
    expect(shown()).toBe('09:01:37');
    tick(1000);
    expect(shown()).toBe('09:01:36');
    expect(timer().getAttribute('aria-label')).toBe('Demo data resets in 9 hours 1 minute');
    tick(36_000);
    expect(shown()).toBe('09:01:00');
    tick(1000);
    expect(shown()).toBe('09:00:59');
    expect(timer().getAttribute('aria-label')).toBe('Demo data resets in 9 hours');
  });

  it('turns amber under ten minutes and says so at 10, 5 and 1 minutes; "Resetting in" in the last minute', () => {
    const near: DemoClock = { ...clock, serverNow: NEXT_RESET - 10 * 60_000 - 2_000 };
    vi.setSystemTime(near.serverNow);
    render(<DemoBar variant="public" clock={near} />);
    const announcer = (): string => text(q('.itsm-DemoCountdown')!.parentElement!.querySelector('[aria-live="polite"]'));
    expect(bar().dataset.state).toBe('default');
    expect(announcer()).toBe('');
    tick(2_005);
    expect(bar().dataset.state).toBe('warning');
    expect(announcer()).toBe('Demo data resets in 10 minutes');
    tick(5 * 60_000);
    expect(announcer()).toBe('Demo data resets in 5 minutes');
    tick(4 * 60_000 - 1_000);
    expect(shown()).toBe('00:01:00');
    expect(text(q('.itsm-DemoCountdown__lead'))).toBe('Resets in');
    tick(1_000);
    expect(announcer()).toBe('Demo data resets in 1 minute');
    expect(text(q('.itsm-DemoCountdown__lead'))).toBe('Resetting in');
    expect(shown()).toBe('00:00:59');
    expect(timer().getAttribute('aria-label')).toBe('Demo data resets in less than a minute');
  });

  it('stops while the tab is hidden and catches up when it is back', () => {
    let visibility: DocumentVisibilityState = 'visible';
    const spy = vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
    render(<DemoBar variant="public" clock={clock} />);
    tick(1_005);
    expect(shown()).toBe('09:01:36');
    visibility = 'hidden';
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(vi.getTimerCount()).toBe(0);
    vi.setSystemTime(Date.now() + 3600_000);
    visibility = 'visible';
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(shown()).toBe('08:01:36');
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    spy.mockRestore();
  });

  it('counts on the server’s clock when the client’s is plainly wrong, and takes a poll’s measurement over it', () => {
    vi.setSystemTime(SERVER_NOW + 2 * 3600_000);
    render(<DemoBar variant="public" clock={clock} />);
    tick(1_005);
    // Two hours fast: the render's serverNow wins, so the countdown is the server's.
    expect(shown()).toBe('09:01:36');
    expect(demoBarState().skewFrom).toBe('render');
    act(() => {
      updateDemoBarState({ skewMs: 0, skewFrom: 'poll' });
    });
    expect(shown()).toBe('07:01:36');
  });

  it('trusts a client clock within a hydration delay of the server’s', () => {
    vi.setSystemTime(SERVER_NOW + 2_000);
    render(<DemoBar variant="public" clock={clock} />);
    expect(demoBarState().skewMs).toBe(0);
    expect(shown()).toBe('09:01:36');
  });

  it('rolls over to the next reset from the pure UK clock once this one has passed', async () => {
    const last: DemoClock = { ...clock, serverNow: NEXT_RESET - 2_000 };
    vi.setSystemTime(last.serverNow);
    render(<DemoBar variant="public" clock={last} />);
    expect(shown()).toBe('00:00:02');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    await act(async () => {
      await vi.dynamicImportSettled();
      await vi.advanceTimersByTimeAsync(1_000);
    });
    // Sat 3 Oct 00:00 BST → Sun 4 Oct 00:00 BST: 24 hours.
    expect(shown()).toBe('23:59:58');
    expect(timer().querySelector('time')?.getAttribute('datetime')).toBe(new Date(Date.UTC(2026, 9, 3, 23, 0, 0)).toISOString());
  });

  it('takes a later reset from a re-rendered layout, and never steps back to an earlier one', () => {
    const view = render(<DemoBar variant="public" clock={clock} />);
    expect(shown()).toBe('09:01:38');
    view.rerender(<DemoBar variant="public" clock={{ ...clock, nextResetAt: NEXT_RESET + 24 * 3600_000 }} />);
    expect(shown()).toBe('33:01:38');
    view.rerender(<DemoBar variant="public" clock={clock} />);
    expect(shown()).toBe('33:01:38');
  });

  it('shows the busy state while a reset runs, with the estimate after "Resetting now…"', () => {
    render(<DemoBar {...sessionProps()} />);
    act(() => {
      updateDemoBarState({ building: { etaText: 'about 2 minutes' } });
    });
    expect(bar().dataset.state).toBe('busy');
    expect(text(q('.itsm-SystemBar__busy'))).toBe('Resetting now… about 2 minutes');
    act(() => {
      updateDemoBarState({ building: null });
    });
    expect(bar().dataset.state).toBe('default');
    expect(text(q('.itsm-SystemBar__busy'))).toBe('Resetting now…');
  });
});

/* ------------------------------------------------------------------------- */

describe('Reset demo data', () => {
  /** Renders the session bar with a status already polled, so the trigger knows the state. */
  function sessionWith(status: DemoStatus | null): void {
    // As a poll notes it: the status, and whether Reset is available.
    if (status) noteDemoStatus({ status, measuredAt: status.serverNow, rtt: 50 });
    render(page(<DemoBar {...sessionProps()} />));
  }

  async function pressReset(): Promise<void> {
    const trigger = resetButton()!;
    focus(trigger);
    await flush();
    click(resetButton()!);
    await flush();
  }

  it('asks first: a danger confirm with Cancel focused, the consequence spelt out', async () => {
    const now = Date.now();
    stubFetch(() => ({ status: 200, body: statusAt(now) }));
    sessionWith(null);
    await pressReset();
    const dialog = q('.itsm-ConfirmDialog')!;
    expect(dialog.getAttribute('role')).toBe('alertdialog');
    expect(text(dialog)).toContain('Reset demo data?');
    expect(text(dialog)).toContain(DEMO_COPY.resetConfirm.body);
    expect(text(dialog)).toContain('Nobody can reset it again for 30 minutes afterwards.');
    expect(activeElement()?.textContent).toBe('Cancel');
    expect(dialogButton('Reset demo data')).toBeDefined();
    expect(DEMO_RESET_CONFIRM.tone).toBe('danger');
  });

  it('202: posts { confirm: "RESET" }, shows the busy state with the estimate and says so politely', async () => {
    const now = Date.now();
    const { calls } = stubFetch((url) =>
      url === '/api/demo/reset' ? { status: 202, body: { nextGeneration: 6, etaSec: 120 } } : { status: 200, body: statusAt(now) },
    );
    sessionWith(null);
    await pressReset();
    click(dialogButton('Reset demo data')!);
    await flush();
    await settle(50);

    // The flow reads the status before it confirms; the watch polls the same route.
    const posts = calls.filter((call) => call.method === 'POST');
    expect(posts).toEqual([{ url: '/api/demo/reset', method: 'POST', body: { confirm: 'RESET' } }]);
    expect(calls.findIndex((call) => call.method === 'GET' && call.url === '/api/demo/status')).toBeLessThan(calls.indexOf(posts[0]!));
    expect(calls.filter((call) => call.method === 'GET').every((call) => call.url === '/api/demo/status')).toBe(true);
    expect(q('.itsm-ConfirmDialog')).toBeNull();
    expect(bar().dataset.state).toBe('busy');
    expect(text(q('.itsm-SystemBar__busy'))).toBe('Resetting now… about 2 minutes');
    expect(announcerText('polite')).toBe('Resetting the demo data. This takes about 2 minutes; you can keep exploring.');
    expect(demoBarState().pending).toMatchObject({ generation: 6, mine: true, etaSec: 120 });
    // While it runs, Reset says it is unavailable but stays focusable.
    expect(resetButton()?.getAttribute('aria-disabled')).toBe('true');
    expect(resetButton()?.hasAttribute('disabled')).toBe(false);
  });

  it('409: "A reset is already running." under the bars, and the busy state', async () => {
    const now = Date.now();
    stubFetch((url) => (url === '/api/demo/reset' ? { status: 409, body: { state: 'building' } } : { status: 200, body: statusAt(now) }));
    sessionWith(null);
    await pressReset();
    click(dialogButton('Reset demo data')!);
    await flush();
    const notice = q(`#${DEMO_NOTICE_HOST_ID} .itsm-DemoNotice`)!;
    expect(notice.getAttribute('role')).toBe('status');
    expect(text(notice)).toContain('A reset is already running.');
    expect(bar().dataset.state).toBe('busy');
    expect(demoBarState().pending).toMatchObject({ generation: 6, mine: false });
  });

  it('429: the confirm gives way to the cooldown reason on the button', async () => {
    const now = Date.now();
    let cooling = false;
    stubFetch((url) => {
      if (url === '/api/demo/reset') {
        cooling = true;
        return { status: 429, body: { retryAfterSec: 18 * 60 }, headers: { 'retry-after': String(18 * 60) } };
      }
      return {
        status: 200,
        body: cooling ? statusAt(now, { live: live(5, 'manual', now - 12 * 60_000), cooldown: { at: now - 12 * 60_000, generation: 5, reason: 'manual' } }) : statusAt(now),
      };
    });
    sessionWith(null);
    await pressReset();
    click(dialogButton('Reset demo data')!);
    await flush();
    expect(q('.itsm-ConfirmDialog')).toBeNull();
    const reason = q('.itsm-DemoReset__reason')!;
    expect(reason.getAttribute('role')).toBe('dialog');
    expect(text(reason)).toBe('The demo was reset 12 min ago. To keep fresh data safe for presenters, it can be reset again in 18 min.');
  });

  it('403 and 404: Reset leaves the bar', async () => {
    for (const code of [403, 404]) {
      const now = Date.now();
      stubFetch((url) => (url === '/api/demo/reset' ? { status: code } : { status: 200, body: statusAt(now) }));
      sessionWith(null);
      await pressReset();
      click(dialogButton('Reset demo data')!);
      await flush();
      expect(resetButton(), String(code)).toBeNull();
      expect(q('.itsm-ConfirmDialog')).toBeNull();
      cleanupDocument();
      resetDemoBarStateForTesting();
    }
  });

  it('a failure keeps the confirm open with the reason inline, so it can be tried again', async () => {
    const now = Date.now();
    stubFetch((url) => (url === '/api/demo/reset' ? { status: 500 } : { status: 200, body: statusAt(now) }));
    sessionWith(null);
    await pressReset();
    click(dialogButton('Reset demo data')!);
    await flush();
    expect(q('.itsm-ConfirmDialog')).not.toBeNull();
    expect(text(q('.itsm-ConfirmDialog [role="alert"]'))).toContain('couldn’t be reset just now');
  });

  it('cooldown: Reset is aria-disabled, and a press says why instead of confirming', async () => {
    const now = Date.now();
    const cooling = statusAt(now, { live: live(5, 'manual', now - 12 * 60_000), cooldown: { at: now - 12 * 60_000, generation: 5, reason: 'manual' } });
    const { calls } = stubFetch(() => ({ status: 200, body: cooling }));
    sessionWith(cooling);
    expect(resetButton()?.getAttribute('aria-disabled')).toBe('true');
    await pressReset();
    expect(q('.itsm-ConfirmDialog')).toBeNull();
    expect(text(q('.itsm-DemoReset__reason'))).toBe(
      'The demo was reset 12 min ago. To keep fresh data safe for presenters, it can be reset again in 18 min.',
    );
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
    // Escape closes the reason and returns focus to the button.
    press(activeElement() ?? document.body, 'Escape');
    await flush();
    expect(q('.itsm-DemoReset__reason')).toBeNull();
    expect(activeElement()).toBe(resetButton());
  });

  it('paused or backing off: "Resetting is paused on this demo at the moment."', async () => {
    const now = Date.now();
    const paused = statusAt(now, { paused: true });
    stubFetch(() => ({ status: 200, body: paused }));
    sessionWith(paused);
    expect(resetButton()?.getAttribute('aria-disabled')).toBe('true');
    await pressReset();
    expect(text(q('.itsm-DemoReset__reason'))).toBe('Resetting is paused on this demo at the moment.');

    const backoff = statusAt(now, { backoff: { v: 1, failures: 2, retryAt: now + 40 * 60_000, step: 'tickets' } });
    expect(resetBlock(backoff, false, now)).toEqual({ kind: 'backoff', until: now + 40 * 60_000 });
    expect(resetBlockText({ kind: 'backoff', until: now + 40 * 60_000 }, now)).toBe(DEMO_COPY.resetBlocked);
  });

  it('opens from the account menu’s "Reset demo data…"', async () => {
    const now = Date.now();
    stubFetch(() => ({ status: 200, body: statusAt(now) }));
    sessionWith(null);
    act(() => {
      window.dispatchEvent(new CustomEvent(DEMO_RESET_REQUEST_EVENT));
    });
    await flush();
    expect(q('.itsm-ConfirmDialog')).not.toBeNull();
  });
});

describe('resetBlock', () => {
  const now = SERVER_NOW;
  it('reads the reasons from the times, not from a stale resetBlocked', () => {
    const ready = statusAt(now);
    expect(resetBlock(ready, false, now)).toBeNull();
    expect(resetBlock(null, false, now)).toBeNull();
    expect(resetBlock(null, true, now)).toEqual({ kind: 'running' });
    expect(resetBlock(statusAt(now, { build: { v: 1, state: 'building', generation: 6, reason: 'manual', startedAt: now, step: 'people', stepIndex: 3, steps: 11, etaSec: 180 } }), false, now)).toEqual({ kind: 'running' });
    expect(resetBlock(statusAt(now, { live: null }), false, now)).toEqual({ kind: 'paused' });
    const cooling = statusAt(now, { live: live(5, 'manual', now - 12 * 60_000), cooldown: { at: now - 12 * 60_000, generation: 5, reason: 'manual' } });
    expect(resetBlock(cooling, false, now)).toEqual({ kind: 'cooldown', since: now - 12 * 60_000, until: now + 18 * 60_000 });
    // Thirty-one minutes on, the same snapshot no longer blocks.
    expect(resetBlock(cooling, false, now + 19 * 60_000)).toBeNull();
    expect(resetBlockText({ kind: 'cooldown', since: now - 12 * 60_000, until: now + 18 * 60_000 }, now)).toBe(
      DEMO_COPY.resetCooldown(12, 18),
    );
    expect(resetBlockText({ kind: 'running' }, now)).toBe('A reset is already running.');
  });

  it('keeps the trigger’s flag in the store, and lifts it when the cooldown runs out, without a poll', () => {
    vi.useFakeTimers({ now: SERVER_NOW, toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const cooling = statusAt(SERVER_NOW, { live: live(5, 'manual', SERVER_NOW - 12 * 60_000), cooldown: { at: SERVER_NOW - 12 * 60_000, generation: 5, reason: 'manual' } });
    noteDemoStatus({ status: cooling, measuredAt: SERVER_NOW, rtt: 50 });
    expect(demoBarState().resetBlocked).toBe(true);
    vi.advanceTimersByTime(18 * 60_000 - 1_000);
    expect(demoBarState().resetBlocked).toBe(true);
    vi.advanceTimersByTime(1_500);
    expect(demoBarState().resetBlocked).toBe(false);
    // A running reset is the busy state's, not this flag's.
    updateDemoBarState({ building: { etaText: 'about 3 minutes' } });
    expect(syncResetBlocked()).toEqual({ kind: 'running' });
    expect(demoBarState().resetBlocked).toBe(false);
  });
});

/* ------------------------------------------------------------------------- */

describe('Demo details', () => {
  async function openDetails(): Promise<HTMLElement> {
    focus(infoButton());
    await flush();
    click(infoButton());
    await flush();
    const popover = q('.itsm-DemoDetails__popover');
    if (!popover) throw new Error('details did not open');
    return popover as HTMLElement;
  }

  it('opens on Info: when, the shared-demo sentence, who you are, explore as, actions — and Escape returns focus', async () => {
    const now = Date.now();
    const current = statusAt(now);
    const today: DemoClock = { ...clock, serverNow: now, nextResetAt: current.nextResetAt, periodMs: current.periodMs };
    stubFetch(() => ({ status: 200, body: current }));
    updateDemoBarState({ status: current, skewMs: 0, skewFrom: 'poll' });
    render(page(<DemoBar {...sessionProps({ clock: today, links: { home: 'https://itsm.example/' } })} />));
    const popover = await openDetails();
    expect(popover.getAttribute('role')).toBe('dialog');
    expect(document.getElementById(popover.getAttribute('aria-labelledby')!)?.getAttribute('aria-label')).toBe('Demo details');
    expect(text(popover.querySelector('.itsm-DemoDetails__heading'))).toBe('Next automatic reset');
    const { when, local } = resetWhen(today, current.nextResetAt, Intl.DateTimeFormat().resolvedOptions().timeZone);
    expect(when).toMatch(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2} \w{3,4} \d{4}, 00:00 UK time$/);
    expect(text(popover.querySelector('.itsm-DemoDetails__when'))).toBe(local ? `${when} ${local}` : when);
    expect(text(popover.querySelector('.itsm-DemoDetails__countdown'))).toMatch(/^Resets in \d{2}:\d{2}:\d{2}$/);
    expect(text(popover.querySelector('.itsm-DemoDetails__text'))).toBe(
      "Demo data resets every day at 00:00 UK time. This is a shared demo: changes are shared with other visitors until the nightly reset. Please don't enter real personal data. Northwind Traders (UK) and its people are fictional.",
    );
    expect(text(popover.querySelector('.itsm-DemoDetails__you'))).toBe("You're Alex Morgan, Service Desk team lead.");
    const rows = [...popover.querySelectorAll('.itsm-DemoDetails__explore li')].map((row) => text(row));
    expect(rows).toEqual([
      'Emma Clarke · Finance Manager — Help Portal',
      'Alex Morgan · Service Desk team lead — Service Desk (you)',
      'Jordan Lee · IT Service Manager — Administration',
    ]);
    const links = [...popover.querySelectorAll<HTMLAnchorElement>('.itsm-DemoDetails__link')];
    expect(links.map((link) => [text(link), link.getAttribute('href')])).toEqual([
      ['How the demo works', 'https://itsm.example/#how-it-works'],
      ['IT Service Management home', 'https://itsm.example/'],
    ]);
    expect(text(popover.querySelector('.itsm-DemoDetails__actions button'))).toBe('Reset demo data');
    expect(text(popover.querySelector('.itsm-DemoDetails__footer'))).toMatch(/^Last reset: (today|yesterday|\w{3} \d+ \w{3}), \d{2}:\d{2} UK time \(scheduled\)$/);

    press(activeElement() ?? popover, 'Escape');
    await flush();
    expect(q('.itsm-DemoDetails__popover')).toBeNull();
    expect(activeElement()).toBe(infoButton());
  });

  it('its Reset says why in place while the cooldown runs, once the watch has the words', async () => {
    const now = Date.now();
    const cooling = statusAt(now, { live: live(5, 'manual', now - 12 * 60_000), cooldown: { at: now - 12 * 60_000, generation: 5, reason: 'manual' } });
    localStorage.setItem(DEMO_LOCAL_KEYS.lastGeneration, '5');
    stubFetch(() => ({ status: 200, body: cooling }));
    render(page(<DemoBar {...sessionProps()} />));
    // The watch starts when idle and polls: the bar now knows about the cooldown.
    await flush();
    expect(resetButton()?.getAttribute('aria-disabled')).toBe('true');
    const popover = await openDetails();
    const reset = popover.querySelector<HTMLButtonElement>('.itsm-DemoDetails__actions button')!;
    expect(reset.getAttribute('aria-disabled')).toBe('true');
    const described = (reset.getAttribute('aria-describedby') ?? '').split(' ').map((id) => text(document.getElementById(id)));
    expect(described).toContain('The demo was reset 12 min ago. To keep fresh data safe for presenters, it can be reset again in 18 min.');
    click(reset);
    await flush();
    expect(q('.itsm-ConfirmDialog')).toBeNull();
    expect(q('.itsm-DemoDetails__popover')).not.toBeNull();
  });

  it('its Reset hands over to the bar’s confirm when Reset is available', async () => {
    stubFetch(() => ({ status: 200, body: statusAt(Date.now()) }));
    render(page(<DemoBar {...sessionProps()} />));
    const popover = await openDetails();
    click(popover.querySelector<HTMLButtonElement>('.itsm-DemoDetails__actions button')!);
    await flush();
    expect(q('.itsm-DemoDetails__popover')).toBeNull();
    expect(q('.itsm-ConfirmDialog')).not.toBeNull();
  });

  it('public variant: no Reset, no persona and no "Explore as"', async () => {
    render(page(<DemoBar variant="public" clock={clock} links={{ home: 'https://itsm.example/' }} />));
    const popover = await openDetails();
    expect(popover.querySelector('.itsm-DemoDetails__you')).toBeNull();
    expect(popover.querySelector('.itsm-DemoDetails__explore')).toBeNull();
    expect(popover.querySelector('.itsm-DemoDetails__actions button')).toBeNull();
    expect(text(popover)).toContain('Northwind Traders (UK) and its people are fictional.');
  });

  it('opens from the account menu’s "Demo details", and a reset request opens it where Reset is not offered', async () => {
    render(page(<DemoBar variant="public" clock={clock} />));
    act(() => {
      window.dispatchEvent(new CustomEvent(DEMO_DETAILS_REQUEST_EVENT));
    });
    await flush();
    expect(q('.itsm-DemoDetails__popover')).not.toBeNull();
    cleanupDocument();
    render(page(<DemoBar variant="public" clock={clock} />));
    act(() => {
      window.dispatchEvent(new CustomEvent(DEMO_RESET_REQUEST_EVENT));
    });
    await flush();
    expect(q('.itsm-DemoDetails__popover')).not.toBeNull();
    expect(q('.itsm-ConfirmDialog')).toBeNull();
  });

  it('gives the time in the visitor’s own zone when it differs, with the day when that differs too', () => {
    expect(resetWhen(clock, NEXT_RESET, 'Europe/London')).toEqual({ when: 'Sat 3 Oct 2026, 00:00 UK time', local: null });
    expect(resetWhen(clock, NEXT_RESET, 'Europe/Paris')).toEqual({ when: 'Sat 3 Oct 2026, 00:00 UK time', local: '(01:00 your time)' });
    expect(resetWhen(clock, NEXT_RESET, 'America/New_York')).toEqual({ when: 'Sat 3 Oct 2026, 00:00 UK time', local: '(Fri 19:00 your time)' });
  });

  it('says when and why the data was last reset', () => {
    const now = Date.UTC(2026, 9, 2, 13, 0);
    expect(lastResetLine(Date.UTC(2026, 9, 1, 23, 0), 'scheduled', now)).toBe('Last reset: today, 00:00 UK time (scheduled)');
    expect(lastResetLine(Date.UTC(2026, 9, 2, 9, 12), 'manual', now)).toBe('Last reset: today, 10:12 UK time (reset by a visitor)');
    expect(lastResetLine(Date.UTC(2026, 8, 30, 23, 0), 'scheduled', now)).toBe('Last reset: yesterday, 00:00 UK time (scheduled)');
    expect(lastResetLine(Date.UTC(2026, 8, 28, 23, 0), 'operator', now)).toBe('Last reset: Tue 29 Sept, 00:00 UK time (reset by the operator)');
    expect(lastResetLine(null, null, now)).toBeNull();
  });
});

/* ------------------------------------------------------------------------- */

describe('the status watch', () => {
  /** A fetch that answers the status route from a list, the last answer repeating. */
  function answering(statuses: (DemoStatus | null)[]): { fetch: FetchLike; count: () => number } {
    let calls = 0;
    const fetch: FetchLike = async () => {
      const next = statuses[Math.min(calls, statuses.length - 1)];
      calls += 1;
      return next ? new Response(JSON.stringify(next), { status: 200 }) : new Response(null, { status: 503 });
    };
    return { fetch, count: () => calls };
  }

  function watch(options: { generation: number | null; statuses: (DemoStatus | null)[]; storage: MemoryStorage; reload?: () => void }) {
    const notices: DemoNoticeSpec[] = [];
    const changes: number[] = [];
    const off = onDemoGenerationChange((generation) => {
      changes.push(generation);
      notices.push({ kind: 'running', text: `cleared ${generation}` });
    });
    const { fetch, count } = answering(options.statuses);
    const stop = startDemoWatch({
      endpoint: '/api/demo/status',
      generation: options.generation,
      fetch,
      storage: options.storage,
      reload: options.reload ?? (() => undefined),
      onNotice: (notice) => {
        if (notice) notices.push(notice);
      },
    });
    return {
      notices,
      changes,
      count,
      stop: () => {
        stop();
        off();
      },
    };
  }

  const settleWatch = async (): Promise<void> => {
    for (let round = 0; round < 6; round += 1) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    for (let round = 0; round < 6; round += 1) await Promise.resolve();
  };

  it('X-M6: a first visit stores the generation silently — no notice, nothing cleared', async () => {
    const storage = new MemoryStorage();
    const run = watch({ generation: 5, statuses: [statusAt(Date.now())], storage });
    await settleWatch();
    expect(storage.getItem(DEMO_LOCAL_KEYS.lastGeneration)).toBe('5');
    expect(run.notices).toEqual([]);
    expect(run.changes).toEqual([]);
    run.stop();
  });

  it('X-M6: "fresh" only when a lower generation was stored — the local data is cleared first, then the notice', async () => {
    const storage = new MemoryStorage();
    storage.setItem(DEMO_LOCAL_KEYS.lastGeneration, '4');
    const run = watch({ generation: 5, statuses: [statusAt(Date.now())], storage });
    await settleWatch();
    expect(run.changes).toEqual([5]);
    expect(run.notices.map((notice) => notice.text)).toEqual(['cleared 5', "Demo data was reset at 00:00 UK time. You're looking at the fresh data."]);
    expect(run.notices[1]).toMatchObject({ kind: 'fresh', generation: 5 });
    expect(storage.getItem(DEMO_LOCAL_KEYS.lastGeneration)).toBe('5');
    run.stop();
  });

  it('says nothing when this browser has already seen the page’s generation, or a later one', async () => {
    for (const stored of ['5', '6']) {
      const storage = new MemoryStorage();
      storage.setItem(DEMO_LOCAL_KEYS.lastGeneration, stored);
      const run = watch({ generation: 5, statuses: [statusAt(Date.now())], storage });
      await settleWatch();
      expect(run.notices, stored).toEqual([]);
      expect(run.changes, stored).toEqual([]);
      run.stop();
    }
  });

  it('clears silently when it cannot say when the reset happened', async () => {
    const storage = new MemoryStorage();
    storage.setItem(DEMO_LOCAL_KEYS.lastGeneration, '4');
    const run = watch({ generation: 5, statuses: [null], storage });
    await settleWatch();
    expect(run.changes).toEqual([5]);
    expect(run.notices.filter((notice) => notice.kind === 'fresh')).toEqual([]);
    expect(storage.getItem(DEMO_LOCAL_KEYS.lastGeneration)).toBe('5');
    run.stop();
  });

  it('"stale": a poll finds a newer generation — cleared, then "Reload to see the fresh data", once', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const storage = new MemoryStorage();
    storage.setItem(DEMO_LOCAL_KEYS.lastGeneration, '5');
    const now = Date.now();
    const run = watch({ generation: 5, statuses: [statusAt(now), statusAt(now, { live: live(6, 'manual', now) })], storage });
    await vi.advanceTimersByTimeAsync(0);
    expect(run.notices).toEqual([]);
    await vi.advanceTimersByTimeAsync(DEMO_POLL_MS);
    expect(run.changes).toEqual([6]);
    expect(run.notices.map((notice) => notice.text)).toEqual(['cleared 6', 'Demo data was reset by a visitor. Reload to see the fresh data.']);
    expect(run.notices[1]).toMatchObject({ kind: 'stale', generation: 6 });
    await vi.advanceTimersByTimeAsync(DEMO_POLL_MS * 2);
    expect(run.notices).toHaveLength(2);
    expect(run.count()).toBe(4);
    run.stop();
  });

  it('a dismissed notice stays dismissed for that generation', async () => {
    const storage = new MemoryStorage();
    storage.setItem(DEMO_LOCAL_KEYS.lastGeneration, '5');
    storage.setItem(DEMO_LOCAL_KEYS.noticeSeen, '6');
    const now = Date.now();
    const run = watch({ generation: 5, statuses: [statusAt(now, { live: live(6, 'manual', now) })], storage });
    await settleWatch();
    expect(run.changes).toEqual([6]);
    expect(run.notices.filter((notice) => notice.kind === 'stale')).toEqual([]);
    run.stop();
  });

  it('the visitor who pressed Reset: "Your fresh demo is ready — reloading…", then a reload after 1.2 s', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const storage = new MemoryStorage();
    storage.setItem(DEMO_LOCAL_KEYS.lastGeneration, '5');
    const reload = vi.fn();
    const now = Date.now();
    const building = statusAt(now, { build: { v: 1, state: 'building', generation: 6, reason: 'manual', startedAt: now, step: 'people', stepIndex: 3, steps: 11, etaSec: 180 } });
    const run = watch({ generation: 5, statuses: [statusAt(now), building, statusAt(now, { live: live(6, 'manual', now) })], storage, reload });
    await vi.advanceTimersByTimeAsync(0);
    updateDemoBarState({ building: { etaText: 'about 2 minutes' }, pending: { generation: 6, since: Date.now(), etaSec: 120, mine: true } });
    // The pace is five seconds now, not a minute.
    await vi.advanceTimersByTimeAsync(DEMO_POLL_BUILDING_MS);
    expect(run.count()).toBe(2);
    expect(demoBarState().building).toEqual({ etaText: 'about 3 minutes' });
    await vi.advanceTimersByTimeAsync(DEMO_POLL_BUILDING_MS);
    expect(run.notices.at(-1)).toEqual({ kind: 'ready', text: 'Your fresh demo is ready — reloading…', generation: 6 });
    expect(reload).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(DEMO_RELOAD_DELAY_MS);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(demoBarState().building).toBeNull();
    run.stop();
  });

  it('polls every minute while visible, not at all while hidden, and at once on return after more than a minute', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    let visibility: DocumentVisibilityState = 'visible';
    const spy = vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
    const storage = new MemoryStorage();
    storage.setItem(DEMO_LOCAL_KEYS.lastGeneration, '5');
    const run = watch({ generation: 5, statuses: [statusAt(Date.now())], storage });
    await vi.advanceTimersByTimeAsync(0);
    expect(run.count()).toBe(1);
    await vi.advanceTimersByTimeAsync(DEMO_POLL_MS - 1);
    expect(run.count()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(run.count()).toBe(2);
    visibility = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(DEMO_POLL_MS * 3);
    expect(run.count()).toBe(2);
    visibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(run.count()).toBe(3);
    run.stop();
    spy.mockRestore();
  });

  it('notes the skew only when the client clock is measurably wrong', () => {
    const status = statusAt(SERVER_NOW);
    expect(noteDemoStatus({ status, measuredAt: SERVER_NOW + 300, rtt: 200 }).skewMs).toBe(0);
    expect(noteDemoStatus({ status, measuredAt: SERVER_NOW - 90_000, rtt: 200 }).skewMs).toBe(90_000);
    expect(demoBarState().skewFrom).toBe('poll');
  });

  it('accepts only a status body', () => {
    expect(parseDemoStatus(statusAt(SERVER_NOW))).toMatchObject({ state: 'ready', generation: 5, lastResetReason: 'scheduled' });
    for (const bad of [null, 'ready', {}, { ...statusAt(SERVER_NOW), state: 'exploded' }, { ...statusAt(SERVER_NOW), serverNow: 'now' }, { ...statusAt(SERVER_NOW), generation: '5' }]) {
      expect(parseDemoStatus(bad)).toBeNull();
    }
  });

  it('reads the reset route’s answers', async () => {
    const answer = (status: number, body?: unknown, headers?: Record<string, string>): FetchLike =>
      async () => new Response(body === undefined ? null : JSON.stringify(body), { status, headers });
    expect(await requestDemoReset('/api/demo/reset', answer(202, { nextGeneration: 6, etaSec: 150 }))).toEqual({ kind: 'started', nextGeneration: 6, etaSec: 150 });
    expect(await requestDemoReset('/api/demo/reset', answer(409, { state: 'building' }))).toEqual({ kind: 'running' });
    expect(await requestDemoReset('/api/demo/reset', answer(429, { retryAfterSec: 600 }))).toEqual({ kind: 'refused', retryAfterSec: 600 });
    expect(await requestDemoReset('/api/demo/reset', answer(429, undefined, { 'retry-after': '300' }))).toEqual({ kind: 'refused', retryAfterSec: 300 });
    expect(await requestDemoReset('/api/demo/reset', answer(503, { type: 'about:blank#demo_unavailable' }))).toEqual({ kind: 'refused', retryAfterSec: null });
    expect(await requestDemoReset('/api/demo/reset', answer(403))).toEqual({ kind: 'unavailable' });
    expect(await requestDemoReset('/api/demo/reset', answer(404))).toEqual({ kind: 'unavailable' });
    expect(await requestDemoReset('/api/demo/reset', answer(500))).toEqual({ kind: 'failed' });
    expect(await requestDemoReset('/api/demo/reset', async () => Promise.reject(new TypeError('offline')))).toEqual({ kind: 'failed' });
    // Neither request can hang the bar: both carry a deadline.
    const inits: (RequestInit | undefined)[] = [];
    const recording: FetchLike = async (_url, init) => {
      inits.push(init);
      return new Response(JSON.stringify(statusAt(SERVER_NOW)), { status: 200 });
    };
    await requestDemoReset('/api/demo/reset', recording);
    await readDemoStatus('/api/demo/status', recording);
    for (const init of inits) expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(inits.map((init) => init?.credentials)).toEqual(['same-origin', 'same-origin']);
  });
});

describe('the notice, through the bar', () => {
  it('a generation change clears the visit (the app’s clearDemoLocalData) and then shows the notice after main', async () => {
    localStorage.setItem(DEMO_LOCAL_KEYS.lastGeneration, '4');
    stubFetch(() => ({ status: 200, body: statusAt(Date.now()) }));
    const order: string[] = [];
    let release: () => void = () => undefined;
    // Stands in for the application's `clearDemoLocalData` (`@itsm/pwa/demo`): slow, and waited for.
    const clearDemoLocalData = vi.fn(
      (generation: number) =>
        new Promise<void>((resolve) => {
          order.push(`clear ${generation}`);
          release = () => {
            order.push('cleared');
            resolve();
          };
        }),
    );
    const off = onDemoGenerationChange(clearDemoLocalData);
    render(page(<DemoBar {...sessionProps()} />));
    await flush();
    expect(clearDemoLocalData).toHaveBeenCalledWith(5);
    expect(q(`#${DEMO_NOTICE_HOST_ID} .itsm-DemoNotice`)).toBeNull();
    await act(async () => {
      release();
    });
    await flush();
    const notice = q(`#${DEMO_NOTICE_HOST_ID} .itsm-DemoNotice`)!;
    expect(order).toEqual(['clear 5', 'cleared']);
    expect(notice.getAttribute('role')).toBe('status');
    expect(text(notice)).toContain("Demo data was reset at 00:00 UK time. You're looking at the fresh data.");
    // After main, never before it (§3.9).
    expect(q('main')!.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(localStorage.getItem(DEMO_LOCAL_KEYS.lastGeneration)).toBe('5');

    // Dismissed, and remembered for that generation.
    click(q<HTMLButtonElement>('.itsm-DemoNotice .itsm-Banner__dismiss')!);
    await flush();
    expect(q('.itsm-DemoNotice')).toBeNull();
    expect(localStorage.getItem(DEMO_LOCAL_KEYS.noticeSeen)).toBe('5');
    off();
  });

  it('the stale notice offers Reload', async () => {
    localStorage.setItem(DEMO_LOCAL_KEYS.lastGeneration, '5');
    const now = Date.now();
    stubFetch(() => ({ status: 200, body: statusAt(now, { live: live(6, 'scheduled', now) }) }));
    render(page(<DemoBar {...sessionProps()} />));
    await flush(6);
    const notice = q('.itsm-DemoNotice')!;
    expect(text(notice)).toContain('Demo data was reset at 00:00 UK time. Reload to see the fresh data.');
    expect([...notice.querySelectorAll('button')].map((button) => button.getAttribute('aria-label') ?? text(button))).toEqual(['Reload', 'Dismiss']);
  });

  it('a page re-rendered on the new generation drops "Reload to see the fresh data"', async () => {
    localStorage.setItem(DEMO_LOCAL_KEYS.lastGeneration, '5');
    const now = Date.now();
    stubFetch(() => ({ status: 200, body: statusAt(now, { live: live(6, 'scheduled', now) }) }));
    const view = render(page(<DemoBar {...sessionProps()} />));
    await flush(6);
    expect(q('.itsm-DemoNotice')).not.toBeNull();
    view.rerender(page(<DemoBar {...sessionProps({ generation: 6 })} />));
    await flush();
    expect(q('.itsm-DemoNotice')).toBeNull();
  });

  it('the public bar never polls', async () => {
    const { fn } = stubFetch(() => ({ status: 200, body: statusAt(Date.now()) }));
    render(page(<DemoBar variant="public" clock={clock} />));
    await flush();
    await settle(20);
    expect(fn).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------------- */

describe('End demo', () => {
  it('submits the frame’s sign-out form, with no confirmation', () => {
    render(page(<DemoBar {...sessionProps()} />));
    const form = q<HTMLFormElement>(`#${DEMO_BAR_SIGN_OUT_FORM_ID}`)!;
    const submitted = vi.fn((event: SubmitEvent) => {
      event.preventDefault();
      return event.submitter;
    });
    form.addEventListener('submit', submitted);
    const end = q<HTMLButtonElement>('.itsm-DemoBar__end')!;
    click(end);
    expect(submitted).toHaveBeenCalledTimes(1);
    expect(submitted.mock.results[0]!.value).toBe(end);
    expect(q('[role="alertdialog"], .itsm-ConfirmDialog')).toBeNull();
  });
});

/* ------------------------------------------------------------------------- */

describe('the stylesheet', () => {
  const sheet = demoBarStyles.replace(/\/\*[\s\S]*?\*\//g, '');
  const systemSheet = systemBarStyles.replace(/\/\*[\s\S]*?\*\//g, '');

  it('draws no second bar: no surface, no offset, no sticky — the system bar does all three', () => {
    expect(sheet).not.toMatch(/\.itsm-SystemBar\s*\{/);
    expect(sheet).not.toMatch(/--itsm-system-bar-h\s*:/);
    expect(sheet).not.toMatch(/position:\s*(sticky|fixed)/);
    expect(sheet).not.toMatch(/background:[^;]*hero/);
  });

  it('on a phone the bar is two lines in the flow (the system bar’s rules), and line two is the persona', () => {
    expect(systemSheet).toMatch(/\.itsm-SystemBar \{[^}]*position: static;[^}]*grid-template-areas: "lead actions" "text text";/);
    expect(systemSheet).toMatch(/@media \(min-width: 48rem\) \{[\s\S]*?\.itsm-SystemBar \{[^}]*position: sticky;/);
    expect(sheet).toMatch(
      /@media \(max-width: 47\.9375rem\) \{\s*\.itsm-DemoBar\[data-variant="session"\] \.itsm-SystemBar__message,\s*\.itsm-DemoBar\[data-variant="session"\] \.itsm-SystemBar__separator \{\s*display: none;/,
    );
  });

  it('End demo is a ghost action whose words show from 48rem; Reset’s wait for 64rem like the others', () => {
    expect(sheet).toMatch(/\.itsm-DemoBar__end \{\s*border-color: transparent;/);
    expect(sheet).toMatch(/@media \(min-width: 48rem\) \{\s*\.itsm-DemoBar__end \.itsm-SystemBar__actionLabel \{[^}]*clip-path: none;/);
    expect(sheet).not.toMatch(/\.itsm-DemoBar__reset \.itsm-SystemBar__actionLabel/);
  });

  it('paints only tokens', () => {
    expect(sheet.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
    expect(sheet.match(/\b(?:rgba?|hsla?)\(/g) ?? []).toEqual([]);
    expect(unknownVariables(demoBarStyles)).toEqual([]);
    expect(demoBarStyles.startsWith('@layer itsm.components {')).toBe(true);
  });
});

/* ------------------------------------------------------------------------- */

describe('module boundaries', () => {
  const read = (file: string): string => readFileSync(join(SRC, file), 'utf8');
  const isClient = (file: string): boolean => /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*['"]use client['"]/.test(read(file));

  function sourceFiles(): string[] {
    const found: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== '__tests__') walk(path);
        } else if (/\.tsx?$/.test(entry.name)) found.push(relative(SRC, path).split(sep).join('/'));
      }
    };
    walk(SRC);
    return found;
  }

  it('the bar is server-safe; the countdown, the controls and the watch are client modules; the popover and dialog too', () => {
    expect(isClient('shell/DemoBar.tsx')).toBe(false);
    for (const file of ['shell/DemoCountdown.tsx', 'shell/DemoBarControls.tsx', 'shell/demo-watch.ts', 'shell/DemoDetailsPopover.tsx', 'shell/DemoResetDialog.tsx']) {
      expect(isClient(file), file).toBe(true);
    }
  });

  it('the popover, the dialog and the watch are reached only through import(), never statically', () => {
    const lazy = ['DemoDetailsPopover', 'DemoResetDialog', 'demo-watch'];
    for (const file of sourceFiles()) {
      const source = read(file);
      for (const name of lazy) {
        if (file === `shell/${name}.tsx` || file === `shell/${name}.ts`) continue;
        const staticImport = new RegExp(`(?:^|\\n)\\s*(?:import|export)\\s[^;]*?from\\s+['"][./]*${name}\\.js['"]`);
        // Type-only imports cost nothing in a bundle.
        const typeOnly = new RegExp(`(?:^|\\n)\\s*import\\s+type\\s[^;]*?from\\s+['"][./]*${name}\\.js['"]`);
        if (staticImport.test(source) && !typeOnly.test(source)) {
          // Lazy modules may import one another: they share the same async chunk group.
          expect(lazy.some((other) => file === `shell/${other}.tsx` || file === `shell/${other}.ts`), `${file} imports ${name} statically`).toBe(true);
        }
      }
    }
    expect(read('shell/DemoBarControls.tsx')).toMatch(/import\('\.\/DemoDetailsPopover\.js'\)/);
    expect(read('shell/DemoBarControls.tsx')).toMatch(/import\('\.\/DemoResetDialog\.js'\)/);
    expect(read('shell/DemoBarControls.tsx')).toMatch(/import\('\.\/demo-watch\.js'\)/);
  });

  it('the first-load islands take only types from @itsm/contracts/demo, whose tables a bundler cannot drop', () => {
    for (const file of ['shell/DemoCountdown.tsx', 'shell/DemoBarControls.tsx']) {
      const imports = [...read(file).matchAll(/import\s+(type\s+)?\{[^}]*\}\s+from\s+'@itsm\/contracts\/demo'/g)];
      for (const found of imports) expect(found[1], file).toBe('type ');
    }
  });

  it('speaks the same events and ids as the frame and the account menu', () => {
    expect(DEMO_BAR_EVENTS.resetRequest).toBe(DEMO_RESET_REQUEST_EVENT);
    expect(DEMO_BAR_EVENTS.detailsRequest).toBe(DEMO_DETAILS_REQUEST_EVENT);
    expect(DEMO_NOTICE_HOST_ID).toBe(SYSTEM_NOTICE_ID);
    expect(DEMO_BAR_SIGN_OUT_FORM_ID).toBe(SIGN_OUT_FORM_ID);
    expect(DEMO_GENERATION_CHANGE_EVENT).toBe('itsm:demo-generation-change');
  });
});

/* ------------------------------------------------------------------------- */

describe('accessibility', () => {
  it('passes axe on the navy surface: the session bar above main, light and dark', async () => {
    for (const theme of ['light', 'dark']) {
      document.documentElement.setAttribute('data-itsm-theme', theme);
      render(page(<DemoBar {...sessionProps()} />));
      await audit();
      cleanupDocument();
    }
  });

  it('passes axe for the public bar and its states', async () => {
    render(
      <div>
        <DemoBar variant="public" clock={clock} />
        <main>
          <h1>IT Service Management</h1>
        </main>
      </div>,
    );
    await audit();
    cleanupDocument();
    render(page(<DemoBar variant="public" clock={clock} state="paused" />));
    await audit();
  });

  it('passes axe with the details open, and with the reset confirm open', async () => {
    stubFetch(() => ({ status: 200, body: statusAt(Date.now()) }));
    render(page(<DemoBar {...sessionProps({ links: { home: 'https://itsm.example/' } })} />));
    focus(infoButton());
    await flush();
    click(infoButton());
    await flush();
    expect(q('.itsm-DemoDetails__popover')).not.toBeNull();
    await audit();
    press(activeElement() ?? document.body, 'Escape');
    await flush();

    focus(resetButton()!);
    await flush();
    click(resetButton()!);
    await flush();
    expect(q('.itsm-ConfirmDialog')).not.toBeNull();
    await audit();
  });
});
