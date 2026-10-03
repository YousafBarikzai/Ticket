import type { ReactNode } from 'react';
import { formatNumber } from '../format/format.js';
import { cx } from '../web/cx.js';
import { ChartFigure } from './ChartFigure.js';
import { ChartLink } from './ChartLink.js';
import { ChartReader, type ReaderPoint } from './ChartReader.js';
import { CHART_EMPTY_TEXT, ChartEmpty } from './parts.js';
import { DEFAULT_LOCALE } from './scale.js';
import type { ChartTableMode } from './types.js';

export interface BulletBarProps {
  /** What the row measures: "Network team", "Response". */
  readonly label: string;
  readonly value: number;
  /** The goal (or, with `cap`, the limit), as a tick across the track. */
  readonly target?: number;
  /** The end of the track. Default the largest of the value, the target and 1; past it the overrun is hatched. */
  readonly max?: number;
  /** The target is a limit — time used against time allowed — so nearing it is the warning and reaching it the breach. */
  readonly cap?: boolean;
  /** With `cap`: the share of the limit from which the fill turns amber. Default 0.8. */
  readonly capWarn?: number;
  /** Without `cap`: a shortfall of at least this share of the track is danger, a smaller one warning. Default 0.10. */
  readonly dangerGap?: number;
  /** The fill's colour: the accent (default), or the tone of the zone the value is in. */
  readonly tone?: 'accent' | 'auto';
  /** Default a plain number; `{ style: 'percent' }` reads values as fractions and gaps as points. */
  readonly format?: Intl.NumberFormatOptions;
  /** A quiet note after the value: "40 min left", "Breached 1 d". */
  readonly detail?: string;
  /** A 24 px row on a 6 px track, for tiles and inspector cards. */
  readonly compact?: boolean;
  /** Makes the row a link to what it measures. */
  readonly href?: string;
  readonly locale?: string;
  readonly className?: string;
}

export interface BulletRow extends BulletBarProps {
  readonly id: string;
}

export interface BulletListProps {
  readonly title: string;
  readonly titleHidden?: boolean;
  readonly rows: readonly BulletRow[];
  /** `value` largest first; `gap` furthest below target first; `none` (default) as given. */
  readonly sort?: 'value' | 'gap' | 'none';
  /** Rows shown; the rest wait behind "Show all n". */
  readonly max?: number;
  /** The list's point in a sentence. Without it the list writes one, for screen readers only. */
  readonly description?: string;
  /** Keeps `description` for assistive technology only: the card around the list shows it as its headline. */
  readonly descriptionHidden?: boolean;
  /** The rows already say every value, so no table by default. */
  readonly table?: ChartTableMode;
  /** Adds the reader island: ↑ ↓ down the rows. */
  readonly interactive?: boolean;
  readonly emptyText?: string;
  readonly locale?: string;
  readonly className?: string;
}

type FillTone = 'accent' | 'success' | 'warning' | 'danger';

/** Where everything on a bullet's track goes, as fractions of its width, and what it says. */
export interface BulletMeasure {
  readonly fill: number;
  readonly fillTone: FillTone;
  /** The shortfall between the value and the target, tinted by how far short. */
  readonly gap: { readonly from: number; readonly to: number; readonly tone: 'warning' | 'danger' } | null;
  readonly tick: number | null;
  /** The part past `max`, hatched. */
  readonly over: { readonly from: number; readonly to: number } | null;
  /** The value in words. */
  readonly value: string;
  /** What follows the value in the sentence: ", target 90%, 9 points below". */
  readonly rest: string;
}

const share = (part: number, whole: number): number => (whole > 0 ? Math.min(1, Math.max(0, part / whole)) : 0);

/**
 * A bullet's geometry and words (A8 §4.6). Pure, so the list, the bar and the
 * tests read the same answer.
 *
 * Without `cap`, a value short of its target leaves a gap to the tick, amber
 * when the shortfall is under `dangerGap` of the track and red from there;
 * with `tone="auto"` the fill takes the same zone (green at or past the
 * target). With `cap` the target is a limit: the fill is the accent below
 * `capWarn` of it, amber from there and red once it is reached. A value past
 * an explicit `max` stretches the track and the part beyond `max` is hatched.
 */
export function measureBullet({
  value,
  target,
  max,
  cap = false,
  capWarn = 0.8,
  dangerGap = 0.1,
  tone = 'accent',
  format,
  locale = DEFAULT_LOCALE,
}: BulletBarProps): BulletMeasure {
  const write = (n: number): string => formatNumber(n, { ...format, locale });
  const known = Number.isFinite(value) ? value : 0;
  const goal = target !== undefined && Number.isFinite(target) ? target : undefined;
  const limit = max !== undefined && Number.isFinite(max) && max > 0 ? max : Math.max(known, goal ?? 0, 1);
  const scale = Math.max(limit, known, goal ?? 0);
  const percent = format?.style === 'percent';
  const difference = (n: number): string => {
    if (!percent) return write(n);
    const points = Math.round(n * 1000) / 10;
    return `${formatNumber(points, { locale, maximumFractionDigits: 1 })} ${points === 1 ? 'point' : 'points'}`;
  };

  let fillTone: FillTone = 'accent';
  let gap: BulletMeasure['gap'] = null;
  let rest = '';
  if (goal !== undefined && cap) {
    const used = goal > 0 ? known / goal : 1;
    fillTone = used >= 1 ? 'danger' : used >= capWarn ? 'warning' : 'accent';
    rest = `, limit ${write(goal)}${known > goal ? `, ${difference(known - goal)} over` : ''}`;
  } else if (goal !== undefined) {
    const short = goal - known;
    // Rounded, so 0.9 − 0.8 is a gap of exactly a tenth, as a reader would say, not 0.0999….
    const zone = short <= 0 ? 'success' : Math.round((short / limit) * 1e9) / 1e9 >= dangerGap ? 'danger' : 'warning';
    if (zone !== 'success') gap = { from: share(known, scale), to: share(goal, scale), tone: zone };
    if (tone === 'auto') fillTone = zone;
    rest = `, target ${write(goal)}, ${Math.abs(short) < 1e-9 ? 'on target' : `${difference(Math.abs(short))} ${short > 0 ? 'below' : 'above'}`}`;
  }
  const over = max !== undefined && known > limit ? { from: share(limit, scale), to: 1 } : null;
  return {
    fill: share(over ? limit : known, scale),
    fillTone,
    gap,
    tick: goal === undefined ? null : share(goal, scale),
    over,
    value: write(known),
    rest,
  };
}

const percent = (fraction: number): string => `${Math.round(fraction * 100_000) / 1000}%`;

/** The track: the fill, the shortfall, the overrun and the tick, all decoration (the words carry them). */
function Track({ measure }: { readonly measure: BulletMeasure }): ReactNode {
  return (
    <span className="itsm-Bullet__track" aria-hidden="true">
      {measure.gap ? (
        <span className="itsm-Bullet__gap" data-tone={measure.gap.tone} style={{ insetInlineStart: percent(measure.gap.from), inlineSize: percent(measure.gap.to - measure.gap.from) }} />
      ) : null}
      {measure.fill > 0 ? <span className="itsm-Bullet__fill" data-tone={measure.fillTone} style={{ inlineSize: percent(measure.fill) }} /> : null}
      {measure.over ? <span className="itsm-Bullet__over" style={{ insetInlineStart: percent(measure.over.from), inlineSize: percent(measure.over.to - measure.over.from) }} /> : null}
      {measure.tick === null ? null : <span className="itsm-Bullet__tick" style={{ insetInlineStart: percent(measure.tick) }} />}
    </span>
  );
}

/**
 * One row: label · track · value · detail. A row with an `href` is a link
 * whose name is the whole sentence, stretched over the row; otherwise the
 * words after the value are there for assistive technology only.
 */
function BulletRowView({
  row,
  measure,
  as: Tag,
  point,
  image,
}: {
  readonly row: BulletBarProps;
  readonly measure: BulletMeasure;
  readonly as: 'div' | 'li';
  readonly point?: number;
  readonly image?: string;
}): ReactNode {
  const words = <span className="itsm-visually-hidden">{`: ${measure.value}${measure.rest}`}</span>;
  return (
    <Tag
      className={cx('itsm-Bullet', row.className)}
      data-compact={row.compact || undefined}
      data-detail={row.detail ? '' : undefined}
      data-link={row.href ? '' : undefined}
      data-point={point}
      {...(image ? { role: 'img', 'aria-label': image } : {})}
    >
      <span className="itsm-Bullet__label">
        {row.href ? (
          <ChartLink href={row.href} className="itsm-Bullet__link">
            {row.label}
            {words}
          </ChartLink>
        ) : (
          row.label
        )}
      </span>
      <Track measure={measure} />
      <span className="itsm-Bullet__value" aria-hidden={row.href ? true : undefined}>
        {measure.value}
      </span>
      {row.href || image ? null : <span className="itsm-visually-hidden">{measure.rest}</span>}
      {row.detail ? <span className="itsm-Bullet__detail">{row.detail}</span> : null}
    </Tag>
  );
}

/**
 * A value against a target on one track (A8 §4.6, the PMO's "By category"):
 * label · dark fill · the shortfall tinted amber or pink to a target tick ·
 * the value · a quiet detail. Server-safe.
 *
 * On its own it is an image named by its sentence — "Network team: 81%,
 * target 90%, 9 points below" — or, with `href`, a link carrying the same
 * words.
 */
export function BulletBar(props: BulletBarProps): ReactNode {
  const measure = measureBullet(props);
  const sentence = `${props.label}: ${measure.value}${measure.rest}${props.detail ? `, ${props.detail}` : ''}`;
  return <BulletRowView row={props} measure={measure} as="div" {...(props.href ? {} : { image: sentence })} />;
}

/**
 * Rows of bullets sharing one set of columns (A8 §4.6): a figure whose list
 * says every row in full, label, value and its distance to target. `sort`
 * puts the largest or the furthest behind first; `max` keeps the rest
 * behind "Show all n". `interactive` adds the reader, ↑ ↓ down the rows.
 * Server-safe.
 */
export function BulletList({
  title,
  titleHidden = false,
  rows,
  sort = 'none',
  max,
  description,
  descriptionHidden = false,
  table = 'hidden',
  interactive = false,
  emptyText = CHART_EMPTY_TEXT.empty,
  locale = DEFAULT_LOCALE,
  className,
}: BulletListProps): ReactNode {
  const frame = { title, titleHidden, locale, className };
  if (rows.length === 0) {
    return (
      <ChartFigure {...frame} summary={emptyText} summaryHidden table={{ columns: [], rows: [] }} tableMode="hidden">
        <div className="itsm-Chart itsm-BulletList">
          <ChartEmpty height={96} text={emptyText} />
        </div>
      </ChartFigure>
    );
  }

  const shortfall = (row: BulletRow): number => (row.target === undefined ? Number.NEGATIVE_INFINITY : row.target - row.value);
  const ordered =
    sort === 'value' ? [...rows].sort((a, b) => b.value - a.value) : sort === 'gap' ? [...rows].sort((a, b) => shortfall(b) - shortfall(a)) : rows;
  const measures = ordered.map((row) => measureBullet({ locale, ...row }));
  const visible = max !== undefined && max >= 1 && max < ordered.length ? Math.floor(max) : ordered.length;
  const targeted = ordered.filter((row) => row.target !== undefined);
  const behind = targeted.filter((row) => !row.cap && row.target! > row.value).length;
  const summary =
    description ?? (targeted.length > 0 ? `${behind} of ${targeted.length} below target.` : `${ordered.length} ${ordered.length === 1 ? 'row' : 'rows'}.`);
  const list = (from: number, to: number): ReactNode => (
    <ul className="itsm-BulletList__rows">
      {ordered.slice(from, to).map((row, offset) => (
        <BulletRowView key={row.id} row={row} measure={measures[from + offset]!} as="li" {...(interactive ? { point: from + offset } : {})} />
      ))}
    </ul>
  );
  const body = (
    <>
      {list(0, visible)}
      {visible < ordered.length ? (
        <details className="itsm-BulletList__more">
          <summary className="itsm-BulletList__toggle">Show all {ordered.length}</summary>
          {list(visible, ordered.length)}
        </details>
      ) : null}
    </>
  );
  const points: ReaderPoint[] = interactive
    ? ordered.map((row, index) => ({
        key: row.id,
        title: row.label,
        at: [0.5, (index + 0.5) / ordered.length],
        rows: [{ id: row.id, label: '', value: `${measures[index]!.value}${measures[index]!.rest}` }],
        ...(row.href ? { href: row.href } : {}),
      }))
    : [];

  return (
    <ChartFigure
      {...frame}
      summary={summary}
      summaryHidden={description === undefined || descriptionHidden}
      table={{
        columns: ['Name', 'Value', 'Target', ...(ordered.some((row) => row.detail) ? ['Detail'] : [])],
        rows: ordered.map((row, index) => [
          row.label,
          measures[index]!.value,
          row.target === undefined ? null : formatNumber(row.target, { ...row.format, locale: row.locale ?? locale }),
          ...(ordered.some((one) => one.detail) ? [row.detail ?? ''] : []),
        ]),
      }}
      tableMode={table}
    >
      <div className="itsm-Chart itsm-BulletList" data-detail={ordered.some((row) => row.detail) ? '' : undefined}>
        {interactive ? (
          <ChartReader label={title} points={points} mode="marks" axis="y" placement="above" nearest={false}>
            {body}
          </ChartReader>
        ) : (
          body
        )}
      </div>
    </ChartFigure>
  );
}
