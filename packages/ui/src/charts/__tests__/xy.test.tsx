import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AreaChart } from '../AreaChart.js';
import { areaChartStyles } from '../AreaChart.styles.js';
import { LineChart, type ChartSeries } from '../LineChart.js';
import { lineChartStyles } from '../LineChart.styles.js';

/**
 * `LineChart` / `AreaChart` v3 (SPEC-v3 §8.2, A8 §4.3) as a server renders
 * them: series styles, washes, end labels nudged apart, the target, bands,
 * and markers placed from the page's `asAt` in the reader's zone — across
 * both 2026 London clock changes — with the room above the data they need.
 */

const html = (element: ReactElement): string => renderToStaticMarkup(element);
const count = (markup: string, pattern: RegExp): number => markup.match(pattern)?.length ?? 0;

/** Consecutive UTC days from `first`, as the API buckets them. */
function days(first: string, n: number): string[] {
  const start = Date.parse(first);
  return Array.from({ length: n }, (_, index) => new Date(start + index * 86_400_000).toISOString().slice(0, 10));
}

const week = days('2026-09-25', 7); // 25 Sep … 1 Oct
const series = (id: string, values: readonly (number | null)[], extra: Partial<ChartSeries> = {}, xs: readonly string[] = week): ChartSeries => ({
  id,
  label: id[0]!.toUpperCase() + id.slice(1),
  points: xs.map((x, index) => ({ x, y: values[index] ?? null })),
  ...extra,
});
const raised = series('raised', [12, 15, 30, 18, 20, 22, 19], { style: 'comparison' });
const resolved = series('resolved', [10, 14, 11, 16, 21, 24, 26]);

afterEach(() => vi.restoreAllMocks());

describe('series styles (A8 §4.3.2)', () => {
  it('draws the actual series in its colour and the comparison in the grey, keyed alike in the legend', () => {
    const markup = html(<LineChart title="Raised vs resolved" series={[raised, resolved]} xType="time" />);
    // Resolved is the first coloured series (slot 1, the accent); raised takes no colour of its own.
    expect(markup).toMatch(/class="itsm-XYChart__line" data-slot="other" data-style="comparison"/);
    expect(markup).toMatch(/class="itsm-XYChart__line" data-slot="1" data-primary="true" d=/);
    expect(markup).toContain('data-mark="chip" data-slot="other" data-style="comparison"');
    expect(markup).toContain('data-mark="chip" data-slot="1" aria-hidden="true"');
  });

  it('gives an end dot to actual and forecast series only, and an end label to every series', () => {
    const forecast = series('next', [null, null, null, null, null, null, null, 28], { style: 'forecast' }, [...week, '2026-10-02']);
    const markup = html(<LineChart title="Volume" series={[raised, resolved, forecast]} xType="time" />);
    expect(count(markup, /class="itsm-XYChart__end"/g)).toBe(2);
    expect(markup).toMatch(/class="itsm-XYChart__end" data-slot="1" data-style="forecast"/);
    expect(count(markup, /class="itsm-XYChart__endLabel"/g)).toBe(3);
    expect(markup).toMatch(/itsm-XYChart__endName">Raised<\/span><span class="itsm-XYChart__endValue">19</);
  });

  it('continues a forecast from the last actual point, in its series’ colour', () => {
    const xs = [...week, '2026-10-02', '2026-10-03'];
    const actual = series('resolved', [10, 14, 11, 16, 21, 24, 26], {}, xs);
    const forecast = series('next', [null, null, null, null, null, null, null, 27, 29], { style: 'forecast' }, xs);
    const markup = html(<LineChart title="Volume" series={[actual, forecast]} xType="time" />);
    const d = (style: string): string => markup.match(new RegExp(`class="itsm-XYChart__line" data-slot="1"${style} d="([^"]+)"`))?.[1] ?? '';
    const actualPath = d(' data-primary="true"');
    const forecastPath = d(' data-style="forecast"');
    const lastActual = actualPath.split(/[ML]/).filter(Boolean).at(-1);
    expect(forecastPath.startsWith(`M${lastActual}`)).toBe(true);
    expect(count(forecastPath, /L/g)).toBe(2);
  });

  it('names forecast values as forecasts in the table', () => {
    const forecast = series('next', [null, null, null, null, null, null, 25], { style: 'forecast', label: 'Resolved' });
    const markup = html(<LineChart title="Volume" series={[resolved, forecast]} xType="time" table="visible" />);
    expect(markup).toContain('<th scope="col" data-numeric="true">Resolved (forecast)</th>');
  });

  it('draws a baseline dashed 2 3 and a forecast dashed 5 4, comparison and baseline at 1.5 px', () => {
    expect(lineChartStyles).toMatch(/\.itsm-XYChart__line\[data-style="baseline"\] \{\s*stroke-dasharray: 2 3;/);
    expect(lineChartStyles).toMatch(/\.itsm-XYChart__line\[data-style="forecast"\] \{\s*stroke-dasharray: 5 4;/);
    expect(lineChartStyles).toMatch(/\[data-style="comparison"\], \[data-style="baseline"\], \[data-style="forecast"\]\) \{\s*stroke-width: 1\.5;/);
    expect(lineChartStyles).toMatch(/\.itsm-XYChart__line\[data-primary\] \{\s*stroke-width: 2\.5;/);
  });

  it('draws the highlighted series primary when several are actual', () => {
    const other = series('other', [3, 4, 5, 6, 7, 8, 9]);
    const markup = html(<LineChart title="Volume" series={[resolved, other]} xType="time" highlight="other" />);
    expect(count(markup, /data-primary="true"/g)).toBe(1);
    expect(markup).toMatch(/data-slot="2" data-primary="true"/);
  });
});

describe('washes', () => {
  it('washes only the actual series of an area chart, and nothing in a line chart', () => {
    const area = html(<AreaChart title="Volume" series={[raised, resolved]} xType="time" />);
    expect(count(area, /class="itsm-XYChart__area"/g)).toBe(1);
    expect(area).toMatch(/class="itsm-XYChart__area" data-slot="1" data-fill="wash"/);
    expect(html(<LineChart title="Volume" series={[raised, resolved]} xType="time" />)).not.toContain('itsm-XYChart__area');
  });

  it('fades a gradient wash from the line to the baseline, its stops keyed by the series', () => {
    const markup = html(<AreaChart title="Volume" series={[resolved]} xType="time" fill="gradient" />);
    expect(markup).toMatch(/<linearGradient id="(itsm-xy-[a-z0-9]+-g0)" class="itsm-XYChart__gradient" x1="0" y1="0" x2="0" y2="1" data-slot="1">/);
    const id = markup.match(/<linearGradient id="([^"]+)"/)![1];
    expect(markup).toContain(`data-fill="gradient" d=`);
    expect(markup).toContain(`fill="url(#${id})"`);
    expect(areaChartStyles).toMatch(/\.itsm-XYChart__stop \{\s*stop-color: var\(--_itsm-series\);\s*stop-opacity: 0\.2;/);
  });

  it('washes several actual series at 8 %, one at 10 %, four points more in the dark themes', () => {
    const other = series('other', [3, 4, 5, 6, 7, 8, 9]);
    expect(html(<AreaChart title="Volume" series={[resolved, other]} xType="time" />)).toContain('data-washes="several"');
    expect(html(<AreaChart title="Volume" series={[resolved]} xType="time" />)).not.toContain('data-washes');
    expect(areaChartStyles).toMatch(/\.itsm-XYChart \{\s*--_itsm-wash: 10%;/);
    expect(areaChartStyles).toMatch(/\[data-washes="several"\] \{\s*--_itsm-wash: 8%;/);
    expect(areaChartStyles).toContain('calc(var(--_itsm-wash) + 4%)');
  });

  it('washes every band of a stacked area chart, at 22 %', () => {
    const markup = html(<AreaChart title="Volume" stacked series={[resolved, series('other', [3, 4, 5, 6, 7, 8, 9])]} xType="time" />);
    expect(count(markup, /class="itsm-XYChart__area"[^>]*data-stacked="true"/g)).toBe(2);
    expect(areaChartStyles).toMatch(/\[data-stacked\] \{\s*--_itsm-wash: 22%;/);
  });

  it('turns the wash into a 1 px outline with more contrast, and drops it in forced colours', () => {
    expect(areaChartStyles).toMatch(/high-contrast"\] \.itsm-XYChart__area:not\(\[data-stacked\]\) \{ fill: none; stroke: var\(--_itsm-series\); stroke-width: 1;/);
    expect(areaChartStyles).toMatch(/@media \(forced-colors: active\) \{\s*\.itsm-XYChart__area \{\s*fill: none;/);
  });
});

describe('end labels (A8-S5)', () => {
  const close = series('close', [10, 14, 11, 16, 21, 24, 25.5]);

  it('nudges labels that would overprint 14 px apart, in their order, and keeps the legend', () => {
    const markup = html(<LineChart title="Volume" series={[resolved, close]} xType="time" />);
    const tops = [...markup.matchAll(/class="itsm-XYChart__endLabel" style="top:([\d.]+)px"/g)].map((match) => Number(match[1]));
    expect(tops).toHaveLength(2);
    expect(tops[1]! - tops[0]!).toBeGreaterThanOrEqual(14);
    expect(markup).toContain('itsm-ChartLegend');
  });

  it('writes the value alone for one series, a swatch and the name for several, and a series’ own words when it has them', () => {
    expect(html(<LineChart title="Resolved" series={[resolved]} xType="time" />)).toMatch(/<span class="itsm-XYChart__endLabel" style="top:[\d.]+px"><span class="itsm-XYChart__endValue">26<\/span>/);
    const markup = html(<LineChart title="Volume" series={[resolved, { ...close, endLabel: 'Forecast 18/day' }]} xType="time" />);
    expect(markup).toMatch(/itsm-XYChart__endKey" data-slot="1"><\/span><span class="itsm-XYChart__endName">Resolved/);
    expect(markup).toContain('itsm-XYChart__endName">Forecast 18/day</span></span>');
  });

  it('labels up to four series by default, any number with `always`, none with `none` or `false`', () => {
    const five = [1, 2, 3, 4, 5].map((n) => series(`s${n}`, week.map(() => n * 20)));
    expect(html(<LineChart title="Many" series={five} xType="time" />)).not.toContain('itsm-XYChart__ends');
    expect(count(html(<LineChart title="Many" series={five} xType="time" endLabels="always" />), /class="itsm-XYChart__endLabel"/g)).toBe(5);
    expect(html(<LineChart title="Volume" series={[resolved]} xType="time" endLabels="none" />)).not.toContain('itsm-XYChart__ends');
    expect(html(<LineChart title="Volume" series={[resolved]} xType="time" directLabels="none" />)).not.toContain('itsm-XYChart__ends');
    expect(html(<LineChart title="Volume" series={[{ ...resolved, endLabel: false }]} xType="time" />)).not.toContain('itsm-XYChart__ends');
  });

  it('keeps the gutter to min(22%, 170px) and gives way to the legend below 32 rem', () => {
    expect(lineChartStyles).toContain('fit-content(min(22%, 10.625rem))');
    expect(lineChartStyles).toMatch(/@container itsm-chart \(max-width: 32rem\) \{[\s\S]*?\.itsm-XYChart__ends \{\s*display: none;/);
  });
});

describe('"today" and the other markers (A8 §3.5, §4.3.4)', () => {
  const october = days('2026-10-19', 8); // 19 Oct … 26 Oct, across the end of British Summer Time
  const line = (asAt: string | undefined, xs = october, extra: Record<string, unknown> = {}): string =>
    html(
      <LineChart
        title="Raised"
        series={[series('raised', xs.map((_, index) => index + 3), {}, xs)]}
        xType="time"
        markers={[{ kind: 'today' }]}
        timeZone="Europe/London"
        table="visible"
        {...(asAt === undefined ? {} : { asAt })}
        {...extra}
      />,
    );
  const pill = (markup: string): { left: string; text: string } | null => {
    const match = markup.match(/class="itsm-Markers__label" data-kind="today"[^>]*style="left:([\d.]+%)">([^<]+)</);
    return match ? { left: match[1]!, text: match[2]! } : null;
  };

  it('stands on the last bucket, worded for the reader’s date, when UTC is still yesterday (BST)', () => {
    const markup = line('2026-10-01T23:30:00Z', week);
    expect(pill(markup)).toEqual({ left: '100%', text: 'As at 2 Oct' });
    expect(markup).toMatch(/<th scope="row">Thu, 1 Oct 2026<\/th>(<td[^>]*>[^<]*<\/td>)*<td>As at 2 Oct<\/td>/);
  });

  it('puts 23:30 UTC on 24 Oct, still summer time, on 25 Oct in London', () => {
    expect(pill(line('2026-10-24T23:30:00Z'))).toEqual({ left: `${Math.round((6 / 7) * 100_000) / 1000}%`, text: 'As at 25 Oct' });
  });

  it('puts 00:30 UTC on 26 Oct, after the clocks went back, on 26 Oct', () => {
    expect(pill(line('2026-10-26T00:30:00Z'))).toEqual({ left: '100%', text: 'As at 26 Oct' });
  });

  it('draws no marker without asAt, before the series, or on a category axis', () => {
    expect(pill(line(undefined))).toBeNull();
    expect(pill(line('2026-10-01T12:00:00Z'))).toBeNull();
    expect(pill(line('2026-10-24T12:00:00Z', october, { xType: 'category' }))).toBeNull();
  });

  it('keeps an 18 px row above the data for a pill, so it never sits on a line', () => {
    const marked = line('2026-10-24T12:00:00Z');
    const bare = line(undefined);
    expect(marked).toContain('--_itsm-plot-h:258px');
    expect(bare).toContain('--_itsm-plot-h:240px');
    expect(marked).toMatch(/<svg class="itsm-XYChart__svg" width="100%" height="258"/);
  });

  it('draws deadlines and milestones with their diamonds, and names them in the table', () => {
    const markup = line('2026-10-24T12:00:00Z', october, {
      markers: [
        { kind: 'deadline', x: '2026-10-21', label: 'Freeze starts' },
        { kind: 'milestone', x: '2026-10-20', label: 'SG4', reached: true },
      ],
    });
    expect(count(markup, /class="itsm-Markers__diamond"/g)).toBe(2);
    expect(markup).toContain('<td>Deadline: Freeze starts</td>');
    expect(markup).toContain('<td>Milestone: SG4, reached</td>');
  });
});

describe('target, bands and the value axis', () => {
  it('draws a dashed target with its label and stretches the axis to include it', () => {
    const markup = html(<LineChart title="Attainment" series={[series('met', [80, 82, 85, 84, 83, 86, 88])]} xType="time" target={{ value: 95, label: 'Target 95%' }} baseline="auto" />);
    expect(markup).toContain('class="itsm-Markers__target"');
    expect(markup).toContain('class="itsm-Markers__targetLabel"');
    expect(markup).toContain('>Target 95%</span>');
    const ticks = [...markup.matchAll(/itsm-XYChart__yTick"[^>]*>([^<]+)</g)].map((match) => Number(match[1]));
    expect(Math.max(...ticks)).toBeGreaterThanOrEqual(95);
  });

  it('shades bands behind the data, with their labels', () => {
    const markup = html(<LineChart title="Changes" series={[resolved]} xType="time" bands={[{ from: '2026-09-28', to: '2026-09-30', label: 'Freeze' }]} />);
    expect(markup).toMatch(/<rect class="itsm-Markers__band"/);
    expect(markup).toContain('>Freeze</span>');
  });

  it('holds a fixed value axis to its domain', () => {
    const markup = html(<LineChart title="Share" series={[series('share', [0.2, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9])]} xType="time" yDomain={[0, 1]} yFormat={{ style: 'percent' }} />);
    const ticks = [...markup.matchAll(/itsm-XYChart__yTick"[^>]*>([^<]+)</g)].map((match) => match[1]);
    expect(ticks[0]).toBe('0%');
    expect(ticks.at(-1)).toBe('100%');
  });

  it('draws a smooth line that never overshoots when asked, and straight segments by default', () => {
    expect(html(<LineChart title="Volume" series={[resolved]} xType="time" curve="monotone" />)).toMatch(/class="itsm-XYChart__line"[^>]* d="M[^"]*C/);
    expect(html(<LineChart title="Volume" series={[resolved]} xType="time" />)).not.toMatch(/class="itsm-XYChart__line"[^>]* d="M[^"]*C/);
  });
});

describe('honest states', () => {
  it('says "Not enough history yet" below three days on a time axis, and what would change it', () => {
    const short = series('raised', [4, 6], {}, week.slice(0, 2));
    const markup = html(<LineChart title="Raised" series={[short]} xType="time" />);
    expect(markup).toContain('data-reason="insufficient"');
    expect(markup).toContain('>Not enough history yet</p>');
    expect(markup).toContain('Charts start once there are 3 days of data');
    expect(html(<LineChart title="Raised" series={[short]} xType="time" minPoints={2} />)).toContain('itsm-XYChart__svg');
    expect(html(<LineChart title="Raised" series={[{ ...short, points: [{ x: 'P1', y: 2 }, { x: 'P2', y: 3 }] }]} xType="category" />)).toContain('itsm-XYChart__svg');
  });

  it('keeps a description for assistive technology only when the card shows it', () => {
    const markup = html(<LineChart title="Volume" titleHidden description="Resolved kept pace" descriptionHidden series={[resolved]} xType="time" />);
    expect(markup).toContain('<figcaption class="itsm-ChartFigure__caption itsm-visually-hidden">');
    expect(markup).toContain('itsm-ChartFigure__summary itsm-visually-hidden"><span class="itsm-visually-hidden">. </span>Resolved kept pace</span>');
  });

  it('draws static, with a warning in development, past 400 values', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const long = days('2026-01-01', 201);
    const markup = html(<LineChart title="Year" interactive series={[series('a', long.map(() => 1), {}, long), series('b', long.map(() => 2), {}, long)]} xType="time" />);
    expect(markup).not.toContain('itsm-ChartReader');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(html(<LineChart title="Week" interactive series={[resolved]} xType="time" />)).toContain('itsm-ChartReader');
  });

  it('renders the same markup every time, and reveals once unless asked not to', () => {
    const one = html(<AreaChart title="Volume" series={[raised, resolved]} xType="time" markers={[{ kind: 'today' }]} asAt="2026-10-01T09:00:00Z" />);
    expect(html(<AreaChart title="Volume" series={[raised, resolved]} xType="time" markers={[{ kind: 'today' }]} asAt="2026-10-01T09:00:00Z" />)).toBe(one);
    expect(one).toContain('data-reveal="true"');
    expect(html(<AreaChart title="Volume" series={[resolved]} xType="time" animate={false} />)).not.toContain('data-reveal');
    expect(lineChartStyles).toMatch(/\.itsm-XYChart\[data-reveal\] \.itsm-XYChart__svg \{\s*animation: itsm-xy-reveal var\(--itsm-duration-reveal\)/);
    expect(lineChartStyles).toMatch(/:root\[data-itsm-motion="reduced"\] \.itsm-XYChart\[data-reveal\] \.itsm-XYChart__svg \{\s*animation: none;/);
  });
});

describe('increase contrast and forced colours', () => {
  it('thickens comparison lines and strengthens the axis with more contrast', () => {
    expect(lineChartStyles).toMatch(/high-contrast"\] \.itsm-XYChart__line:is\(\[data-style="comparison"\], \[data-style="baseline"\], \[data-style="forecast"\], \[data-reference\]\) \{ stroke-width: 2; \}/);
    expect(lineChartStyles).toMatch(/high-contrast"\] \.itsm-XYChart__gridline\[data-axis\] \{ stroke: var\(--itsm-colour-border-strong\); \}/);
  });

  it('draws lines in CanvasText, keeping each style’s dash, in forced colours', () => {
    const forced = lineChartStyles.slice(lineChartStyles.indexOf('@media (forced-colors: active)'));
    expect(forced).toContain('stroke: CanvasText;');
    expect(forced).toMatch(/\.itsm-XYChart__line:is\(\[data-style="comparison"\], \[data-style="baseline"\]\) \{\s*stroke-dasharray: 2 3;/);
    expect(forced).toMatch(/\.itsm-XYChart__line\[data-style="forecast"\] \{\s*stroke-dasharray: 5 4;/);
  });
});
