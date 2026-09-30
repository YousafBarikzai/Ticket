'use client';

import type { ReactNode } from 'react';
import { describeProblem } from '../feedback/problem.js';
import { formatDuration } from '../format/duration.js';
import { formatNumber } from '../format/format.js';
import { Icon } from '../icons/Icon.js';
import { useOptionalItsm } from '../provider/ItsmProvider.js';
import { defaultMessages } from '../provider/messages.js';
import type { IconName, Problem } from '../types.js';
import { Button } from '../web/Button.js';
import { cx } from '../web/cx.js';
import { Skeleton } from '../web/Skeleton.js';
import { DEFAULT_LOCALE, describeTrend } from './scale.js';
import { Sparkline } from './Sparkline.js';

export interface StatCardDelta {
  readonly value: number;
  /** How the change is written: `{ style: 'percent' }` for a relative change given as a ratio (0.12 → "+12%"). */
  readonly format?: Intl.NumberFormatOptions;
  /** "vs last week". */
  readonly period: string;
  /** Which way is good news (default `up`); `none` for a change that is neither. */
  readonly goodDirection?: 'up' | 'down' | 'none';
}

export interface StatCardProps {
  readonly label: string;
  /** `null` reads "—", spoken as "Not available". */
  readonly value: number | null;
  /**
   * `compact` writes 12,900 as "12.9k". `duration: 'minutes'` reads the value
   * as minutes and writes it as a duration — "1 h 12 min", heard as "1 hour
   * 12 minutes" — for times to respond or resolve.
   */
  readonly format?: Intl.NumberFormatOptions & { readonly compact?: boolean; readonly duration?: 'minutes' };
  /** The value is a lower bound ("100+"), because the list it counts had more. */
  readonly approx?: 'atLeast';
  /** After the value, smaller: "ms", "h". */
  readonly unit?: string;
  readonly delta?: StatCardDelta;
  /** Recent values, oldest first (about twelve), drawn as a sparkline with the latest in the accent. */
  readonly trend?: readonly number[];
  readonly icon?: IconName;
  /** Makes the whole card a link to what it counts. */
  readonly href?: string;
  /** `attention` and `critical` add an icon and a tinted edge — never colour alone. */
  readonly status?: 'default' | 'attention' | 'critical';
  readonly footnote?: string;
  readonly loading?: boolean;
  readonly problem?: Problem;
  /** Retry after a `problem`. Client parents only. */
  readonly onRetry?: () => void;
  /** A qualifier after the value: "· 3 breached". */
  readonly secondary?: string;
  /** `raised` (default) is a card on the canvas; `sunken` sits inside another card without a second frame. */
  readonly surface?: 'raised' | 'sunken';
  /** Defaults to the provider's locale. */
  readonly locale?: string;
  readonly className?: string;
}

/** The parts of a stat card once its value is written; shared with the deprecated `Metric`. */
export interface StatCardViewProps {
  readonly label: string;
  readonly display: ReactNode;
  /** What a screen reader hears instead of `display`, when the two differ ("at least 100", "Not available"). */
  readonly spoken?: string;
  readonly unit?: string;
  readonly secondary?: string;
  readonly delta?: ReactNode;
  readonly trend?: ReactNode;
  readonly icon?: IconName;
  readonly href?: string;
  readonly status?: 'default' | 'attention' | 'critical';
  readonly footnote?: string;
  readonly footnoteTone?: 'good' | 'bad';
  readonly loading?: boolean;
  readonly problem?: Problem;
  readonly onRetry?: () => void;
  readonly surface?: 'raised' | 'sunken';
  readonly className?: string;
}

const STATUS: Readonly<Record<'attention' | 'critical', { icon: IconName; label: string }>> = {
  attention: { icon: 'triangle-alert', label: 'Needs attention' },
  critical: { icon: 'circle-alert', label: 'Critical' },
};

/**
 * One number that matters, with its change and trend (SPEC §4.8). Replaces
 * `Metric` and the drafts' `KpiTile`.
 *
 * Anatomy, the stat-tile contract: a sentence-case label; the value, the only
 * large thing, in proportional figures; a delta chip whose icon and sign say
 * the direction and whose colour says whether that is good; the period in
 * words; a sparkline in the de-emphasis grey with the latest point in the
 * accent. Nothing relies on colour: the chip has an arrow and a sign, and a
 * screen reader hears "Up 12%, worse, vs last week".
 *
 * Honest states: "—" (heard as "Not available") when there is no value, "100+"
 * (heard as "at least 100") when a list had more than it counted, a skeleton
 * while loading, and the reason in words when it could not load.
 *
 * With `href` the label is a link stretched over the whole card, so the card
 * is one target with one name, and it lifts like every navigable card.
 */
export function StatCard({
  label,
  value,
  format,
  approx,
  unit,
  delta,
  trend,
  icon,
  href,
  status = 'default',
  footnote,
  loading = false,
  problem,
  onRetry,
  secondary,
  surface = 'raised',
  locale: localeProp,
  className,
}: StatCardProps): ReactNode {
  const itsm = useOptionalItsm();
  const locale = localeProp ?? itsm?.locale ?? DEFAULT_LOCALE;
  const notAvailable = itsm?.messages.notAvailable ?? defaultMessages.notAvailable;
  const { compact, duration, ...numberOptions } = format ?? {};
  const options: Intl.NumberFormatOptions = compact ? { notation: 'compact', maximumFractionDigits: 1, ...numberOptions } : numberOptions;
  const write = (n: number): string =>
    duration === 'minutes' ? formatDuration(n, { locale, maxParts: 2 }) : formatNumber(n, { ...options, locale });

  let display: ReactNode = '—';
  let spoken: string | undefined = notAvailable;
  if (value !== null && Number.isFinite(value)) {
    const written = write(value);
    display = approx === 'atLeast' ? `${written}+` : written;
    // A duration's short units ("h", "min") are spelled out for listeners.
    const heard = duration === 'minutes' ? formatDuration(value, { locale, maxParts: 2, style: 'long' }) : written;
    spoken = approx === 'atLeast' ? `at least ${heard}` : duration === 'minutes' ? heard : undefined;
  }

  return (
    <StatCardView
      label={label}
      display={display}
      {...(spoken === undefined ? {} : { spoken })}
      {...(unit === undefined ? {} : { unit })}
      {...(secondary === undefined ? {} : { secondary })}
      delta={delta && value !== null && Number.isFinite(value) ? <Delta delta={delta} locale={locale} /> : undefined}
      trend={
        trend && trend.length > 1 ? (
          <Sparkline className="itsm-StatCard__trend" values={trend} label={`Trend: ${describeTrend(trend, write)}`} width={88} height={28} />
        ) : undefined
      }
      {...(icon === undefined ? {} : { icon })}
      {...(href === undefined ? {} : { href })}
      status={status}
      {...(footnote === undefined ? {} : { footnote })}
      loading={loading}
      {...(problem === undefined ? {} : { problem })}
      {...(onRetry === undefined ? {} : { onRetry })}
      surface={surface}
      {...(className === undefined ? {} : { className })}
    />
  );
}

/** The card itself, from already-written parts. */
export function StatCardView({
  label,
  display,
  spoken,
  unit,
  secondary,
  delta,
  trend,
  icon,
  href,
  status = 'default',
  footnote,
  footnoteTone,
  loading = false,
  problem,
  onRetry,
  surface = 'raised',
  className,
}: StatCardViewProps): ReactNode {
  const itsm = useOptionalItsm();
  const messages = itsm?.messages ?? defaultMessages;
  const Link = itsm?.Link;
  const interactive = href !== undefined && !loading;
  const name =
    interactive && href !== undefined ? (
      Link ? (
        <Link href={href} className="itsm-StatCard__link">
          {label}
        </Link>
      ) : (
        <a href={href} className="itsm-StatCard__link">
          {label}
        </a>
      )
    ) : (
      label
    );
  const described = problem ? describeProblem(problem, { context: label.toLocaleLowerCase('en-GB') }) : null;

  return (
    <div
      className={cx('itsm-StatCard', className)}
      data-status={status}
      data-surface={surface}
      data-interactive={interactive || undefined}
      aria-busy={loading || undefined}
    >
      <div className="itsm-StatCard__head">
        {icon ? <Icon name={icon} size="sm" className="itsm-StatCard__icon" /> : null}
        <p className="itsm-StatCard__label">{name}</p>
        {status !== 'default' ? <Icon name={STATUS[status].icon} size="sm" label={STATUS[status].label} className="itsm-StatCard__status" /> : null}
      </div>

      {loading ? (
        <div className="itsm-StatCard__loading">
          <span className="itsm-visually-hidden">{messages.loading}</span>
          <Skeleton className="itsm-StatCard__bone" width="55%" height="var(--itsm-text-statValue-line)" radius="md" />
          <Skeleton className="itsm-StatCard__bone" width="40%" height={12} />
        </div>
      ) : described ? (
        <div className="itsm-StatCard__problem">
          <p className="itsm-StatCard__problemText">
            <Icon name="circle-alert" size="sm" className="itsm-StatCard__problemIcon" />
            <span>{described.title}</span>
          </p>
          {onRetry && described.remedy !== 'none' && described.remedy !== 'signIn' ? (
            <Button size="sm" variant="ghost" onClick={onRetry} className="itsm-StatCard__retry">
              {messages.retry}
            </Button>
          ) : null}
        </div>
      ) : (
        <>
          <p className="itsm-StatCard__value">
            <span className="itsm-StatCard__number" aria-hidden={spoken === undefined ? undefined : true}>
              {display}
            </span>
            {spoken === undefined ? null : <span className="itsm-visually-hidden">{spoken}</span>}
            {unit ? <span className="itsm-StatCard__unit">{unit}</span> : null}
            {secondary ? <span className="itsm-StatCard__secondary">{secondary}</span> : null}
          </p>
          {delta || trend ? (
            <div className="itsm-StatCard__foot">
              {delta}
              {trend}
            </div>
          ) : null}
        </>
      )}

      {footnote && !loading ? (
        <p className="itsm-StatCard__footnote" data-tone={footnoteTone}>
          {footnote}
        </p>
      ) : null}
    </div>
  );
}

/** The change chip: arrow, signed value, period. Coloured by direction × whether up is good. */
function Delta({ delta, locale }: { readonly delta: StatCardDelta; readonly locale: string }): ReactNode {
  const { value, format, period, goodDirection = 'up' } = delta;
  const direction = !Number.isFinite(value) || value === 0 ? 'flat' : value > 0 ? 'up' : 'down';
  const sentiment = direction === 'flat' || goodDirection === 'none' ? 'neutral' : direction === goodDirection ? 'good' : 'bad';
  const shown = formatNumber(Number.isFinite(value) ? value : 0, { ...format, signDisplay: 'exceptZero', locale });
  const size = formatNumber(Math.abs(Number.isFinite(value) ? value : 0), { ...format, signDisplay: 'never', locale });
  const words =
    direction === 'flat' ? 'No change' : `${direction === 'up' ? 'Up' : 'Down'} ${size}${sentiment === 'good' ? ', better' : sentiment === 'bad' ? ', worse' : ''}`;
  return (
    <p className="itsm-StatCard__delta" data-direction={direction} data-sentiment={sentiment}>
      <span className="itsm-StatCard__chip">
        <Icon name={direction === 'up' ? 'arrow-up' : direction === 'down' ? 'arrow-down' : 'minus'} size="xs" className="itsm-StatCard__chipIcon" />
        <span aria-hidden="true">{shown}</span>
        <span className="itsm-visually-hidden">{words}</span>
      </span>
      <span className="itsm-StatCard__period">{period}</span>
    </p>
  );
}
