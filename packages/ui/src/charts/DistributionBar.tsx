import type { ReactNode } from 'react';
import { formatNumber, formatPercent } from '../format/format.js';
import type { IconName } from '../icons/registry.js';
import { Icon } from '../icons/Icon.js';
import { cx } from '../web/cx.js';
import { ChartLink } from './ChartLink.js';
import { DEFAULT_LOCALE, sentenceList } from './scale.js';
import type { ChartSlot, ChartTone } from './types.js';

export interface DistributionSegment {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  /** A state's colour (P2, breached); wins over `slot`. */
  readonly tone?: ChartTone;
  /** An identity colour (a channel, a team). */
  readonly slot?: ChartSlot;
  /** Where the segment's legend entry leads: the tickets it counts. */
  readonly href?: string;
  readonly icon?: IconName;
  /** Hatched in every theme: "unassigned", "overdue". */
  readonly pattern?: 'hatch';
}

export interface DistributionBarProps {
  /** The figure's name: "Open tickets by SLA state". */
  readonly label: string;
  readonly segments: readonly DistributionSegment[];
  /** The strip's height in px. Default 10; 6 in a KPI tile, 28 for the PMO's budget strip. */
  readonly height?: 6 | 8 | 10 | 16 | 28;
  /** The legend under the strip (default), beside the label, or none (the strip is then named by its sentence alone). */
  readonly legend?: 'below' | 'inline' | 'none';
  /** Each legend entry's share after its value. Default true. */
  readonly showShare?: boolean;
  /** "Total 51" at the end of the label row; the value defaults to the sum. */
  readonly total?: { readonly label: string; readonly value?: number };
  /** A tick with its label above the strip: the PMO's "Approved". */
  readonly marker?: { readonly value: number; readonly label: string };
  /** The whole the parts are measured against; a sum past it is hatched and said ("Over by 123"). */
  readonly max?: number;
  /** Shows the label row. Default only with a `total`: in a card, the card's title already names the strip. */
  readonly showLabel?: boolean;
  /** What a strip of nothing says. Default "Nothing open". */
  readonly emptyText?: string;
  readonly format?: Intl.NumberFormatOptions;
  readonly locale?: string;
  /** The strip's sentence. Written from the segments when absent. */
  readonly description?: string;
  readonly className?: string;
}

const percent = (fraction: number): string => `${Math.round(fraction * 100_000) / 1000}%`;

/**
 * One strip showing what a whole is made of (A8 §4.4): open work by
 * priority, by SLA state, by status; the PMO's "Budget position".
 * Server-safe.
 *
 * Each segment grows with its value on a pill-shaped strip with 2 px gaps of
 * the card between them, and none is ever thinner than 3 px — a 1 among 200
 * still shows, and the legend says the true value. A `max` turns the strip
 * into a gauge of the whole: room left is the track, an overrun is hatched
 * in danger and stated under it. A `marker` stands over the strip with its
 * label.
 *
 * The strip is decoration. The figure is named by its sentence ("Open
 * tickets by SLA state: On track 41, At risk 7 and Breached 3"), and the
 * legend is a real list of every segment with its value and share, each a
 * link where the page gives one — the legend is the data, so there is no
 * table twin.
 */
export function DistributionBar({
  label,
  segments,
  height = 10,
  legend = 'below',
  showShare = true,
  total,
  marker,
  max,
  showLabel = total !== undefined,
  emptyText = 'Nothing open',
  format,
  locale = DEFAULT_LOCALE,
  description,
  className,
}: DistributionBarProps): ReactNode {
  const write = (n: number): string => formatNumber(n, { ...format, locale });
  const values = segments.map((segment) => (Number.isFinite(segment.value) && segment.value > 0 ? segment.value : 0));
  const sum = values.reduce((a, b) => a + b, 0);
  const whole = max !== undefined && Number.isFinite(max) && max > 0 ? max : undefined;
  const scale = Math.max(sum, whole ?? 0, marker && Number.isFinite(marker.value) ? marker.value : 0);
  const over = whole !== undefined && sum > whole ? sum - whole : 0;
  const room = whole !== undefined && sum < whole ? whole - sum : 0;
  const markerAt = marker && scale > 0 ? Math.min(1, Math.max(0, marker.value / scale)) : null;

  const parts = segments.map((segment, index) => `${segment.label} ${write(values[index]!)}`);
  const sentence =
    description ??
    `${label}: ${sum === 0 ? emptyText.toLowerCase() : sentenceList(parts)}${over > 0 ? `, over by ${write(over)}` : ''}${marker ? `; ${marker.label} ${write(marker.value)}` : ''}`;

  const legendList =
    legend === 'none' ? null : (
      <ul className="itsm-ChartLegend itsm-DistributionBar__legend" aria-label="Legend">
        {sum === 0 ? (
          <li className="itsm-ChartLegend__item itsm-DistributionBar__nothing">{emptyText}</li>
        ) : (
          segments.map((segment, index) => {
            const name = segment.href ? (
              <ChartLink href={segment.href} className="itsm-ChartLegend__label itsm-DistributionBar__link">
                {segment.label}
              </ChartLink>
            ) : (
              <span className="itsm-ChartLegend__label">{segment.label}</span>
            );
            return (
              <li key={segment.id} className="itsm-ChartLegend__item">
                <span
                  className="itsm-ChartLegend__key"
                  data-mark="chip"
                  data-slot={segment.tone ? undefined : (segment.slot ?? ((index % 8) + 1))}
                  data-tone={segment.tone}
                  data-pattern={segment.pattern}
                  aria-hidden="true"
                />
                {segment.icon ? <Icon name={segment.icon} size="sm" className="itsm-DistributionBar__icon" /> : null}
                {name}
                <span className="itsm-ChartLegend__value">{write(values[index]!)}</span>
                {showShare ? <span className="itsm-ChartLegend__detail">{formatPercent(values[index]! / sum, { locale })}</span> : null}
              </li>
            );
          })
        )}
        {over > 0 ? <li className="itsm-ChartLegend__item itsm-DistributionBar__overText">Over by {write(over)}</li> : null}
      </ul>
    );

  return (
    <figure className={cx('itsm-Chart itsm-DistributionBar', className)} data-legend={legend}>
      <figcaption className={cx('itsm-DistributionBar__head', !showLabel && 'itsm-visually-hidden')}>
        <span className="itsm-DistributionBar__label">{label}</span>
        {total ? (
          <span className="itsm-DistributionBar__total">
            {total.label} <span className="itsm-DistributionBar__totalValue">{write(total.value ?? sum)}</span>
          </span>
        ) : null}
        <span className="itsm-visually-hidden">. {sentence}</span>
      </figcaption>
      {legend === 'inline' ? legendList : null}
      <div className="itsm-DistributionBar__strip" data-marker={markerAt === null ? undefined : ''} aria-hidden="true">
        <span className="itsm-DistributionBar__segments" data-empty={sum === 0 ? '' : undefined} style={{ blockSize: `${height / 16}rem` }}>
          {segments.map((segment, index) =>
            values[index]! > 0 ? (
              <span
                key={segment.id}
                className="itsm-DistributionBar__segment"
                data-slot={segment.tone ? undefined : (segment.slot ?? ((index % 8) + 1))}
                data-tone={segment.tone}
                data-pattern={segment.pattern}
                style={{ flexGrow: values[index] }}
              />
            ) : null,
          )}
          {room > 0 ? <span className="itsm-DistributionBar__room" style={{ flexGrow: room }} /> : null}
        </span>
        {over > 0 ? <span className="itsm-DistributionBar__over" style={{ insetInlineStart: percent(whole! / scale), inlineSize: percent(over / scale) }} /> : null}
        {marker && markerAt !== null ? (
          <span className="itsm-DistributionBar__marker" data-edge={markerAt <= 0.08 ? 'start' : markerAt >= 0.92 ? 'end' : undefined} style={{ insetInlineStart: percent(markerAt) }}>
            <span className="itsm-DistributionBar__markerLabel">{marker.label}</span>
          </span>
        ) : null}
      </div>
      {legend === 'below' ? legendList : null}
    </figure>
  );
}
