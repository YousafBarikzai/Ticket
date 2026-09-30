'use client';

import { useState, type ReactNode } from 'react';
import { ProgressRing } from '../charts/ProgressRing.js';
import { StatusPill } from '../display/StatusPill.js';
import { Icon } from '../icons/Icon.js';
import { useNow } from '../provider/clock.js';
import type { IconName, Tone } from '../types.js';
import { cx } from '../web/cx.js';

/**
 * How long is left on an SLA target, and whether the clock is running.
 *
 * The thing this gets wrong if nobody thinks about it is **announcement**. A
 * countdown is exactly the sort of element somebody reaches for `aria-live` on,
 * and a live region that updates every minute makes a screen reader unusable —
 * it interrupts whatever the person is reading, for ever. The remaining time
 * is therefore plain text that a person reads when they look at it, and only a
 * *breach* is announced, once, because that is the state change worth
 * interrupting for.
 *
 * The second is **paused**. MOD-07 stops the clock while a ticket waits on the
 * requester, and a paused timer that renders a falling number is a lie that
 * costs somebody their afternoon. Paused says paused, and says nothing about
 * minutes.
 *
 * It **ticks** on the page's shared clock (one timer for every clock and
 * timestamp on the page, paused in a background tab), counting down from the
 * minutes it was given — or from `dueAt`, when it has one. The server's
 * render and the first render in the browser both show the minutes as given,
 * so hydration matches; the count moves on from there.
 *
 * Three ways to show it (SPEC §4.8): a status pill (`badge`, the default), a
 * line of `text` for the ticket header, and a `ring` of time used for the one
 * place a ring earns its space — the ticket's own header, never a list row
 * (X-33).
 */

export type SlaState = 'running' | 'paused' | 'met' | 'breached';

export interface SlaClockProps {
  /** `response`, `resolution`, `fulfilment` — what the target is for. */
  readonly targetType: string;
  readonly state: SlaState;
  /** Null when paused, met or breached: there is no meaningful countdown. */
  readonly remainingMinutes: number | null;
  /** Below this, the clock reads as urgent. Defaults to an hour. */
  readonly urgentBelowMinutes?: number;
  /** `badge` (default): label and pill. `text`: one line for the ticket header. `ring`: time used, ticket header only. */
  readonly display?: 'badge' | 'ring' | 'text';
  /** The whole target in minutes, for the ring's share of time used. */
  readonly totalMinutes?: number;
  /** When the target falls due (ISO 8601). With it the clock counts down to the real moment rather than from when it was drawn. */
  readonly dueAt?: string;
  readonly className?: string;
}

const STATE_TONE: Record<SlaState, Tone> = {
  running: 'neutral',
  paused: 'neutral',
  met: 'success',
  breached: 'danger',
};

const STATE_ICON: Record<SlaState, IconName> = {
  running: 'clock',
  paused: 'pause',
  met: 'circle-check',
  breached: 'circle-alert',
};

const TARGET_LABEL: Record<string, string> = {
  response: 'First response',
  update: 'Next update',
  restoration: 'Restoration',
  resolution: 'Resolution',
  fulfilment: 'Fulfilment',
  approval: 'Approval',
};

/**
 * Minutes as a person would say them. Not `HH:MM`: a countdown in digits
 * invites a glance-and-misread at exactly the moment somebody is busy.
 */
export function describeRemaining(minutes: number): string {
  if (minutes <= 0) return 'overdue';
  if (minutes < 60) return `${minutes} min left`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return rest === 0 ? `${hours} h left` : `${hours} h ${rest} min left`;
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours === 0 ? `${days} d left` : `${days} d ${restHours} h left`;
}

/**
 * The minutes left now. On the server and while hydrating (`useNow` is null)
 * it is exactly what was given. After that, a running clock counts down on the
 * shared clock: to `dueAt` when there is one, otherwise from the moment these
 * minutes were first shown in the browser.
 */
function useRemaining(remainingMinutes: number | null, state: SlaState, dueAt: string | undefined): number | null {
  const now = useNow();
  // When these minutes were first seen in the browser. Re-anchored whenever
  // the server sends a new figure, so a refresh corrects any drift. (State
  // set during render, React's pattern for remembering a previous prop.)
  const [anchor, setAnchor] = useState<{ readonly value: number; readonly at: number } | null>(null);
  if (now === null || state !== 'running') return remainingMinutes;
  const due = dueAt === undefined ? Number.NaN : Date.parse(dueAt);
  if (Number.isFinite(due)) return Math.ceil((due - now) / 60_000);
  if (remainingMinutes === null) return null;
  // A clock that went backwards (the computer's time was corrected) re-anchors too.
  if (anchor === null || anchor.value !== remainingMinutes || now < anchor.at) {
    setAnchor({ value: remainingMinutes, at: now });
    return remainingMinutes;
  }
  return remainingMinutes - Math.floor((now - anchor.at) / 60_000);
}

export function SlaClock({
  targetType,
  state,
  remainingMinutes,
  urgentBelowMinutes = 60,
  display = 'badge',
  totalMinutes,
  dueAt,
  className,
}: SlaClockProps): ReactNode {
  const label = TARGET_LABEL[targetType] ?? targetType;
  const remaining = useRemaining(remainingMinutes, state, dueAt);
  const urgent = state === 'running' && remaining !== null && remaining <= urgentBelowMinutes;

  const reading =
    state === 'breached'
      ? 'Breached'
      : state === 'met'
        ? 'Met'
        : state === 'paused'
          ? 'Paused'
          : remaining === null
            ? 'Running'
            : describeRemaining(remaining);
  const tone: Tone = urgent ? 'warning' : STATE_TONE[state];
  const icon: IconName = urgent ? 'triangle-alert' : STATE_ICON[state];

  // The share of the target used, for the ring: whole once breached or met.
  const used =
    state === 'breached' || state === 'met'
      ? 1
      : totalMinutes !== undefined && totalMinutes > 0 && remaining !== null
        ? Math.min(1, Math.max(0, 1 - remaining / totalMinutes))
        : null;

  // A ring needs a share to draw; without the target's length it reads as text.
  const shown = display === 'ring' && used === null ? 'text' : display;
  let body: ReactNode;
  if (shown === 'text') {
    // Quiet while there is time; an icon once it is at risk, stopped or over.
    const marked = urgent || state !== 'running';
    body = (
      <>
        {marked ? <Icon name={icon} size="sm" className="itsm-SlaClock__icon" /> : null}
        <span className="itsm-SlaClock__label">{label}</span>
        <span className="itsm-SlaClock__reading">{reading}</span>
      </>
    );
  } else if (shown === 'ring' && used !== null) {
    body = (
      <>
        <ProgressRing
          className="itsm-SlaClock__ring"
          value={used}
          size={32}
          label={`${label}, time used`}
          tone={state === 'met' ? 'success' : state === 'breached' ? 'danger' : state === 'paused' ? 'neutral' : urgent ? 'warning' : 'accent'}
        />
        <span className="itsm-SlaClock__stack">
          <span className="itsm-SlaClock__label">{label}</span>
          <span className="itsm-SlaClock__reading">{reading}</span>
        </span>
      </>
    );
  } else {
    body = (
      <>
        <span className="itsm-SlaClock__label">{label}</span>
        <StatusPill className="itsm-SlaClock__pill" label={reading} tone={tone} icon={icon} size="sm" />
      </>
    );
  }

  return (
    <div
      className={cx('itsm-SlaClock', urgent && 'itsm-SlaClock--urgent', className)}
      data-state={state}
      data-display={shown}
      data-tone={tone}
    >
      {body}
      {/*
        Announced once, and only for the state worth interrupting somebody for.
        A live countdown would talk over everything the person is reading.
      */}
      {state === 'breached' ? (
        <span role="status" className="itsm-visually-hidden">{`${label} target breached`}</span>
      ) : null}
    </div>
  );
}
