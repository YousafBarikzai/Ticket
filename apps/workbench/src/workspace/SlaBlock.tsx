'use client';

import type { MouseEvent, ReactNode } from 'react';
import type { SlaTimer } from '@itsm/sdk';
import { Icon, SlaClock, describeRemaining, useItsm, type IconName, type Tone } from '@itsm/ui';
import { BulletBar } from '@itsm/ui/charts';
import { formatDateTime } from '@itsm/ui/format';

/**
 * The ticket hero's SLA block (v3 §7.1.4, A6 §5.6.2): the one clock the
 * ticket answers to, said three ways — a 44 px ring of the time used, "Resolve
 * by 16:01" with what is left, and a bullet of the share used — and, when the
 * ticket owes updates, which one is next ("Update 3 · next due 14:30", from
 * the timer's `cycle`, F1).
 *
 * It replaces the v2 header's "Next update 2 h 35 min left" words because a
 * deadline is the first thing an agent reads on a ticket and the last thing a
 * row of chips made visible. Every reading comes from the server's timer —
 * business time, never this machine's clock — so the server render and the
 * first browser render agree; the ring then counts down to `dueAt`.
 *
 * The line that names the deadline is a button: it opens the inspector's
 * Service levels card, where every timer has its own bar. The rest of the
 * block answers a pointer too, so the whole block is the target the eye
 * sees, while the keyboard has one stop.
 *
 * In the inbox's pane the block is compact — a 28 px ring and two lines —
 * because the pane is narrow and the inspector sits beside it.
 */

type ClockState = 'running' | 'paused' | 'met' | 'breached';

export function clockState(state: string): ClockState {
  return state === 'running' || state === 'met' || state === 'breached' ? state : 'paused';
}

/**
 * The timer the ticket answers to: the running one due soonest, else a
 * breached one, else a paused one, else the last met. The block, the phone
 * chip and the inspector's first row all speak for it.
 */
export function headlineTimer(timers: readonly SlaTimer[] | null): SlaTimer | null {
  if (!timers || timers.length === 0) return null;
  const due = (timer: SlaTimer): number => (timer.dueAt ? Date.parse(timer.dueAt) : Number.POSITIVE_INFINITY);
  const running = timers.filter((timer) => timer.state === 'running').sort((a, b) => due(a) - due(b));
  if (running[0]) return running[0];
  return (
    timers.find((timer) => timer.state === 'breached') ??
    timers.find((timer) => clockState(timer.state) === 'paused') ??
    timers[timers.length - 1] ??
    null
  );
}

/** The verb a deadline is met by: "Resolve by", "Reply by", "Update by". */
const DUE_VERB: Readonly<Record<string, string>> = {
  response: 'Reply',
  update: 'Update',
  resolution: 'Resolve',
  restoration: 'Restore',
  fulfilment: 'Fulfil',
  approval: 'Decide',
};

/** The target's name in a sentence: "Resolution target passed". */
const TARGET_NAME: Readonly<Record<string, string>> = {
  response: 'First response',
  update: 'Update',
  resolution: 'Resolution',
  restoration: 'Restoration',
  fulfilment: 'Fulfilment',
  approval: 'Approval',
};

export function targetName(targetType: string): string {
  return TARGET_NAME[targetType] ?? targetType.charAt(0).toUpperCase() + targetType.slice(1).replaceAll('_', ' ');
}

/** What a paused clock is waiting for, in the ticket's own words (A6 §5.6.2). */
const PAUSED_FOR: Readonly<Record<string, string>> = {
  pending_requester: 'SLA paused while waiting on the requester',
  pending_third_party: 'SLA paused while waiting on a supplier',
  pending_approval: 'SLA paused while waiting for approval',
};

/** Share of a timer's business time used, 0–1; `null` when the API gave no length. */
export function shareUsed(timer: SlaTimer): number | null {
  const state = clockState(timer.state);
  if (state === 'breached' || state === 'met') return 1;
  const total = timer.remainingMs + timer.elapsedMs;
  if (total <= 0) return null;
  return Math.min(1, Math.max(0, timer.elapsedMs / total));
}

/** "40 min", "3 h", "1 d" ago, floored to a whole unit so it never rounds up; "just now" under a minute. */
export function agoText(from: number, now: number): string {
  const minutes = Math.floor((now - from) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

export type SlaBlockState = 'running' | 'due_soon' | 'breached' | 'paused' | 'met' | 'none';

export interface SlaBlockReading {
  readonly state: SlaBlockState;
  readonly headline: SlaTimer | null;
  /** "Resolve by 16:01", "SLA paused while waiting on the requester", "All targets met". */
  readonly line1: string;
  /** "2 h 35 min left", "Resolution · 62% used". */
  readonly line2: string | null;
  /** The headline's share of time used, for the bullet; `null` without one. */
  readonly used: number | null;
  /** "Update 3 · next due 14:30" while an update target runs. */
  readonly update: string | null;
}

export interface ReadingContext {
  readonly now: number;
  readonly locale: string;
  readonly timeZone: string;
  /** The ticket's status: a paused clock says what it waits for. */
  readonly status?: string;
  /** The minutes under which a running clock is at risk (amber); an hour by default, as `SlaClock`'s. */
  readonly urgentBelowMinutes?: number;
}

/** A deadline's time of day when it is within the day, else with the weekday: "16:01", "Thu 09:00". */
function when(at: string, { now, locale, timeZone }: ReadingContext): string {
  const soon = Math.abs(Date.parse(at) - now) < 20 * 60 * 60_000;
  return formatDateTime(at, { locale, timeZone, style: soon ? 'time' : 'weekdayTime' });
}

/**
 * The block in words, from the timers alone. Pure, so each of its five states
 * is tested with a list of timers rather than a rendered ticket.
 */
export function slaBlockReading(timers: readonly SlaTimer[], context: ReadingContext): SlaBlockReading {
  const headline = headlineTimer(timers);
  if (!headline) return { state: 'none', headline: null, line1: 'No service levels apply', line2: null, used: null, update: null };

  const updateTimer = timers.find((timer) => timer.targetType === 'update' && clockState(timer.state) === 'running' && timer.dueAt);
  const update = updateTimer?.dueAt
    ? updateTimer.cycle !== undefined
      ? `Update ${updateTimer.cycle} · next due ${when(updateTimer.dueAt, context)}`
      : `Next update due ${when(updateTimer.dueAt, context)}`
    : null;
  const used = shareUsed(headline);
  const percent = used === null ? null : new Intl.NumberFormat(context.locale, { style: 'percent', maximumFractionDigits: 0 }).format(used);
  const state = clockState(headline.state);
  const name = targetName(headline.targetType);

  if (state === 'met') {
    const allMet = timers.every((timer) => clockState(timer.state) === 'met');
    return {
      state: 'met',
      headline,
      line1: allMet ? 'All targets met' : `${name} met`,
      line2: headline.metAt ? `${name} met ${when(headline.metAt, context)}` : null,
      used: null,
      update,
    };
  }
  if (state === 'breached' || (state === 'running' && headline.dueAt && Date.parse(headline.dueAt) <= context.now)) {
    const at = headline.breachedAt ?? headline.dueAt;
    return {
      state: 'breached',
      headline,
      line1: at ? `${name} target passed ${agoText(Date.parse(at), context.now)} (${when(at, context)})` : `${name} target passed`,
      line2: null,
      used: 1,
      update,
    };
  }
  if (state === 'paused') {
    return {
      state: 'paused',
      headline,
      line1: PAUSED_FOR[context.status ?? ''] ?? 'SLA paused',
      line2: percent ? `${name} · ${percent} used` : name,
      used,
      update,
    };
  }
  const minutes = Math.round(headline.remainingMs / 60_000);
  const verb = DUE_VERB[headline.targetType];
  return {
    state: minutes <= (context.urgentBelowMinutes ?? 60) ? 'due_soon' : 'running',
    headline,
    line1: headline.dueAt ? (verb ? `${verb} by ${when(headline.dueAt, context)}` : `${name} due ${when(headline.dueAt, context)}`) : `${name} running`,
    line2: percent ? `${describeRemaining(minutes)} · ${percent} used` : describeRemaining(minutes),
    used,
    update,
  };
}

const STATE_LOOK: Readonly<Record<SlaBlockState, { readonly tone: Tone; readonly icon: IconName }>> = {
  running: { tone: 'neutral', icon: 'clock' },
  due_soon: { tone: 'warning', icon: 'triangle-alert' },
  breached: { tone: 'danger', icon: 'circle-alert' },
  paused: { tone: 'hold', icon: 'pause' },
  met: { tone: 'success', icon: 'circle-check' },
  none: { tone: 'neutral', icon: 'clock' },
};

export interface SlaBlockProps {
  /** Every timer on the ticket; `null` when they could not be read (no SLA module, no right): the block is absent. */
  readonly timers: readonly SlaTimer[] | null;
  /** The ticket's status, so a paused clock says what it waits for. */
  readonly status: string;
  /** The pane's block: a 28 px ring and two lines, no bullet. */
  readonly compact?: boolean;
  /** Opens the inspector's Service levels card. */
  readonly onOpen?: () => void;
  /** The workspace's clock, for tests; the ring keeps its own. */
  readonly now?: number;
}

/** The ring for a timer: `SlaClock`, whose own words this block replaces with its lines. */
function Ring({ timer, size }: { readonly timer: SlaTimer; readonly size: 'sm' | 'lg' }): ReactNode {
  const state = clockState(timer.state);
  const total = timer.remainingMs + timer.elapsedMs > 0 ? Math.round((timer.remainingMs + timer.elapsedMs) / 60_000) : undefined;
  return (
    <SlaClock
      className="app-SlaBlock__clock"
      targetType={timer.targetType}
      state={state}
      remainingMinutes={state === 'running' ? Math.round(timer.remainingMs / 60_000) : null}
      display="ring"
      ringSize={size}
      breachedAt={timer.breachedAt}
      {...(total ? { totalMinutes: total } : {})}
      {...(state === 'running' && timer.dueAt ? { dueAt: timer.dueAt } : {})}
    />
  );
}

export function SlaBlock({ timers, status, compact = false, onOpen, now }: SlaBlockProps): ReactNode {
  const { locale, timeZone } = useItsm();
  if (timers === null) return null;
  const reading = slaBlockReading(timers, { now: now ?? Date.now(), locale, timeZone, status });
  const look = STATE_LOOK[reading.state];
  const open = onOpen
    ? (event: MouseEvent<HTMLElement>): void => {
        // The button answers for itself; the rest of the block is a larger target for a pointer.
        if ((event.target as Element).closest?.('.app-SlaBlock__open')) return;
        onOpen();
      }
    : undefined;

  return (
    <div className="app-SlaBlock" data-state={reading.state} data-tone={look.tone} data-compact={compact ? '' : undefined} onClick={open}>
      {reading.headline ? (
        <Ring timer={reading.headline} size={compact ? 'sm' : 'lg'} />
      ) : (
        <span className="app-SlaBlock__icon" aria-hidden="true">
          <Icon name="clock" size="sm" />
        </span>
      )}
      <div className="app-SlaBlock__text">
        {onOpen && reading.headline ? (
          <button type="button" className="app-SlaBlock__open app-SlaBlock__line1" onClick={onOpen}>
            {reading.line1}
            <span className="itsm-visually-hidden"> · show every service level</span>
          </button>
        ) : (
          <p className="app-SlaBlock__line1">{reading.line1}</p>
        )}
        {reading.line2 ? (
          <p className="app-SlaBlock__line2" suppressHydrationWarning>
            {reading.line2}
          </p>
        ) : null}
        {!compact && reading.used !== null && reading.state !== 'met' ? (
          <BulletBar
            className="app-SlaBlock__bullet"
            label="Time used"
            value={reading.used}
            max={1}
            target={1}
            cap
            compact
            format={{ style: 'percent', maximumFractionDigits: 0 }}
            locale={locale}
          />
        ) : null}
        {!compact && reading.update ? (
          <p className="app-SlaBlock__update">
            <Icon name="history" size="xs" />
            {reading.update}
          </p>
        ) : null}
      </div>
    </div>
  );
}
