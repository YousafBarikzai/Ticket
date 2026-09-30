'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { MetricResult } from '@itsm/sdk';
import { FormField, ProblemState, SegmentedControl, Select, useItsm, type Problem } from '@itsm/ui';
import { BarChart, LineChart, StatCard } from '@itsm/ui/charts';
import { api } from '../../client/api.js';
import { problemFrom } from '../../problem.js';
import { TechnicalKey } from '../command-centre/TechnicalKey.js';
import { chartScale, dimensionLabel, measureSentence, RANGE_LABELS, statFormat, statValue, toBars, toSeries } from './presentation.js';

export interface ExplorerMetric {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly fact: string;
  readonly aggregate: string;
  readonly field?: string;
  readonly unit: string;
}

const RANGES = (['7d', '30d', '90d', '12m'] as const).map((value) => ({ value, label: RANGE_LABELS[value].replace('Last ', '') }));

/** An answer, and the breakdown it was asked with: a line cannot stand in for bars while bars load. */
type Answer = ({ readonly value: MetricResult; readonly shape: MetricResult } | { readonly problem: Problem }) & { readonly groupBy: string };

/**
 * The metric explorer (SPEC §6.1 Insights › Metrics): one metric, a period
 * and an optional breakdown, answered live by `POST /analytics/query` — an
 * ad-hoc question with no dashboard to build first.
 *
 * Two questions per change, asked together: the number for the period (the
 * headline), and its shape — the line over time, or the breakdown by the
 * chosen dimension. A slower answer to an older choice is dropped rather
 * than drawn over a newer one.
 */
export function MetricExplorer({ metric, dimensions }: { readonly metric: ExplorerMetric; readonly dimensions: readonly string[] }): ReactNode {
  const { locale, timeZone } = useItsm();
  const [range, setRange] = useState<(typeof RANGES)[number]['value']>('30d');
  const [groupBy, setGroupBy] = useState('');
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [loading, setLoading] = useState(true);
  const asked = useRef(0);

  const ask = useCallback(async () => {
    const ticket = ++asked.current;
    setLoading(true);
    try {
      const [value, shape] = await Promise.all([
        api.observe.insights.query({ metricKey: metric.key, range }),
        api.observe.insights.query(groupBy ? { metricKey: metric.key, range, groupBy } : { metricKey: metric.key, range, series: true }),
      ]);
      if (ticket === asked.current) setAnswer({ value, shape, groupBy });
    } catch (error) {
      if (ticket === asked.current) setAnswer({ problem: problemFrom(error), groupBy });
    } finally {
      if (ticket === asked.current) setLoading(false);
    }
  }, [metric.key, range, groupBy]);

  useEffect(() => {
    void ask();
  }, [ask]);

  const unit = (answer && 'value' in answer ? answer.value.metric.unit : metric.unit) as MetricResult['metric']['unit'];
  const period = RANGE_LABELS[range].toLowerCase();

  const shaped = answer && answer.groupBy === groupBy ? answer : null;
  let chart: ReactNode;
  if (shaped && 'problem' in shaped) {
    chart = <ProblemState size="sm" problem={shaped.problem} context={metric.name} onRetry={() => void ask()} />;
  } else if (groupBy) {
    const groups = shaped?.shape.groups;
    const scale = chartScale(unit, (groups ?? []).map((group) => group.value));
    chart = (
      <BarChart
        title={`${metric.name} by ${dimensionLabel(groupBy).toLowerCase()}, ${period}`}
        titleHidden
        variant="list"
        locale={locale}
        loading={loading && !shaped}
        valueFormat={scale.format}
        emptyText="No data for this period yet"
        data={toBars(groups, scale.factor, groupBy)}
        {...(unit === 'count' ? { maxBars: 10 } : {})}
      />
    );
  } else {
    const series = shaped?.shape.series;
    const scale = chartScale(unit, (series ?? []).map((point) => point.value));
    chart = (
      <LineChart
        title={`${metric.name}, ${period}`}
        titleHidden
        xType="time"
        interactive
        locale={locale}
        timeZone={timeZone}
        loading={loading && !shaped}
        yFormat={scale.format}
        emptyText="No data for this period yet"
        series={[toSeries(metric.key, metric.name, series, scale.factor)]}
      />
    );
  }

  return (
    <div className="app-Explorer">
      <p className="app-Explorer__measure">
        {measureSentence(metric)}
        <TechnicalKey value={metric.key} label="metric key" />
      </p>
      <div className="app-Explorer__controls">
        <div className="app-Explorer__control">
          {/* The group is named by its own label; this visible one matches the field beside it. */}
          <span className="app-Explorer__label" aria-hidden="true">
            Period
          </span>
          <SegmentedControl label="Period" mode="value" options={RANGES} value={range} onValueChange={(next) => setRange(next as typeof range)} />
        </div>
        {dimensions.length > 0 ? (
          <FormField label="Break down by">
            <Select
              options={[{ value: '', label: 'Nothing — over time' }, ...dimensions.map((name) => ({ value: name, label: dimensionLabel(name) }))]}
              value={groupBy}
              onChange={(event) => setGroupBy(event.target.value)}
            />
          </FormField>
        ) : null}
      </div>
      <div className="app-Refetch" aria-busy={loading || undefined}>
        <StatCard
          label={RANGE_LABELS[range]}
          value={answer && 'value' in answer ? statValue(unit, answer.value.value) : null}
          format={statFormat(unit)}
          locale={locale}
          surface="sunken"
          loading={loading && !answer}
          {...(answer && 'problem' in answer ? { problem: answer.problem } : {})}
          {...(answer && 'value' in answer && (answer.value.value === null || answer.value.value === undefined) ? { footnote: 'No data for this period yet' } : {})}
        />
      </div>
      <div className="app-Explorer__chart app-Refetch" aria-busy={loading || undefined}>
        {chart}
      </div>
    </div>
  );
}
