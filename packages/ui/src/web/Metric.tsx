'use client';

import type { ReactNode } from 'react';
import { StatCardView } from '../charts/StatCard.js';
import { StatGrid } from '../charts/StatGrid.js';
import { formatNumber } from '../format/format.js';
import { useOptionalItsm } from '../provider/ItsmProvider.js';
import { cx } from './cx.js';

/**
 * One number, with enough around it to mean something.
 *
 * **Deprecated** (SPEC §4.11): use `StatCard` and `StatGrid` from
 * `@itsm/ui/charts`. Kept, with its props unchanged, until no application
 * imports it (Stage 5); it now draws a `StatCard`, so a page still on
 * `Metric` already looks like one that moved.
 *
 * What it keeps from its first version is the rule it was drawn to: a figure
 * with no label, no unit and no sense of whether it is good is decoration. So
 * the label is required, the value is the only large thing, and the note
 * underneath is where "up on last week" goes. `tone` colours that note and
 * never the value — a number that changes colour is a number somebody has to
 * decode, and the note says it in words, which is the only version a screen
 * reader can convey (SC 1.4.1).
 *
 * Interactive only with an `href`: a card that cannot be opened does not lift
 * under the cursor, because the lift is the promise that something is there.
 */
export interface MetricProps {
  readonly label: string;
  readonly value: ReactNode;
  readonly note?: string;
  readonly tone?: 'neutral' | 'good' | 'bad';
  readonly href?: string;
  readonly className?: string;
}

export function Metric({ label, value, note, tone = 'neutral', href, className }: MetricProps): ReactNode {
  const itsm = useOptionalItsm();
  const locale = itsm?.locale ?? 'en-GB';
  const missing = value === null || value === undefined || value === '' || (typeof value === 'number' && !Number.isFinite(value));
  const display = typeof value === 'number' && Number.isFinite(value) ? formatNumber(value, { locale }) : value;
  return (
    <StatCardView
      className={cx('itsm-Metric', className)}
      label={label}
      display={missing ? '—' : display}
      {...(missing ? { spoken: itsm?.messages.notAvailable ?? 'Not available' } : {})}
      {...(note === undefined ? {} : { footnote: note })}
      {...(tone === 'neutral' ? {} : { footnoteTone: tone })}
      {...(href === undefined ? {} : { href })}
    />
  );
}

/** Metrics in a grid that wraps rather than scrolls. Deprecated: use `StatGrid`. */
export function MetricGrid({ children, className }: { readonly children: ReactNode; readonly className?: string }): ReactNode {
  return <StatGrid className={cx('itsm-MetricGrid', className)}>{children}</StatGrid>;
}
