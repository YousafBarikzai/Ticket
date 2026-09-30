import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { contrastRatio } from '../../tokens/contrast.js';
import { themeVariables } from '../../tokens/css.js';
import { themeNames } from '../../tokens/tokens.js';
import { statGridStyles } from '../StatGrid.styles.js';
import { AreaChart } from '../AreaChart.js';
import { BarChart, type BarDatum } from '../BarChart.js';
import { ChartFigure } from '../ChartFigure.js';
import { DonutChart } from '../DonutChart.js';
import { LineChart, type ChartSeries } from '../LineChart.js';
import { ProgressRing } from '../ProgressRing.js';
import { Sparkline } from '../Sparkline.js';
import { StatGrid } from '../StatGrid.js';

/**
 * The charts as a server renders them: static markup, no provider, no
 * browser. Most of the product's charts are drawn by server components, so
 * this is the rendering that ships. Each case is one rule of SPEC §4.8 and
 * the dataviz method it follows, asserted on the markup.
 */

const here = dirname(fileURLToPath(import.meta.url));
const html = (element: ReactElement): string => renderToStaticMarkup(element);

/** Parse the markup with the platform's own parser-free tools: a regex count is enough for these structural checks. */
const count = (markup: string, pattern: RegExp): number => markup.match(pattern)?.length ?? 0;

const days = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04'];
const raised: ChartSeries = { id: 'raised', label: 'Raised', points: days.map((x, index) => ({ x, y: [12, 15, 30, 18][index]! })) };
const resolved: ChartSeries = { id: 'resolved', label: 'Resolved', points: days.map((x, index) => ({ x, y: [10, 14, 11, 6][index]! })) };

describe('static SVG from a server component', () => {
  it('keeps every static chart module free of the client directive, so the server-safety guard reads it', () => {
    for (const file of ['ChartFigure', 'LineChart', 'AreaChart', 'xy', 'BarChart', 'DonutChart', 'ProgressRing', 'Sparkline', 'StatGrid', 'parts', 'texture']) {
      const source = readFileSync(join(here, '..', `${file}.tsx`), 'utf8');
      expect(source.trimStart().startsWith("'use client'"), file).toBe(false);
    }
    // The two client leaves are client modules, and only they are.
    for (const file of ['ChartReader', 'ChartLink', 'StatCard']) {
      expect(readFileSync(join(here, '..', `${file}.tsx`), 'utf8').trimStart().startsWith("'use client'"), file).toBe(true);
    }
  });

  it('renders each chart to SVG without a provider or a browser', () => {
    expect(html(<LineChart title="Volume" series={[raised]} xType="time" />)).toMatch(/<svg[^>]*class="itsm-XYChart__svg"/);
    expect(html(<AreaChart title="Volume" series={[raised]} xType="time" />)).toContain('itsm-XYChart__area');
    expect(html(<DonutChart title="Channels" segments={[{ id: 'a', label: 'Email', value: 3 }]} />)).toMatch(/<svg[^>]*itsm-DonutChart__svg/);
    expect(html(<ProgressRing value={0.5} label="Half" />)).toContain('<svg');
    expect(html(<Sparkline values={[1, 3, 2]} label="Rising, 1 → 2" />)).toContain('<svg');
    expect(html(<BarChart title="By team" data={[{ id: 'a', label: 'Desk', value: 3 }]} />)).toContain('itsm-BarChart__bar');
  });

  it('keeps the plot out of the accessibility tree: the caption and the table carry it', () => {
    const markup = html(<LineChart title="Volume" series={[raised, resolved]} xType="time" />);
    expect(markup).toMatch(/<svg[^>]*aria-hidden="true"/);
    expect(markup).toMatch(/class="itsm-XYChart__y" aria-hidden="true"/);
    expect(markup).toMatch(/class="itsm-XYChart__x" aria-hidden="true"/);
  });
});

describe('ChartFigure', () => {
  const table = { columns: ['Band', 'Predicted', 'Observed'], rows: [['80–90%', 0.85, '84%'], ['90–100%', 1234.5, '—']] };

  it('is a figure named by its caption: the title and the one-sentence summary', () => {
    const markup = html(<ChartFigure title="Calibration" summary="Right 84% of the time." table={table}>plot</ChartFigure>);
    expect(markup).toMatch(/^<figure class="itsm-ChartFigure">/);
    expect(markup).toContain('<figcaption class="itsm-ChartFigure__caption"><span class="itsm-ChartFigure__title">Calibration</span>');
    expect(markup).toContain('Right 84% of the time.');
  });

  it('renders the data as a real table behind "View as table", on the server', () => {
    const markup = html(<ChartFigure title="Calibration" summary="s" table={table}>plot</ChartFigure>);
    expect(markup).toMatch(/<details class="itsm-ChartFigure__data"><summary class="itsm-ChartFigure__toggle">View as table<\/summary>/);
    expect(markup).toContain('<caption class="itsm-visually-hidden">Calibration</caption>');
    expect(count(markup, /<th scope="col"/g)).toBe(3);
    expect(count(markup, /<th scope="row"/g)).toBe(2);
    // Numbers are formatted for the reader and line up on the end.
    expect(markup).toContain('1,234.5');
    expect(markup).toMatch(/<td data-numeric="true">84%<\/td>/);
    // The scrolling frame can be reached and scrolled by keyboard.
    expect(markup).toMatch(/class="itsm-ChartFigure__scroll" tabindex="0" role="group" aria-label="Calibration, data"/);
  });

  it('shows the table outright, or leaves it out, when asked', () => {
    expect(html(<ChartFigure title="t" summary="s" table={table} tableMode="visible">p</ChartFigure>)).not.toContain('<details');
    expect(html(<ChartFigure title="t" summary="s" table={table} tableMode="visible">p</ChartFigure>)).toContain('<table');
    expect(html(<ChartFigure title="t" summary="s" table={table} tableMode="hidden">p</ChartFigure>)).not.toContain('<table');
  });

  it('keeps a hidden title for assistive technology, as one caption', () => {
    const markup = html(<ChartFigure title="Volume" summary="Rose." titleHidden table={table}>p</ChartFigure>);
    expect(markup).toContain('<span class="itsm-ChartFigure__title itsm-visually-hidden">Volume</span>');
    expect(markup).toContain('<span class="itsm-visually-hidden">. </span>Rose.');
  });
});

describe('line and area charts', () => {
  it('has no legend for one series — the title names it — and labels its end with the value', () => {
    const markup = html(<LineChart title="Raised" series={[raised]} xType="time" />);
    expect(markup).not.toContain('itsm-ChartLegend');
    expect(markup).toMatch(/itsm-XYChart__endValue">18</);
    expect(markup).not.toContain('itsm-XYChart__endName');
  });

  it('always has a legend for two or more series, and direct end labels while they do not collide', () => {
    const markup = html(<LineChart title="Volume" series={[raised, resolved]} xType="time" />);
    expect(markup).toContain('aria-label="Legend"');
    expect(count(markup, /itsm-ChartLegend__item/g)).toBe(2);
    expect(markup).toMatch(/itsm-XYChart__endName">Raised</);
    expect(markup).toMatch(/itsm-XYChart__endName">Resolved</);
  });

  it('gives way to the legend alone when end labels would collide, rather than nudging them off their lines', () => {
    const close: ChartSeries = { id: 'close', label: 'Close', points: days.map((x, index) => ({ x, y: [10, 14, 11, 18.5][index]! })) };
    const markup = html(<LineChart title="Volume" series={[raised, close]} xType="time" />);
    expect(markup).toContain('itsm-ChartLegend');
    expect(markup).not.toContain('itsm-XYChart__ends');
  });

  it('labels no ends past four series', () => {
    const many = [1, 2, 3, 4, 5].map((n) => ({ id: `s${n}`, label: `S${n}`, points: days.map((x) => ({ x, y: n * 20 })) }));
    expect(html(<LineChart title="Many" series={many} xType="time" />)).not.toContain('itsm-XYChart__ends');
  });

  it('colours series by slot, following the entity rather than its position', () => {
    const markup = html(<LineChart title="Volume" series={[{ ...resolved, slot: 3 }, raised]} xType="time" />);
    expect(markup).toMatch(/class="itsm-XYChart__line" data-slot="3"/);
    expect(markup).toMatch(/class="itsm-XYChart__line" data-slot="2"/);
  });

  it('draws a reference series dashed in the grey, with no end marker, and keeps the data series’ colours', () => {
    const target: ChartSeries = { id: 'target', label: 'Target', reference: true, points: days.map((x) => ({ x, y: 20 })) };
    const markup = html(<LineChart title="Volume" series={[target, raised, resolved]} xType="time" />);
    expect(markup).toMatch(/class="itsm-XYChart__line" data-slot="other" data-reference="true"/);
    expect(markup).toMatch(/class="itsm-XYChart__line" data-slot="1" d=/);
    expect(markup).toMatch(/class="itsm-XYChart__line" data-slot="2" d=/);
    expect(count(markup, /itsm-XYChart__end"/g)).toBe(2);
    expect(markup).not.toMatch(/itsm-XYChart__endName">Target</);
    expect(count(markup, /itsm-ChartLegend__item/g)).toBe(3);
    expect(markup).toMatch(/<th[^>]*>Target<\/th>/);
  });

  it('writes a summary from the data when none is given, for screen readers only', () => {
    const markup = html(<LineChart title="Volume" series={[raised]} xType="time" />);
    expect(markup).toMatch(/itsm-ChartFigure__summary itsm-visually-hidden">(<span[^>]*>\. <\/span>)?Raised rose from 12 \(1 Sept?\) to 18 \(4 Sept?\), highest 30 \(3 Sept?\)\./);
  });

  it('shows a given description', () => {
    const markup = html(<LineChart title="Volume" description="Raised outpaced resolved." series={[raised]} xType="time" />);
    expect(markup).toContain('<span class="itsm-ChartFigure__summary">Raised outpaced resolved.</span>');
  });

  it('puts every value in the table, a gap as a dash, and a stacked total', () => {
    const gappy: ChartSeries = { ...resolved, points: resolved.points.map((point, index) => (index === 1 ? { x: point.x, y: null } : point)) };
    const markup = html(<AreaChart title="Volume" stacked series={[raised, gappy]} xType="time" table="visible" />);
    expect(markup).toContain('<th scope="col">Date</th><th scope="col" data-numeric="true">Raised</th><th scope="col" data-numeric="true">Resolved</th><th scope="col" data-numeric="true">Total</th>');
    expect(markup).toMatch(/<th scope="row">Wed, 2 Sept? 2026<\/th><td data-numeric="true">15<\/td><td data-numeric="true">—<\/td><td data-numeric="true">15<\/td>/);
  });

  it('draws a missing value as a gap, not a drop to zero', () => {
    const gappy: ChartSeries = { ...raised, points: raised.points.map((point, index) => (index === 1 ? { x: point.x, y: null } : point)) };
    const markup = html(<LineChart title="Volume" series={[gappy]} xType="time" />);
    const d = markup.match(/class="itsm-XYChart__line"[^>]* d="([^"]*)"/)?.[1] ?? '';
    // Two runs: the first point alone (drawn as a dot), then points three and four.
    expect(count(d, /M/g)).toBe(1);
    expect(markup).toContain('itsm-XYChart__dot');
  });

  it('orders a time axis by time, whatever order the points came in', () => {
    const shuffled: ChartSeries = { ...raised, points: [...raised.points].reverse() };
    const markup = html(<LineChart title="Volume" series={[shuffled]} xType="time" table="visible" />);
    expect(markup.indexOf('1 Sep')).toBeLessThan(markup.indexOf('4 Sep'));
  });

  it('keeps its height when empty, and says why in words', () => {
    const markup = html(<LineChart title="Volume" series={[]} xType="time" height={180} />);
    expect(markup).toContain('No data for this period');
    expect(markup).toContain('min-block-size:180px');
    expect(markup).not.toContain('<table');
    expect(html(<LineChart title="Volume" series={[{ ...raised, points: [{ x: '2026-09-01', y: null }] }]} xType="time" emptyText="Nothing raised yet" />)).toContain('Nothing raised yet');
  });

  it('marks the figure busy while loading, at the plot height', () => {
    const markup = html(<LineChart title="Volume" series={[raised]} xType="time" loading height={200} />);
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain('itsm-Chart__loading');
    expect(markup).not.toContain('itsm-XYChart__svg');
  });

  it('adds the reading layer only when interactive', () => {
    expect(html(<LineChart title="Volume" series={[raised]} xType="time" />)).not.toContain('itsm-ChartReader');
    const markup = html(<LineChart title="Volume" series={[raised]} xType="time" interactive />);
    expect(markup).toMatch(/role="group" aria-roledescription="chart" aria-label="Volume"/);
    expect(markup).toContain('Use ← → to read values');
  });
});

describe('bar charts', () => {
  const channels: BarDatum[] = [
    { id: 'email', label: 'Email', value: 412, icon: 'mail', href: '/tickets?channel=email' },
    { id: 'slack', label: 'Slack', value: 142 },
    { id: 'portal', label: 'Portal', value: 318, secondary: 'self-service' },
  ];

  it('lists label · bar · value rows, largest first, as a ranked list', () => {
    const markup = html(<BarChart title="By channel" variant="list" data={channels} />);
    expect(markup).toMatch(/<ol class="itsm-BarChart__rows">/);
    const labels = [...markup.matchAll(/itsm-BarChart__name[^"]*">([^<]+)</g)].map((match) => match[1]);
    expect(labels).toEqual(['Email', 'Portal', 'Slack']);
    // Each row reads as "Email 412": the label, then the value; the bar is decoration.
    expect(markup).toMatch(/<span class="itsm-BarChart__value">412<\/span><span class="itsm-BarChart__track" aria-hidden="true">/);
    expect(markup).toContain('data-layout="list"');
  });

  it('keeps the given order when asked, as an unordered list', () => {
    const markup = html(<BarChart title="By channel" variant="list" sort="none" data={channels} />);
    expect(markup).toMatch(/<ul class="itsm-BarChart__rows">/);
    expect([...markup.matchAll(/itsm-BarChart__name[^"]*">([^<]+)</g)].map((match) => match[1])).toEqual(['Email', 'Slack', 'Portal']);
  });

  it('links a row and carries its icon and qualifier', () => {
    const markup = html(<BarChart title="By channel" variant="list" data={channels} />);
    expect(markup).toContain('<a href="/tickets?channel=email" class="itsm-BarChart__name itsm-BarChart__link">Email</a>');
    expect(markup).toMatch(/<svg[^>]*itsm-BarChart__icon/);
    expect(markup).toContain('<span class="itsm-BarChart__secondary">self-service</span>');
  });

  it('sizes each bar against the largest, and draws nothing for a zero', () => {
    const markup = html(<BarChart title="By channel" variant="list" data={[...channels, { id: 'fax', label: 'Fax', value: 0 }]} />);
    expect(markup).toContain('--_itsm-bar:1');
    expect(markup).toMatch(/--_itsm-bar:0\.3446/);
    const fax = markup.slice(markup.indexOf('>Fax<'));
    expect(fax.slice(0, fax.indexOf('</li>'))).not.toContain('itsm-BarChart__segment');
  });

  it('paints one series in one colour, and "Other" in the de-emphasis grey', () => {
    const markup = html(<BarChart title="By channel" variant="list" maxBars={2} data={channels} />);
    expect(count(markup, /data-slot="1"/g)).toBe(1);
    expect(markup).toContain('data-slot="other"');
    expect(markup).toMatch(/itsm-BarChart__name">Other<\/span>.*?itsm-BarChart__value">460</);
  });

  it('stacks parts with their series colours, says the breakdown in words, and adds a legend', () => {
    const markup = html(
      <BarChart
        title="By team"
        variant="list"
        seriesDefs={[
          { id: 'p1', label: 'P1', slot: 6 },
          { id: 'p2', label: 'P2', slot: 2 },
        ]}
        data={[{ id: 'desk', label: 'Desk', value: 0, series: { p1: 3, p2: 9 } }]}
      />,
    );
    expect(markup).toMatch(/itsm-BarChart__value">12<span class="itsm-visually-hidden"> \(P1 3, P2 9\)<\/span>/);
    expect(markup).toContain('data-slot="6" style="flex-grow:3"');
    expect(markup).toContain('data-slot="2" style="flex-grow:9"');
    expect(count(markup, /itsm-ChartLegend__item/g)).toBe(2);
  });

  it('puts the value at the tip of a horizontal bar, measured in the widest value', () => {
    const markup = html(<BarChart title="By team" data={channels} />);
    expect(markup).toContain('data-layout="rows"');
    expect(markup).toContain('--_itsm-value-ch:3');
  });

  it('draws vertical bars on a value axis, keeps their order, and puts the data behind "View as table"', () => {
    const markup = html(
      <BarChart title="Per day" orientation="vertical" data={['Mon', 'Tue', 'Wed'].map((label, index) => ({ id: label, label, value: [5, 12, 7][index]! }))} />,
    );
    expect(markup).toContain('data-layout="columns"');
    expect([...markup.matchAll(/itsm-BarChart__xTick"[^>]*>([^<]+)</g)].map((match) => match[1])).toEqual(['Mon', 'Tue', 'Wed']);
    expect([...markup.matchAll(/itsm-BarChart__yTick"[^>]*>([^<]+)</g)].map((match) => match[1])).toEqual(['0', '5', '10', '15']);
    expect(markup).toContain('View as table');
    expect(markup).toMatch(/itsm-ChartFigure__summary itsm-visually-hidden">(<span[^>]*>\. <\/span>)?Highest: Tue \(12\); lowest: Mon \(5\)\./);
  });

  it('leaves the table out of rows, which already say every value, unless asked', () => {
    expect(html(<BarChart title="By channel" variant="list" data={channels} />)).not.toContain('<table');
    expect(html(<BarChart title="By channel" variant="list" data={channels} table="toggle" />)).toContain('<table');
  });

  it('formats values, empty and loading states', () => {
    expect(html(<BarChart title="Accuracy" variant="list" valueFormat={{ style: 'percent' }} data={[{ id: 'p', label: 'Priority', value: 0.92 }]} />)).toContain('>92%<');
    expect(html(<BarChart title="By team" data={[]} />)).toContain('No data for this period');
    expect(html(<BarChart title="By team" data={channels} loading />)).toContain('aria-busy="true"');
  });

  it('reads rows with the arrow keys down the list when interactive', () => {
    const markup = html(<BarChart title="By team" data={channels} interactive />);
    expect(markup).toContain('Use ↑ ↓ to read values');
    expect(count(markup, /data-point="\d"/g)).toBe(3);
  });
});

describe('donut chart', () => {
  const segments = ['Email', 'Portal', 'Slack', 'Teams', 'Phone', 'API', 'Fax'].map((label, index) => ({ id: label.toLowerCase(), label, value: 70 - index * 10 }));

  it('is for six parts at most: the smallest fold into "Other"', () => {
    const markup = html(<DonutChart title="Channels" segments={segments} />);
    expect(count(markup, /class="itsm-DonutChart__segment"/g)).toBe(6);
    expect(markup).toMatch(/itsm-ChartLegend__label">Other<\/span><span class="itsm-ChartLegend__value">30<\/span><span class="itsm-ChartLegend__detail">11%</);
  });

  it('gives every part its value and share in the legend, so nobody reads an angle', () => {
    const markup = html(<DonutChart title="Channels" segments={segments.slice(0, 2)} />);
    expect(markup).toMatch(/Email<\/span><span class="itsm-ChartLegend__value">70<\/span><span class="itsm-ChartLegend__detail">54%/);
    expect(markup).toMatch(/itsm-visually-hidden">(<span[^>]*>\. <\/span>)?Email 54% and Portal 46%, of 130 in all\./);
  });

  it('draws each textured part twice, with the hatch shown by CSS only when wanted', () => {
    const markup = html(<DonutChart title="Channels" segments={segments.slice(0, 3)} />);
    expect(count(markup, /<pattern /g)).toBe(2);
    expect(count(markup, /itsm-DonutChart__texture" fill="url\(#itsm-donut-[a-z0-9]+-t[23]\)"/g)).toBe(2);
  });

  it('says the centre figure once, in words', () => {
    const markup = html(<DonutChart title="Channels" segments={segments.slice(0, 2)} centerValue="130" centerLabel="tickets" />);
    expect(markup).toContain('<span class="itsm-DonutChart__centre" aria-hidden="true">');
    expect(markup).toContain('<span class="itsm-visually-hidden">130 tickets</span>');
  });

  it('is empty when nothing adds up to anything', () => {
    expect(html(<DonutChart title="Channels" segments={[{ id: 'a', label: 'A', value: 0 }]} />)).toContain('No data for this period');
  });
});

describe('progress ring and sparkline', () => {
  it('names the ring with its value, and keeps the centre text visual', () => {
    const markup = html(<ProgressRing value={0.624} label="SLA time used" centerText="62%" />);
    expect(markup).toMatch(/role="img" aria-label="SLA time used: 62%"/);
    expect(markup).toContain('stroke-dasharray="62.4 100"');
  });

  it('turns warning then danger as time runs out, in auto', () => {
    expect(html(<ProgressRing value={0.5} label="x" tone="auto" />)).toContain('data-tone="accent"');
    expect(html(<ProgressRing value={0.8} label="x" tone="auto" />)).toContain('data-tone="warning"');
    expect(html(<ProgressRing value={0.95} label="x" tone="auto" />)).toContain('data-tone="danger"');
  });

  it('clamps and draws no arc for nothing', () => {
    expect(html(<ProgressRing value={-1} label="x" />)).not.toContain('itsm-ProgressRing__arc');
    expect(html(<ProgressRing value={3} label="x" />)).toContain('aria-label="x: 100%"');
  });

  it('is an image named by its trend, with the latest point marked', () => {
    const markup = html(<Sparkline values={[12, 14, 18]} label="Rising, 12 → 18" />);
    expect(markup).toMatch(/^<svg role="img" aria-label="Rising, 12 → 18"/);
    expect(markup).toContain('itsm-Sparkline__dot');
    expect(markup).toContain('itsm-Sparkline__wash');
    expect(html(<Sparkline values={[12, 14, 18]} label="x" highlightLast={false} />)).not.toContain('itsm-Sparkline__dot');
  });

  it('leaves a gap for a missing value and no wash across it', () => {
    const markup = html(<Sparkline values={[1, Number.NaN, 3, 4]} label="x" />);
    expect(markup).not.toContain('itsm-Sparkline__wash');
  });
});

describe('stat grid', () => {
  it('passes its minimum as a local property and its column rule as an attribute', () => {
    expect(html(<StatGrid min={200}>x</StatGrid>)).toBe('<div class="itsm-StatGrid" style="--_itsm-stat-min:12.5rem"><div class="itsm-StatGrid__items">x</div></div>');
    expect(html(<StatGrid columns={4}>x</StatGrid>)).toContain('data-columns="4"');
  });
});

describe('StatGrid on a phone', () => {
  it('is two by two, never one column and never a sideways carousel (X-94)', () => {
    // The track minimum is the lesser of `min` and half the row, so a grid
    // as narrow as a phone still makes two columns.
    expect(statGridStyles).toContain('minmax(min(var(--_itsm-stat-min), calc(50% - var(--_itsm-stat-gap) / 2)), 1fr)');
    expect(statGridStyles).toMatch(/\[data-columns="4"\] \.itsm-StatGrid__items \{\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
    expect(statGridStyles).toMatch(/@container itsm-stats \(min-width: 48rem\)[\s\S]*repeat\(4, minmax\(0, 1fr\)\)/);
    expect(statGridStyles).not.toMatch(/overflow-x|scroll-snap|nowrap/);
  });
});

describe('colours that carry meaning', () => {
  const surfaces = ['surface-raised', 'surface-canvas', 'surface-sunken'];
  const marks = ['text-disabled', 'accent', 'success-border', 'warning-border', 'danger-border', 'neutral-border'];

  it.each(themeNames)('reach 3:1 against every surface a chart sits on in %s: "Other", the ring tones', (theme) => {
    const vars = themeVariables(theme);
    for (const mark of marks) {
      for (const surface of surfaces) {
        const ratio = contrastRatio(vars[`--itsm-colour-${mark}`]!, vars[`--itsm-colour-${surface}`]!);
        expect(ratio, `${mark} on ${surface}`).toBeGreaterThanOrEqual(3);
      }
    }
  });
});
