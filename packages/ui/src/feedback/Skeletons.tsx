import type { CSSProperties, ReactNode } from 'react';
import { cx } from '../web/cx.js';
import { Skeleton, SkeletonText } from '../web/Skeleton.js';
import { Spinner } from './Spinner.js';

/*
 * The skeleton family: placeholders shaped like the content they stand in for.
 *
 * Server-safe, because they are what a route's `loading.tsx` streams first.
 * The timing is all CSS — bones revealed after 200 ms, the "Loading …" status
 * after 1 s, "Still loading…" after 10 s — so a fast response never flashes a
 * skeleton and no timer runs on the client. The shapes are `aria-hidden`;
 * only the status speaks, and only on a skeleton that has one: every
 * `SkeletonPage`, and a section skeleton given a `label`. A dashboard of six
 * loading cards should say "Loading…" once, not six times.
 *
 * The status sits beside the busy shapes rather than inside them: a live
 * region inside an `aria-busy` element may be held back until the element
 * stops being busy, which for a skeleton is never.
 *
 * `Skeleton` and `SkeletonText` stay in `web/Skeleton.tsx`, where applications
 * import them from today.
 */

const CONTROL = 'var(--itsm-control-height-md)';
const CONTROL_SM = 'var(--itsm-control-height-sm)';

interface Announced {
  /**
   * Gives the skeleton a status that is read out after a second: "Loading
   * rules…". Without it the skeleton is silent, for a section inside a page
   * that already says it is loading.
   */
  readonly label?: string;
  /** The words shown after ten seconds; "Still loading…" by default. */
  readonly stillLabel?: string;
}

/**
 * The delayed status. Present from the first paint — a live region has to
 * exist before its text changes to be heard — with its words hidden until
 * CSS reveals them: the loading sentence (for screen readers only) after one
 * second, then "Still loading…" (for everybody) after ten.
 */
function SkeletonStatus({ label, stillLabel = 'Still loading…' }: { readonly label: string; readonly stillLabel?: string | undefined }): ReactNode {
  return (
    <div role="status" className="itsm-SkeletonStatus">
      <span className="itsm-SkeletonStatus__loading itsm-visually-hidden">{label}</span>
      <span className="itsm-SkeletonStatus__still">
        <Spinner size="sm" />
        {stillLabel}
      </span>
    </div>
  );
}

/**
 * The root of every skeleton in this file: the shapes, silent (`aria-hidden`)
 * or — with a label — marked busy beside their status.
 */
function SkeletonRoot({
  className,
  label,
  stillLabel,
  style,
  children,
  ...data
}: Announced & {
  readonly className: string;
  readonly style?: CSSProperties;
  readonly children: ReactNode;
  readonly [data: `data-${string}`]: string | number | undefined;
}): ReactNode {
  if (!label) {
    return (
      <div {...data} aria-hidden="true" className={className} style={style}>
        {children}
      </div>
    );
  }
  return (
    <div {...data} className={className} style={style} data-announced="">
      <SkeletonStatus label={label} stillLabel={stillLabel} />
      <div className="itsm-SkeletonShapes" aria-busy="true">
        {children}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Pieces */

const avatarPixels = { xs: 20, sm: 24, md: 32, lg: 40, xl: 56 } as const;

export interface SkeletonAvatarProps {
  readonly size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  readonly className?: string;
}

export function SkeletonAvatar({ size = 'md', className }: SkeletonAvatarProps): ReactNode {
  const px = avatarPixels[size] ?? avatarPixels.md;
  return <Skeleton className={cx('itsm-SkeletonAvatar', className)} width={px} height={px} radius="full" />;
}

export interface SkeletonStatProps {
  readonly className?: string;
}

/**
 * Stands in for a `StatCard` v3 tile at its final height (124): the label,
 * the value with its delta pill, and the context line at the foot.
 */
export function SkeletonStat({ className }: SkeletonStatProps): ReactNode {
  return (
    <div aria-hidden="true" className={cx('itsm-SkeletonStat', className)}>
      <Skeleton className="itsm-SkeletonStat__label" width="45%" height={12} />
      <div className="itsm-SkeletonStat__value">
        <Skeleton width="40%" height="var(--itsm-text-statValue-size)" radius="md" />
        <Skeleton width="2.75rem" height={20} radius="pill" />
      </div>
      <Skeleton className="itsm-SkeletonStat__context" width="64%" height={12} />
    </div>
  );
}

/** A card's head: the title bar (38 %) and, for chart cards, the headline bar (64 %) — 12 px bars, as the v3 kit draws text. */
function CardHead({ headline }: { readonly headline: boolean }): ReactNode {
  return (
    <div className="itsm-SkeletonCard__head">
      <Skeleton className="itsm-SkeletonCard__title" width="38%" height={12} />
      {headline ? <Skeleton className="itsm-SkeletonCard__headline" width="64%" height={12} /> : null}
    </div>
  );
}

export interface SkeletonCardProps extends Announced {
  /** Lines of body text. */
  readonly lines?: number;
  readonly className?: string;
}

/** Stands in for a `Card`: a title and a few lines of text — long lines at 92 %, the last at 64 % — in the card's frame. */
export function SkeletonCard({ lines = 3, className, label, stillLabel }: SkeletonCardProps): ReactNode {
  const count = Math.max(1, Math.floor(lines));
  return (
    <SkeletonRoot className={cx('itsm-SkeletonCard', className)} label={label} stillLabel={stillLabel} data-lines={count}>
      <CardHead headline={false} />
      <div className="itsm-SkeletonCard__lines">
        {Array.from({ length: count }, (_, index) => (
          <Skeleton key={index} width={index === count - 1 && count > 1 ? '64%' : '92%'} height={12} />
        ))}
      </div>
    </SkeletonRoot>
  );
}

export interface SkeletonChartCardProps extends Announced {
  /**
   * The ready card's whole height in pixels — the kind's plot height plus the
   * card's chrome — so nothing below moves when the chart arrives. 320 (the
   * dashboard's chart cards) by default.
   */
  readonly height?: number;
  /** Draws the headline bar under the title; on by default, because every chart card has a headline (v3 §7.0.1 G6). */
  readonly headline?: boolean;
  readonly className?: string;
}

/**
 * Stands in for a `ChartCard` (v3 §2.13, A8 §3): the title bar, the headline
 * bar, then a plot block that takes the rest of the card's final height. The
 * fallback each dashboard card streams behind (`<Suspense fallback={…}>`).
 */
export function SkeletonChartCard({ height = 320, headline = true, className, label, stillLabel }: SkeletonChartCardProps): ReactNode {
  const final = Number.isFinite(height) && height > 0 ? height : 320;
  return (
    <SkeletonRoot
      className={cx('itsm-SkeletonCard itsm-SkeletonChartCard', className)}
      label={label}
      stillLabel={stillLabel}
      data-height={final}
      data-headline={headline ? '' : undefined}
      // Dynamic geometry, which is what inline style is for (SPEC §3.3 rule 6).
      style={{ minBlockSize: `${final}px` }}
    >
      <CardHead headline={headline} />
      <Skeleton className="itsm-SkeletonChartCard__plot" height="auto" radius="md" />
    </SkeletonRoot>
  );
}

export interface SkeletonTableProps extends Announced {
  readonly rows?: number;
  readonly columns?: number;
  readonly className?: string;
}

/** Cell widths, cycled so the rows look like data rather than a grid of identical bars. */
const cellWidths = ['72%', '48%', '60%', '36%', '54%', '66%', '42%'];

/** Stands in for a table: a header row and `rows` rows of `columns` cells, the first column wider. */
export function SkeletonTable({ rows = 8, columns = 4, className, label, stillLabel }: SkeletonTableProps): ReactNode {
  const columnCount = Math.max(1, Math.floor(columns));
  const rowCount = Math.max(1, Math.floor(rows));
  // Dynamic geometry, which is what inline style is for (SPEC §3.3 rule 6).
  const template = { gridTemplateColumns: `minmax(0, 2fr) repeat(${columnCount - 1}, minmax(0, 1fr))` };
  return (
    <SkeletonRoot className={cx('itsm-SkeletonTable', className)} label={label} stillLabel={stillLabel} data-rows={rowCount} data-columns={columnCount}>
      <div className="itsm-SkeletonTable__row" data-header="" style={template}>
        {Array.from({ length: columnCount }, (_, column) => (
          <Skeleton key={column} width={column === 0 ? '32%' : '50%'} height={10} />
        ))}
      </div>
      {Array.from({ length: rowCount }, (_, row) => (
        <div key={row} className="itsm-SkeletonTable__row" style={template}>
          {Array.from({ length: columnCount }, (_, column) => (
            <Skeleton key={column} width={cellWidths[(row * 3 + column * 2) % cellWidths.length]} height={column === 0 ? 13 : 11} />
          ))}
        </div>
      ))}
    </SkeletonRoot>
  );
}

export interface SkeletonListProps extends Announced {
  readonly rows?: number;
  readonly className?: string;
}

/** Stands in for a two-line list: an avatar, a title and a line of detail, and a time at the end. */
export function SkeletonList({ rows = 8, className, label, stillLabel }: SkeletonListProps): ReactNode {
  const rowCount = Math.max(1, Math.floor(rows));
  return (
    <SkeletonRoot className={cx('itsm-SkeletonList', className)} label={label} stillLabel={stillLabel} data-rows={rowCount}>
      {Array.from({ length: rowCount }, (_, row) => (
        <div key={row} className="itsm-SkeletonList__row">
          <SkeletonAvatar size="md" />
          <div className="itsm-SkeletonList__text">
            <Skeleton width={cellWidths[(row * 2) % cellWidths.length]} height={13} />
            <Skeleton width={cellWidths[(row * 2 + 3) % cellWidths.length]} height={10} />
          </div>
          <Skeleton className="itsm-SkeletonList__end" width={40} height={10} />
        </div>
      ))}
    </SkeletonRoot>
  );
}

export interface SkeletonConversationProps extends Announced {
  readonly messages?: number;
  readonly className?: string;
}

/** Stands in for a ticket's conversation: messages with an avatar, a name and time, and a few lines. */
export function SkeletonConversation({ messages = 3, className, label, stillLabel }: SkeletonConversationProps): ReactNode {
  const count = Math.max(1, Math.floor(messages));
  return (
    <SkeletonRoot className={cx('itsm-SkeletonConversation', className)} label={label} stillLabel={stillLabel} data-messages={count}>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="itsm-SkeletonConversation__message">
          <SkeletonAvatar size="md" />
          <div className="itsm-SkeletonConversation__bubble">
            <div className="itsm-SkeletonConversation__meta">
              <Skeleton width="7rem" height={12} />
              <Skeleton width="3rem" height={10} />
            </div>
            <SkeletonText lines={index % 2 === 0 ? 3 : 2} lastLineWidth={index % 2 === 0 ? '45%' : '70%'} />
          </div>
        </div>
      ))}
    </SkeletonRoot>
  );
}

/* ------------------------------------------------------------------- Pages */

export type SkeletonPageVariant = 'list' | 'detail' | 'dashboard' | 'board' | 'form' | 'workspace' | 'inbox' | 'settings';

export interface SkeletonPageProps {
  readonly variant: SkeletonPageVariant;
  /** The delayed status, the whole sentence: "Loading tickets…". "Loading…" by default. */
  readonly label?: string;
  /** The words shown after ten seconds; "Still loading…" by default. */
  readonly stillLabel?: string;
  readonly className?: string;
}

function Header({ actions = true, back = false }: { readonly actions?: boolean; readonly back?: boolean }): ReactNode {
  return (
    <div className="itsm-SkeletonPage__header">
      <div className="itsm-SkeletonPage__heading">
        {back ? <Skeleton width="6rem" height={12} /> : null}
        <Skeleton width="min(16rem, 60%)" height="var(--itsm-text-title1-size)" radius="md" />
      </div>
      {actions ? <Skeleton className="itsm-SkeletonPage__action" width="7rem" height={CONTROL} radius="lg" /> : null}
    </div>
  );
}

function Toolbar(): ReactNode {
  return (
    <div className="itsm-SkeletonPage__toolbar">
      <Skeleton width="min(16rem, 100%)" height={CONTROL} radius="lg" />
      <Skeleton width="5.5rem" height={CONTROL_SM} radius="pill" />
      <Skeleton width="4.5rem" height={CONTROL_SM} radius="pill" />
      <Skeleton width="5rem" height={CONTROL_SM} radius="pill" />
    </div>
  );
}

function Field(): ReactNode {
  return (
    <div className="itsm-SkeletonPage__field">
      <Skeleton width="7rem" height={12} />
      <Skeleton height={CONTROL} radius="lg" />
    </div>
  );
}

function FormSectionShapes(): ReactNode {
  return (
    <div className="itsm-SkeletonPage__panel itsm-SkeletonPage__stack">
      <Skeleton width="9rem" height={16} />
      <Field />
      <Field />
      <Field />
    </div>
  );
}

function SettingRows({ rows }: { readonly rows: number }): ReactNode {
  return (
    <div className="itsm-SkeletonPage__panel itsm-SkeletonPage__settings">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="itsm-SkeletonPage__setting">
          <div className="itsm-SkeletonPage__settingText">
            <Skeleton width={cellWidths[index % cellWidths.length]} height={13} />
            <Skeleton width={cellWidths[(index + 3) % cellWidths.length]} height={10} />
          </div>
          <Skeleton width="2.75rem" height="1.625rem" radius="pill" />
        </div>
      ))}
    </div>
  );
}

function DetailAside(): ReactNode {
  return (
    <div className="itsm-SkeletonPage__panel itsm-SkeletonPage__facts">
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="itsm-SkeletonPage__fact">
          <Skeleton width="40%" height={10} />
          <Skeleton width={cellWidths[(index * 2) % cellWidths.length]} height={13} />
        </div>
      ))}
    </div>
  );
}

/** A dashboard's toolbar: the scope and range controls at the start, the "As at" and an action at the end. */
function DashboardToolbar(): ReactNode {
  return (
    <div className="itsm-SkeletonPage__toolbar itsm-SkeletonPage__dashboardToolbar">
      <Skeleton width="10rem" height={CONTROL_SM} radius="lg" />
      <Skeleton width="12rem" height={CONTROL_SM} radius="lg" />
      <Skeleton className="itsm-SkeletonPage__toolbarEnd" width="7rem" height={12} />
      <Skeleton width="6.5rem" height={CONTROL} radius="lg" />
    </div>
  );
}

/** The verdict band at 168 px: kicker, verdict, a line under it, and the aside's figure. */
function Hero(): ReactNode {
  return (
    <div className="itsm-SkeletonPage__panel itsm-SkeletonPage__hero">
      <div className="itsm-SkeletonPage__stack">
        <Skeleton width="7rem" height={12} />
        <Skeleton width="min(16rem, 70%)" height="var(--itsm-text-verdict-line)" radius="md" />
        <Skeleton width="min(22rem, 90%)" height={12} />
        <div className="itsm-SkeletonPage__pills">
          <Skeleton width="5.5rem" height={22} radius="pill" />
          <Skeleton width="7rem" height={22} radius="pill" />
          <Skeleton width="6rem" height={22} radius="pill" />
        </div>
      </div>
      <div className="itsm-SkeletonPage__heroAside">
        <Skeleton width="6rem" height={12} />
        <Skeleton width="5rem" height="var(--itsm-text-verdict-line)" radius="md" />
        <Skeleton height={10} radius="pill" />
      </div>
    </div>
  );
}

/** One kanban column: its header (title and count) and `cards` ghost cards. */
function BoardColumn({ cards }: { readonly cards: number }): ReactNode {
  return (
    <div className="itsm-SkeletonPage__column">
      <div className="itsm-SkeletonPage__columnHead">
        <Skeleton width="45%" height={12} />
        <Skeleton width="1.5rem" height={20} radius="pill" />
      </div>
      {Array.from({ length: cards }, (_, index) => (
        <div key={index} className="itsm-SkeletonPage__ghostCard">
          <Skeleton width="38%" height={10} />
          <Skeleton width="92%" height={12} />
          <Skeleton width="64%" height={12} />
          <div className="itsm-SkeletonPage__ghostFoot">
            <Skeleton width={24} height={24} radius="full" />
            <Skeleton width="4rem" height={20} radius="pill" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** The board: four columns of three ghost cards, then two folded strips (Resolved, Closed). */
function Board(): ReactNode {
  return (
    <div className="itsm-SkeletonPage__board">
      {Array.from({ length: 4 }, (_, index) => (
        <BoardColumn key={index} cards={3} />
      ))}
      <div className="itsm-SkeletonPage__strip">
        <Skeleton width={20} height={20} radius="pill" />
        <Skeleton width={12} height="6rem" />
      </div>
      <div className="itsm-SkeletonPage__strip">
        <Skeleton width={20} height={20} radius="pill" />
        <Skeleton width={12} height="6rem" />
      </div>
    </div>
  );
}

function Workspace(): ReactNode {
  return (
    <div className="itsm-SkeletonPage__workspace">
      <div className="itsm-SkeletonPage__heading">
        <Skeleton width="6rem" height={12} />
        <Skeleton width="min(28rem, 80%)" height="var(--itsm-text-title3-size)" radius="md" />
        <div className="itsm-SkeletonPage__pills">
          <Skeleton width="5rem" height={22} radius="pill" />
          <Skeleton width="4rem" height={22} radius="pill" />
          <Skeleton width="6rem" height={22} radius="pill" />
        </div>
      </div>
      <SkeletonConversation messages={3} />
      <Skeleton className="itsm-SkeletonPage__composer" height="6rem" radius="xl" />
    </div>
  );
}

function pageShapes(variant: SkeletonPageVariant): ReactNode {
  switch (variant) {
    case 'list':
      return (
        <>
          <Header />
          <Toolbar />
          <div className="itsm-SkeletonPage__panel">
            <SkeletonTable rows={8} columns={5} />
          </div>
        </>
      );
    case 'detail':
      return (
        <>
          <Header back />
          <div className="itsm-SkeletonPage__split">
            <div className="itsm-SkeletonPage__stack">
              <SkeletonCard lines={4} />
              <SkeletonCard lines={3} />
            </div>
            <DetailAside />
          </div>
        </>
      );
    case 'dashboard':
      return (
        <>
          <DashboardToolbar />
          <Hero />
          <div className="itsm-SkeletonPage__stats" data-count={6}>
            {Array.from({ length: 6 }, (_, index) => (
              <SkeletonStat key={index} />
            ))}
          </div>
          <div className="itsm-SkeletonPage__columns">
            <SkeletonChartCard height={320} />
            <SkeletonChartCard height={320} />
          </div>
        </>
      );
    case 'board':
      return (
        <>
          <Toolbar />
          <Board />
        </>
      );
    case 'form':
      return (
        <>
          <Header actions={false} back />
          <div className="itsm-SkeletonPage__narrow">
            <FormSectionShapes />
            <FormSectionShapes />
            <div className="itsm-SkeletonPage__footer">
              <Skeleton width="5.5rem" height={CONTROL} radius="lg" />
              <Skeleton width="7.5rem" height={CONTROL} radius="lg" />
            </div>
          </div>
        </>
      );
    case 'workspace':
      return <Workspace />;
    case 'inbox':
      return (
        <div className="itsm-SkeletonPage__panes">
          <div className="itsm-SkeletonPage__listPane">
            <Skeleton width="min(12rem, 60%)" height="var(--itsm-text-title3-size)" radius="md" />
            <SkeletonList rows={9} />
          </div>
          <div className="itsm-SkeletonPage__detailPane">
            <Workspace />
          </div>
        </div>
      );
    case 'settings':
      return (
        <>
          <Header actions={false} />
          <div className="itsm-SkeletonPage__narrow">
            <SettingRows rows={4} />
            <SettingRows rows={3} />
          </div>
        </>
      );
    default:
      return <Header />;
  }
}

/**
 * A whole route's placeholder, for `loading.tsx`, shaped like the page it
 * stands in for — list, detail, dashboard, board, form, the Service Desk
 * workspace and inbox, settings — and rendered inside the persistent shell.
 * It carries the delayed status: "Loading…" for screen readers after a
 * second, "Still loading…" for everybody after ten.
 *
 * The v3 dashboard is the PMO page at its final heights (v3 §2.13): the
 * toolbar, the hero at 168, six KPI tiles at 124 and two chart cards at 320,
 * so nothing jumps when the page streams in. The board is four columns of
 * three ghost cards and the two folded strips.
 */
export function SkeletonPage({ variant, label = 'Loading…', stillLabel, className }: SkeletonPageProps): ReactNode {
  return (
    <SkeletonRoot className={cx('itsm-SkeletonPage', className)} label={label} stillLabel={stillLabel} data-variant={variant}>
      {pageShapes(variant)}
    </SkeletonRoot>
  );
}
