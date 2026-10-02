// @vitest-environment jsdom
import type { ReactElement } from 'react';
import { afterEach, describe, it } from 'vitest';
import { TestProvider } from '../../provider/__tests__/support/provider.js';
import { expectNoViolations } from '../../web/__tests__/support/audit.js';
import { cleanupDocument, press, render } from '../../web/__tests__/support/render.js';
import { Metric, MetricGrid } from '../../web/Metric.js';
import { AreaChart } from '../AreaChart.js';
import { BarChart } from '../BarChart.js';
import { ChartFigure } from '../ChartFigure.js';
import { DonutChart } from '../DonutChart.js';
import { LineChart, type ChartSeries } from '../LineChart.js';
import { MarkerBackdrop, MarkerLayer, layoutMarkers, resolveBands, resolveMarkers } from '../markers.js';
import { ChartEmpty, ChartLegend } from '../parts.js';
import { ProgressRing } from '../ProgressRing.js';
import { parseTimes } from '../scale.js';
import { Sparkline } from '../Sparkline.js';

/*
 * Every charts export, read by axe (SPEC §8.0 rule 5), the way a dashboard
 * uses it: each chart static and interactive — with a reading showing, so
 * the tooltip and the live region are audited too — with its table open,
 * empty and loading. The v3 kit pieces are read in a light and a dark
 * container (A8 §6.1). Stat cards are audited in `stat-card.test.tsx`.
 */

afterEach(() => cleanupDocument());

async function audit(element: ReactElement, keys: readonly string[] = []): Promise<void> {
  const { container } = render(<TestProvider>{element}</TestProvider>);
  for (const group of container.querySelectorAll<HTMLElement>('[aria-roledescription="chart"]')) {
    for (const key of keys) press(group, key);
  }
  for (const details of container.querySelectorAll('details')) details.open = true;
  await expectNoViolations(container);
}

const days = ['2026-09-01', '2026-09-02', '2026-09-03'];
const series: ChartSeries[] = [
  { id: 'r', label: 'Raised', points: days.map((x, index) => ({ x, y: [12, 30, 18][index]! })) },
  { id: 's', label: 'Resolved', points: days.map((x, index) => ({ x, y: [4, 9, 2][index]! })) },
];

describe('charts audit', () => {
  it('the deprecated Metric wrappers', async () => {
    await audit(
      <MetricGrid>
        <Metric label="Open tickets" value={128} note="12 more than yesterday" tone="bad" />
        <Metric label="Awaiting approval" value="4" href="/approvals" />
      </MetricGrid>,
    );
  });

  it('line and area charts, static, reading and with their tables open', async () => {
    await audit(
      <div>
        <LineChart title="Volume" series={series} xType="time" />
        <LineChart title="Volume, interactive" series={series} xType="time" interactive titleHidden description="Raised ran ahead." />
        <AreaChart title="Stacked" series={series} xType="time" stacked interactive table="visible" />
        <AreaChart title="By week" series={[series[0]!]} xType="category" />
      </div>,
      ['ArrowRight'],
    );
  });

  it('bar charts in every layout, reading', async () => {
    const data = [
      { id: 'e', label: 'Email', value: 412, icon: 'mail' as const, href: '/tickets?channel=email' },
      { id: 'p', label: 'Portal', value: 318, secondary: 'self-service' },
      { id: 's', label: 'Slack', value: 12 },
    ];
    await audit(
      <div>
        <BarChart title="List" variant="list" data={data} maxBars={2} />
        <BarChart title="Rows" data={data} interactive table="toggle" />
        <BarChart title="Columns" orientation="vertical" data={data} interactive />
        <BarChart
          title="Stacked"
          variant="list"
          interactive
          seriesDefs={[
            { id: 'a', label: 'P1', slot: 6 },
            { id: 'b', label: 'P2', slot: 2 },
          ]}
          data={[{ id: 'd', label: 'Desk', value: 0, series: { a: 2, b: 5 } }]}
        />
      </div>,
      ['ArrowRight'],
    );
  });

  it('donut, ring, sparkline and a bare figure', async () => {
    await audit(
      <div>
        <DonutChart title="Channels" interactive centerValue="742" centerLabel="tickets" segments={[{ id: 'e', label: 'Email', value: 412 }, { id: 'p', label: 'Portal', value: 318 }, { id: 's', label: 'Slack', value: 12 }]} />
        <ProgressRing value={0.62} label="SLA time used" centerText="62%" />
        <ProgressRing value={0.95} label="SLA time used" tone="auto" size={32} />
        <Sparkline values={[1, 4, 2, 6]} label="Rising, 1 → 6" />
        <ChartFigure title="Calibration" summary="Right 84% of the time." table={{ columns: ['Band', 'Observed'], rows: [['80–90%', '84%']] }}>
          <div />
        </ChartFigure>
      </div>,
      ['End'],
    );
  });

  describe.each(['apple', 'apple-dark'])('the v3 kit pieces in %s', (theme) => {
    const days = ['2026-09-29', '2026-09-30', '2026-10-01'];
    const axis = { xs: days, positions: [0, 0.5, 1], times: parseTimes(days) };

    it('sparklines: filling, fixed, toned, with a reference and with no trend', async () => {
      await audit(
        <div data-itsm-theme={theme}>
          <Sparkline values={[12, null, 14, 18]} label="Rising, 12 → 18" width="fill" tone="accent" />
          <Sparkline values={[80, 85, 92]} label="Rising, 80% → 92%" reference={90} curve="monotone" />
          <Sparkline values={[3, 1, 4]} label="Breaches: rising, 3 → 4" tone="danger" width={96} />
          <Sparkline values={[7]} label="Rising" width="fill" />
        </div>,
      );
    });

    it('legend chips by slot, tone and style, and the three empty plots', async () => {
      await audit(
        <div data-itsm-theme={theme}>
          <ChartLegend
            items={[
              { id: 'r', label: 'Resolved', slot: 1, value: '412' },
              { id: 'p', label: 'Raised', style: 'comparison' },
              { id: 'f', label: 'Forecast', slot: 1, style: 'forecast' },
              { id: 'b', label: 'P1 breached', tone: 'danger' },
              { id: 'q', label: 'P4', tone: 'neutralSoft' },
            ]}
          />
          <ChartEmpty height={120} />
          <ChartEmpty height={120} reason="insufficient" detail="Charts start once there are 3 days of data" />
          <ChartEmpty height={120} reason="error" />
        </div>,
      );
    });

    it('markers over a plot inside a figure whose table names them', async () => {
      const resolved = resolveMarkers(
        [
          { kind: 'today' },
          { kind: 'deadline', x: '2026-09-30', label: 'Freeze starts' },
          { kind: 'milestone', x: '2026-09-29', label: 'SG4', reached: true },
          { kind: 'event', x: '2026-09-30', label: 'Release' },
        ],
        axis,
        { asAt: '2026-10-01T23:30:00Z', timeZone: 'Europe/London' },
      );
      const bands = resolveBands([{ from: '2026-09-30', to: '2026-10-01', label: 'Freeze' }], axis);
      const layout = layoutMarkers(resolved);
      await audit(
        <div data-itsm-theme={theme}>
          <ChartFigure
            title="Raised vs resolved"
            headline="Resolved kept pace with raised"
            table={{ columns: ['Date', 'Resolved', 'Marker'], rows: days.map((day, index) => [day, [10, 12, null][index]!, index === 2 ? 'As at 2 Oct' : '']) }}
            tableMode="visible"
          >
            <div className="itsm-Chart" style={{ position: 'relative', blockSize: '240px' }}>
              <svg width="100%" height="240" aria-hidden="true" focusable="false">
                <MarkerBackdrop bands={bands} target={{ y: 60 }} top={layout.rowHeight} bottom={240} />
              </svg>
              <MarkerLayer layout={layout} bottom={240} bands={bands} target={{ y: 60, label: 'Target 90%' }} />
            </div>
          </ChartFigure>
        </div>,
      );
    });

    it('a matrix table with column groups', async () => {
      await audit(
        <div data-itsm-theme={theme}>
          <ChartFigure
            title="Arrivals by hour"
            summary="Busiest: Tuesday 09:00."
            tableMode="visible"
            table={{
              columns: ['Day', '09:00', '10:00', '09:00', '10:00'],
              columnGroups: [
                { label: '', span: 1 },
                { label: 'This week', span: 2 },
                { label: 'Last week', span: 2 },
              ],
              rows: [
                ['Mon', 30, 22, 28, 20],
                ['Tue', 42, 30, null, 29],
              ],
            }}
          >
            <div />
          </ChartFigure>
        </div>,
      );
    });
  });

  it('empty and loading charts', async () => {
    await audit(
      <div>
        <LineChart title="Volume" series={[]} xType="time" />
        <BarChart title="By team" data={[]} />
        <DonutChart title="Channels" segments={[]} />
        <LineChart title="Volume" series={series} xType="time" loading />
        <BarChart title="By team" data={[]} loading />
      </div>,
    );
  });
});
