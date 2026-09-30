'use client';

import type { ReactNode, TimeHTMLAttributes } from 'react';
import { useOptionalItsm } from '../provider/ItsmProvider.js';
import { useNow } from '../provider/clock.js';
import { cx } from '../web/cx.js';
import { formatDateTime, formatRelative } from './format.js';

export interface RelativeTimeProps extends Omit<TimeHTMLAttributes<HTMLTimeElement>, 'children' | 'dateTime'> {
  /** ISO 8601 timestamp, as the API sends it. */
  readonly date: string;
  /**
   * `auto` (default): relative within a week ("3 min ago", "yesterday"), the
   * date beyond it. `relative`: always relative. `absolute`: never.
   */
  readonly mode?: 'auto' | 'relative' | 'absolute';
  /** How the absolute form reads — what the server renders, and `auto` shows past a week. */
  readonly absoluteStyle?: 'date' | 'datetime' | 'time';
  /** `short` "3 min ago" (default, for lists and meta lines) or `long` "3 minutes ago" (for sentences). */
  readonly relativeStyle?: 'short' | 'long';
  readonly className?: string;
}

/** Within this, `auto` reads relative time; beyond it a date says more than "5 weeks ago". */
const RELATIVE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * A timestamp that reads "3 min ago" and keeps the exact time in `title` and
 * the machine-readable one in `dateTime`.
 *
 * The server renders the absolute time in the provider's time zone (the
 * reader's, never the server's), and the client switches to relative text
 * once hydrated, then moves on with the one shared clock — so the HTML never
 * disagrees with the first client render, and fifty timestamps on a page do
 * not start fifty timers. `suppressHydrationWarning` covers the one
 * difference left: the browser's `Intl` data can spell a month differently
 * from the server's ("Sep" or "Sept"), which is not worth a warning.
 *
 * Outside a provider it formats in `en-GB` and UTC rather than failing: a
 * timestamp on a static page is still worth showing.
 */
export function RelativeTime({
  date,
  mode = 'auto',
  absoluteStyle = 'datetime',
  relativeStyle = 'short',
  className,
  ...rest
}: RelativeTimeProps): ReactNode {
  const context = useOptionalItsm();
  const locale = context?.locale ?? 'en-GB';
  const timeZone = context?.timeZone ?? 'UTC';
  const now = useNow();

  const moment = Date.parse(date);
  const valid = !Number.isNaN(moment);
  let text = formatDateTime(date, { locale, timeZone, style: absoluteStyle });
  let relative = false;
  if (valid && now !== null && mode !== 'absolute' && (mode === 'relative' || Math.abs(now - moment) < RELATIVE_WINDOW_MS)) {
    text = formatRelative(date, now, locale, { timeZone, style: relativeStyle });
    relative = true;
  }

  return (
    <time
      {...rest}
      className={cx('itsm-RelativeTime', className)}
      dateTime={date}
      title={valid ? formatDateTime(date, { locale, timeZone, style: 'full' }) : undefined}
      data-relative={relative ? '' : undefined}
      suppressHydrationWarning
    >
      {text}
    </time>
  );
}
