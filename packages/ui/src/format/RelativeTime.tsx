'use client';

import type { ReactNode } from 'react';
import { cx } from '../web/cx.js';

export interface RelativeTimeProps {
  /** ISO 8601 timestamp. */
  readonly date: string;
  /** `auto` shows relative time for recent moments and the date for older ones. */
  readonly mode?: 'auto' | 'relative' | 'absolute';
  readonly absoluteStyle?: 'date' | 'datetime' | 'time';
  readonly className?: string;
}

/**
 * A timestamp that reads "3 min ago" and keeps the exact time in `title`.
 *
 * The server renders the absolute time in the provider's time zone and the
 * client switches to relative text after hydration, ticking on the provider's
 * one shared clock — so the HTML never disagrees with the first client render
 * and fifty timestamps on a page do not start fifty timers.
 *
 * Stub (SPEC §4.1): renders the machine-readable `<time>` with the timestamp
 * as written; the foundations package formats it.
 */
export function RelativeTime({ date, mode = 'auto', absoluteStyle = 'datetime', className }: RelativeTimeProps): ReactNode {
  return (
    <time className={cx('itsm-RelativeTime', className)} dateTime={date} data-mode={mode} data-style={absoluteStyle}>
      {date}
    </time>
  );
}
