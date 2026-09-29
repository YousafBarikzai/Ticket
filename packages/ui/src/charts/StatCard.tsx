'use client';

import type { ReactNode } from 'react';
import type { IconName, Problem } from '../types.js';
import { cx } from '../web/cx.js';

export interface StatCardDelta {
  readonly value: number;
  readonly format?: Intl.NumberFormatOptions;
  /** "vs last week". */
  readonly period: string;
  /** Which way is good news; `none` for a change that is neither. */
  readonly goodDirection?: 'up' | 'down' | 'none';
}

export interface StatCardProps {
  readonly label: string;
  /** `null` reads "—", spoken as "Not available". */
  readonly value: number | null;
  readonly format?: Intl.NumberFormatOptions & { readonly compact?: boolean };
  /** The value is a lower bound ("100+"), because the list it counts had more. */
  readonly approx?: 'atLeast';
  readonly unit?: string;
  readonly delta?: StatCardDelta;
  readonly trend?: readonly number[];
  readonly icon?: IconName;
  /** Makes the whole card a link to what it counts. */
  readonly href?: string;
  readonly status?: 'default' | 'attention' | 'critical';
  readonly footnote?: string;
  readonly loading?: boolean;
  readonly problem?: Problem;
  /** A qualifier after the value: "· 3 breached". */
  readonly secondary?: string;
  readonly className?: string;
}

/**
 * One number that matters, with its change and trend. Replaces `Metric` and
 * the drafts' `KpiTile`.
 *
 * Stub (SPEC §4.8): renders the label and value; the charts package adds the
 * delta, sparkline, states and link.
 */
export function StatCard({ label, value, status = 'default', className }: StatCardProps): ReactNode {
  return (
    <div className={cx('itsm-StatCard', className)} data-status={status}>
      <p className="itsm-StatCard__label">{label}</p>
      <p className="itsm-StatCard__value">{value === null ? '—' : value}</p>
    </div>
  );
}
