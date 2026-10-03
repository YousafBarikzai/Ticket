'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { announce } from '../a11y/announcer.js';
import { ProgressRing } from '../charts/ProgressRing.js';
import { StatusPill } from '../display/StatusPill.js';
import { SLA_STATE_LOOK } from '../display/ticket-states.js';
import { formatDuration } from '../format/duration.js';
import { formatDateTime } from '../format/format.js';
import { Icon } from '../icons/Icon.js';
import { useNow } from '../provider/clock.js';
import { useOptionalItsm } from '../provider/ItsmProvider.js';
import type { IconName, Tone } from '../types.js';
import { cx } from '../web/cx.js';

/**
 * How long is left on an SLA target, and whether the clock is running.
 *
 * The thing this gets wrong if nobody thinks about it is **announcement**. A
 * countdown is exactly the sort of element somebody reaches for `aria-live` on,
 * and a live region that updates every minute makes a screen reader unusable —
 * it interrupts whatever the person is reading, for ever. So the clock is a
 * `timer` (v3, A6 §12: "every live clock is a `timer` that is not a live
 * region"): its words are read when a person reaches it, in full ("40 minutes
 * left", not "40 min"), and never pushed. Only a *breach that happens while
 * the page is open* is said, once, through the page's shared announcer —
 * that is the state change worth interrupting for. A clock that was already
 * breached when the page drew it is read in place like any other text; and a
 * `chip` never speaks, because a list of fifty rows could otherwise talk over
 * itself.
 *
 * The second is **paused**. MOD-07 stops the clock while a ticket waits on the
 * requester, and a paused timer that renders a falling number is a lie that
 * costs somebody their afternoon. Paused says paused, and says nothing about
 * minutes.
 *
 * It **ticks** on the page's shared clock (one timer for every clock and
 * timestamp on the page, paused in a background tab), counting down from the
 * minutes it was given — or from `dueAt`, when it has one. The server's
 * render and the first render in the browser both work from the props alone,
 * so hydration matches; the count moves on from there.
 *
 * Four ways to show it: a status pill beside the target's name (`badge`, the
 * default), a line of `text` for the ticket header, a `ring` of time used for
 * the one place a ring earns its space — the ticket's own header and SLA
 * block, never a list row (X-33) — and the v3 `chip`, the pill alone, for
 * rows and cards: "Breached 1 d ago", "Due in 40 min", "Due 16:30", "SLA
 * paused" (the copy register, SPEC §6.6). Tones follow D5 through
 * `SLA_STATE_LOOK`: paused is `hold`, due soon `warning` (the only amber in
 * the product), breached `danger`, met `success`.
 */

export type SlaState = 'running' | 'paused' | 'met' | 'breached';

export interface SlaClockProps {
  /** `response`, `resolution`, `fulfilment` — what the target is for. */
  readonly targetType: string;
  readonly state: SlaState;
  /** Null when paused, met or breached: there is no meaningful countdown. */
  readonly remainingMinutes: number | null;
  /** Below this, the clock reads as urgent ("due soon"). Defaults to an hour. */
  readonly urgentBelowMinutes?: number;
  /**
   * `badge` (default): label and pill. `text`: one line for the ticket header.
   * `ring`: time used, ticket header and SLA block only. `chip`: the pill
   * alone, for list rows and board cards.
   */
  readonly display?: 'badge' | 'ring' | 'text' | 'chip';
  /** The whole target in minutes, for the ring's share of time used. */
  readonly totalMinutes?: number;
  /** When the target falls due (ISO 8601). With it the clock counts down to the real moment rather than from when it was drawn. */
  readonly dueAt?: string | null;
  /** When the target was breached (ISO 8601), so a chip can say how long ago: "Breached 1 d ago". */
  readonly breachedAt?: string | null;
  /** The ring's size: `sm` 28 px (a condensed header), `lg` 44 px (the SLA block). 32 px without. */
  readonly ringSize?: 'sm' | 'lg';
  /** The reader's locale and zone for "Due 16:30"; the provider's (`me.locale`, `me.timeZone`) by default. */
  readonly locale?: string;
  readonly timeZone?: string;
  readonly className?: string;
}

const STATE_TONE: Record<SlaState, Tone> = {
  running: 'neutral',
  paused: SLA_STATE_LOOK.paused.tone,
  met: SLA_STATE_LOOK.met.tone,
  breached: SLA_STATE_LOOK.breached.tone,
};

const STATE_ICON: Record<SlaState, IconName> = {
  running: 'clock',
  paused: SLA_STATE_LOOK.paused.icon,
  met: SLA_STATE_LOOK.met.icon,
  breached: SLA_STATE_LOOK.breached.icon,
};

const TARGET_LABEL: Record<string, string> = {
  response: 'First response',
  update: 'Next update',
  restoration: 'Restoration',
  resolution: 'Resolution',
  fulfilment: 'Fulfilment',
  approval: 'Approval',
};

const MINUTE_MS = 60_000;
const HOUR_MINUTES = 60;
const DAY_MINUTES = 24 * 60;

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

/** What a chip says: the `SLA_STATE_LOOK` state it is, and its words for the eye and the ear. */
export type SlaChipKey = 'breached' | 'due_soon' | 'due_later' | 'paused' | 'met' | 'on_track';

export interface SlaChipReading {
  readonly key: SlaChipKey;
  readonly tone: Tone;
  readonly icon: IconName;
  /** On the pill: "Breached 1 d ago", "Due in 40 min", "Due 16:30", "SLA paused". */
  readonly text: string;
  /** Read out, without abbreviations and without the target's name: "breached 1 day ago", "due at 16:30". */
  readonly spoken: string;
}

export interface SlaChipInput {
  readonly state: SlaState;
  /** Minutes left now (negative once past due), or null when unknown. */
  readonly remaining: number | null;
  readonly urgentBelowMinutes: number;
  readonly dueAt?: string | null;
  readonly breachedAt?: string | null;
  /**
   * The moment to read against, in epoch milliseconds, or null when there is
   * none yet (the server and the hydrating render): the chip then says only
   * what the props alone can say, so both renders agree.
   */
  readonly now: number | null;
  readonly locale: string;
  readonly timeZone: string;
}

function parseInstant(value: string | null | undefined): number | null {
  if (typeof value !== 'string') return null;
  const at = Date.parse(value);
  return Number.isFinite(at) ? at : null;
}

/** Whole minutes, floored to the largest unit that fits — "1 d" for 44 hours — so "ago" never rounds up into the future. */
function wholeUnit(minutes: number): number {
  if (minutes >= DAY_MINUTES) return Math.floor(minutes / DAY_MINUTES) * DAY_MINUTES;
  if (minutes >= HOUR_MINUTES) return Math.floor(minutes / HOUR_MINUTES) * HOUR_MINUTES;
  return Math.floor(minutes);
}

const formats = new Map<string, Intl.DateTimeFormat | null>();

function dateFormat(locale: string, timeZone: string, kind: 'key' | 'spokenDay'): Intl.DateTimeFormat | null {
  const id = `${kind}|${locale}|${timeZone}`;
  if (!formats.has(id)) {
    let format: Intl.DateTimeFormat | null = null;
    try {
      format =
        kind === 'key'
          ? new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
          : new Intl.DateTimeFormat(locale, { timeZone, day: 'numeric', month: 'long' });
    } catch {
      // An unknown zone or locale: the caller falls back to UTC.
      format = null;
    }
    if (formats.size > 32) formats.clear();
    formats.set(id, format);
  }
  return formats.get(id) ?? null;
}

/** Calendar days from `from` to `to` where the reader is: 0 today, 1 tomorrow. */
function calendarDaysBetween(from: number, to: number, timeZone: string): number | null {
  const format = dateFormat('en-CA', timeZone, 'key') ?? dateFormat('en-CA', 'UTC', 'key');
  if (!format) return null;
  const day = (at: number): number => {
    const [year, month, date] = format.format(new Date(at)).split('-').map(Number);
    return Date.UTC(year!, month! - 1, date!);
  };
  const days = Math.round((day(to) - day(from)) / (DAY_MINUTES * MINUTE_MS));
  return Number.isFinite(days) ? days : null;
}

function spokenDay(at: number, locale: string, timeZone: string): string {
  const format = dateFormat(locale, timeZone, 'spokenDay') ?? dateFormat(locale, 'UTC', 'spokenDay');
  return format ? format.format(new Date(at)) : new Date(at).toISOString().slice(0, 10);
}

/**
 * The chip's state and words, from the props and a moment to read against.
 * Pure, so the server's render and the browser's first render agree, and so
 * every row of a list words the same clock the same way.
 */
export function describeSlaChip({ state, remaining, urgentBelowMinutes, dueAt, breachedAt, now, locale, timeZone }: SlaChipInput): SlaChipReading {
  const due = parseInstant(dueAt);
  if (state === 'paused') {
    const look = SLA_STATE_LOOK.paused;
    return { key: 'paused', tone: look.tone, icon: look.icon, text: look.label, spoken: 'SLA paused' };
  }
  if (state === 'met') {
    const look = SLA_STATE_LOOK.met;
    return { key: 'met', tone: look.tone, icon: look.icon, text: look.label, spoken: 'met' };
  }
  const overdue = state === 'running' && remaining !== null && remaining <= 0;
  if (state === 'breached' || overdue) {
    const look = SLA_STATE_LOOK.breached;
    // A running clock past its due time is breached in all but the server's
    // bookkeeping, which catches up within a minute: say so now.
    const since = parseInstant(breachedAt) ?? (overdue ? due : null);
    if (since === null || now === null) return { key: 'breached', tone: look.tone, icon: look.icon, text: look.label, spoken: 'breached' };
    const minutes = wholeUnit(Math.max(0, (now - since) / MINUTE_MS));
    if (minutes < 1) return { key: 'breached', tone: look.tone, icon: look.icon, text: `${look.label} just now`, spoken: 'breached just now' };
    return {
      key: 'breached',
      tone: look.tone,
      icon: look.icon,
      text: `${look.label} ${formatDuration(minutes, { locale, maxParts: 1 })} ago`,
      spoken: `breached ${formatDuration(minutes, { locale, style: 'long', maxParts: 1 })} ago`,
    };
  }
  if (remaining !== null && remaining <= urgentBelowMinutes) {
    const look = SLA_STATE_LOOK.due_soon;
    return {
      key: 'due_soon',
      tone: look.tone,
      icon: look.icon,
      text: `Due in ${formatDuration(remaining, { locale, maxParts: 2 })}`,
      spoken: `due in ${formatDuration(remaining, { locale, style: 'long', maxParts: 2 })}`,
    };
  }
  // Later than "soon": the clock time the person plans around. The moment to
  // read against is the clock's, or — before there is one — the one the props
  // imply (`dueAt` less the minutes left), which is the same on both renders.
  const reference = now ?? (due !== null && remaining !== null ? due - remaining * MINUTE_MS : null);
  if (due !== null) {
    const look = { tone: 'neutral' as const, icon: 'calendar' as const };
    const time = formatDateTime(due, { locale, timeZone, style: 'time' });
    const days = reference === null ? null : calendarDaysBetween(reference, due, timeZone);
    if (days === 0) return { key: 'due_later', ...look, text: `Due ${time}`, spoken: `due at ${time}` };
    if (days === 1) return { key: 'due_later', ...look, text: `Due tomorrow ${time}`, spoken: `due tomorrow at ${time}` };
    const day = formatDateTime(due, { locale, timeZone, style: 'monthDay' });
    if (days !== null) return { key: 'due_later', ...look, text: `Due ${day}`, spoken: `due on ${spokenDay(due, locale, timeZone)}` };
    return { key: 'due_later', ...look, text: `Due ${day}, ${time}`, spoken: `due on ${spokenDay(due, locale, timeZone)} at ${time}` };
  }
  if (remaining !== null) {
    return {
      key: 'due_later',
      tone: 'neutral',
      icon: 'calendar',
      text: `Due in ${formatDuration(remaining, { locale, maxParts: 2 })}`,
      spoken: `due in ${formatDuration(remaining, { locale, style: 'long', maxParts: 2 })}`,
    };
  }
  const look = SLA_STATE_LOOK.on_track;
  return { key: 'on_track', tone: look.tone, icon: look.icon, text: look.label, spoken: 'on track' };
}

/** The badge, text and ring reading, said in full: "2 hours 10 minutes left", never "2 h 10 min". */
function spokenReading(state: SlaState, remaining: number | null, urgent: boolean, locale: string): string {
  if (state === 'breached') return 'breached';
  if (state === 'met') return 'met';
  if (state === 'paused') return 'SLA paused';
  if (remaining === null) return 'running';
  if (remaining <= 0) return 'overdue';
  const left = `${formatDuration(remaining, { locale, style: 'long', maxParts: 2 })} left`;
  return urgent ? `due soon, ${left}` : left;
}

/**
 * The minutes left now. On the server and while hydrating (`useNow` is null)
 * it is exactly what was given. After that, a running clock counts down on the
 * shared clock: to `dueAt` when there is one, otherwise from the moment these
 * minutes were first shown in the browser.
 */
function useRemaining(remainingMinutes: number | null, state: SlaState, dueAt: string | null | undefined, now: number | null): number | null {
  // When these minutes were first seen in the browser. Re-anchored whenever
  // the server sends a new figure, so a refresh corrects any drift. (State
  // set during render, React's pattern for remembering a previous prop.)
  const [anchor, setAnchor] = useState<{ readonly value: number; readonly at: number } | null>(null);
  if (now === null || state !== 'running') return remainingMinutes;
  const due = parseInstant(dueAt);
  if (due !== null) return Math.ceil((due - now) / MINUTE_MS);
  if (remainingMinutes === null) return null;
  // A clock that went backwards (the computer's time was corrected) re-anchors too.
  if (anchor === null || anchor.value !== remainingMinutes || now < anchor.at) {
    setAnchor({ value: remainingMinutes, at: now });
    return remainingMinutes;
  }
  return remainingMinutes - Math.floor((now - anchor.at) / MINUTE_MS);
}

/**
 * Says "Resolution target breached" once, when the clock crosses into breach
 * while it is on screen — not when it was drawn already breached, which is
 * read in place. A running clock reaching nought counts: the server's state
 * follows within a minute, and that second change is not news again.
 */
function useBreachAnnouncement(overdue: boolean, label: string, enabled: boolean): void {
  const was = useRef(overdue);
  useEffect(() => {
    if (enabled && overdue && !was.current) announce(`${label} target breached`);
    was.current = overdue;
  }, [overdue, label, enabled]);
}

export function SlaClock({
  targetType,
  state,
  remainingMinutes,
  urgentBelowMinutes = 60,
  display = 'badge',
  totalMinutes,
  dueAt,
  breachedAt,
  ringSize,
  locale: localeProp,
  timeZone: timeZoneProp,
  className,
}: SlaClockProps): ReactNode {
  const itsm = useOptionalItsm();
  const locale = localeProp ?? itsm?.locale ?? 'en-GB';
  const timeZone = timeZoneProp ?? itsm?.timeZone ?? 'UTC';
  const now = useNow();
  const label = TARGET_LABEL[targetType] ?? targetType;
  const remaining = useRemaining(remainingMinutes, state, dueAt, now);
  const overdue = state === 'breached' || (state === 'running' && remaining !== null && remaining <= 0);
  const urgent = state === 'running' && remaining !== null && remaining > 0 && remaining <= urgentBelowMinutes;
  useBreachAnnouncement(overdue, label, display !== 'chip');

  if (display === 'chip') {
    const chip = describeSlaChip({ state, remaining, urgentBelowMinutes, dueAt, breachedAt, now, locale, timeZone });
    return (
      <span
        role="timer"
        aria-live="off"
        className={cx('itsm-SlaClock', className)}
        data-state={state}
        data-display="chip"
        data-tone={chip.tone}
        data-sla={chip.key}
      >
        <StatusPill className="itsm-SlaClock__pill" label={chip.text} tone={chip.tone} icon={chip.icon} size="sm" aria-hidden="true" />
        <span className="itsm-visually-hidden">{`${label}: ${chip.spoken}`}</span>
      </span>
    );
  }

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
  const tone: Tone = overdue ? SLA_STATE_LOOK.breached.tone : urgent ? 'warning' : STATE_TONE[state];
  const icon: IconName = overdue ? SLA_STATE_LOOK.breached.icon : urgent ? 'triangle-alert' : STATE_ICON[state];
  const spoken = `${label}: ${spokenReading(state, remaining, urgent, locale)}`;

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
    const marked = urgent || overdue || state !== 'running';
    body = (
      <>
        {marked ? <Icon name={icon} size="sm" className="itsm-SlaClock__icon" /> : null}
        <span className="itsm-SlaClock__label" aria-hidden="true">
          {label}
        </span>
        <span className="itsm-SlaClock__reading" aria-hidden="true">
          {reading}
        </span>
      </>
    );
  } else if (shown === 'ring' && used !== null) {
    body = (
      <>
        <ProgressRing
          className="itsm-SlaClock__ring"
          value={used}
          size={ringSize === 'lg' ? 48 : 32}
          label={`${label}, time used`}
          // `hold` is drawn by this component's stylesheet: the ring knows the status tones, not D5's waiting colour.
          tone={tone === 'hold' ? 'neutral' : tone === 'success' || tone === 'danger' || tone === 'warning' ? tone : state === 'running' ? 'accent' : 'neutral'}
        />
        <span className="itsm-SlaClock__stack" aria-hidden="true">
          <span className="itsm-SlaClock__label">{label}</span>
          <span className="itsm-SlaClock__reading">{reading}</span>
        </span>
      </>
    );
  } else {
    body = (
      <>
        <span className="itsm-SlaClock__label" aria-hidden="true">
          {label}
        </span>
        <StatusPill className="itsm-SlaClock__pill" label={reading} tone={tone} icon={icon} size="sm" aria-hidden="true" />
      </>
    );
  }

  return (
    <div
      role="timer"
      aria-live="off"
      className={cx('itsm-SlaClock', urgent && 'itsm-SlaClock--urgent', className)}
      data-state={state}
      data-display={shown}
      data-tone={tone}
      {...(shown === 'ring' && ringSize ? { 'data-ring-size': ringSize } : {})}
    >
      {body}
      <span className="itsm-visually-hidden">{spoken}</span>
    </div>
  );
}
