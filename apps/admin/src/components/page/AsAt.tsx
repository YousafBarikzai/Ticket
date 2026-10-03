import type { ReactNode } from 'react';
import './page.css';

export interface AsAtProps {
  /** The moment the page's numbers were read: an ISO instant. */
  readonly at: string;
  /** The reader's zone (`me.timeZone`). Buckets are UTC days; the labels are the reader's (A4 §4, ADR-0064). */
  readonly timeZone: string;
  /** `en-GB` by default. */
  readonly locale?: string;
  readonly className?: string;
}

/**
 * "10:04 · Fri 2 Oct": the time, then the short day, in the reader's zone.
 * `null` for an instant that cannot be read, or a zone the runtime does not
 * know, so the caller shows nothing rather than "Invalid Date".
 */
export function asAtText(at: string, timeZone: string, locale = 'en-GB'): string | null {
  const moment = new Date(at);
  if (Number.isNaN(moment.getTime())) return null;
  try {
    const time = new Intl.DateTimeFormat(locale, { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(moment);
    const day = new Intl.DateTimeFormat(locale, { timeZone, weekday: 'short', day: 'numeric', month: 'short' })
      .formatToParts(moment)
      .filter((part) => part.type !== 'literal')
      .map((part) => part.value)
      .join(' ');
    return `${time} · ${day}`;
  } catch {
    return null;
  }
}

/**
 * The page's "As at" (§7.0.1): the one place a dashboard says when its numbers
 * were read. Every card on the page answers for this moment, so no card and
 * no chip repeats it (X-M4). `data-as-at="page"` is the hook the parity checks
 * count — exactly one per page.
 *
 * A server component: the moment is the server's render, which is the truth
 * about the numbers; `Freshness` beside it is the part that moves.
 */
export function AsAt({ at, timeZone, locale = 'en-GB', className }: AsAtProps): ReactNode {
  const text = asAtText(at, timeZone, locale);
  if (text === null) return null;
  return (
    <p className={className ? `app-AsAt ${className}` : 'app-AsAt'} data-as-at="page">
      As at{' '}
      <time dateTime={at} className="app-AsAt__time">
        {text}
      </time>
    </p>
  );
}
