'use client';

import type { AreaLink, AreaModel } from '@itsm/contracts/areas';
import { DEMO_COPY, DEMO_RESET, ukDateKey, type DemoResetReason } from '@itsm/contracts/demo';
import { useId, type ReactElement, type ReactNode } from 'react';
import { Icon } from '../icons/Icon.js';
import { Popover } from '../overlays/Popover.js';
import { Button } from '../web/Button.js';
import { useDemoBarState } from './DemoBarControls.js';
import { formatCountdown, useResetRemaining, type DemoClock } from './DemoCountdown.js';

export interface DemoDetailsPopoverProps {
  /** The bar's Info button; Radix makes it the popover's trigger. */
  readonly trigger: ReactElement<{ id?: string }>;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly variant: 'session' | 'public';
  readonly clock: DemoClock;
  readonly persona?: { readonly name: string; readonly title: string };
  readonly areas?: AreaModel;
  readonly links: { readonly home?: string; readonly howItWorks?: string };
  /** Reset is offered in this session (a demo session whose route has not refused it). */
  readonly resetOffered: boolean;
  /** Starts the bar's reset flow, which says why when Reset is unavailable. */
  readonly onReset: () => void;
  /**
   * Why Reset is unavailable now, or `null` (the status watch's
   * `currentResetReason`, once it has loaded): with it the button explains
   * itself in place (X-80); without it a press goes to the bar's flow, which
   * says the same.
   */
  readonly resetReason?: () => string | null;
}

const LONDON_PARTS = ['weekday', 'day', 'month', 'year', 'hour', 'minute'] as const;
type Parts = Record<(typeof LONDON_PARTS)[number], string>;

function partsIn(timeZone: string | undefined, instant: number): Parts {
  const format = new Intl.DateTimeFormat('en-GB', {
    ...(timeZone ? { timeZone } : {}),
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = { weekday: '', day: '', month: '', year: '', hour: '', minute: '' };
  for (const part of format.formatToParts(instant)) {
    if (part.type in parts) parts[part.type as keyof Parts] = part.value;
  }
  return parts;
}

/**
 * "Fri 3 Oct 2026, 00:00 UK time", and "(19:00 your time)" when this
 * browser's wall clock reads differently — with the day as well when the
 * date differs ("(Thu 19:00 your time)").
 */
export function resetWhen(clock: DemoClock, instant: number, localZone?: string): { readonly when: string; readonly local: string | null } {
  const uk = partsIn(clock.timeZone, instant);
  const here = partsIn(localZone, instant);
  const when = `${uk.weekday} ${uk.day} ${uk.month} ${uk.year}, ${clock.resetLabel}`;
  const sameTime = here.hour === uk.hour && here.minute === uk.minute;
  const sameDay = here.day === uk.day && here.month === uk.month && here.year === uk.year;
  if (sameTime && sameDay) return { when, local: null };
  return { when, local: `(${sameDay ? '' : `${here.weekday} `}${here.hour}:${here.minute} your time)` };
}

const REASON_WORDS: Readonly<Record<DemoResetReason, string>> = {
  scheduled: 'scheduled',
  'catch-up': 'scheduled, caught up overnight',
  manual: 'reset by a visitor',
  operator: 'reset by the operator',
  initial: 'when the demo was prepared',
};

/** "Last reset: today, 00:00 UK time (scheduled)" (A2 §9.3); `null` without a status. */
export function lastResetLine(lastResetAt: number | null, reason: DemoResetReason | null, now: number): string | null {
  if (lastResetAt === null || reason === null) return null;
  const at = partsIn(DEMO_RESET.timeZone, lastResetAt);
  const today = ukDateKey(now);
  const day = ukDateKey(lastResetAt);
  const yesterday = ukDateKey(now - 24 * 60 * 60 * 1000);
  const dayWords = day === today ? 'today' : day === yesterday ? 'yesterday' : `${at.weekday} ${at.day} ${at.month}`;
  return `Last reset: ${dayWords}, ${at.hour}:${at.minute} UK time (${REASON_WORDS[reason]})`;
}

/** "This is a shared demo: changes are shared…" — `DEMO_COPY.sharedData` with its first letter lowered. */
const SHARED = `This is a shared demo: ${DEMO_COPY.sharedData.charAt(0).toLowerCase()}${DEMO_COPY.sharedData.slice(1)}`;

function exploreLine(link: AreaLink): string {
  const who = link.persona ? `${link.persona.name} · ${link.persona.title} — ` : '';
  return `${who}${link.name}`;
}

function DetailsBody({ variant, clock, persona, areas, links, resetOffered, onReset, resetReason }: Omit<DemoDetailsPopoverProps, 'trigger' | 'open' | 'onOpenChange'>): ReactNode {
  const exploreId = useId();
  const bar = useDemoBarState();
  const { remaining, target } = useResetRemaining(clock);
  const now = Date.now() + bar.skewMs;
  const session = variant === 'session';
  const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const { when, local } = resetWhen(clock, target, localZone);
  const reason = resetOffered && (bar.resetBlocked || bar.building !== null) ? (resetReason?.() ?? null) : null;
  const footer = bar.status ? lastResetLine(bar.status.lastResetAt, bar.status.lastResetReason, now) : null;
  const explore = session && areas ? areas.areas.filter((link) => link.persona) : [];

  return (
    <div className="itsm-DemoDetails">
      <h2 className="itsm-DemoDetails__heading">
        Next automatic reset
      </h2>
      <p className="itsm-DemoDetails__when">
        {when}
        {local ? <span className="itsm-DemoDetails__local"> {local}</span> : null}
      </p>
      <p className="itsm-DemoDetails__countdown">
        <Icon name="timer" size={15} />
        Resets in <time>{formatCountdown(remaining)}</time>
      </p>
      <p className="itsm-DemoDetails__text">
        {DEMO_COPY.resetsDaily} {SHARED} {DEMO_COPY.fictional}
      </p>
      {session && persona ? (
        <p className="itsm-DemoDetails__you">
          You&apos;re {persona.name}, {persona.title}.
        </p>
      ) : null}
      {explore.length > 0 ? (
        <>
          <h3 className="itsm-DemoDetails__subheading" id={exploreId}>
            Explore as
          </h3>
          <ul className="itsm-DemoDetails__explore" aria-labelledby={exploreId}>
            {explore.map((link) => (
              <li key={link.id}>
                {link.current ? (
                  <span className="itsm-DemoDetails__row" data-current="">
                    <Icon name={link.icon} size="sm" />
                    {exploreLine(link)} (you)
                  </span>
                ) : (
                  <a className="itsm-DemoDetails__row" href={link.href}>
                    <Icon name={link.icon} size="sm" />
                    {exploreLine(link)}
                  </a>
                )}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {(session && resetOffered) || links.howItWorks || links.home ? (
        <div className="itsm-DemoDetails__actions">
          {session && resetOffered ? (
            <Button size="sm" variant="secondary" iconStart="history" {...(reason ? { disabledReason: reason } : {})} onClick={onReset}>
              {DEMO_COPY.resetConfirm.confirm}
            </Button>
          ) : null}
          {links.howItWorks ? (
            <a className="itsm-DemoDetails__link" href={links.howItWorks}>
              How the demo works
            </a>
          ) : null}
          {links.home ? (
            <a className="itsm-DemoDetails__link" href={links.home}>
              IT Service Management home
            </a>
          ) : null}
        </div>
      ) : null}
      {footer ? <p className="itsm-DemoDetails__footer">{footer}</p> : null}
    </div>
  );
}

/**
 * Demo details (A2 §9.3): when the next automatic reset is, in UK time and in
 * the visitor's own, with the live countdown; what the shared demo is and that
 * Northwind Traders (UK) is fictional (D16); in a session who the visitor is,
 * the other personas to explore as (D11), Reset demo data — cooldown-aware —
 * and when and why the data was last reset. The public bar's details leave
 * out Reset, the persona and "Explore as" (A2 §9.7).
 *
 * A lazy Radix popover (`role="dialog"`, named by its trigger "Demo
 * details"): focus moves in on open and Escape returns it.
 */
export function DemoDetailsPopover({ trigger, open, onOpenChange, ...body }: DemoDetailsPopoverProps): ReactNode {
  return (
    <Popover trigger={trigger} open={open} onOpenChange={onOpenChange} width="md" align="end" className="itsm-DemoDetails__popover">
      <DetailsBody
        {...body}
        onReset={() => {
          onOpenChange(false);
          body.onReset();
        }}
      />
    </Popover>
  );
}
