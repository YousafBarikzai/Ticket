'use client';

import { useSyncExternalStore, type ReactNode } from 'react';

export interface TimeCellProps {
  /** The machine-readable moment (`dateTime`). */
  readonly iso: string;
  /** What the cell reads: the column's date or date-and-time form. */
  readonly text: string;
  /** The spelled-out moment for the tooltip ("Wednesday 30 September 2026 at 14:30"). */
  readonly full: string;
}

const noSubscription = (): (() => void) => () => undefined;

/**
 * A `date` / `datetime` cell's `<time>`, with its tooltip added only once the
 * page has hydrated.
 *
 * The long form is where two `Intl` builds disagree most — Node's ICU writes
 * "Wednesday, 30 September", Chromium's "Wednesday 30 September" — and a
 * `title` that differs between the server's HTML and the first client render
 * is a hydration mismatch on every row of every table with a date column. So
 * the server and the hydrating render both leave `title` off (identical by
 * construction), and the render straight after hydration adds the reader's
 * own spelling. A table rendered on the client after that (a new page of
 * rows, a client navigation) has it from the first render. The short text
 * is the same on both sides in every locale we ship; `suppressHydrationWarning`
 * only stops a stray "Sep"/"Sept" difference between ICU versions from being
 * reported, as `RelativeTime` does.
 */
export function TimeCell({ iso, text, full }: TimeCellProps): ReactNode {
  const hydrated = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
  return (
    <time dateTime={iso} title={hydrated ? full : undefined} suppressHydrationWarning>
      {text}
    </time>
  );
}
