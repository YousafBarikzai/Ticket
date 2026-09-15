import { useMemo, type ReactNode } from 'react';
import { cx } from './cx.js';
import type { IntentName } from '../tokens/tokens.js';

export interface TimelineEvent {
  readonly id: string;
  /** What happened, e.g. "changed the priority to P2". */
  readonly title: ReactNode;
  /** ISO-8601 instant. */
  readonly timestamp: string;
  readonly actor?: string;
  readonly body?: ReactNode;
  readonly intent?: IntentName;
  /**
   * `internal` notes are visible to agents only. They are tinted *and*
   * labelled, because a colour alone would not tell a colour-blind agent that
   * the requester cannot see what they are about to write (SC 1.4.1).
   */
  readonly visibility?: 'public' | 'internal';
  readonly meta?: ReactNode;
}

export interface TimelineProps {
  readonly events: readonly TimelineEvent[];
  /** Names the list, e.g. "Ticket history". */
  readonly label: string;
  readonly locale?: string;
  readonly emptyMessage?: string;
  readonly className?: string;
}

const UNITS: readonly (readonly [Intl.RelativeTimeFormatUnit, number])[] = [
  ['year', 31_536_000_000],
  ['month', 2_592_000_000],
  ['week', 604_800_000],
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
];

/** "3 hours ago". The absolute instant stays in `title` and in `datetime`, so nothing is lost. */
export function relativeTime(timestamp: string, locale: string, now: number = Date.now()): string {
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const delta = new Date(timestamp).getTime() - now;
  for (const [unit, ms] of UNITS) {
    if (Math.abs(delta) >= ms) return formatter.format(Math.round(delta / ms), unit);
  }
  return formatter.format(Math.round(delta / 1000), 'second');
}

export function Timeline({ events, label, locale = 'en-GB', emptyMessage = 'Nothing has happened yet', className }: TimelineProps): ReactNode {
  const absolute = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }),
    [locale],
  );

  if (events.length === 0) {
    return <p className={cx('itsm-Timeline__empty', className)}>{emptyMessage}</p>;
  }

  return (
    <ol className={cx('itsm-Timeline', className)} aria-label={label}>
      {events.map((event, index) => {
        const when = new Date(event.timestamp);
        const internal = event.visibility === 'internal';
        return (
          <li key={event.id} className="itsm-Timeline__item">
            <span className="itsm-Timeline__rail" aria-hidden="true">
              <span
                className="itsm-Timeline__marker"
                style={event.intent ? { background: `var(--itsm-colour-${event.intent}-solid)` } : undefined}
              />
              {index < events.length - 1 ? <span className="itsm-Timeline__line" /> : null}
            </span>
            <div className="itsm-Timeline__content">
              <div className="itsm-Timeline__meta">
                {event.actor ? <span className="itsm-Timeline__actor">{event.actor}</span> : null}
                <span>{event.title}</span>
                <time dateTime={event.timestamp} title={absolute.format(when)}>
                  {relativeTime(event.timestamp, locale)}
                </time>
                {internal ? <span className="itsm-Badge">Internal note</span> : null}
                {event.meta}
              </div>
              {event.body ? (
                <div className={cx('itsm-Timeline__body', internal && 'itsm-Timeline__body--internal')}>{event.body}</div>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
