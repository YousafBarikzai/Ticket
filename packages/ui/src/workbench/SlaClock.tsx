'use client';

import type { ReactNode } from 'react';
import { Badge } from '../web/Badge.js';
import { cx } from '../web/cx.js';
import type { IntentName } from '../tokens/tokens.js';

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
  readonly className?: string;
}

const STATE_INTENT: Record<SlaState, IntentName> = {
  running: 'info',
  paused: 'neutral',
  met: 'success',
  breached: 'danger',
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

export function SlaClock({
  targetType,
  state,
  remainingMinutes,
  urgentBelowMinutes = 60,
  className,
}: SlaClockProps): ReactNode {
  const label = TARGET_LABEL[targetType] ?? targetType;
  const urgent = state === 'running' && remainingMinutes !== null && remainingMinutes <= urgentBelowMinutes;

  const reading =
    state === 'breached'
      ? 'Breached'
      : state === 'met'
        ? 'Met'
        : state === 'paused'
          ? 'Paused'
          : remainingMinutes === null
            ? 'Running'
            : describeRemaining(remainingMinutes);

  return (
    <div className={cx('itsm-SlaClock', urgent && 'itsm-SlaClock--urgent', className)} data-state={state}>
      <span className="itsm-SlaClock__label">{label}</span>
      <Badge intent={urgent ? 'warning' : STATE_INTENT[state]} srPrefix={label}>
        {reading}
      </Badge>
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
