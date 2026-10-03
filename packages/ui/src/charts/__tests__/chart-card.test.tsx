// @vitest-environment jsdom
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { TestProvider } from '../../provider/__tests__/support/provider.js';
import { expectNoViolations } from '../../web/__tests__/support/audit.js';
import { cleanupDocument, render } from '../../web/__tests__/support/render.js';
import { AreaChart } from '../AreaChart.js';
import { CHART_HEIGHTS, ChartCard } from '../ChartCard.js';
import { chartCardStyles } from '../ChartCard.styles.js';
import { DistributionBar } from '../DistributionBar.js';
import { Gauge } from '../Gauge.js';
import type { ChartSeries } from '../LineChart.js';

/**
 * `ChartCard` (SPEC-v3 §8.2, A8 §4.1): `Card` v3 with the chart contract — a
 * visible headline, the chart told what the card already says, and every
 * state the same card at the same height.
 */

const html = (element: ReactElement): string => renderToStaticMarkup(<TestProvider>{element}</TestProvider>);

const week = ['2026-09-25', '2026-09-26', '2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01'];
const resolved: ChartSeries = { id: 'resolved', label: 'Resolved', points: week.map((x, index) => ({ x, y: [10, 14, 11, 16, 21, 24, 26][index]! })) };
const raised: ChartSeries = { id: 'raised', label: 'Raised', style: 'comparison', points: week.map((x, index) => ({ x, y: [12, 15, 30, 18, 20, 22, 19][index]! })) };
const area = (extra: Record<string, unknown> = {}): ReactElement => <AreaChart title="Raised and resolved" series={[raised, resolved]} xType="time" {...extra} />;
const headline = 'Resolved 122, raised 136 in 7 days: the queue grew by 14';

afterEach(() => cleanupDocument());

describe('the card', () => {
  it('shows the title as a heading, then the headline and its basis line, then the chart', () => {
    const markup = html(
      <ChartCard title="Raised vs resolved" headline={headline} caption="Daily, in UTC days">
        {area()}
      </ChartCard>,
    );
    const open = markup.match(/<section [^>]*>/)![0];
    expect(open).toContain('class="itsm-Surface itsm-Card itsm-ChartCard"');
    expect(open).toContain('data-state="ready"');
    expect(open).toContain('data-lede=""');
    expect(markup).toMatch(/<h3 class="itsm-Card__title" id="[^"]+">Raised vs resolved<\/h3>/);
    const lede = markup.indexOf('<div class="itsm-ChartCard__lede"><p class="itsm-ChartCard__headline">Resolved 122, raised 136 in 7 days: the queue grew by 14</p><p class="itsm-ChartCard__caption">Daily, in UTC days</p></div>');
    expect(lede).toBeGreaterThan(markup.indexOf('itsm-Card__title'));
    expect(markup.indexOf('itsm-ChartFigure')).toBeGreaterThan(lede);
  });

  it('tells the chart what the card already says: its title hidden, the headline its description for assistive technology only', () => {
    const markup = html(<ChartCard title="Raised vs resolved" headline={headline}>{area()}</ChartCard>);
    expect(markup).toContain('<figcaption class="itsm-ChartFigure__caption itsm-visually-hidden"><span class="itsm-ChartFigure__title itsm-visually-hidden">Raised and resolved</span>');
    expect(markup).toContain(`<span class="itsm-ChartFigure__summary itsm-visually-hidden"><span class="itsm-visually-hidden">. </span>${headline}</span>`);
    // Seen once: the only visible copy is the card's.
    expect(markup.split(headline)).toHaveLength(3);
  });

  it('lets a description the page set on the chart win', () => {
    const markup = html(<ChartCard title="Raised vs resolved" headline={headline}>{area({ description: 'Resolved overtook raised on Tuesday.' })}</ChartCard>);
    expect(markup).toContain('Resolved overtook raised on Tuesday.');
    expect(markup).not.toContain(`<span class="itsm-visually-hidden">. </span>${headline}`);
  });

  it('passes its span to a line or area chart, which fits its marker labels to the narrower plot', () => {
    const markers = [{ kind: 'today' as const }, { kind: 'deadline' as const, x: '2026-09-30', label: 'Freeze starts' }];
    const chart = area({ markers, asAt: '2026-10-01T09:00:00Z', timeZone: 'Europe/London' });
    const wide = html(<ChartCard title="t" span={12}>{chart}</ChartCard>);
    const narrow = html(<ChartCard title="t" span={4}>{chart}</ChartCard>);
    expect(wide).not.toContain('data-tier="2"');
    expect(narrow).toContain('data-tier="2"');
    expect(narrow).toMatch(/^<div class="itsm-GridItem" data-span="4">/);
    // 9 is a span too (X-m25): a wide card beside a span-3 list.
    expect(html(<ChartCard title="t" span={9}>{chart}</ChartCard>)).toMatch(/^<div class="itsm-GridItem" data-span="9">/);
  });

  it('leaves a chart without a title as it is', () => {
    const markup = html(<ChartCard title="SLA met" headline="85% met"><Gauge label="SLA met" value={0.85} target={0.9} /></ChartCard>);
    expect(markup).toContain('aria-label="SLA met: 85%, target 90%, 5 points below target"');
  });

  it('carries the ⓘ, meta, the range and actions, the footer link and an anchor', () => {
    const markup = html(
      <ChartCard
        title="Raised vs resolved"
        info="Tickets raised and resolved each day."
        meta={<span className="meta">Last 7 days</span>}
        range={<span className="range">Range</span>}
        actions={<span className="menu">⋯</span>}
        footerLink={{ href: '/team', label: 'Open team performance' }}
        headingLevel={2}
        id="volume"
      >
        {area()}
      </ChartCard>,
    );
    expect(markup).toContain('id="volume"');
    expect(markup).toContain('<h2 class="itsm-Card__title"');
    expect(markup).toContain('aria-label="About Raised vs resolved"');
    expect(markup).toContain('<div class="itsm-Card__meta"><span class="meta">Last 7 days</span></div>');
    expect(markup).toContain('<div class="itsm-Card__actions"><span class="range">Range</span><span class="menu">⋯</span></div>');
    expect(markup).toMatch(/<a href="\/team" class="itsm-Card__footerLink"><span>Open team performance<\/span>/);
  });
});

describe('states, all at one height', () => {
  const states = ['loading', 'empty', 'insufficient', 'error', 'ready'] as const;

  it.each(states)('%s takes the card’s height', (state) => {
    const markup = html(
      <ChartCard title="Raised vs resolved" headline={headline} state={state} minHeight={400} problem={{ status: 503 }} retryHref="/overview">
        {area()}
      </ChartCard>,
    );
    expect(markup).toContain('min-block-size:400px');
  });

  it('without a height, takes the chart’s plot height and the card’s chrome', () => {
    expect(CHART_HEIGHTS).toEqual({ line: 240, hero: 280, area: 240, donut: 220, gauge: 200, heatmapRow: 28, calendar: 188, sparkline: 40 });
    expect(html(<ChartCard title="t" state="loading">{area()}</ChartCard>)).toContain('min-block-size:336px');
    expect(html(<ChartCard title="t" state="loading">{area({ height: 280 })}</ChartCard>)).toContain('min-block-size:376px');
    expect(html(<ChartCard title="t" state="empty"><Gauge label="g" value={null} /></ChartCard>)).toContain('min-block-size:296px');
    expect(html(<ChartCard title="t" state="loading" />)).toContain('min-block-size:336px');
  });

  it('loads as the chart card skeleton, announced by its title', () => {
    const markup = html(<ChartCard title="Raised vs resolved" headline={headline} state="loading" />);
    expect(markup).toMatch(/class="itsm-SkeletonCard itsm-SkeletonChartCard itsm-ChartCard"/);
    expect(markup).toContain('Loading Raised vs resolved');
    expect(markup).not.toContain(headline);
  });

  it('is empty in words, and its headline says the same', () => {
    const markup = html(<ChartCard title="Raised vs resolved" headline={headline} state="empty" emptyText="No tickets in this period">{area()}</ChartCard>);
    expect(markup).toContain('<p class="itsm-ChartCard__headline">No tickets in this period</p>');
    expect(markup).toContain('<p class="itsm-Chart__emptyText">No tickets in this period</p>');
    expect(markup).not.toContain('itsm-XYChart__svg');
  });

  it('says when there is too little history, and what would change it', () => {
    const markup = html(<ChartCard title="Raised vs resolved" state="insufficient">{area()}</ChartCard>);
    expect(markup).toContain('data-reason="insufficient"');
    expect(markup).toContain('Charts start once there are 3 days of data');
  });

  it('fails in the product’s words with a plain "Try again" link, and no headline', () => {
    const markup = html(<ChartCard title="Raised vs resolved" headline={headline} state="error" problem={{ status: 404 }} retryHref="/overview?range=7d">{area()}</ChartCard>);
    expect(markup).toContain('data-reason="error"');
    expect(markup).toContain('<p class="itsm-Chart__emptyText">Couldn&#x27;t find raised vs resolved</p>');
    expect(markup).toContain('<a class="itsm-ChartCard__retry" href="/overview?range=7d">Try again</a>');
    expect(markup).not.toContain(headline);
    expect(html(<ChartCard title="t" state="error" />)).toContain('Couldn&#x27;t load this chart');
  });

  it('holds a label-named chart as it is, at its own height', () => {
    const markup = html(
      <ChartCard title="My work by priority" headline="2 of your 9 are P2">
        <DistributionBar label="Open tickets by priority" segments={[{ id: 'p2', label: 'P2', value: 2, tone: 'high' }]} />
      </ChartCard>,
    );
    expect(markup).not.toContain('min-block-size');
    expect(markup).toContain('Open tickets by priority: P2 2');
  });
});

describe('styles', () => {
  it('sets the headline 2 px under the title and the plot 16 px under it, in the card’s own rhythm', () => {
    expect(chartCardStyles).toMatch(/\.itsm-ChartCard\[data-lede\] > \.itsm-Card__header \+ \.itsm-Card__body \{\s*padding-block-start: var\(--itsm-space-3xs\);/);
    expect(chartCardStyles).toMatch(/\.itsm-ChartCard > \.itsm-Card__body \{[^}]*gap: var\(--itsm-space-md\);/);
    expect(chartCardStyles).toMatch(/\.itsm-ChartCard__headline \{[^}]*font-weight: var\(--itsm-font-weight-medium\);[^}]*color: var\(--itsm-colour-text-secondary\);/);
    expect(chartCardStyles).toMatch(/\.itsm-ChartCard__plot > \.itsm-Gauge \{\s*align-self: center;/);
  });
});

describe('accessibility', () => {
  it.each(['apple', 'apple-dark'])('passes axe in %s, ready and in each state', async (theme) => {
    const { container } = render(
      <TestProvider>
        <div data-itsm-theme={theme}>
          <ChartCard title="Raised vs resolved" headline={headline} info="Tickets raised and resolved each day." footerLink={{ href: '/team', label: 'Open team performance' }} span={8}>
            {area({ markers: [{ kind: 'today' }], asAt: '2026-10-01T09:00:00Z' })}
          </ChartCard>
          <ChartCard title="SLA met" headline="85% of targets met" caption="Response 92% · Update 80%">
            <Gauge label="SLA met · last 30 days" value={0.85} target={0.9} />
          </ChartCard>
          <ChartCard title="Empty" state="empty" emptyText="No tickets in this period" />
          <ChartCard title="Short" state="insufficient" />
          <ChartCard title="Failed" state="error" problem={{ status: 503 }} retryHref="/overview" />
          <ChartCard title="Loading" state="loading" />
        </div>
      </TestProvider>,
    );
    for (const details of container.querySelectorAll('details')) details.open = true;
    await expectNoViolations(container);
  });
});
