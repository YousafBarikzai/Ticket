'use client';

import type { ReactNode } from 'react';
import type { SlaTimer } from '@itsm/sdk';
import { SlaClock, useItsm } from '@itsm/ui';
import { formatDateTime } from '@itsm/ui/format';
import { headlineTimer } from '../PropertyChips.js';

/**
 * Every service-level timer on the ticket (SPEC §6.2 "SLA"): what each is
 * for, how it stands, and when it falls due or was met or breached. The
 * timer the header speaks for leads, drawn as a ring of the time used — the
 * one place a ring earns its space (X-33); the rest read as a line each.
 */

type ClockState = 'running' | 'paused' | 'met' | 'breached';

function clockState(state: string): ClockState {
  return state === 'running' || state === 'met' || state === 'breached' ? state : 'paused';
}

/** "Due 30 Sept 2026, 12:10", "Met at 29 Sep, 10:02", "Breached at …", "Paused" — the when of a timer. */
export function timerWhen(timer: SlaTimer, at: (value: string) => string): string {
  const state = clockState(timer.state);
  if (state === 'met') return timer.metAt ? `Met at ${at(timer.metAt)}` : 'Met';
  if (state === 'breached') return timer.breachedAt ? `Breached at ${at(timer.breachedAt)}` : 'Breached';
  if (state === 'paused') return 'Paused while the ticket waits';
  return timer.dueAt ? `Due ${at(timer.dueAt)}` : 'Running';
}

function Clock({ timer, display }: { readonly timer: SlaTimer; readonly display: 'ring' | 'badge' }): ReactNode {
  const state = clockState(timer.state);
  const remaining = state === 'running' ? Math.round(timer.remainingMs / 60_000) : null;
  const total = timer.remainingMs + timer.elapsedMs > 0 ? Math.round((timer.remainingMs + timer.elapsedMs) / 60_000) : undefined;
  return (
    <SlaClock
      targetType={timer.targetType}
      state={state}
      remainingMinutes={remaining}
      display={display}
      {...(total ? { totalMinutes: total } : {})}
      {...(state === 'running' && timer.dueAt ? { dueAt: timer.dueAt } : {})}
    />
  );
}

export function SlaSection({ timers }: { readonly timers: readonly SlaTimer[] }): ReactNode {
  const { locale, timeZone } = useItsm();
  const at = (value: string): string => formatDateTime(value, { locale, timeZone, style: 'datetime' });
  if (timers.length === 0) {
    return <p className="app-Insp__empty">No service levels apply to this ticket.</p>;
  }
  const headline = headlineTimer(timers);
  const ordered = headline ? [headline, ...timers.filter((timer) => timer !== headline)] : [...timers];
  return (
    <ul className="app-InspSla">
      {ordered.map((timer) => (
        <li key={timer.id} className="app-InspSla__row" data-state={clockState(timer.state)} data-headline={timer === headline ? '' : undefined}>
          <Clock timer={timer} display={timer === headline ? 'ring' : 'badge'} />
          <p className="app-InspSla__when">{timerWhen(timer, at)}</p>
        </li>
      ))}
    </ul>
  );
}
