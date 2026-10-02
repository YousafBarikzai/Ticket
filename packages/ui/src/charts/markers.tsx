import type { CSSProperties, ReactNode } from 'react';
import type { ChartBand, ChartMarker, ChartMarkerKind, TimeBucket } from './common.js';
import { cx } from '../web/cx.js';
import { DEFAULT_LOCALE, diamondAt, placeMarkers } from './scale.js';
import { asAtLabel, markerPosition, toInstant } from './time.js';

/**
 * Markers for any chart with an x axis (A8 §3.1, §4.3.4): the dashed "As at
 * 2 Oct" line with its navy pill, a deadline with its pill and a filled
 * diamond, milestones with gate labels and hollow or filled diamonds, events,
 * a target line and shaded bands. Server-safe; the chart that uses them
 * supplies the geometry (where its x values sit, where its baseline is) and
 * these draw on top of it.
 *
 * The work is split so that a chart can reserve room before it draws:
 *
 * 1. `resolveMarkers` turns the page's markers into fractions of the plot
 *    width — "today" from `asAt` in the reader's zone, never from a clock;
 * 2. `layoutMarkers` decides which labels go on which of two 18 px tiers
 *    above the data, without measuring anything;
 * 3. the chart adds `rowHeight` to the room above its data, then renders
 *    `MarkerBackdrop` inside its SVG (behind the lines) and `MarkerLayer`
 *    over its plot (in front of them).
 *
 * Everything here is decoration over a figure whose table twin carries the
 * same facts (`markerTableColumn`), so the layer is hidden from assistive
 * technology.
 */

/** The height of one tier of marker labels, in px: a 14 px line and the pill's 2 px padding above and below. */
export const MARKER_TIER_HEIGHT = 18;

/** Diamond sizes, as half-diagonals: a milestone is a 9 px square turned 45°, a deadline a 12 px diamond (A8 §3.1). */
const MILESTONE_RADIUS = 6.36;
const DEADLINE_RADIUS = 6;
/** The box each diamond is drawn in. */
const DIAMOND_BOX = 15;

/** Where a chart's x values sit, so a marker can be put among them. */
export interface MarkerAxis {
  /** The chart's x values, in drawing order. */
  readonly xs: readonly string[];
  /** Each x value's position as a fraction of the plot width, 0 at the start and 1 at the end. */
  readonly positions: readonly number[];
  /** The x values as epoch milliseconds on a time axis; absent on a category axis, which has no "today". */
  readonly times?: readonly number[] | null;
  /** The series' bucket; inferred from the spacing of `times` when absent. */
  readonly bucket?: TimeBucket;
}

/** What "now" is and how to write it: the page's `asAt` instant, the reader's zone and language. */
export interface MarkerContext {
  readonly asAt?: string;
  readonly timeZone?: string;
  readonly locale?: string;
}

/** A marker put on the axis. */
export interface ResolvedMarker {
  readonly id: string;
  readonly kind: ChartMarkerKind;
  /** Its position as a fraction of the plot width. */
  readonly x: number;
  /** The index of the x value whose table row names it: the bucket it stands on or in. */
  readonly row: number;
  /** The words above the plot: the pill's, or a gate label. */
  readonly label?: string;
  readonly reached?: boolean;
}

/** A band put on the axis, as fractions of the plot width. */
export interface ResolvedBand {
  readonly from: number;
  readonly to: number;
  readonly label?: string;
}

interface Located {
  readonly x: number;
  readonly row: number;
}

/** The x values in time order, as indices, so a marker can be found between two of them. */
function timeOrder(axis: MarkerAxis): number[] | null {
  const { times } = axis;
  if (!times || times.length !== axis.xs.length || times.length !== axis.positions.length) return null;
  return times.map((_, index) => index).filter((index) => Number.isFinite(times[index])).sort((a, b) => times[a]! - times[b]!);
}

/**
 * Where an x value or instant sits. One of the chart's own x values sits on
 * its point. On a time axis, any instant inside the domain sits between the
 * two points around it, in proportion — a breach at 16:01 on a day-bucketed
 * chart falls just after the middle of that day's span — and belongs to the
 * row of the bucket before it. Outside the domain, nowhere: unless `clamp`,
 * which puts it at the nearer end (a band that started before the chart did).
 */
function locate(x: string, axis: MarkerAxis, clamp = false): Located | null {
  const exact = axis.xs.indexOf(x);
  if (exact >= 0 && axis.positions[exact] !== undefined) return { x: axis.positions[exact]!, row: exact };
  const order = timeOrder(axis);
  const time = toInstant(x);
  if (!order || order.length === 0 || time === null) return null;
  const times = axis.times!;
  const first = order[0]!;
  const last = order[order.length - 1]!;
  if (time < times[first]!) return clamp ? { x: axis.positions[first]!, row: first } : null;
  if (time > times[last]!) return clamp ? { x: axis.positions[last]!, row: last } : null;
  for (let step = 0; step < order.length; step++) {
    const index = order[step]!;
    const next = order[step + 1];
    if (time === times[index]) return { x: axis.positions[index]!, row: index };
    if (next !== undefined && time < times[next]!) {
      const share = (time - times[index]!) / (times[next]! - times[index]!);
      return { x: axis.positions[index]! + share * (axis.positions[next]! - axis.positions[index]!), row: index };
    }
  }
  return { x: axis.positions[last]!, row: last };
}

/**
 * The page's markers, placed on the axis. "Today" goes on the bucket that is
 * today in the reader's zone (`markerPosition`), labelled "As at 2 Oct" unless
 * the page words it; it is left out with no `asAt`, on a category axis, or when
 * `asAt` is outside the series (a past range never shows "today"). Any other
 * marker whose x is not on the axis is left out too: a marker drawn at the
 * edge would claim a date the chart does not show.
 */
export function resolveMarkers(markers: readonly ChartMarker[], axis: MarkerAxis, context: MarkerContext = {}): ResolvedMarker[] {
  const locale = context.locale ?? DEFAULT_LOCALE;
  const out: ResolvedMarker[] = [];
  markers.forEach((marker, index) => {
    const id = `${marker.kind}-${index}`;
    if (marker.kind === 'today') {
      if (context.asAt === undefined) return;
      const placed = markerPosition(axis.xs, axis.times ?? null, context.asAt, context.timeZone, axis.bucket);
      const x = placed ? axis.positions[placed.index] : undefined;
      if (!placed || x === undefined) return;
      out.push({ id, kind: 'today', x, row: placed.index, label: marker.label ?? asAtLabel(context.asAt, locale, context.timeZone) });
      return;
    }
    const at = locate(marker.x, axis);
    if (!at) return;
    const label = marker.label?.trim() ? marker.label : undefined;
    out.push({
      id,
      kind: marker.kind,
      ...at,
      ...(label ? { label } : {}),
      ...(marker.kind === 'milestone' && marker.reached ? { reached: true } : {}),
    });
  });
  return out;
}

/** Bands placed on the axis, clipped to it; a band wholly outside it, or with no width, is left out. */
export function resolveBands(bands: readonly ChartBand[], axis: MarkerAxis): ResolvedBand[] {
  const out: ResolvedBand[] = [];
  for (const band of bands) {
    const from = locate(band.from, axis, true);
    const to = locate(band.to, axis, true);
    if (!from || !to) continue;
    const start = Math.min(from.x, to.x);
    const end = Math.max(from.x, to.x);
    // No width left: a band of no length, or one entirely beyond one end (both ends clamp to it).
    if (end - start <= 0) continue;
    out.push({ from: start, to: end, ...(band.label ? { label: band.label } : {}) });
  }
  return out;
}

/** A marker with its label's place: the tier (1 nearest the top) or `null` when the label gave way. */
export interface PlacedMarker extends ResolvedMarker {
  readonly tier: 1 | 2 | null;
  readonly edge?: 'start' | 'end';
}

export interface MarkerLayout {
  readonly items: readonly PlacedMarker[];
  /** How many tiers of labels are used, 0–2. */
  readonly tiers: 0 | 1 | 2;
  /** The room, in px, a chart keeps above its data for the labels: 18 per tier. */
  readonly rowHeight: number;
}

/**
 * Which tier each label takes (`placeMarkers`, A8 §4.3.4), fitted to a card
 * `span` columns wide (default 12). Deterministic: the same markers give the
 * same layout on every render.
 */
export function layoutMarkers(markers: readonly ResolvedMarker[], { span }: { readonly span?: number } = {}): MarkerLayout {
  const { placements, tiers } = placeMarkers(markers, span === undefined ? {} : { span });
  const items = markers.map((marker, index): PlacedMarker => {
    const placement = placements[index]!;
    return { ...marker, tier: placement.tier, ...(placement.edge ? { edge: placement.edge } : {}) };
  });
  return { items, tiers, rowHeight: tiers * MARKER_TIER_HEIGHT };
}

/** How a marker reads in a table cell. */
function describe(marker: ResolvedMarker): string {
  switch (marker.kind) {
    case 'today':
      return marker.label ?? 'Today';
    case 'deadline':
      return `Deadline: ${marker.label ?? ''}`.trim();
    case 'milestone':
      return `${marker.label ? `Milestone: ${marker.label}` : 'Milestone'}${marker.reached ? ', reached' : ''}`;
    case 'event':
      return `Event: ${marker.label ?? ''}`.trim();
  }
}

/**
 * The markers as a column of the chart's table twin (A8 §4.3.6): a "Marker"
 * cell on the row of each marker's x ("As at 2 Oct", "Deadline: Breach
 * 16:01"), blank elsewhere, two on one row joined. `null` when there are none,
 * so the chart adds no empty column.
 */
export function markerTableColumn(markers: readonly ResolvedMarker[], rows: number): { readonly header: string; readonly cells: readonly string[] } | null {
  if (markers.length === 0) return null;
  const cells = Array.from({ length: rows }, () => [] as string[]);
  for (const marker of markers) cells[marker.row]?.push(describe(marker));
  return { header: 'Marker', cells: cells.map((words) => words.join('; ')) };
}

const percent = (fraction: number): string => `${Math.round(fraction * 100_000) / 1000}%`;
const px = (value: number): string => `${Math.round(value * 100) / 100}px`;

export interface MarkerBackdropProps {
  readonly bands?: readonly ResolvedBand[];
  /** The target line's y, in px from the top of the plot. */
  readonly target?: { readonly y: number };
  /** The top of the data area, in px (below the marker row). */
  readonly top: number;
  /** The baseline, in px. */
  readonly bottom: number;
}

/**
 * What lies behind the data: shaded bands and the target line. An SVG group,
 * for a chart to draw inside its own SVG before its lines — a band laid over
 * a line would grey it. The SVG must not be stretched by a `viewBox`, so
 * percentages are of its width and the dashes stay even.
 */
export function MarkerBackdrop({ bands = [], target, top, bottom }: MarkerBackdropProps): ReactNode {
  if (bands.length === 0 && !target) return null;
  return (
    <g className="itsm-Markers__backdrop">
      {bands.map((band, index) => (
        <rect
          key={`band-${index}`}
          className="itsm-Markers__band"
          x={percent(band.from)}
          width={percent(band.to - band.from)}
          y={top}
          height={Math.max(0, bottom - top)}
        />
      ))}
      {target ? <line className="itsm-Markers__target" x1="0" x2="100%" y1={target.y} y2={target.y} /> : null}
    </g>
  );
}

export interface MarkerLayerProps {
  readonly layout: MarkerLayout;
  /** The baseline, in px from the top of the plot: where lines end and diamonds sit. */
  readonly bottom: number;
  /** Where a marker line starts when its label gave way or it has none. Default the layout's `rowHeight`. */
  readonly top?: number;
  /** The target line's label, written at its start, above the line. */
  readonly target?: { readonly y: number; readonly label?: string };
  /** Band labels, inside the top of each band. */
  readonly bands?: readonly ResolvedBand[];
  readonly className?: string;
}

/**
 * The markers over a plot: their lines, the diamonds on the baseline, and the
 * pills and gate labels on their tiers above the data. Laid over the chart's
 * plot box (`position: absolute; inset: 0`), so the plot must be positioned.
 *
 * Words are HTML and marks are SVG, as everywhere in the kit: lines are drawn
 * in an unscaled SVG at percentage x, diamonds in small fixed SVGs so they
 * stay square, and labels are positioned by percentage and aligned inwards at
 * the edges. Container queries hide tier-2 gate labels below 40rem and all
 * gate labels below 32rem; pills and diamonds always stay.
 */
export function MarkerLayer({ layout, bottom, top = layout.rowHeight, target, bands = [], className }: MarkerLayerProps): ReactNode {
  const { items } = layout;
  const bandLabels = bands.filter((band) => band.label);
  if (items.length === 0 && !target?.label && bandLabels.length === 0) return null;
  return (
    <div className={cx('itsm-Markers', className)} aria-hidden="true" data-tiers={layout.tiers}>
      {items.length > 0 ? (
        <svg className="itsm-Markers__lines" width="100%" height="100%" focusable="false">
          {items.map((marker) => {
            // A line starts under its own label, so the pill and its line read as one mark.
            const start = marker.tier === null ? top : marker.tier * MARKER_TIER_HEIGHT;
            return (
              <line
                key={marker.id}
                className="itsm-Markers__line"
                data-kind={marker.kind}
                x1={percent(marker.x)}
                x2={percent(marker.x)}
                y1={start}
                y2={bottom}
              />
            );
          })}
        </svg>
      ) : null}
      {bandLabels.map((band, index) => (
        <span
          key={`band-${index}`}
          className="itsm-Markers__bandLabel"
          style={{ left: percent(band.from), inlineSize: percent(band.to - band.from), top: px(top) }}
        >
          {band.label}
        </span>
      ))}
      {target?.label ? (
        <span className="itsm-Markers__targetLabel" style={{ top: px(target.y) }}>
          {target.label}
        </span>
      ) : null}
      {items
        .filter((marker) => marker.kind === 'deadline' || marker.kind === 'milestone')
        .map((marker) => {
          const radius = marker.kind === 'deadline' ? DEADLINE_RADIUS : MILESTONE_RADIUS;
          const style: CSSProperties = { left: percent(marker.x), top: px(bottom) };
          return (
            <svg
              key={`diamond-${marker.id}`}
              className="itsm-Markers__diamond"
              data-kind={marker.kind}
              data-reached={marker.kind === 'deadline' || marker.reached ? '' : undefined}
              width={DIAMOND_BOX}
              height={DIAMOND_BOX}
              viewBox={`0 0 ${DIAMOND_BOX} ${DIAMOND_BOX}`}
              focusable="false"
              style={style}
            >
              <path d={diamondAt(DIAMOND_BOX / 2, DIAMOND_BOX / 2, radius)} />
            </svg>
          );
        })}
      {items
        .filter((marker) => marker.tier !== null && marker.label)
        .map((marker) => {
          const pill = marker.kind === 'today' || marker.kind === 'deadline';
          return (
            <span
              key={`label-${marker.id}`}
              className="itsm-Markers__label"
              data-kind={marker.kind}
              data-tier={marker.tier}
              data-edge={marker.edge}
              data-pill={pill ? '' : undefined}
              data-gate={pill ? undefined : ''}
              style={{ left: percent(marker.x) }}
            >
              {marker.label}
            </span>
          );
        })}
    </div>
  );
}
