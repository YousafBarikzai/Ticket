'use client';

import type { ReactNode } from 'react';
import { formatDuration } from '../../format/duration.js';
import { useNow } from '../../provider/clock.js';
import { TimeCell } from './TimeCell.js';

export interface DueCellProps {
  /** The due moment (`dateTime`). */
  readonly iso: string;
  /** The column's date or date-and-time form. */
  readonly text: string;
  /** The spelled-out moment, for the tooltip. */
  readonly full: string;
  /** Whether the row is still open, so a past date means late (`overdueWhen`); a closed row's past date is history. */
  readonly open: boolean;
  readonly locale: string;
}

/**
 * How late, in the compact form a narrow column has room for: "+4d", "+3h",
 * "+20m". The whole units only — the cell says that something slipped and by
 * roughly how much; the record says exactly.
 */
export function slipText(minutes: number): string {
  const late = Math.max(1, Math.floor(minutes));
  if (late >= 24 * 60) return `+${Math.floor(late / (24 * 60))}d`;
  if (late >= 60) return `+${Math.floor(late / 60)}h`;
  return `+${late}m`;
}

/**
 * A `due` cell (v3 §2.14): the date, and — once it has passed on a row that
 * is still open — the date in `danger.subtleText` 600 with the slip after it
 * ("+4d"), spoken as "4 days overdue".
 *
 * Lateness is measured on the page's shared clock (`useNow`), which is `null`
 * on the server and while hydrating: the server's HTML and the first client
 * render both show the plain date, so hydration matches, and the overdue
 * look arrives on the render straight after — the same switch `RelativeTime`
 * makes.
 */
export function DueCell({ iso, text, full, open, locale }: DueCellProps): ReactNode {
  const now = useNow();
  const due = Date.parse(iso);
  const late = open && now !== null && Number.isFinite(due) && due < now ? (now - due) / 60_000 : null;
  return (
    <span className="itsm-DataTable__due" data-overdue={late === null ? undefined : ''}>
      <TimeCell iso={iso} text={text} full={full} />
      {late === null ? null : (
        <>
          <span className="itsm-DataTable__slip" aria-hidden="true">
            {slipText(late)}
          </span>
          <span className="itsm-visually-hidden">, {formatDuration(Math.max(1, Math.floor(late)), { locale, style: 'long', maxParts: 1 })} overdue</span>
        </>
      )}
    </span>
  );
}
