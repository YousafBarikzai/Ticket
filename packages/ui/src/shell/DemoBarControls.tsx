'use client';

import type { AreaModel } from '@itsm/contracts/areas';
import type { DemoStatus } from '@itsm/contracts/demo';
import { useEffect, useRef, useState, useSyncExternalStore, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../icons/Icon.js';
import type { DemoClock } from './DemoCountdown.js';
import { fetchModule, lazyModule, useIntentLoader, type IntentTriggerProps } from './lazy.js';

/* -------------------------------------------------------------------------
 * The bar's shared state
 *
 * The bar is one server component with three client islands and three lazy
 * modules around it: the countdown, these controls, the status watch, the
 * details popover and the reset flow. They share one small store, here,
 * because this module is in every demo page's first load anyway and every
 * other piece already imports it; a context would need a provider the server
 * component cannot render around islands it does not own.
 *
 * Nothing here imports a value from `@itsm/contracts/demo`: that module is a
 * few kilobytes of frozen tables a bundler cannot drop, so it is reached only
 * by the lazy modules. Types cost nothing.
 * ---------------------------------------------------------------------- */

/** The fields of `GET /api/demo/status` the bar reads (A3 §6.4; `computeDemoStatus`). */
export type DemoStatusView = Pick<
  DemoStatus,
  | 'state'
  | 'serverNow'
  | 'nextResetAt'
  | 'periodMs'
  | 'generation'
  | 'lastResetAt'
  | 'lastResetReason'
  | 'build'
  | 'manualResetAvailableAt'
  | 'resetBlocked'
  | 'cooldownSeconds'
>;

/** A reset this page knows is under way before any poll has said so: its own (202) or another visitor's (409). */
export interface DemoPendingReset {
  /** The generation that will be live when it finishes, when known. */
  readonly generation: number | null;
  /** Client clock, ms: a pending reset that never shows up in a poll is forgotten after a while. */
  readonly since: number;
  readonly etaSec: number | null;
  /** This visitor pressed Reset: when it lands, the page reloads by itself. */
  readonly mine: boolean;
}

export interface DemoBarState {
  /** The last status a poll returned; `null` until the first one (cooldown and building arrive with it, A2 §9.6). */
  readonly status: DemoStatusView | null;
  /** Server clock minus client clock, in ms. Zero unless the client clock is measurably wrong. */
  readonly skewMs: number;
  readonly skewFrom: 'none' | 'render' | 'poll';
  /** A reset is running: the bar shows "Resetting now… {eta}". The words come from the lazy modules. */
  readonly building: { readonly etaText: string } | null;
  readonly pending: DemoPendingReset | null;
  /** The reset route answered 403 or 404: this deployment or session cannot reset, so Reset is not offered. */
  readonly resetHidden: boolean;
}

const INITIAL_STATE: DemoBarState = Object.freeze({
  status: null,
  skewMs: 0,
  skewFrom: 'none',
  building: null,
  pending: null,
  resetHidden: false,
});

let current: DemoBarState = INITIAL_STATE;
const listeners = new Set<() => void>();

export function demoBarState(): DemoBarState {
  return current;
}

export function updateDemoBarState(patch: Partial<DemoBarState>): void {
  current = { ...current, ...patch };
  for (const listener of [...listeners]) listener();
}

export function subscribeDemoBarState(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const serverSnapshot = (): DemoBarState => INITIAL_STATE;

/** The bar's state, re-rendering on every change. The server always sees the initial state. */
export function useDemoBarState(): DemoBarState {
  return useSyncExternalStore(subscribeDemoBarState, demoBarState, serverSnapshot);
}

/** For tests: forgets every status, skew and pending reset. */
export function resetDemoBarStateForTesting(): void {
  current = INITIAL_STATE;
  listeners.clear();
}

/* -------------------------------------------------------------------------
 * Why Reset is unavailable right now
 * ---------------------------------------------------------------------- */

/**
 * The four reasons a visitor cannot reset (A2 §9.3): a reset is already
 * running; the demo is paused or still being prepared; the 30-minute
 * cooldown after any reset (D12, D28); the worker's backoff after a failed
 * build. Pure numbers — the sentences are the lazy reset module's
 * (`DEMO_COPY`) — so the trigger can say `aria-disabled` from the first load.
 *
 * `now` is the server's clock (client clock + skew). The status is a
 * snapshot, so its own `resetBlocked` goes stale as the cooldown runs out;
 * the times decide whenever there are times.
 */
export type ResetBlock =
  | { readonly kind: 'running' }
  | { readonly kind: 'paused' }
  | { readonly kind: 'cooldown'; readonly since: number; readonly until: number }
  | { readonly kind: 'backoff'; readonly until: number | null };

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

/* -------------------------------------------------------------------------
 * Events
 * ---------------------------------------------------------------------- */

/**
 * The window events the bar listens for and sends. The first two are the
 * account menu's Demo group (`UserMenu.tsx` exports the same strings; a test
 * holds them equal, because importing the menu here would put it in the
 * site's first load).
 */
export const DEMO_BAR_EVENTS = Object.freeze({
  resetRequest: 'itsm:demo-reset-request',
  detailsRequest: 'itsm:demo-details-request',
} as const);

/**
 * Sent when this browser meets a newer demo generation (A3 §6.9–§6.10): the
 * moment to forget the visit's local data — recents, pins, drafts, the
 * offline caches and the outbox — before the notice says the data was reset.
 *
 * It is the frame's `onDemoGenerationChange(generation)` as an event. The
 * clearing itself is `clearDemoLocalData` in `@itsm/pwa/demo`, which this
 * package does not depend on, and each application clears its own keys
 * (`isPersonalKey`), so each application answers the event:
 * `onDemoGenerationChange((generation) => import('@itsm/pwa/demo').then(({
 * clearDemoLocalData }) => clearDemoLocalData({ generation, alsoKeys })))`.
 * The watch waits for the work handed to `waitUntil` (a few seconds at
 * most), then records the generation and shows the notice.
 */
export const DEMO_GENERATION_CHANGE_EVENT = 'itsm:demo-generation-change';

export interface DemoGenerationChangeDetail {
  readonly generation: number;
  /** Hands the watch a promise to wait for before the notice appears. */
  waitUntil(work: Promise<unknown>): void;
}

/**
 * Runs `handler` whenever the bar meets a newer generation; returns the
 * unsubscribe. A promise the handler returns is waited for (`waitUntil`).
 */
export function onDemoGenerationChange(handler: (generation: number) => Promise<unknown> | void): () => void {
  const listener = (event: Event): void => {
    const detail = (event as CustomEvent<DemoGenerationChangeDetail>).detail;
    if (!detail || typeof detail.generation !== 'number') return;
    const work = handler(detail.generation);
    if (work) detail.waitUntil(work);
  };
  window.addEventListener(DEMO_GENERATION_CHANGE_EVENT, listener);
  return () => window.removeEventListener(DEMO_GENERATION_CHANGE_EVENT, listener);
}

/* -------------------------------------------------------------------------
 * Notices
 * ---------------------------------------------------------------------- */

/** One notice under the bars (A2 §9.3): the reset notices and "A reset is already running." */
export interface DemoNoticeSpec {
  readonly kind: 'fresh' | 'stale' | 'ready' | 'running';
  readonly text: string;
  /** The generation it is about, remembered when the visitor dismisses it. */
  readonly generation?: number;
}

/** Where the frame keeps the notice slot: after `main` (`SYSTEM_NOTICE_ID` in `frame.tsx`). */
export const DEMO_NOTICE_HOST_ID = 'itsm-system-notice';

/* -------------------------------------------------------------------------
 * The controls
 * ---------------------------------------------------------------------- */

const detailsModule = lazyModule(() => import('./DemoDetailsPopover.js'));
const resetModule = lazyModule(() => import('./DemoResetDialog.js'));
const watchModule = lazyModule(() => import('./demo-watch.js'));

type WatchModule = typeof import('./demo-watch.js');

const DEFAULT_ENDPOINTS = Object.freeze({ status: '/api/demo/status', reset: '/api/demo/reset' } as const);

/** How long the watch waits for an idle moment before it starts anyway (the portal prefetch pattern, A2 §9.6). */
const WATCH_IDLE_TIMEOUT_MS = 8000;

export interface DemoBarControlsProps {
  readonly variant: 'session' | 'public';
  readonly clock: DemoClock;
  readonly persona?: { readonly name: string; readonly title: string };
  /** The generation the page was rendered with (`bff.latestSession(session).demoGeneration`). */
  readonly generation?: number;
  readonly areas?: AreaModel;
  readonly endpoints?: { readonly status: string; readonly reset: string };
  readonly links?: { readonly home?: string; readonly howItWorks?: string };
}

type TriggerProps = Partial<Omit<IntentTriggerProps, 'ref'>> & {
  readonly ref: IntentTriggerProps['ref'];
  readonly 'aria-expanded'?: boolean;
};

function whenIdle(run: () => void): () => void {
  if (typeof window.requestIdleCallback === 'function') {
    const handle = window.requestIdleCallback(run, { timeout: WATCH_IDLE_TIMEOUT_MS });
    return () => window.cancelIdleCallback(handle);
  }
  const handle = window.setTimeout(run, 1500);
  return () => window.clearTimeout(handle);
}

/** A trigger the account menu asked for may be off screen (the phone bar scrolls away): bring it back first. */
function reveal(element: HTMLElement | null): void {
  element?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
}

/**
 * The bar's two buttons — Demo details and Reset demo data — and, in a
 * session, the status watch and the notice under the bars (A2 §9.6).
 *
 * Both buttons are plain until there is intent (`useIntentLoader`): the
 * details popover and the reset flow are Radix modules a demo page should
 * not pay for until someone reaches for them. The account menu's Demo group
 * reaches them through window events. The watch starts when the browser is
 * idle, and only in a session: the public bar never polls (its clock is
 * pure, A2 §9.7).
 *
 * Reset stays focusable while it is unavailable (`aria-disabled`), so a
 * press can say why (the v2 X-80 pattern); it is not offered at all once the
 * route has answered 403 or 404.
 */
export function DemoBarControls({ variant, clock, persona, generation, areas, endpoints = DEFAULT_ENDPOINTS, links = {} }: DemoBarControlsProps): ReactNode {
  const session = variant === 'session';
  const details = useIntentLoader(detailsModule);
  const reset = useIntentLoader(resetModule);
  const bar = useDemoBarState();
  const [notice, setNotice] = useState<DemoNoticeSpec | null>(null);
  const [watch, setWatch] = useState<WatchModule | null>(null);
  const [, setTick] = useState(0);

  const now = Date.now() + bar.skewMs;
  const block = session ? resetBlock(bar.status, bar.building !== null, now) : null;
  const resetOffered = session && !bar.resetHidden;

  // A cooldown ends on its own: re-render when it does, so the button stops saying it is unavailable.
  const until = block && (block.kind === 'cooldown' || block.kind === 'backoff') ? block.until : null;
  useEffect(() => {
    if (until === null) return;
    const handle = window.setTimeout(() => setTick((value) => value + 1), Math.max(0, until - (Date.now() + demoBarState().skewMs)) + 250);
    return () => window.clearTimeout(handle);
  }, [until]);

  const showNotice = (next: DemoNoticeSpec | null): void => {
    setNotice(next);
    if (next) {
      fetchModule(watchModule).then(
        (module) => setWatch(() => module),
        () => undefined,
      );
    }
  };
  const showNoticeRef = useRef(showNotice);
  showNoticeRef.current = showNotice;

  // The status watch: idle, session only, once per page generation.
  useEffect(() => {
    if (!session) return;
    let stop: (() => void) | undefined;
    let cancelled = false;
    const cancelIdle = whenIdle(() => {
      fetchModule(watchModule).then(
        (module) => {
          if (cancelled) return;
          setWatch(() => module);
          stop = module.startDemoWatch({
            endpoint: endpoints.status,
            generation: generation ?? null,
            onNotice: (next) => showNoticeRef.current(next),
          });
        },
        () => undefined,
      );
    });
    return () => {
      cancelled = true;
      cancelIdle();
      stop?.();
    };
  }, [session, endpoints.status, generation]);

  // The account menu's Demo group: "Reset demo data…" and "Demo details".
  const latest = useRef({ details, reset, resetOffered });
  latest.current = { details, reset, resetOffered };
  useEffect(() => {
    const openDetails = (): void => {
      const loader = latest.current.details;
      reveal(loader.triggerElement());
      if (loader.loaded) loader.setOpen(true);
      else loader.intentProps.onClick();
    };
    const openReset = (): void => {
      // Nothing to reset with here: the details say what the demo is instead of a dead menu item.
      if (!latest.current.resetOffered) {
        openDetails();
        return;
      }
      const loader = latest.current.reset;
      reveal(loader.triggerElement());
      if (loader.loaded) loader.setOpen(true);
      else loader.intentProps.onClick();
    };
    window.addEventListener(DEMO_BAR_EVENTS.detailsRequest, openDetails);
    window.addEventListener(DEMO_BAR_EVENTS.resetRequest, openReset);
    return () => {
      window.removeEventListener(DEMO_BAR_EVENTS.detailsRequest, openDetails);
      window.removeEventListener(DEMO_BAR_EVENTS.resetRequest, openReset);
    };
  }, []);

  const infoTrigger = (props: TriggerProps): ReactElement<{ id?: string }> => (
    <button type="button" className="itsm-SystemBar__action itsm-DemoBar__info" aria-label="Demo details" aria-haspopup="dialog" {...props}>
      <Icon name="info" size={15} />
    </button>
  );

  const resetTrigger = (props: TriggerProps): ReactElement<{ id?: string }> => (
    <button
      type="button"
      className="itsm-SystemBar__action itsm-DemoBar__reset"
      aria-haspopup="dialog"
      aria-disabled={block ? 'true' : undefined}
      {...props}
    >
      <Icon name="history" size={15} />
      <span className="itsm-SystemBar__actionLabel">Reset demo data</span>
    </button>
  );

  const Details = details.loaded?.DemoDetailsPopover;
  const ResetFlow = reset.loaded?.DemoResetDialog;
  const NoticeView = watch?.DemoNoticeView;
  const noticeHost = notice && typeof document !== 'undefined' ? document.getElementById(DEMO_NOTICE_HOST_ID) : null;

  return (
    <>
      {Details ? (
        <Details
          trigger={infoTrigger({ ref: details.triggerRef })}
          open={details.open}
          onOpenChange={details.setOpen}
          variant={variant}
          clock={clock}
          {...(persona ? { persona } : {})}
          {...(areas ? { areas } : {})}
          links={links}
          resetOffered={resetOffered}
          onReset={() => window.dispatchEvent(new CustomEvent(DEMO_BAR_EVENTS.resetRequest))}
        />
      ) : (
        infoTrigger({ ...details.intentProps, 'aria-expanded': false })
      )}
      {resetOffered ? (
        ResetFlow ? (
          <ResetFlow
            trigger={resetTrigger({ ref: reset.triggerRef })}
            open={reset.open}
            onOpenChange={reset.setOpen}
            endpoints={endpoints}
            onNotice={showNotice}
          />
        ) : (
          resetTrigger({ ...reset.intentProps, 'aria-expanded': false })
        )
      ) : null}
      {notice && NoticeView && noticeHost ? createPortal(<NoticeView notice={notice} onClose={() => setNotice(null)} />, noticeHost) : null}
    </>
  );
}
