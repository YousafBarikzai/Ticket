import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { transformSync } from 'esbuild';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { contrastRatio } from '../../tokens/contrast.js';
import { themeVariables } from '../../tokens/css.js';
import { themeNames } from '../../tokens/tokens.js';
import { AreaChart } from '../AreaChart.js';
import { BarChart } from '../BarChart.js';
import { BulletList } from '../Bullet.js';
import { ChartCard } from '../ChartCard.js';
import { CHART_TABLE_DEFAULTS, ChartFigure } from '../ChartFigure.js';
import { chartFigureStyles } from '../ChartFigure.styles.js';
import { DistributionBar } from '../DistributionBar.js';
import { DonutChart } from '../DonutChart.js';
import { Gauge } from '../Gauge.js';
import { LineChart, type ChartSeries } from '../LineChart.js';
import { CHART_EMPTY_TEXT, ChartEmpty, ChartLegend } from '../parts.js';
import { ProgressRing } from '../ProgressRing.js';
import { READER_CORE_MARK } from '../reader-core.js';
import { Sparkline } from '../Sparkline.js';
import { TEXTURE_TONES, TexturePatterns, textureId } from '../texture.js';
import { textureRules, textureVariables, toneTextureImages, toneTextureRules } from '../texture-css.js';

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
    const files = [
      'ChartFigure.tsx', 'LineChart.tsx', 'AreaChart.tsx', 'xy.tsx', 'BarChart.tsx', 'DonutChart.tsx', 'ProgressRing.tsx',
      'Sparkline.tsx', 'StatGrid.tsx', 'parts.tsx', 'texture.tsx', 'texture-css.ts', 'markers.tsx', 'common.ts', 'time.ts', 'scale.ts',
      'ChartCard.tsx', 'Gauge.tsx', 'Bullet.tsx', 'DistributionBar.tsx',
    ];
    for (const file of files) {
      const source = readFileSync(join(here, '..', file), 'utf8');
      expect(source.trimStart().startsWith("'use client'"), file).toBe(false);
    }
    // The client leaves are client modules: the reader island, its lazy core
    // and the link leaf. (`StatCard` is server-safe in v3, RV2; its own test,
    // `stat-card.test.tsx`, holds it to that.)
    for (const file of ['ChartReader', 'reader-core', 'ChartLink']) {
      expect(readFileSync(join(here, '..', `${file}.tsx`), 'utf8').trimStart().startsWith("'use client'"), file).toBe(true);
    }
  });

  it('never reads a clock or a random number: "today" is the asAt a page passes in (ADR-0064)', () => {
    // Comments may talk about clocks; code may not call one. `new Date(x)`
    // with an argument converts a value and is fine.
    const banned = /\bDate\.now\s*\(|\bnew\s+Date\s*\(\s*\)|\bperformance\.now\s*\(|\bMath\.random\s*\(/;
    const sources = readdirSync(join(here, '..')).filter((file) => /\.tsx?$/.test(file));
    expect(sources).toContain('time.ts');
    for (const file of sources) {
      const code = readFileSync(join(here, '..', file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
      expect(code.match(banned)?.[0], file).toBeUndefined();
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

  it('renders the v3 pieces without a provider or a browser', () => {
    expect(html(<Gauge label="SLA met" value={0.9} target={0.9} />)).toContain('itsm-Gauge__svg');
    expect(html(<DistributionBar label="Open" segments={[{ id: 'a', label: 'P1', value: 2, tone: 'danger' }]} />)).toContain('itsm-DistributionBar__segment');
    expect(html(<BulletList title="By team" rows={[{ id: 'a', label: 'Desk', value: 0.8, target: 0.9 }]} />)).toContain('itsm-Bullet__track');
    expect(html(<ChartCard title="Volume" headline="Rose"><LineChart title="Volume" series={[raised]} xType="time" /></ChartCard>)).toContain('itsm-ChartCard__headline');
  });

  it('keeps the plot out of the accessibility tree: the caption and the table carry it', () => {
    const markup = html(<LineChart title="Volume" series={[raised, resolved]} xType="time" />);
    expect(markup).toMatch(/<svg[^>]*aria-hidden="true"/);
    expect(markup).toMatch(/class="itsm-XYChart__y" aria-hidden="true"/);
    expect(markup).toMatch(/class="itsm-XYChart__x" aria-hidden="true"/);
  });
});

describe('the reader island and its lazy core (A8 §5.2, §8.2)', () => {
  /** A module's own cost: minified and gzipped at level 9, as `check-bundles` measures a chunk. */
  const gz = (file: string): number =>
    gzipSync(transformSync(readFileSync(join(here, '..', file), 'utf8'), { loader: 'tsx', jsx: 'automatic', minify: true, format: 'esm', target: 'es2022' }).code, { level: 9 }).length;

  it('keeps the island within 800 B and the core within 3,000 B', () => {
    expect(gz('ChartReader.tsx')).toBeLessThanOrEqual(800);
    expect(gz('reader-core.tsx')).toBeLessThanOrEqual(3000);
  });

  it('reaches the core only through import(), so it is its own chunk, found by its marker', () => {
    const island = readFileSync(join(here, '..', 'ChartReader.tsx'), 'utf8');
    expect(island).toContain("import('./reader-core.js')");
    // The marker in the island would put it in every first load, where the bundle check fails it.
    expect(island).not.toContain(READER_CORE_MARK);
    expect(READER_CORE_MARK).toBe('itsm-reader-core');
    expect(readFileSync(join(here, '..', 'reader-core.tsx'), 'utf8')).toContain(`'${READER_CORE_MARK}'`);
    const statically = /^\s*(?:import|export)\b[^;]*?\bfrom\s+['"]\.\/reader-core(?:\.js)?['"]/m;
    for (const file of readdirSync(join(here, '..')).filter((name) => /\.tsx?$/.test(name))) {
      expect(readFileSync(join(here, '..', file), 'utf8').match(statically)?.[0], file).toBeUndefined();
    }
  });
});

describe('textures by tone (A8 §6.3)', () => {
  it('gives every tone but success a hatch, in SVG and in CSS alike', () => {
    expect(TEXTURE_TONES).toEqual(['danger', 'high', 'warning', 'info', 'hold', 'neutral', 'neutralSoft']);
    const markup = html(
      <svg>
        <TexturePatterns id="c" slots={[2]} tones={['danger', 'success', 'info']} />
      </svg>,
    );
    expect(count(markup, /<pattern /g)).toBe(3);
    expect(markup).toContain(`id="${textureId('c', 'danger')}"`);
    expect(markup).toContain(`id="${textureId('c', 2)}"`);
    expect(markup).not.toContain(textureId('c', 'success'));
    expect(Object.keys(toneTextureImages('ink'))).toEqual(TEXTURE_TONES.map(String));
  });

  it('matches each tone’s CSS texture to a slot’s, so keys and marks agree', () => {
    expect(toneTextureImages('ink').danger).toBe(textureRules('', '.x', 'ink').match(/\[data-slot="4"\] \{ background: (.*), var\(--_itsm-series\); \}/)![1]);
    expect(toneTextureRules('.s', '.m', 'ink')).toContain('.s .m[data-tone="hold"] { background: ');
    expect(toneTextureRules('.s', '.m', 'ink')).not.toContain('success');
  });

  it('writes each key’s texture once as a variable in the ink its theme sets', () => {
    const rules = textureVariables('.m');
    expect(rules.split('\n')).toHaveLength(14);
    expect(rules).toContain('.m[data-tone="info"] { --_itsm-texture: radial-gradient(circle, var(--_itsm-ink) 1px, transparent 1.5px) 0 0 / 5px 5px; }');
    expect(textureVariables('.m', { slots: false }).split('\n')).toHaveLength(7);
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

  it('takes the card’s headline as its summary, for assistive technology only, since the card shows it (A8-S6)', () => {
    const markup = html(
      <ChartFigure title="Raised vs resolved" titleHidden summary="Raised rose from 12 to 18." headline="Resolved kept pace with raised" table={table}>
        p
      </ChartFigure>,
    );
    expect(markup).toContain('<figcaption class="itsm-ChartFigure__caption itsm-visually-hidden">');
    expect(markup).toContain('<span class="itsm-ChartFigure__summary itsm-visually-hidden"><span class="itsm-visually-hidden">. </span>Resolved kept pace with raised</span>');
    expect(markup).not.toContain('Raised rose');
  });

  it('falls back to the generated summary when the headline is blank', () => {
    const markup = html(<ChartFigure title="Volume" summary="Rose." headline="  " table={table}>p</ChartFigure>);
    expect(markup).toContain('<span class="itsm-ChartFigure__summary">Rose.</span>');
  });

  it('shows "no data" in a table as a dash, never as zero', () => {
    const markup = html(<ChartFigure title="t" summary="s" table={{ columns: ['Day', 'Raised'], rows: [['Mon', null]] }} tableMode="visible">p</ChartFigure>);
    expect(markup).toContain('<td data-numeric="true">—</td>');
  });

  it('reads a matrix by row and by column: row headers, column headers and column groups', () => {
    const matrix = {
      columns: ['Day', '09:00', '10:00', '09:00', '10:00'],
      columnGroups: [
        { label: '', span: 1 },
        { label: 'This week', span: 2 },
        { label: 'Last week', span: 2 },
      ],
      rows: [['Tue', 42, 30, 38, 29]],
    };
    const markup = html(<ChartFigure title="Arrivals" summary="s" table={matrix} tableMode="visible">p</ChartFigure>);
    expect(markup).toContain('<tr class="itsm-ChartFigure__groups"><td colSpan="1"></td><th scope="colgroup" colSpan="2">This week</th><th scope="colgroup" colSpan="2">Last week</th></tr>');
    expect(count(markup, /<th scope="col"/g)).toBe(5);
    expect(markup).toContain('<th scope="row">Tue</th>');
  });

  it('can leave out row headers, for a list with no name column', () => {
    const markup = html(<ChartFigure title="t" summary="s" table={{ columns: ['Value'], rows: [[3], [4]], rowHeaders: false }} tableMode="visible">p</ChartFigure>);
    expect(markup).not.toContain('scope="row"');
    expect(count(markup, /<td data-numeric="true">/g)).toBe(2);
  });

  it('offers the table behind a toggle where marks are positions, and leaves it out where the text already says every value', () => {
    expect(CHART_TABLE_DEFAULTS.xy).toBe('toggle');
    expect(CHART_TABLE_DEFAULTS.columns).toBe('toggle');
    expect(CHART_TABLE_DEFAULTS.heatmap).toBe('toggle');
    for (const kind of ['rows', 'list', 'gauge', 'distribution', 'bullet'] as const) expect(CHART_TABLE_DEFAULTS[kind], kind).toBe('hidden');
  });
});

describe('legend and empty plots', () => {
  it('keys each series with a 10 × 10 chip by default, radius 2.5 (A8-S2)', () => {
    const markup = html(<ChartLegend items={[{ id: 'a', label: 'Raised', slot: 2 }]} />);
    expect(markup).toContain('<span class="itsm-ChartLegend__key" data-mark="chip" data-slot="2" aria-hidden="true"></span>');
    expect(chartFigureStyles).toMatch(/\.itsm-ChartLegend__key\[data-mark="chip"\] \{\s*inline-size: 0\.625rem;\s*block-size: 0\.625rem;\s*border-radius: 0\.15625rem;/);
  });

  it('keys a state by its tone, which wins over a slot, and a comparison or forecast by its style', () => {
    const markup = html(
      <ChartLegend
        items={[
          { id: 'p1', label: 'P1', tone: 'danger', slot: 3 },
          { id: 'plan', label: 'Plan', style: 'comparison' },
          { id: 'next', label: 'Forecast', slot: 1, style: 'forecast' },
          { id: 'now', label: 'Actual', slot: 1, style: 'actual', value: '84%' },
        ]}
      />,
    );
    expect(markup).toContain('data-mark="chip" data-tone="danger" aria-hidden="true"');
    expect(markup).toContain('data-mark="chip" data-slot="1" data-style="comparison"');
    expect(markup).toContain('data-mark="chip" data-slot="1" data-style="forecast"');
    expect(markup).toMatch(/data-mark="chip" data-slot="1" aria-hidden="true"><\/span><span class="itsm-ChartLegend__label">Actual<\/span><span class="itsm-ChartLegend__value">84%<\/span>/);
  });

  it('keeps the line and box keys for the charts that still ask for them', () => {
    expect(html(<ChartLegend mark="line" items={[{ id: 'a', label: 'A', slot: 1 }]} />)).toContain('data-mark="line"');
  });

  it('colours tones after slots and the comparison grey after both, so state and style win', () => {
    const slot = chartFigureStyles.indexOf('[data-slot="1"]');
    const tone = chartFigureStyles.indexOf('[data-tone="danger"] { --_itsm-series: var(--itsm-colour-danger-border); }');
    const style = chartFigureStyles.indexOf('[data-style="baseline"] { --_itsm-series: var(--itsm-colour-chart-comparison); }');
    expect(slot).toBeGreaterThan(-1);
    expect(tone).toBeGreaterThan(slot);
    expect(style).toBeGreaterThan(tone);
    // The soft P4 fill is under 3:1 alone, so it carries its outline.
    expect(chartFigureStyles).toContain('--_itsm-series: var(--itsm-colour-chart-neutralSoft); --_itsm-series-edge: var(--itsm-colour-neutral-border);');
  });

  it('says why a plot is empty, in words, at the plot’s height', () => {
    const empty = html(<ChartEmpty height={240} />);
    expect(empty).toMatch(/^<div class="itsm-Chart__empty" data-reason="empty" style="min-block-size:240px"><span class="itsm-Chart__emptyDisc"><svg[^>]*data-icon="insights"/);
    expect(empty).toContain('<p class="itsm-Chart__emptyText">No data for this period</p>');
    const short = html(<ChartEmpty height={240} reason="insufficient" detail="Charts start once there are 3 days of data" />);
    expect(short).toContain('data-icon="hourglass"');
    expect(short).toContain('>Not enough history yet</p><p class="itsm-Chart__emptyDetail">Charts start once there are 3 days of data</p>');
    expect(html(<ChartEmpty height={240} reason="error" />)).toContain(`>${CHART_EMPTY_TEXT.error.replace("'", '&#x27;')}</p>`);
    expect(html(<ChartEmpty height={120} text="Nothing raised yet" />)).toContain('>Nothing raised yet</p>');
  });

  it('tints the empty disc by reason: brand for no data, neutral for too little, danger for a failed read', () => {
    expect(chartFigureStyles).toMatch(/\.itsm-Chart__emptyDisc \{[^}]*inline-size: 3rem;[^}]*background: var\(--itsm-colour-brand-subtle\);/);
    expect(chartFigureStyles).toMatch(/\[data-reason="insufficient"\] \.itsm-Chart__emptyDisc \{\s*background: var\(--itsm-colour-neutral-subtle\);/);
    expect(chartFigureStyles).toMatch(/\[data-reason="error"\] \.itsm-Chart__emptyDisc \{\s*background: var\(--itsm-colour-danger-subtle\);/);
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

  it('nudges end labels that would collide to 14 px apart rather than dropping them (A8-S5)', () => {
    const close: ChartSeries = { id: 'close', label: 'Close', points: days.map((x, index) => ({ x, y: [10, 14, 11, 18.5][index]! })) };
    const markup = html(<LineChart title="Volume" series={[raised, close]} xType="time" />);
    expect(markup).toContain('itsm-ChartLegend');
    const tops = [...markup.matchAll(/class="itsm-XYChart__endLabel" style="top:([\d.]+)px"/g)].map((match) => Number(match[1]));
    expect(tops).toHaveLength(2);
    expect(Math.abs(tops[0]! - tops[1]!)).toBeGreaterThanOrEqual(14);
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

// The bar and donut cases moved to `bar.test.tsx` and `donut.test.tsx` with
// the v3 charts (WP-44), each with its own axe cases in light and dark.

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

  it('ticks and names a target, and comes in a 140 size', () => {
    expect(html(<ProgressRing value={0.15} target={0.17} size={140} label="Updates on time" />)).toMatch(/aria-label="Updates on time: 15%, target 17%"[\s\S]*itsm-ProgressRing__target/);
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
    const markup = html(<Sparkline values={[1, null, 3, 4]} label="x" />);
    // The point alone before the gap has no area; the run after it has its own.
    const wash = markup.match(/class="itsm-Sparkline__wash" d="([^"]*)"/)?.[1] ?? '';
    expect(count(wash, /M/g)).toBe(1);
    expect(count(wash, /Z/g)).toBe(1);
  });

  it('fills its parent in a KPI tile, 40 px tall by default (A8 §4.2)', () => {
    const markup = html(<Sparkline values={[12, 14, 18]} label="Rising, 12 → 18" width="fill" tone="accent" />);
    expect(markup).toMatch(/^<span role="img" aria-label="Rising, 12 → 18" class="itsm-Sparkline" data-tone="accent" data-width="fill" style="block-size:40px">/);
    expect(markup).toContain('width="100%" height="40"');
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
