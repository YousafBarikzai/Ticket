'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../icons/Icon.js';
import { demoBarState, subscribeDemoBarState, updateDemoBarState, useDemoBarState } from './DemoBarControls.js';

/**
 * The reset clock the server hands the bar: the pure UK clock
 * (`nextResetAt(now)` and friends in `@itsm/contracts/demo`), computed when
 * the page was rendered, so the countdown needs no request (A2 §9.6).
 */
export interface DemoClock {
  /** The next reset, epoch ms. */
  readonly nextResetAt: number;
  /** The server's clock when it rendered the page, epoch ms. */
  readonly serverNow: number;
  /** Length of the current demo day: 24 h, or 23 h and 25 h on the change days. */
  readonly periodMs: number;
  /** "00:00 UK time". */
  readonly resetLabel: string;
  /** "Europe/London". */
  readonly timeZone: string;
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;

/** The minutes at which the countdown says how long is left (A2 §9.3). */
export const COUNTDOWN_ANNOUNCE_MINUTES: readonly number[] = Object.freeze([10, 5, 1]);
/** Under this the countdown sits in the amber pill. */
export const COUNTDOWN_WARNING_MS = 10 * MINUTE;

/**
 * A client clock this far from the server's when the page arrives is wrong,
 * not slow to hydrate. Closer than this the client clock is trusted until a
 * poll measures the difference properly (with its round trip).
 */
const RENDER_SKEW_TOLERANCE_MS = 5 * SECOND;

const two = (value: number): string => String(value).padStart(2, '0');

/** `HH:MM:SS`, whole seconds rounded down; hours past 24 on the 25-hour day. Never negative. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / SECOND));
  return `${two(Math.floor(total / 3600))}:${two(Math.floor((total % 3600) / 60))}:${two(total % 60)}`;
}

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`;

/** "9 hours 1 minute", "42 minutes", "less than a minute": what the timer's name says, once a minute. */
export function spokenCountdown(ms: number): string {
  if (ms < MINUTE) return 'less than a minute';
  const totalMinutes = Math.floor(ms / MINUTE);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return plural(minutes, 'minute');
  return minutes === 0 ? plural(hours, 'hour') : `${plural(hours, 'hour')} ${plural(minutes, 'minute')}`;
}

/**
 * The announcement minute crossed between two readings, if any: the
 * smallest, because after a tab was hidden for a while only the latest news
 * is worth saying. Never on the first reading — a page opened with seven
 * minutes left does not announce "ten".
 */
export function crossedAnnouncement(previous: number | null, next: number): number | null {
  if (previous === null) return null;
  const crossed = [...COUNTDOWN_ANNOUNCE_MINUTES]
    .sort((a, b) => a - b)
    .find((minutes) => previous > minutes * MINUTE && next <= minutes * MINUTE && next > 0);
  return crossed ?? null;
}

/**
 * Milliseconds until the next reset on the server's clock, re-read once a
 * second on the second.
 *
 * The first value is the server's own (`nextResetAt − serverNow`), so the
 * client's first render matches the HTML. After that the client clock is used
 * with the skew a poll measured (`skewMs`), or, before any poll, with the
 * server's render time when the two disagree by more than a hydration delay
 * could explain. Ticks are aligned to the second, stop while the tab is
 * hidden and catch up at once when it returns. When the reset passes, the
 * next one comes from the pure clock, loaded only then, or from a newer poll.
 */
export function useResetRemaining(clock: DemoClock): { readonly remaining: number; readonly target: number } {
  const polled = useDemoBarState().status?.nextResetAt;
  const [target, setTarget] = useState(clock.nextResetAt);
  const effective = polled !== undefined && polled > target ? polled : target;
  const [remaining, setRemaining] = useState(clock.nextResetAt - clock.serverNow);
  const effectiveRef = useRef(effective);
  effectiveRef.current = effective;
  const rolling = useRef(false);

  useEffect(() => {
    let timer: number | undefined;
    const read = (): number => Date.now() + demoBarState().skewMs;
    const tick = (): void => {
      const now = read();
      const left = effectiveRef.current - now;
      setRemaining(left);
      if (left <= 0 && !rolling.current) {
        rolling.current = true;
        void import('@itsm/contracts/demo').then(
          ({ nextResetAt }) => {
            rolling.current = false;
            setTarget(nextResetAt(read()));
          },
          () => {
            rolling.current = false;
          },
        );
      }
      window.clearTimeout(timer);
      if (document.visibilityState === 'hidden') return;
      // The shown second changes when the server's clock passes a whole second (the reset is on one):
      // tick a few milliseconds after the next one, or straight away when this reading sits on one.
      timer = window.setTimeout(tick, ((SECOND - (((now % SECOND) + SECOND) % SECOND)) % SECOND) + 5);
    };
    const onVisibility = (): void => {
      window.clearTimeout(timer);
      if (document.visibilityState !== 'hidden') tick();
    };
    // A new skew or a new target is felt at once, not at the next second.
    const unsubscribe = subscribeSkew(tick);
    tick();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearTimeout(timer);
      unsubscribe();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  useEffect(() => {
    setRemaining(effective - (Date.now() + demoBarState().skewMs));
  }, [effective]);

  return { remaining, target: effective };
}

/** Calls `onChange` when the store's skew changes. */
function subscribeSkew(onChange: () => void): () => void {
  let skew = demoBarState().skewMs;
  return subscribeDemoBarState(() => {
    const next = demoBarState().skewMs;
    if (next === skew) return;
    skew = next;
    onChange();
  });
}

export interface DemoCountdownProps {
  readonly clock: DemoClock;
}

/**
 * "Resets in 09:01:38" (A2 §9.2, §9.6): the bar's status island.
 *
 * - `role="timer"` with `aria-live="off"`: a ticking clock is not news. Its
 *   name says the time left in words and changes once a minute.
 * - At 10, 5 and 1 minutes a polite, visually hidden region with no role
 *   says "Demo data resets in 10 minutes" (nothing before `main` may carry
 *   `role="status"`, §3.9).
 * - It owns the bar's state: `warning` (the amber pill) under ten minutes,
 *   `busy` while a reset runs, written on `.itsm-SystemBar` itself so the
 *   server component never re-renders; and it adds the build's estimate to
 *   the bar's busy line ("Resetting now… about 2 minutes").
 * - In the last minute it reads "Resetting in 00:00:42".
 *
 * The time's text comes from the server's clock on the first render, so the
 * HTML and hydration agree; the `<time>` keeps `suppressHydrationWarning`
 * for the second that may tick between them.
 */
export function DemoCountdown({ clock }: DemoCountdownProps): ReactNode {
  const { remaining, target } = useResetRemaining(clock);
  const { building } = useDemoBarState();
  const own = useRef<HTMLSpanElement | null>(null);
  const previous = useRef<number | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [busyLine, setBusyLine] = useState<Element | null>(null);

  const busy = building !== null;
  const warning = !busy && remaining > 0 && remaining < COUNTDOWN_WARNING_MS;

  useEffect(() => {
    // Before any poll: trust the client clock unless it is clearly wrong.
    if (demoBarState().skewFrom !== 'none') return;
    const estimate = clock.serverNow - Date.now();
    updateDemoBarState({ skewFrom: 'render', skewMs: Math.abs(estimate) > RENDER_SKEW_TOLERANCE_MS ? estimate : 0 });
  }, [clock.serverNow]);

  useEffect(() => {
    setBusyLine(own.current?.closest('.itsm-SystemBar')?.querySelector('.itsm-SystemBar__busy') ?? null);
  }, []);

  useEffect(() => {
    const bar = own.current?.closest('.itsm-SystemBar');
    if (bar instanceof HTMLElement) bar.dataset.state = busy ? 'busy' : warning ? 'warning' : 'default';
  }, [busy, warning]);

  useEffect(() => {
    const crossed = crossedAnnouncement(previous.current, remaining);
    previous.current = remaining;
    if (crossed !== null) setAnnouncement(`Demo data resets in ${plural(crossed, 'minute')}`);
  }, [remaining]);

  return (
    <>
      <span ref={own} className="itsm-DemoCountdown" role="timer" aria-live="off" aria-label={`Demo data resets in ${spokenCountdown(remaining)}`}>
        <Icon name="timer" size={15} />
        <span className="itsm-DemoCountdown__lead" suppressHydrationWarning>
          {remaining < MINUTE ? 'Resetting in' : 'Resets in'}
        </span>{' '}
        <time dateTime={new Date(target).toISOString()} suppressHydrationWarning>
          {formatCountdown(remaining)}
        </time>
      </span>
      <span className="itsm-visually-hidden" aria-live="polite" aria-atomic="true">
        {announcement}
      </span>
      {busy && busyLine && building.etaText ? createPortal(<span className="itsm-DemoBar__eta"> {building.etaText}</span>, busyLine) : null}
    </>
  );
}
