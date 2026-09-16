'use client';

import type { ReactNode } from 'react';
import { cx } from './cx.js';

/**
 * One number, with enough around it to mean something.
 *
 * The brief warns against "decorative dashboard cards", which is the failure
 * this is drawn to avoid: a figure with no label, no unit and no sense of
 * whether it is good. So the label is required, the value is the only large
 * thing, and the note underneath is where "up on last week" goes.
 *
 * `tone` colours that note and never the value. A number that changes colour
 * is a number somebody has to decode; the note says it in words, which is also
 * the only version a screen reader can convey (SC 1.4.1).
 *
 * Interactive only when given an `href`. A metric that cannot be opened should
 * not lift under the cursor, because the lift is this design system's promise
 * that something is there.
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
  const inner = (
    <>
      <span className="itsm-Metric__label">{label}</span>
      <span className="itsm-Metric__value">{value}</span>
      {note ? (
        <span
          className={cx(
            'itsm-Metric__note',
            tone === 'good' && 'itsm-Metric__note--good',
            tone === 'bad' && 'itsm-Metric__note--bad',
          )}
        >
          {note}
        </span>
      ) : null}
    </>
  );

  if (href !== undefined) {
    return (
      <a className={cx('itsm-Metric', 'itsm-Metric--interactive', className)} href={href}>
        {inner}
      </a>
    );
  }

  return <div className={cx('itsm-Metric', className)}>{inner}</div>;
}

/** Metrics in a row that wraps rather than scrolls. */
export function MetricGrid({ children, className }: { readonly children: ReactNode; readonly className?: string }): ReactNode {
  return <div className={cx('itsm-MetricGrid', className)}>{children}</div>;
}
