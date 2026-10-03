import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { GridItem, type GridSpan } from '../display/DashboardGrid.js';
import { SkeletonChartCard } from '../feedback/Skeletons.js';
import { describeProblem } from '../feedback/problem.js';
import { Icon } from '../icons/Icon.js';
import type { Problem } from '../types.js';
import { Card, type CardFooterLink, type CardInfo } from '../web/Card.js';
import { cx } from '../web/cx.js';
import { CHART_EMPTY_TEXT, ChartEmpty } from './parts.js';

/**
 * The plot height each kind of chart is drawn at (A8 §4.1), so a card's
 * skeleton and its empty state can take the room the chart will.
 */
export const CHART_HEIGHTS = Object.freeze({ line: 240, hero: 280, area: 240, donut: 220, gauge: 200, heatmapRow: 28, calendar: 188, sparkline: 40 } as const);

/** What a card adds round its plot — title, headline, padding, the "View as table" toggle — for a state of the card's final height. */
const CHROME = 96;

export type ChartCardState = 'ready' | 'loading' | 'empty' | 'insufficient' | 'error';

export interface ChartCardProps {
  readonly title: string;
  /** An ⓘ beside the title that explains the figure: what it counts and where it comes from. */
  readonly info?: CardInfo;
  /** The card's answer in words, under the title: "Resolved 412, raised 398 in 30 days: the queue fell by 14" (≤ 110 characters). */
  readonly headline?: string;
  /** A quiet basis line under the headline: "Estimated from raised and resolved". */
  readonly caption?: string;
  /** Badges beside the title ("Last 30 days"). */
  readonly meta?: ReactNode;
  /** A range control, only when this card's period differs from the page's (A8-S1). */
  readonly range?: ReactNode;
  /** The view switch and the ⋯ menu, at the end of the header. */
  readonly actions?: ReactNode;
  /** Where the card's subject continues: "Open trends". */
  readonly footerLink?: CardFooterLink;
  /** Columns of the `DashboardGrid` the card spans; every span is the full width below a 45 rem grid. */
  readonly span?: GridSpan;
  /** The card's height in every state (loading, empty, failed), so nothing below moves when the chart arrives. */
  readonly minHeight?: number;
  readonly state?: ChartCardState;
  /** With `state="error"`: what went wrong, said in the product's words. */
  readonly problem?: Problem;
  /** With `state="empty"`: the sentence, which becomes the headline too. Default "No data for this period". */
  readonly emptyText?: string;
  /** With `state="error"`: a plain link that loads the page again. */
  readonly retryHref?: string;
  /** Default 3: a card sits under a page's `h2` sections. */
  readonly headingLevel?: 2 | 3 | 4;
  /** An anchor, for the section chips on a phone. */
  readonly id?: string;
  readonly className?: string;
  /** Exactly one chart when the card is ready. */
  readonly children?: ReactNode;
}

const HEADINGS = { 2: 'h2', 3: 'h3', 4: 'h4' } as const;

/** Whether a child is a line or area chart: the charts that take a `height` and a `span`. */
const isXY = (child: ReactElement<Record<string, unknown>>): boolean => 'xType' in child.props && 'series' in child.props;

/**
 * The plot height of the chart a card holds, or a line chart's when it holds
 * none yet. Read from the element's props and the component's own
 * `plotHeight` (set by `Gauge`), never by importing the charts: a card on a
 * Help Portal page must not pull every chart, and the reader island with
 * them, into that route.
 */
function plotHeight(child: ReactElement<Record<string, unknown>> | null): number {
  if (!child) return CHART_HEIGHTS.line;
  const height = child.props.height;
  if (isXY(child)) return typeof height === 'number' && Number.isFinite(height) ? height : CHART_HEIGHTS.line;
  const own = typeof child.type === 'function' ? (child.type as { plotHeight?: unknown }).plotHeight : undefined;
  if (typeof own === 'number') return own;
  if ('segments' in child.props && 'title' in child.props) return CHART_HEIGHTS.donut;
  return CHART_HEIGHTS.line;
}

/**
 * The chart in the card, told what the card already says (A8 §4.1): its
 * title is hidden, because the card shows one, and the card's headline is
 * its description for assistive technology only, because the card shows
 * that too — so a screen reader hears "title. headline" once, with the
 * figure. A description the page set on the chart itself wins. The card's
 * span goes to a line or area chart, which fits its marker labels to it.
 */
function inCard(child: ReactElement<Record<string, unknown>>, headline: string | undefined, span: GridSpan | undefined): ReactElement {
  if (typeof child.type === 'string' || !('title' in child.props)) return child;
  const own = child.props;
  const extra: Record<string, unknown> = {};
  if (own.titleHidden === undefined) extra.titleHidden = true;
  if (headline && own.description === undefined) {
    extra.description = headline;
    extra.descriptionHidden = true;
  }
  if (span !== undefined && own.span === undefined && isXY(child)) extra.span = span;
  return Object.keys(extra).length > 0 ? cloneElement(child, extra) : child;
}

/**
 * The PMO chart card (SPEC-v3 §8.2, A8 §4.1): `Card` v3 with the chart
 * contract. A title with its ⓘ, a visible **headline** — the card's answer
 * in words — and an optional basis line, the range or view controls, one
 * chart with its legend chips and "View as table", and a footer link.
 * Server-safe: it renders the `Card` client component with plain props and a
 * server-rendered chart.
 *
 * Every state is the same card at the same height (`minHeight`, or the
 * chart's plot height and the card's chrome), so a dashboard never jumps:
 *
 * - `loading`: `SkeletonChartCard`;
 * - `empty`: the "no data" plot, and the headline says the same words;
 * - `insufficient`: "Not enough history yet", with what would change it;
 * - `error`: the problem in the product's words and a plain "Try again"
 *   link, and no headline (it would describe data the card does not have).
 *
 * The card never renders a 403: a page that may not read a figure does not
 * render its card (D9). With `span` it is its own cell of a `DashboardGrid`.
 * Test hooks: `.itsm-ChartCard[data-state]`, `.itsm-ChartCard__headline`.
 */
export function ChartCard({
  title,
  info,
  headline,
  caption,
  meta,
  range,
  actions,
  footerLink,
  span,
  minHeight,
  state = 'ready',
  problem,
  emptyText = CHART_EMPTY_TEXT.empty,
  retryHref,
  headingLevel = 3,
  id,
  className,
  children,
}: ChartCardProps): ReactNode {
  const only = Children.toArray(children).find(isValidElement) as ReactElement<Record<string, unknown>> | undefined;
  const plot = plotHeight(only ?? null);
  const height = minHeight !== undefined && Number.isFinite(minHeight) && minHeight > 0 ? minHeight : plot + CHROME;
  const inCell = (card: ReactNode): ReactNode => (span === undefined ? card : <GridItem span={span}>{card}</GridItem>);

  if (state === 'loading') {
    return inCell(<SkeletonChartCard className={cx('itsm-ChartCard', className)} height={height} headline={Boolean(headline)} label={`Loading ${title}`} />);
  }

  const words = state === 'empty' ? emptyText : state === 'error' ? undefined : headline;
  const empty = state !== 'ready' || !only;
  let body: ReactNode;
  if (state === 'error') {
    const said = problem ? describeProblem(problem, { context: title }).title : CHART_EMPTY_TEXT.error;
    body = (
      <div className="itsm-Chart__empty itsm-ChartCard__problem" data-reason="error">
        <span className="itsm-Chart__emptyDisc">
          <Icon name="circle-alert" size="xl" className="itsm-Chart__emptyIcon" />
        </span>
        <p className="itsm-Chart__emptyText">{said}</p>
        {retryHref ? (
          <a className="itsm-ChartCard__retry" href={retryHref}>
            Try again
          </a>
        ) : null}
      </div>
    );
  } else if (state === 'empty') {
    body = <ChartEmpty height={plot} text={emptyText} />;
  } else if (state === 'insufficient') {
    body = <ChartEmpty height={plot} reason="insufficient" detail="Charts start once there are 3 days of data" />;
  } else {
    body = only ? inCard(only, headline, span) : <ChartEmpty height={plot} text={emptyText} />;
  }

  const controls = range || actions ? (
    <>
      {range}
      {actions}
    </>
  ) : undefined;
  return inCell(
    <Card
      className={cx('itsm-ChartCard', className)}
      title={title}
      titleAs={HEADINGS[headingLevel] ?? 'h3'}
      {...(info === undefined ? {} : { info })}
      {...(meta === undefined ? {} : { meta })}
      {...(controls === undefined ? {} : { actions: controls })}
      {...(footerLink === undefined ? {} : { footerLink })}
      {...(id === undefined ? {} : { id })}
      data-state={state}
      data-lede={words || caption ? '' : undefined}
      style={empty || minHeight !== undefined ? { minBlockSize: `${height}px` } : undefined}
    >
      {words || caption ? (
        <div className="itsm-ChartCard__lede">
          {words ? <p className="itsm-ChartCard__headline">{words}</p> : null}
          {caption ? <p className="itsm-ChartCard__caption">{caption}</p> : null}
        </div>
      ) : null}
      <div className="itsm-ChartCard__plot">{body}</div>
    </Card>,
  );
}
