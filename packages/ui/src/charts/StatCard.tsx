import type { ReactNode } from 'react';
import { DeltaPill, readDelta } from '../display/DeltaPill.js';
import { describeProblem } from '../feedback/problem.js';
import { formatDuration } from '../format/duration.js';
import { formatNumber } from '../format/format.js';
import { Icon } from '../icons/Icon.js';
import { defaultMessages } from '../provider/messages.js';
import { ShellLink } from '../shell/ShellLink.js';
import type { IconName, Problem } from '../types.js';
import { Button } from '../web/Button.js';
import { cx } from '../web/cx.js';
import { InfoTipTrigger } from '../web/InfoTipTrigger.js';
import { Skeleton } from '../web/Skeleton.js';
import { DEFAULT_LOCALE, describeTrend } from './scale.js';
import { Sparkline } from './Sparkline.js';

export interface StatCardDelta {
  readonly value: number;
  /** How the change is written: `{ style: 'percent' }` for a relative change given as a ratio (0.12 → "+12%"). */
  readonly format?: Intl.NumberFormatOptions;
  /** After the number on the pill: "pts" for percentage points (spoken "points"). Hidden in a narrow tile. */
  readonly unit?: string;
  /** "vs last week": the context line starts with it, and the pill says it to a screen reader. */
  readonly period: string;
  /** Which way is good news (default `up`); `none` for a change that is neither. */
  readonly goodDirection?: 'up' | 'down' | 'none';
}

/** What the ⓘ beside the label explains: the sentence alone, or a title, the sentence and where the figure comes from. */
export type StatCardInfo = string | { readonly title?: string; readonly body: string; readonly source?: string };

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
  /**
   * Recent values, oldest first (about twelve; `null` is a gap), drawn as a
   * sparkline under the value. Fewer than two known values draw the dashed
   * "No trend yet" rule. Leave it out, with no `visual`, and the tile has no
   * spark row at all.
   */
  readonly trend?: readonly (number | null)[];
  /** The sparkline's colour: `accent` (default) when the trend is the story, `muted` when it is background. */
  readonly trendTone?: 'accent' | 'muted';
  /**
   * A small drawing in the spark row instead of a trend (a 40 px slot): a
   * `DistributionBar` of what the number is made of, a compact `BulletBar`
   * against a target. It replaces the sparkline.
   */
  readonly visual?: ReactNode;
  /** The ⓘ beside the label: what the number counts. A client island, about 0.3 kB, its bubble loaded on intent. */
  readonly info?: StatCardInfo;
  /** The line at the foot, after the delta's period: "2 P2 · 4 P3 · 3 P4". `footnote` is its older name. */
  readonly context?: string;
  readonly icon?: IconName;
  /** Makes the whole card a link to what it counts. */
  readonly href?: string;
  /** `attention` and `critical` add an icon and a tinted edge — never colour alone. */
  readonly status?: 'default' | 'attention' | 'critical';
  /** The context line, under its v2 name; `context` wins when both are given. */
  readonly footnote?: string;
  readonly loading?: boolean;
  readonly problem?: Problem;
  /**
   * Retry after a `problem`. Client parents only: a function cannot cross
   * from a server component, so a server page offers its retry as a link
   * elsewhere instead.
   */
  readonly onRetry?: () => void;
  /** A qualifier after the value: "· 3 breached". */
  readonly secondary?: string;
  /** `raised` (default) is a card on the canvas; `sunken` sits inside another card without a second frame. */
  readonly surface?: 'raised' | 'sunken';
  /**
   * `tile` (default) is the KPI tile: the delta beside the value, a full row
   * for the spark, the context at the foot. `inline` is the compact v2 flow,
   * the delta and a small sparkline sharing one row, for tiles inside a card.
   */
  readonly layout?: 'tile' | 'inline';
  /** For the digits and the delta; `en-GB` by default. A prop rather than the provider's, so the card renders on the server. */
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
  /** The delta, drawn: what goes in `.itsm-StatCard__delta` beside the value. */
  readonly delta?: ReactNode;
  readonly deltaDirection?: 'up' | 'down' | 'flat';
  readonly deltaSentiment?: 'good' | 'bad' | 'neutral';
  /** The delta's period, at the start of the context line. Shown with a delta only. */
  readonly period?: string;
  /** The spark row's content: a sparkline or a visual. Omitted, the tile has no spark row. */
  readonly trend?: ReactNode;
  /** Whether `trend` is a caller's `visual` (it takes the row's width) or a sparkline (its own width). */
  readonly trendKind?: 'trend' | 'visual';
  readonly info?: StatCardInfo;
  readonly context?: string;
  readonly icon?: IconName;
  readonly href?: string;
  readonly status?: 'default' | 'attention' | 'critical';
  readonly footnote?: string;
  readonly footnoteTone?: 'good' | 'bad';
  readonly loading?: boolean;
  readonly problem?: Problem;
  readonly onRetry?: () => void;
  readonly surface?: 'raised' | 'sunken';
  readonly layout?: 'tile' | 'inline';
  readonly className?: string;
}

const STATUS: Readonly<Record<'attention' | 'critical', { icon: IconName; label: string }>> = {
  attention: { icon: 'triangle-alert', label: 'Needs attention' },
  critical: { icon: 'circle-alert', label: 'Critical' },
};

/**
 * The spark row's line. A fixed 96 × 40 until the kit's `width="fill"` is
 * wired in (WP-29); `inline` keeps v2's 88 × 28 at the end of its row.
 */
const SPARK_SIZE = { tile: { width: 96, height: 40 }, inline: { width: 88, height: 28 } } as const;

/**
 * One number that matters, with its change and trend: the KPI tile (v3
 * §2.13, A1 §7.2; PMO "label with an info icon, a large numeral with its
 * unit, a delta pill, a sparkline and a caption"). Replaces `Metric` and the
 * drafts' `KpiTile`.
 *
 * Anatomy: a sentence-case label with an optional ⓘ; the value, the only
 * large thing, in proportional figures; a `DeltaPill` top right whose arrow
 * and sign say the direction and whose tint says whether that is good; a
 * spark row — the trend in the accent, or a caller's `visual` — that is left
 * out when there is neither, so a tile without history carries no
 * placeholder; and a context line that starts with the delta's period
 * ("vs last week · 3 P1/P2"). Nothing relies on colour: a screen reader
 * hears "Up 12%, worse, vs last week", the period once.
 *
 * Honest states: "—" (heard as "Not available") when there is no value,
 * "100+" (heard as "at least 100") when a list had more than it counted, a
 * skeleton at the tile's final height while loading, and the reason in words
 * when it could not load.
 *
 * **Server-safe** (RV2): no `'use client'`, no hooks and no provider, so a
 * portal summary strip of four tiles ships no chart code. The locale is a
 * prop and the copy is `defaultMessages`. The three interactive parts are
 * client islands that take plain props: the ⓘ (`InfoTipTrigger`), the label's
 * link (`ShellLink`, the application's router link) and the retry `Button`,
 * which only a client parent can wire up.
 */
export function StatCard({
  label,
  value,
  format,
  approx,
  unit,
  delta,
  trend,
  trendTone = 'accent',
  visual,
  info,
  context,
  icon,
  href,
  status = 'default',
  footnote,
  loading = false,
  problem,
  onRetry,
  secondary,
  surface = 'raised',
  layout = 'tile',
  locale = DEFAULT_LOCALE,
  className,
}: StatCardProps): ReactNode {
  const { compact, duration, ...numberOptions } = format ?? {};
  const options: Intl.NumberFormatOptions = compact ? { notation: 'compact', maximumFractionDigits: 1, ...numberOptions } : numberOptions;
  const write = (n: number): string =>
    duration === 'minutes' ? formatDuration(n, { locale, maxParts: 2 }) : formatNumber(n, { ...options, locale });

  let display: ReactNode = '—';
  let spoken: string | undefined = defaultMessages.notAvailable;
  const known = value !== null && Number.isFinite(value);
  if (known) {
    const written = write(value);
    display = approx === 'atLeast' ? `${written}+` : written;
    // A duration's short units ("h", "min") are spelled out for listeners.
    const heard = duration === 'minutes' ? formatDuration(value, { locale, maxParts: 2, style: 'long' }) : written;
    spoken = approx === 'atLeast' ? `at least ${heard}` : duration === 'minutes' ? heard : undefined;
  }

  // A change is claimed only for a value that is there, and only when it is a number.
  const reading = known && delta ? readDelta({ ...delta, locale }) : null;
  const hasVisual = visual !== undefined && visual !== null && visual !== false;
  const size = SPARK_SIZE[layout];
  const spark: ReactNode = hasVisual ? (
    visual
  ) : trend ? (
    <Sparkline
      className="itsm-StatCard__trend"
      values={trend}
      label={`Trend: ${describeTrend(trend, write)}`}
      tone={trendTone}
      width={size.width}
      height={size.height}
    />
  ) : undefined;

  return (
    <StatCardView
      label={label}
      display={display}
      {...(spoken === undefined ? {} : { spoken })}
      {...(unit === undefined ? {} : { unit })}
      {...(secondary === undefined ? {} : { secondary })}
      {...(delta && reading
        ? {
            delta: (
              <DeltaPill
                value={delta.value}
                period={delta.period}
                goodDirection={delta.goodDirection ?? 'up'}
                locale={locale}
                {...(delta.format ? { format: delta.format } : {})}
                {...(delta.unit ? { unit: delta.unit } : {})}
              />
            ),
            deltaDirection: reading.direction,
            deltaSentiment: reading.sentiment,
            period: delta.period,
          }
        : {})}
      {...(spark === undefined ? {} : { trend: spark, trendKind: hasVisual ? ('visual' as const) : ('trend' as const) })}
      {...(info === undefined ? {} : { info })}
      {...(context === undefined ? {} : { context })}
      {...(icon === undefined ? {} : { icon })}
      {...(href === undefined ? {} : { href })}
      status={status}
      {...(footnote === undefined ? {} : { footnote })}
      loading={loading}
      {...(problem === undefined ? {} : { problem })}
      {...(onRetry === undefined ? {} : { onRetry })}
      surface={surface}
      layout={layout}
      {...(className === undefined ? {} : { className })}
    />
  );
}

/**
 * The card itself, from already-written parts. Server-safe like `StatCard`;
 * the deprecated `Metric` (a client module) draws through it too.
 */
export function StatCardView({
  label,
  display,
  spoken,
  unit,
  secondary,
  delta,
  deltaDirection,
  deltaSentiment,
  period,
  trend,
  trendKind = 'trend',
  info,
  context,
  icon,
  href,
  status = 'default',
  footnote,
  footnoteTone,
  loading = false,
  problem,
  onRetry,
  surface = 'raised',
  layout = 'tile',
  className,
}: StatCardViewProps): ReactNode {
  const link = loading ? undefined : href;
  const interactive = link !== undefined;
  const described = problem && !loading ? describeProblem(problem, { context: label.toLocaleLowerCase('en-GB') }) : null;
  const state = loading ? 'loading' : described ? 'problem' : 'ready';
  const hasDelta = state === 'ready' && delta !== undefined && delta !== null;
  // A zero delta draws no pill, only its hidden "No change", so it takes no row of its own.
  const deltaShown = hasDelta && deltaDirection !== 'flat';
  const hasSpark = state !== 'problem' && trend !== undefined && trend !== null;
  const note = context ?? footnote;
  const shownPeriod = hasDelta && period ? period : undefined;
  const tip = typeof info === 'string' ? { body: info } : info;

  return (
    <div
      className={cx('itsm-StatCard', className)}
      data-layout={layout}
      data-status={status}
      data-surface={surface}
      data-interactive={interactive || undefined}
      data-spark={hasSpark ? '' : undefined}
      data-delta={deltaShown ? '' : undefined}
      aria-busy={loading || undefined}
    >
      <div className="itsm-StatCard__grid">
        <div className="itsm-StatCard__head">
          {icon ? <Icon name={icon} size="sm" className="itsm-StatCard__icon" /> : null}
          <p className="itsm-StatCard__label">
            {link !== undefined ? (
              <ShellLink href={link} className="itsm-StatCard__link">
                {label}
              </ShellLink>
            ) : (
              label
            )}
          </p>
          {tip ? (
            <InfoTipTrigger
              className="itsm-StatCard__info"
              label={`About ${label}`}
              body={tip.body}
              {...(tip.title === undefined ? {} : { title: tip.title })}
              {...(tip.source === undefined ? {} : { source: tip.source })}
            />
          ) : null}
          {status !== 'default' ? <Icon name={STATUS[status].icon} size="sm" label={STATUS[status].label} className="itsm-StatCard__status" /> : null}
        </div>

        {state === 'loading' ? (
          // The bones sit in the tile's own grid areas, so the loading tile is the height of the one it becomes.
          <div className="itsm-StatCard__loading">
            <span className="itsm-visually-hidden">{defaultMessages.loading}</span>
            <Skeleton className="itsm-StatCard__bone itsm-StatCard__valueBone" width="58%" height="var(--itsm-text-statValue-size)" radius="md" />
            {hasSpark ? <Skeleton className="itsm-StatCard__bone itsm-StatCard__sparkBone" width="100%" height="2.5rem" radius="md" /> : null}
            <Skeleton className="itsm-StatCard__bone itsm-StatCard__contextBone" width="80%" height={12} />
          </div>
        ) : described ? (
          <div className="itsm-StatCard__problem">
            <p className="itsm-StatCard__problemText">
              <Icon name="circle-alert" size="sm" className="itsm-StatCard__problemIcon" />
              <span>{described.title}</span>
            </p>
            {onRetry && described.remedy !== 'none' && described.remedy !== 'signIn' ? (
              <Button size="sm" variant="ghost" onClick={onRetry} className="itsm-StatCard__retry">
                {defaultMessages.retry}
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
            {hasDelta ? (
              <div className="itsm-StatCard__delta" data-direction={deltaDirection} data-sentiment={deltaSentiment}>
                {delta}
              </div>
            ) : null}
            {hasSpark ? (
              <div className="itsm-StatCard__spark" data-kind={trendKind}>
                {trend}
              </div>
            ) : null}
          </>
        )}

        {!loading && (shownPeriod || note) ? (
          <p className="itsm-StatCard__context">
            {shownPeriod ? (
              // Said once already, by the pill ("Up 12%, worse, vs last week"), so drawn for the eye only.
              <span className="itsm-StatCard__period" aria-hidden="true">
                {shownPeriod}
              </span>
            ) : null}
            {shownPeriod && note ? (
              <span className="itsm-StatCard__separator" aria-hidden="true">
                {' · '}
              </span>
            ) : null}
            {note ? (
              <span className="itsm-StatCard__footnote" data-tone={footnoteTone}>
                {note}
              </span>
            ) : null}
          </p>
        ) : null}
      </div>
    </div>
  );
}
