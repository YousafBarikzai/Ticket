import type { ReactNode } from 'react';
import { formatNumber } from '../format/format.js';
import { cx } from '../web/cx.js';
import { DEFAULT_LOCALE } from './scale.js';

/** The tones a gauge's zones take: SLA risk is the one place amber belongs (D5). */
export type GaugeTone = 'danger' | 'warning' | 'success';

/** A zone of the dial, from the previous zone's end (or 0) up to `to`, a fraction of 1. */
export interface GaugeBand {
  readonly to: number;
  readonly tone: GaugeTone;
}

/**
 * Zones placed around a reference, usually the target, as distances in
 * fractions of 1 (`0.05` is 5 points): `warning` is how deep the amber zone
 * runs below the reference, and `danger` the depth from which a reading is in
 * danger whatever `warning` says, so the amber zone is never deeper than it.
 */
export interface GaugeRelativeBands {
  readonly relativeTo: number;
  readonly warning?: number;
  readonly danger?: number;
}

export interface GaugeProps {
  /** What is measured: "SLA met · last 30 days". The gauge's name starts with it. */
  readonly label: string;
  /** A fraction of 1 (93.4 % is `0.934`); `null` when there is nothing to measure yet. */
  readonly value: number | null;
  /** A fraction of 1, drawn as a tick across the dial. */
  readonly target?: number;
  /** Absolute zones in ascending order, or zones around a reference. With a target and none, 5 points of amber under it. */
  readonly bands?: readonly GaugeBand[] | GaugeRelativeBands;
  /** `down` when less is better (spend against budget): the zones reverse. */
  readonly goodDirection?: 'up' | 'down';
  /** A quiet line under the dial: "19 of 29 signed off". */
  readonly caption?: string;
  /** `md` 200 × 128 (default), `lg` 260 × 166. */
  readonly size?: 'md' | 'lg';
  /** Default a percentage with up to one decimal. */
  readonly format?: Intl.NumberFormatOptions;
  readonly locale?: string;
  /** The gauge's spoken sentence. Written from the reading when absent. */
  readonly description?: string;
  readonly className?: string;
}

/** The dial (A8 §4.5): a 220° arc, from 110° left of twelve o'clock to 110° right, 12 wide. */
const SWEEP = 220;
const START = -110;
const CENTRE_X = 100;
/**
 * The arc's centre sits where the dial fits its 200 × 128 box: the ends fall
 * 20° below the centre's level, so a centre at 104 (A8's figure) would put
 * them, with their round caps, ten units outside the box.
 */
const CENTRE_Y = 92;
const RADIUS = 84;
const TICK = 9;

const round = (value: number): number => Math.round(value * 100) / 100;
const clamp = (value: number): number => Math.min(1, Math.max(0, value));

/** A point on the dial at a fraction of its sweep, `radius` from the centre. */
function dialPoint(at: number, radius = RADIUS): readonly [number, number] {
  const angle = ((START + clamp(at) * SWEEP) * Math.PI) / 180;
  return [round(CENTRE_X + radius * Math.sin(angle)), round(CENTRE_Y - radius * Math.cos(angle))];
}

/** The `d` of the dial's arc from one fraction of its sweep to another, clockwise, in the 200 × 128 box. */
export function gaugeArc(from: number, to: number): string {
  const start = clamp(Math.min(from, to));
  const end = clamp(Math.max(from, to));
  const [x0, y0] = dialPoint(start);
  const [x1, y1] = dialPoint(end);
  const large = (end - start) * SWEEP > 180 ? 1 : 0;
  return `M${x0} ${y0}A${RADIUS} ${RADIUS} 0 ${large} 1 ${x1} ${y1}`;
}

/**
 * The dial's zones as absolute bands covering 0..1, in order. Relative bands
 * become three zones around their reference; with a target and no bands the
 * default is `{ relativeTo: target, warning: 0.05, danger: 0.10 }`: at or
 * above the target success, up to 5 points under it warning, below that
 * danger. `down` mirrors them. No target and no bands: no zones.
 */
export function gaugeZones(target: number | undefined, bands: GaugeProps['bands'], goodDirection: 'up' | 'down' = 'up'): GaugeBand[] {
  let zones: GaugeBand[];
  if (Array.isArray(bands)) {
    zones = [...(bands as readonly GaugeBand[])].sort((a, b) => a.to - b.to).map((band) => ({ to: clamp(band.to), tone: band.tone }));
    if (zones.length > 0) zones[zones.length - 1] = { ...zones[zones.length - 1]!, to: 1 };
  } else {
    const relative = (bands as GaugeRelativeBands | undefined) ?? (target === undefined ? undefined : { relativeTo: target });
    if (!relative || !Number.isFinite(relative.relativeTo)) return [];
    const reference = clamp(relative.relativeTo);
    const depth = Math.max(0, Math.min(relative.warning ?? 0.05, relative.danger ?? 0.1));
    zones =
      goodDirection === 'down'
        ? [
            { to: reference, tone: 'success' },
            { to: clamp(reference + depth), tone: 'warning' },
            { to: 1, tone: 'danger' },
          ]
        : [
            { to: clamp(reference - depth), tone: 'danger' },
            { to: reference, tone: 'warning' },
            { to: 1, tone: 'success' },
          ];
  }
  // A zone with no width is kept: it draws nothing, but a reading past the end of the dial is in it
  // (spend at 105 % of a budget of 100 % is over budget, not on it).
  return zones;
}

/**
 * The zone a reading falls in, read before it is clamped to the dial, so a
 * reading past either end is in the zone at that end. A reading on a
 * boundary belongs to the better side.
 */
export function gaugeTone(value: number, zones: readonly GaugeBand[], goodDirection: 'up' | 'down' = 'up'): GaugeTone | undefined {
  for (const zone of zones) if (goodDirection === 'down' ? value <= zone.to : value < zone.to) return zone.tone;
  return zones[zones.length - 1]?.tone;
}

/**
 * A value against a target with zones (A8 §4.5): SLA met against its target,
 * CSAT against a goal, spend against a budget. Server-safe static SVG.
 *
 * The dial is a 220° arc. Its track is tinted by zone — danger, warning,
 * success, each its intent's colour at 22 % on the card, so the zones stay
 * secondary to the reading — and the reading is an arc from the start to the
 * value in the tone of the zone it falls in. The target is a 2 px tick across
 * the band. The value sits in the middle in the stat numeral, "Target 90%"
 * under it, and the caption under the dial.
 *
 * It is an image named by a sentence — "SLA met · last 30 days: 93.4%,
 * target 90%, 3.4 points above target" — so the arc is never the only way to
 * the number; the centre text repeats it and is hidden from assistive
 * technology. A reading outside 0..1 is drawn at the end and stated as it is.
 * No reading is a bare track, "—" and "No data yet".
 */
export function Gauge({
  label,
  value,
  target,
  bands,
  goodDirection = 'up',
  caption,
  size = 'md',
  format = { style: 'percent', maximumFractionDigits: 1 },
  locale = DEFAULT_LOCALE,
  description,
  className,
}: GaugeProps): ReactNode {
  const write = (n: number): string => formatNumber(n, { ...format, locale });
  const known = value !== null && Number.isFinite(value);
  const hasTarget = target !== undefined && Number.isFinite(target);
  const zones = gaugeZones(hasTarget ? target : undefined, bands, goodDirection);
  // Only the zones with width are drawn; their ends round off the dial.
  const drawnZones = zones.flatMap((zone, index) => {
    const from = index === 0 ? 0 : zones[index - 1]!.to;
    return zone.to > from ? [{ ...zone, from }] : [];
  });
  const tone = known ? gaugeTone(value, zones, goodDirection) : undefined;
  const drawn = known ? clamp(value) : 0;

  let sentence = `${label}: no data yet`;
  if (known) {
    sentence = `${label}: ${write(value)}`;
    if (hasTarget) {
      const gap = value - target;
      const percent = format.style === 'percent';
      const points = Math.round(Math.abs(gap) * 1000) / 10;
      const amount = percent ? `${formatNumber(points, { locale, maximumFractionDigits: 1 })} ${points === 1 ? 'point' : 'points'}` : write(Math.abs(gap));
      sentence += `, target ${write(target)}, ${(percent ? points : Math.abs(gap)) < 1e-9 ? 'on target' : `${amount} ${gap > 0 ? 'above' : 'below'} target`}`;
    }
    if (caption) sentence += `. ${caption}`;
  }

  const [tickInner, tickOuter] = hasTarget ? [dialPoint(target, RADIUS - TICK), dialPoint(target, RADIUS + TICK)] : [];
  const [startX, startY] = dialPoint(0);
  const [endX, endY] = dialPoint(1);
  return (
    <div role="img" aria-label={description ?? sentence} className={cx('itsm-Gauge', className)} data-size={size} data-tone={tone}>
      <div className="itsm-Gauge__dial">
        <svg className="itsm-Gauge__svg" viewBox="0 0 200 128" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
          {drawnZones.length > 0 ? (
            <>
              {drawnZones.map((zone) => (
                <path key={`${zone.tone}-${zone.from}`} className="itsm-Gauge__zone" data-tone={zone.tone} d={gaugeArc(zone.from, zone.to)} />
              ))}
              {/* The round ends, each in its zone's tint: the zones meet square, the dial's ends are round. */}
              <path className="itsm-Gauge__cap" data-tone={drawnZones[0]!.tone} d={`M${startX} ${startY}h0`} />
              <path className="itsm-Gauge__cap" data-tone={drawnZones[drawnZones.length - 1]!.tone} d={`M${endX} ${endY}h0`} />
            </>
          ) : (
            <path className="itsm-Gauge__track" d={gaugeArc(0, 1)} />
          )}
          {drawn > 0 ? <path className="itsm-Gauge__reading" data-tone={tone} d={gaugeArc(0, drawn)} pathLength={100} /> : null}
          {tickInner && tickOuter ? <line className="itsm-Gauge__tick" x1={tickInner[0]} y1={tickInner[1]} x2={tickOuter[0]} y2={tickOuter[1]} /> : null}
        </svg>
        <span className="itsm-Gauge__centre" aria-hidden="true">
          <span className="itsm-Gauge__value">{known ? write(value) : '—'}</span>
          {hasTarget ? <span className="itsm-Gauge__target">Target {write(target)}</span> : null}
        </span>
      </div>
      {caption || !known ? (
        <span className="itsm-Gauge__caption" aria-hidden="true">
          {known ? caption : 'No data yet'}
        </span>
      ) : null}
    </div>
  );
}

/** The height a `ChartCard` keeps for a gauge while it loads or has nothing to show (A8 §4.1). */
Gauge.plotHeight = 200;
