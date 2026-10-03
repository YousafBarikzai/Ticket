// @vitest-environment jsdom
import { act, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TestProvider } from '../../provider/__tests__/support/provider.js';
import { expectNoViolations } from '../../web/__tests__/support/audit.js';
import { cleanupDocument, press, render } from '../../web/__tests__/support/render.js';
import { ChartCard } from '../ChartCard.js';
import { DonutChart, type DonutSegment } from '../DonutChart.js';
import { donutChartStyles } from '../DonutChart.styles.js';

/**
 * `DonutChart` v3 (SPEC-v3 §8.2, A8 §4.9): at most six parts, the rest
 * folded into a hatched "Other · n"; parts by slot or by tone; a 1.5° gap;
 * the legend as the data, with bold values, beside or below the ring by
 * container query; two sizes; the reveal; and the card contract.
 */

const html = (element: ReactElement): string => renderToStaticMarkup(element);
const count = (markup: string, pattern: RegExp): number => markup.match(pattern)?.length ?? 0;
const all = (markup: string, pattern: RegExp): string[] => [...markup.matchAll(pattern)].map((match) => match[1]!);

afterEach(() => cleanupDocument());

const channels: DonutSegment[] = ['Email', 'Portal', 'Slack', 'Teams', 'Phone', 'API', 'Fax'].map((label, index) => ({ id: label.toLowerCase(), label, value: 70 - index * 10 }));
const states: DonutSegment[] = [
  { id: 'open', label: 'Open', value: 41, tone: 'info', slot: 3 },
  { id: 'waiting', label: 'Waiting', value: 7, tone: 'hold' },
  { id: 'breached', label: 'Breached', value: 3, tone: 'danger' },
  { id: 'none', label: 'Not set', value: 2, pattern: 'hatch' },
];

describe('parts', () => {
  it('is for six parts at most: the smallest fold into "Other · n", neutral and hatched, ring and key alike', () => {
    const markup = html(<DonutChart title="Channels" segments={channels} />);
    expect(count(markup, /class="itsm-DonutChart__segment"/g)).toBe(6);
    expect(markup).toContain('<path class="itsm-DonutChart__segment" data-tone="neutral" data-pattern="hatch"');
    expect(markup).toMatch(/<path class="itsm-DonutChart__texture" data-pattern="hatch" fill="url\(#itsm-donut-[a-z0-9]+-t2\)"/);
    expect(markup).toMatch(
      /data-mark="chip" data-tone="neutral" data-pattern="hatch" aria-hidden="true"><\/span><span class="itsm-ChartLegend__label">Other · 2<\/span><span class="itsm-ChartLegend__value">30<\/span><span class="itsm-ChartLegend__detail">11%</,
    );
    expect(donutChartStyles).toMatch(/\.itsm-DonutChart__texture\[data-pattern\] \{\s*display: inline;/);
    expect(donutChartStyles).toContain('.itsm-DonutChart .itsm-ChartLegend__key[data-pattern="hatch"] {');
  });

  it('never draws more than six parts, whatever is asked, and fewer when asked', () => {
    expect(count(html(<DonutChart title="Channels" segments={channels} maxSegments={12} />), /class="itsm-DonutChart__segment"/g)).toBe(6);
    const four = html(<DonutChart title="Channels" segments={channels} maxSegments={4} />);
    expect(count(four, /class="itsm-DonutChart__segment"/g)).toBe(4);
    expect(four).toContain('>Other · 4<');
  });

  it('colours parts by tone for a status donut, the tone winning over a slot, and hatches a part marked so', () => {
    const markup = html(<DonutChart title="By state" segments={states} />);
    expect(all(markup, /<path class="itsm-DonutChart__segment" ((?:data-[a-z]+="[^"]*" )*)d=/g)).toEqual([
      'data-tone="info" ',
      'data-tone="hold" ',
      'data-tone="danger" ',
      'data-slot="4" data-pattern="hatch" ',
    ]);
    expect(all(markup, /data-mark="chip" ((?:data-[a-z]+="[^"]*" )*)aria-hidden/g)).toEqual(['data-tone="info" ', 'data-tone="hold" ', 'data-tone="danger" ', 'data-slot="4" data-pattern="hatch" ']);
    // Tones are textured with more contrast like slots; `success` and slot 1 stay solid.
    expect(markup).toMatch(/<pattern id="itsm-donut-[a-z0-9]+-tinfo"/);
    expect(markup).toMatch(/<pattern id="itsm-donut-[a-z0-9]+-tdanger"/);
    const solid = html(<DonutChart title="SLA" segments={[{ id: 'met', label: 'Met', value: 9, tone: 'success' }, { id: 'a', label: 'A', value: 1, slot: 1 }]} />);
    expect(solid).not.toContain('itsm-DonutChart__texture');
  });

  it('draws each textured part twice, with the hatch shown by CSS only when wanted', () => {
    const markup = html(<DonutChart title="Channels" segments={channels.slice(0, 3)} />);
    expect(count(markup, /<pattern /g)).toBe(2);
    expect(count(markup, /itsm-DonutChart__texture" fill="url\(#itsm-donut-[a-z0-9]+-t[23]\)"/g)).toBe(2);
    expect(donutChartStyles).toMatch(/\.itsm-DonutChart__texture \{\s*display: none;/);
  });

  it('separates parts by a 1.5° surface gap, and draws one part as a whole ring', () => {
    const markup = html(<DonutChart title="Halves" segments={[{ id: 'a', label: 'A', value: 1 }, { id: 'b', label: 'B', value: 1 }]} />);
    // The first part starts 0.75° past twelve o'clock: x = 50 + 50 · sin(0.75°) = 50.65.
    expect(markup).toContain('d="M50.65 0A50 50 0 0 1 50.65 100');
    expect(html(<DonutChart title="Whole" segments={[{ id: 'a', label: 'A', value: 5 }]} />)).toContain('d="M50 0A50 50');
  });

  it('outlines the soft fill, as its tone asks', () => {
    expect(donutChartStyles).toMatch(/\.itsm-DonutChart__segment \{\s*fill: var\(--_itsm-series\);\s*stroke: var\(--_itsm-series-edge, none\);/);
  });

  it('is empty when nothing adds up to anything, and busy while loading', () => {
    expect(html(<DonutChart title="Channels" segments={[{ id: 'a', label: 'A', value: 0 }]} />)).toContain('No data for this period');
    expect(html(<DonutChart title="Channels" segments={[]} loading />)).toContain('aria-busy="true"');
  });
});

describe('the legend and the ring', () => {
  it('gives every part its value in bold and its share, so nobody reads an angle', () => {
    const markup = html(<DonutChart title="Channels" segments={channels.slice(0, 2)} />);
    expect(markup).toMatch(/Email<\/span><span class="itsm-ChartLegend__value">70<\/span><span class="itsm-ChartLegend__detail">54%/);
    expect(markup).toContain('<ul class="itsm-ChartLegend itsm-DonutChart__legend" aria-label="Legend">');
    expect(markup).toMatch(/itsm-visually-hidden">(<span[^>]*>\. <\/span>)?Email 54% and Portal 46%, of 130 in all\./);
  });

  it('puts the legend beside the ring in a card 22.5 rem wide, below it otherwise, or where the page says', () => {
    expect(html(<DonutChart title="x" segments={channels} />)).toContain('class="itsm-Chart itsm-DonutChart" data-legend="auto"');
    expect(html(<DonutChart title="x" segments={channels} legendPosition="side" />)).toContain('data-legend="side"');
    expect(html(<DonutChart title="x" segments={channels} legendPosition="bottom" />)).toContain('data-legend="bottom"');
    expect(donutChartStyles).toMatch(/\.itsm-DonutChart \{\s*display: flex;\s*flex-direction: column;/);
    expect(donutChartStyles).toMatch(/@container itsm-chart \(min-width: 22\.5rem\) \{\s*\.itsm-DonutChart\[data-legend="auto"\] \{\s*flex-direction: row;/);
    expect(donutChartStyles).toMatch(/\.itsm-DonutChart\[data-legend="side"\] \{\s*flex-direction: row;/);
  });

  it('draws the ring at 160 px, or 200 px for lg', () => {
    expect(html(<DonutChart title="x" segments={channels} />)).toContain('class="itsm-DonutChart__ring" data-size="md"');
    expect(html(<DonutChart title="x" segments={channels} size="lg" />)).toContain('data-size="lg"');
    expect(donutChartStyles).toMatch(/\.itsm-DonutChart__ring \{[^}]*inline-size: 10rem;\s*block-size: 10rem;/);
    expect(donutChartStyles).toMatch(/\.itsm-DonutChart__ring\[data-size="lg"\] \{\s*inline-size: 12\.5rem;\s*block-size: 12\.5rem;/);
  });

  it('says the centre figure once, in words, set in the stat numeral', () => {
    const markup = html(<DonutChart title="Channels" segments={channels.slice(0, 2)} centerValue="130" centerLabel="tickets" />);
    expect(markup).toContain('<span class="itsm-DonutChart__centre" aria-hidden="true">');
    expect(markup).toContain('<span class="itsm-visually-hidden">130 tickets</span>');
    expect(donutChartStyles).toMatch(/\.itsm-DonutChart__centreValue \{[^}]*font-size: var\(--itsm-text-statValue-size\);/);
  });

  it('offers the parts as a table behind "View as table" (A8 §6.1)', () => {
    const markup = html(<DonutChart title="Channels" segments={channels.slice(0, 2)} />);
    expect(markup).toContain('View as table');
    expect(markup).toContain('<th scope="row">Email</th><td data-numeric="true">70</td><td data-numeric="true">54%</td>');
    expect(html(<DonutChart title="Channels" segments={channels.slice(0, 2)} table="hidden" />)).not.toContain('<table');
  });
});

describe('the card, the reader and motion', () => {
  it('inside a headlined ChartCard, shows the headline once — the card’s — and reads it once with the figure', () => {
    const headline = 'Email brings half of all tickets';
    const markup = html(
      <ChartCard title="Channel mix" headline={headline}>
        <DonutChart title="Channel mix" segments={channels} />
      </ChartCard>,
    );
    expect(count(markup, new RegExp(headline, 'g'))).toBe(2);
    expect(markup).toContain(`<p class="itsm-ChartCard__headline">${headline}</p>`);
    expect(markup).toContain(`<span class="itsm-ChartFigure__summary itsm-visually-hidden"><span class="itsm-visually-hidden">. </span>${headline}</span>`);
    expect(html(<DonutChart title="x" segments={channels} description="Email leads." />)).toContain('<span class="itsm-ChartFigure__summary">Email leads.</span>');
  });

  it('reads each part with its value, share and colour when interactive', () => {
    const markup = html(<DonutChart title="Channels" segments={states} interactive />);
    expect(markup).toMatch(/role="group" aria-roledescription="chart" aria-label="Channels"/);
    expect(count(markup, /<g class="itsm-DonutChart__part" data-point="\d"/g)).toBe(4);
  });

  it('fades the ring in once, never under reduced motion or with animate={false}, and renders deterministically', () => {
    expect(html(<DonutChart title="x" segments={channels} />)).toContain('data-reveal=""');
    expect(html(<DonutChart title="x" segments={channels} animate={false} />)).not.toContain('data-reveal');
    expect(donutChartStyles).toMatch(/\.itsm-DonutChart\[data-reveal\] \.itsm-DonutChart__svg \{\s*animation: itsm-chart-reveal var\(--itsm-duration-reveal\) var\(--itsm-easing-entrance\);/);
    expect(donutChartStyles).toMatch(/:root\[data-itsm-motion="reduced"\] \.itsm-DonutChart__svg \{\s*animation: none;/);
    expect(html(<DonutChart title="x" segments={states} />)).toBe(html(<DonutChart title="x" segments={states} />));
  });

  it('shows each part’s hatch with more contrast, and outlines parts in forced colours', () => {
    expect(donutChartStyles).toContain(':root[data-itsm-theme="high-contrast"] .itsm-DonutChart__texture { display: inline; }');
    const forced = donutChartStyles.slice(donutChartStyles.indexOf('@media (forced-colors: active)'));
    expect(forced).toMatch(/\.itsm-DonutChart__segment \{\s*fill: Canvas;\s*stroke: CanvasText;/);
    expect(forced).toMatch(/\.itsm-DonutChart \.itsm-ChartLegend__key\[data-pattern\] \{\s*background: repeating-linear-gradient\(45deg, transparent 0 3px, CanvasText 3px 4\.5px\), Canvas;/);
  });
});

describe('accessibility', () => {
  it.each(['apple', 'apple-dark'])('passes axe in %s: folds, tones, sizes, legend positions, a card and a reading', async (theme) => {
    const { container } = render(
      <TestProvider>
        <div data-itsm-theme={theme}>
          <DonutChart title="Channels" segments={channels} centerValue="280" centerLabel="tickets" interactive table="visible" />
          <DonutChart title="By state" segments={states} size="lg" legendPosition="side" />
          <DonutChart title="Nothing" segments={[]} />
          <ChartCard title="Channel mix" headline="Email brings a quarter of all tickets">
            <DonutChart title="Channel mix" segments={channels.slice(0, 3)} legendPosition="bottom" />
          </ChartCard>
        </div>
      </TestProvider>,
    );
    const group = container.querySelector<HTMLElement>('[aria-roledescription="chart"]')!;
    press(group, 'ArrowRight');
    await act(async () => {
      await vi.dynamicImportSettled();
      await Promise.resolve();
    });
    for (const details of container.querySelectorAll('details')) details.open = true;
    await expectNoViolations(container);
  });
});
