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
import { ProgressRing } from '../ProgressRing.js';
import { Sparkline } from '../Sparkline.js';
import { StatCard } from '../StatCard.js';
import { StatGrid } from '../StatGrid.js';

/*
 * Every charts export, read by axe (SPEC §8.0 rule 5), the way a dashboard
 * uses it: stat cards in each state inside their grid, each chart static and
 * interactive — with a reading showing, so the tooltip and the live region
 * are audited too — with its table open, empty and loading.
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
  it('stat cards in every state, in a grid', async () => {
    await audit(
      <StatGrid columns={4}>
        <StatCard label="Open" value={1284} href="/tickets" icon="ticket" trend={[1, 3, 2, 5]} delta={{ value: 0.12, format: { style: 'percent' }, period: 'vs last week', goodDirection: 'down' }} />
        <StatCard label="Unassigned" value={50} approx="atLeast" status="attention" footnote="Counted from the first 50." />
        <StatCard label="SLA met" value={null} secondary="· 3 breached" status="critical" />
        <StatCard label="First reply" value={null} loading />
        <StatCard label="Backlog" value={null} problem={{ status: 503 }} onRetry={() => undefined} surface="sunken" />
      </StatGrid>,
    );
  });

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
