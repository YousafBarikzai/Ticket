'use client';

import type { ReactNode } from 'react';
import type { SlaTimer } from '@itsm/sdk';
import { StatusPill, SLA_STATE_LOOK, describeRemaining, useItsm, type StateLook } from '@itsm/ui';
import { BulletBar } from '@itsm/ui/charts';
import { formatDateTime } from '@itsm/ui/format';
import { agoText, clockState, headlineTimer, shareUsed, targetName } from '../SlaBlock.js';

/**
 * The inspector's Service levels card (v3 §7.1.4, A6 §5.6.5 row 2): every
 * timer on the ticket as a row — what it is for ("Update · cycle 3"), a
 * bullet of the business time used against the target, and how it stands in
 * words ("Due 16:01 · 2 h 35 min left", "Met 09:12", "Breached 1 d ago",
 * "Paused") with its `SLA_STATE_LOOK` tone. The timer the hero's SLA block
 * speaks for leads.
 *
 * No policy name: the ticket's answer carries no `slaPolicyId`, so the card
 * names targets only rather than guess.
 */

const DUE_LATER: StateLook = { tone: 'neutral', icon: 'clock', label: 'Due' };

/** "Resolution", "Update · cycle 3": a row's name. */
export function timerLabel(timer: SlaTimer): string {
  const name = targetName(timer.targetType);
  return timer.targetType === 'update' && timer.cycle !== undefined && timer.cycle > 1 ? `${name} · cycle ${timer.cycle}` : name;
}

/** "Due 16:01 · 2 h 35 min left", "Met 09:12", "Breached 1 d ago", "Paused" — how a timer stands, and its look. */
export function timerStanding(timer: SlaTimer, at: (value: string) => string, now: number): { readonly text: string; readonly look: StateLook } {
  const state = clockState(timer.state);
  if (state === 'met') return { text: timer.metAt ? `Met ${at(timer.metAt)}` : 'Met', look: SLA_STATE_LOOK.met };
  if (state === 'paused') return { text: 'Paused', look: SLA_STATE_LOOK.paused };
  const overdueAt = state === 'breached' ? (timer.breachedAt ?? timer.dueAt) : timer.dueAt && Date.parse(timer.dueAt) <= now ? timer.dueAt : null;
  if (state === 'breached' || overdueAt) {
    return { text: overdueAt ? `Breached ${agoText(Date.parse(overdueAt), now)}` : 'Breached', look: SLA_STATE_LOOK.breached };
  }
  const minutes = Math.round(timer.remainingMs / 60_000);
  const left = describeRemaining(minutes);
  return {
    text: timer.dueAt ? `Due ${at(timer.dueAt)} · ${left}` : left,
    // A deadline still far off is quiet, as the row chip's "Due 16:30" is: green is for a target met.
    look: minutes <= 60 ? SLA_STATE_LOOK.due_soon : DUE_LATER,
  };
}

/** The old line under each timer, kept for the callers that word one timer alone. */
export function timerWhen(timer: SlaTimer, at: (value: string) => string): string {
  const state = clockState(timer.state);
  if (state === 'met') return timer.metAt ? `Met at ${at(timer.metAt)}` : 'Met';
  if (state === 'breached') return timer.breachedAt ? `Breached at ${at(timer.breachedAt)}` : 'Breached';
  if (state === 'paused') return 'Paused while the ticket waits';
  return timer.dueAt ? `Due ${at(timer.dueAt)}` : 'Running';
}

export function SlaSection({ timers, now }: { readonly timers: readonly SlaTimer[]; readonly now?: number }): ReactNode {
  const { locale, timeZone } = useItsm();
  const moment = now ?? Date.now();
  const at = (value: string): string =>
    formatDateTime(value, { locale, timeZone, style: Math.abs(Date.parse(value) - moment) < 20 * 60 * 60_000 ? 'time' : 'weekdayTime' });
  if (timers.length === 0) {
    return <p className="app-Insp__empty">No service levels apply to this ticket.</p>;
  }
  const headline = headlineTimer(timers);
  const ordered = headline ? [headline, ...timers.filter((timer) => timer !== headline)] : [...timers];
  return (
    <ul className="app-InspSla">
      {ordered.map((timer) => {
        const standing = timerStanding(timer, at, moment);
        const used = shareUsed(timer);
        return (
          <li key={timer.id} className="app-InspSla__row" data-state={clockState(timer.state)} data-headline={timer === headline ? '' : undefined}>
            <div className="app-InspSla__head">
              <span className="app-InspSla__name">{timerLabel(timer)}</span>
              <StatusPill size="sm" tone={standing.look.tone} icon={standing.look.icon} label={standing.text} className="app-InspSla__state" />
            </div>
            {used !== null ? (
              <BulletBar
                className="app-InspSla__bullet"
                label={`${timerLabel(timer)}, time used`}
                value={used}
                max={1}
                target={1}
                cap
                compact
                format={{ style: 'percent', maximumFractionDigits: 0 }}
                locale={locale}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
