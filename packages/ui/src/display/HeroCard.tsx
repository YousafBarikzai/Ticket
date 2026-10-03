import { isValidElement, type HTMLAttributes, type ReactNode, type Ref } from 'react';
import { formatPercent } from '../format/format.js';
import { Icon } from '../icons/Icon.js';
import { ShellLink } from '../shell/ShellLink.js';
import type { IconName } from '../types.js';
import { cx } from '../web/cx.js';

/** The tones a hero judges in. No `accent` and no `high`: a verdict is a status, and status is never the brand blue (D5). */
export type HeroTone = 'success' | 'warning' | 'danger' | 'info' | 'hold' | 'neutral';

/** The verdict: one word or two ("At risk"), its tone, and optionally its own icon. */
export interface HeroVerdict {
  readonly tone: HeroTone;
  readonly label: string;
  /** Overrides the tone's own shape ("circle-x" for Breaching). */
  readonly icon?: IconName;
}

/** One line under the verdict about where things are heading: "Next breach in 40 min". */
export interface HeroTrend {
  readonly text: string;
  /** Draws a rising, falling or level glyph before the words. The words carry the meaning; the glyph is decoration. */
  readonly direction?: 'up' | 'down' | 'flat';
}

/** A counted contributor under the verdict: "1 breached". With `href`, a link to the filtered view. */
export interface HeroChip {
  readonly id: string;
  readonly tone: HeroTone;
  readonly label: string;
  readonly href?: string;
}

/** One of the things the verdict is made of: "Response SLA — At risk — 3 due within the hour". */
export interface HeroDimension {
  readonly id: string;
  readonly label: string;
  readonly tone: HeroTone;
  /** The dimension's own verdict, in words: "At risk", "None open". */
  readonly state: string;
  readonly reason?: string;
  readonly href?: string;
}

/** A bullet bar in the aside: how much of something is used, against a target. Fractions of 1. */
export interface HeroProgress {
  /** 0–1; drawn clamped, spoken as given ("105%"). */
  readonly value: number;
  /** 0–1; a tick on the bar, and the stretch from the value up to it tinted. */
  readonly target?: number;
  /** What is measured, which names the bar for a screen reader: "SLA met", "Resolution time used". */
  readonly label: string;
  /** A line under the bar: "Target 90%". */
  readonly caption?: string;
}

/** The hero's right-hand figure: the next breach, the SLA met, the open major incident. */
export interface HeroAside {
  readonly kicker: string;
  readonly tone?: HeroTone;
  /** The figure, as written: "40 min", "85%", "MI-0004". Drawn in tabular figures. */
  readonly value: string;
  readonly valueLabel?: string;
  readonly progress?: HeroProgress;
  readonly caption?: string;
  /** Makes the figure a link: the ticket, the war room. */
  readonly href?: string;
}

export interface HeroCardProps extends Omit<HTMLAttributes<HTMLElement>, 'children' | 'title'> {
  /**
   * `navy` (default) is the loud surface of the Service Desk and
   * Administration dashboards (D2); `light` is the Help Portal's, and the
   * success panel of a request.
   */
  readonly variant?: 'navy' | 'light';
  /** What is being judged, sentence case — "Queue health". The stylesheet draws it in capitals (D6). */
  readonly kicker: string;
  readonly verdict: HeroVerdict;
  /** A `HeroWhy` island beside the verdict, listing what made it. */
  readonly why?: ReactNode;
  readonly trend?: HeroTrend;
  readonly chips?: readonly HeroChip[];
  /** One sentence, at most two lines: "INC-004503 passed its resolution target yesterday at 15:10". */
  readonly narrative?: string;
  readonly dimensions?: readonly HeroDimension[];
  /** Names the dimensions list for a screen reader; "{kicker} in detail" by default. */
  readonly dimensionsLabel?: string;
  /** A `HeroAside`, or a node of the caller's own — a live countdown island in the war room. */
  readonly aside?: HeroAside | ReactNode;
  /** The level of the verdict heading: `2` (default) on a dashboard, `3` inside a section. */
  readonly headingLevel?: 2 | 3;
  /** For the progress figures; `en-GB` by default. A prop, so the hero renders on the server with no provider. */
  readonly locale?: string;
  readonly className?: string;
  readonly ref?: Ref<HTMLElement>;
}

/** Each tone's shape, so a verdict, a chip or a dimension reads without its colour (SC 1.4.1). */
const toneIcon: Readonly<Record<HeroTone, IconName>> = {
  success: 'circle-check',
  warning: 'triangle-alert',
  danger: 'circle-alert',
  info: 'info',
  hold: 'pause',
  neutral: 'circle-dot',
};

const trendIcon: Readonly<Record<NonNullable<HeroTrend['direction']>, IconName>> = {
  up: 'trending-up',
  down: 'trending-down',
  flat: 'minus',
};

/** An id from the kicker, so the section can name itself by its heading without a hook (the hero is server-safe). */
function slug(text: string): string {
  const base = text
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base === '' ? 'hero' : base;
}

function isHeroAside(aside: unknown): aside is HeroAside {
  return (
    typeof aside === 'object' &&
    aside !== null &&
    !isValidElement(aside) &&
    !Array.isArray(aside) &&
    typeof (aside as { kicker?: unknown }).kicker === 'string' &&
    typeof (aside as { value?: unknown }).value === 'string'
  );
}

/** A fraction for drawing: finite and between 0 and 1. */
function unit(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

/** A length along the bar, as a percentage of its width, for inline geometry. */
function along(fraction: number): string {
  return `${Math.round(fraction * 10000) / 100}%`;
}

function Chip({ chip }: { readonly chip: HeroChip }): ReactNode {
  const body = (
    <>
      <Icon name={toneIcon[chip.tone]} size={12} className="itsm-HeroCard__chipIcon" />
      <span className="itsm-HeroCard__chipLabel">{chip.label}</span>
    </>
  );
  return chip.href ? (
    <ShellLink href={chip.href} className="itsm-HeroCard__chip" data-tone={chip.tone}>
      {body}
    </ShellLink>
  ) : (
    <span className="itsm-HeroCard__chip" data-tone={chip.tone}>
      {body}
    </span>
  );
}

/**
 * A dimension row. The punctuation between its parts is there for the ear
 * only, so the row reads "Response SLA: At risk. 3 due within the hour" as a
 * list item and as a link name, while the eye gets three aligned columns.
 */
function Dimension({ dimension }: { readonly dimension: HeroDimension }): ReactNode {
  const body = (
    <>
      <span className="itsm-HeroCard__dimensionLabel">{dimension.label}</span>
      <span className="itsm-visually-hidden">: </span>
      <span className="itsm-HeroCard__dimensionState" data-tone={dimension.tone}>
        <Icon name={toneIcon[dimension.tone]} size={12} className="itsm-HeroCard__dimensionIcon" />
        <span>{dimension.state}</span>
      </span>
      {dimension.reason ? (
        <>
          <span className="itsm-visually-hidden">. </span>
          <span className="itsm-HeroCard__dimensionReason">{dimension.reason}</span>
        </>
      ) : null}
    </>
  );
  return dimension.href ? (
    <ShellLink href={dimension.href} className="itsm-HeroCard__dimension" data-tone={dimension.tone}>
      {body}
    </ShellLink>
  ) : (
    <div className="itsm-HeroCard__dimension" data-tone={dimension.tone}>
      {body}
    </div>
  );
}

/**
 * The aside's bullet bar: a track, the value filled, the stretch from the
 * value up to the target tinted, a tick at the target. A `meter` named by
 * what it measures, with the reading in words ("66%, target 83%") — the bar
 * is drawn for the eye and hidden from the tree.
 */
function Bullet({ progress, locale }: { readonly progress: HeroProgress; readonly locale: string }): ReactNode {
  const value = unit(progress.value);
  const target = progress.target === undefined ? undefined : unit(progress.target);
  const shown = formatPercent(Number.isFinite(progress.value) ? progress.value : 0, { locale });
  const reading = target === undefined ? shown : `${shown}, target ${formatPercent(target, { locale })}`;
  const short = target !== undefined && target > value ? target - value : 0;
  return (
    <div className="itsm-HeroCard__progress">
      <div
        role="meter"
        aria-label={progress.label}
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={value}
        aria-valuetext={reading}
        className="itsm-HeroCard__bullet"
      >
        <span className="itsm-HeroCard__bulletTrack" aria-hidden="true">
          {/* Dynamic geometry, which is what inline style is for. */}
          <span className="itsm-HeroCard__bulletFill" style={{ inlineSize: along(value) }} />
          {short > 0 ? <span className="itsm-HeroCard__bulletShort" style={{ insetInlineStart: along(value), inlineSize: along(short) }} /> : null}
          {target === undefined ? null : <span className="itsm-HeroCard__bulletTarget" style={{ insetInlineStart: along(target) }} />}
        </span>
        <span className="itsm-HeroCard__bulletValue" aria-hidden="true">
          {shown}
        </span>
      </div>
      {progress.caption ? <p className="itsm-HeroCard__bulletCaption">{progress.caption}</p> : null}
    </div>
  );
}

function Aside({ aside, locale }: { readonly aside: HeroAside; readonly locale: string }): ReactNode {
  const figure = (
    <>
      <span className="itsm-HeroCard__asideFigure">{aside.value}</span>
      {aside.valueLabel ? (
        <>
          <span className="itsm-visually-hidden">, </span>
          <span className="itsm-HeroCard__asideValueLabel">{aside.valueLabel}</span>
        </>
      ) : null}
    </>
  );
  return (
    <>
      <p className="itsm-HeroCard__asideKicker" data-tone={aside.tone ?? 'neutral'}>
        <span className="itsm-HeroCard__asideDot" aria-hidden="true" />
        {aside.kicker}
      </p>
      <p className="itsm-HeroCard__asideValue">
        {aside.href ? (
          <ShellLink href={aside.href} className="itsm-HeroCard__asideLink">
            {figure}
          </ShellLink>
        ) : (
          figure
        )}
      </p>
      {aside.progress ? <Bullet progress={aside.progress} locale={locale} /> : null}
      {aside.caption ? <p className="itsm-HeroCard__asideCaption">{aside.caption}</p> : null}
    </>
  );
}

/**
 * The verdict band at the top of a dashboard (v3 §2.13, G4; A1 §7.3): a
 * kicker naming what is judged, the verdict as a word with its icon, why,
 * where it is heading, the counted contributors, one sentence of narrative,
 * the dimensions it is made of, and an aside with the figure that matters
 * next.
 *
 * Server-safe, and 0 kB where it is used: links go through `ShellLink` (the
 * frame's link leaf, already in every app), and the only interactive part,
 * "Why?", is the caller's `HeroWhy` island passed in as `why`.
 *
 * **Navy** sets `data-surface="hero"`, which re-themes everything inside it —
 * focus rings in the hero accent, and the nested controls' rules in
 * `HeroCard.styles.ts` — so a segmented control or a count placed in a hero
 * needs no variant. **Light** keeps the page's own text tokens on a pale blue
 * wash: the Help Portal's hero and the request success panel.
 *
 * It is a `<section>` named by its heading, and the heading is the verdict
 * with the kicker in front for the ear only — "Queue health: At risk" — so
 * the landmark, the heading list and the visible band all say the same thing
 * once. The visible kicker is hidden from the tree for the same reason. The
 * columns (main · dimensions · aside, 5 : 4 : 3) fold with the card's own
 * width, not the window's.
 */
export function HeroCard({
  variant = 'navy',
  kicker,
  verdict,
  why,
  trend,
  chips,
  narrative,
  dimensions,
  dimensionsLabel,
  aside,
  headingLevel = 2,
  locale = 'en-GB',
  className,
  ref,
  ...rest
}: HeroCardProps): ReactNode {
  const Heading = headingLevel === 3 ? 'h3' : 'h2';
  const headingId = `${rest.id ?? `itsm-hero-${slug(kicker)}`}-verdict`;
  const rows = dimensions ?? [];
  const hasDimensions = rows.length > 0;
  const hasAside = aside !== undefined && aside !== null && aside !== false && aside !== '';
  const layout = hasDimensions && hasAside ? 'full' : hasDimensions ? 'dimensions' : hasAside ? 'aside' : 'single';

  return (
    <section
      {...rest}
      ref={ref}
      className={cx('itsm-HeroCard', className)}
      data-variant={variant}
      data-layout={layout}
      {...(variant === 'navy' ? { 'data-surface': 'hero' } : {})}
      aria-labelledby={headingId}
    >
      <div className="itsm-HeroCard__grid">
        <div className="itsm-HeroCard__main">
          <p className="itsm-HeroCard__kicker" aria-hidden="true">
            {kicker}
          </p>
          <div className="itsm-HeroCard__verdictRow">
            <Heading id={headingId} className="itsm-HeroCard__verdict" data-tone={verdict.tone}>
              <span className="itsm-visually-hidden">{`${kicker}: `}</span>
              <Icon name={verdict.icon ?? toneIcon[verdict.tone]} size={28} className="itsm-HeroCard__verdictIcon" />
              <span className="itsm-HeroCard__verdictLabel">{verdict.label}</span>
            </Heading>
            {why ? <div className="itsm-HeroCard__why">{why}</div> : null}
          </div>
          {trend ? (
            <p className="itsm-HeroCard__trend" data-direction={trend.direction}>
              {trend.direction ? <Icon name={trendIcon[trend.direction]} size={14} className="itsm-HeroCard__trendIcon" /> : null}
              <span>{trend.text}</span>
            </p>
          ) : null}
          {chips && chips.length > 0 ? (
            <ul className="itsm-HeroCard__chips">
              {chips.map((chip) => (
                <li key={chip.id} className="itsm-HeroCard__chipItem">
                  <Chip chip={chip} />
                </li>
              ))}
            </ul>
          ) : null}
          {narrative ? <p className="itsm-HeroCard__narrative">{narrative}</p> : null}
        </div>
        {hasDimensions ? (
          <div className="itsm-HeroCard__dimensionsColumn">
            <ul className="itsm-HeroCard__dimensions" aria-label={dimensionsLabel ?? `${kicker} in detail`}>
              {rows.map((dimension) => (
                <li key={dimension.id} className="itsm-HeroCard__dimensionItem">
                  <Dimension dimension={dimension} />
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {hasAside ? (
          <div className="itsm-HeroCard__aside">{isHeroAside(aside) ? <Aside aside={aside} locale={locale} /> : (aside as ReactNode)}</div>
        ) : null}
      </div>
    </section>
  );
}
