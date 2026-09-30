import type { ReactNode } from 'react';
import type { RenderedWidget } from '@itsm/sdk';
import { Card, InlineAlert, Table } from '@itsm/ui';
import { BarChart, LineChart, StatCard } from '@itsm/ui/charts';
import { formatDateTime, formatNumber } from '@itsm/ui/format';
import { chartScale, groupLabel, hasData, statFormat, statValue, toBars, toSeries, type MetricUnit } from './presentation.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** A widget's period in words: "Last 30 days" for the named ranges, dates otherwise. */
export function periodLabel(period: { readonly from: string; readonly to: string } | undefined, locale: string): string {
  if (!period) return '';
  const days = Math.round((Date.parse(period.to) - Date.parse(period.from)) / DAY_MS);
  if (days === 7 || days === 30 || days === 90) return `Last ${days} days`;
  const from = formatDateTime(period.from, { locale, timeZone: 'UTC', style: 'date' });
  // The API's periods end at the start of the next day; the last day shown is the one before.
  const to = formatDateTime(new Date(Date.parse(period.to) - 1).toISOString(), { locale, timeZone: 'UTC', style: 'date' });
  return `${from} – ${to}`;
}

export interface WidgetProps {
  readonly widget: RenderedWidget;
  readonly locale: string;
  readonly timeZone: string;
}

/**
 * One dashboard widget, drawn from what `GET /analytics/dashboards/:id/render`
 * evaluated (SPEC §6.1 Insights): `number` → a stat card, `trend` → a stat
 * card with the change from the bucket before and the line as a sparkline,
 * `timeseries` → a line chart, `bar` → a ranked list, `table` → a table.
 * A widget the API could not evaluate says so in its own cell and nowhere
 * else — the rest of the dashboard is unaffected, as on the server.
 */
export function Widget({ widget, locale, timeZone }: WidgetProps): ReactNode {
  const result = widget.result;
  const unit: MetricUnit = result?.metric.unit ?? 'count';
  const period = periodLabel(result?.period, locale);

  if (widget.error || !result) {
    return (
      <Card title={widget.title} titleAs="h3" className="app-Widget__card">
        <InlineAlert tone="danger">
          Couldn’t draw this widget.{widget.error ? ` ${sentence(widget.error)}` : ''}
        </InlineAlert>
      </Card>
    );
  }

  if (widget.type === 'number') {
    return (
      <StatCard
        label={widget.title}
        value={statValue(unit, result.value)}
        format={statFormat(unit)}
        locale={locale}
        footnote={result.value === null || result.value === undefined ? `${period} · no data yet` : period}
      />
    );
  }

  if (widget.type === 'trend') {
    const points = (result.series ?? []).map((point) => point.value).filter((value): value is number => typeof value === 'number');
    const last = points.at(-1) ?? null;
    const before = points.length > 1 ? points.at(-2)! : null;
    const change =
      last !== null && before !== null
        ? unit === 'percent'
          ? { value: (last - before) / 100, format: { style: 'percent', maximumFractionDigits: 1 } as Intl.NumberFormatOptions }
          : before !== 0
            ? { value: (last - before) / before, format: { style: 'percent', maximumFractionDigits: 0 } as Intl.NumberFormatOptions }
            : null
        : null;
    const bucket = result.bucket ?? 'day';
    return (
      <StatCard
        label={widget.title}
        value={statValue(unit, last)}
        format={statFormat(unit)}
        locale={locale}
        footnote={period}
        {...(points.length > 1 ? { trend: points } : {})}
        {...(change ? { delta: { ...change, period: `vs the ${bucket} before`, goodDirection: goodWay(result.metric.key) } } : {})}
      />
    );
  }

  if (widget.type === 'timeseries') {
    const scale = chartScale(unit, (result.series ?? []).map((point) => point.value));
    return (
      <Card title={widget.title} titleAs="h3" meta={period} className="app-Widget__card">
        <LineChart
          title={widget.title}
          titleHidden
          xType="time"
          interactive
          locale={locale}
          timeZone={timeZone}
          yFormat={scale.format}
          emptyText="No data for this period yet"
          series={[toSeries(widget.metricKey, result.metric.name, result.series, scale.factor)]}
        />
      </Card>
    );
  }

  if (widget.type === 'bar') {
    const scale = chartScale(unit, (result.groups ?? []).map((group) => group.value));
    return (
      <Card title={widget.title} titleAs="h3" meta={period} className="app-Widget__card">
        <BarChart
          title={widget.title}
          titleHidden
          variant="list"
          locale={locale}
          valueFormat={scale.format}
          emptyText="No data for this period yet"
          data={toBars(result.groups, scale.factor)}
          {...(unit === 'count' ? { maxBars: 8 } : {})}
        />
      </Card>
    );
  }

  // `table`, and any type added to the API after this was written.
  const scale = chartScale(unit, [...(result.groups ?? []).map((group) => group.value), ...(result.series ?? []).map((point) => point.value)]);
  const write = (value: number | null): string => (value === null ? '—' : formatNumber(value * scale.factor, { ...scale.format, locale }));
  const rows = result.groups
    ? result.groups.map((group, index) => ({ id: group.key ?? `none-${index}`, label: groupLabel(group), value: write(group.value) }))
    : (result.series ?? []).map((point) => ({ id: point.at, label: formatDateTime(point.at, { locale, timeZone: 'UTC', style: 'date' }), value: write(point.value) }));
  return (
    <Card title={widget.title} titleAs="h3" meta={period} className="app-Widget__card">
      {hasData(result) ? (
        <Table
          caption={widget.title}
          captionHidden
          rows={rows}
          rowKey={(row) => row.id}
          columns={[
            { key: 'label', header: result.groups ? 'Group' : 'Period', cell: (row) => row.label },
            { key: 'value', header: result.metric.name, cell: (row) => row.value, align: 'end' },
          ]}
        />
      ) : (
        <p className="app-Widget__empty">No data for this period yet</p>
      )}
    </Card>
  );
}

/** Which way is good news for a metric's trend: fewer breaches and faster times are. */
function goodWay(metricKey: string): 'up' | 'down' | 'none' {
  if (/breach|time|turnaround|reopen|cost|elapsed|first_response/.test(metricKey)) return 'down';
  if (/attainment|rate|score|resolved/.test(metricKey)) return 'up';
  return 'none';
}

function sentence(text: string): string {
  const trimmed = text.trim();
  const capital = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return /[.!?]$/.test(capital) ? capital : `${capital}.`;
}
